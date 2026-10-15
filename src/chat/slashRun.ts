/**
 * Runs a typed slash command against the open chat.
 *
 * The desktop's dispatcher (app/session/hooks/use-prompt-actions/slash.ts),
 * cut to the phone's list: local actions, then `slash.exec` with a
 * `command.dispatch` fallback for everything else, and the dispatch directives
 * (`exec`, `alias`, `send`, `skill`, `prefill`) rendered the desktop's way. The
 * controller supplies the environment, so this stays free of sockets and state.
 */

import type { SessionCorrectionResult } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { skillInvocationText } from '../../vendor/hermes-shared/src/skill-scaffold.ts';
import { looksLikeSlashCommand, parseCommandDispatch, type CommandDispatchResponse } from '../../vendor/hermes-shared/src/slash.ts';
import { parseSlashLine, type SlashCommand } from './slash.ts';

export type SlashEnv = {
  isBotChat: boolean;
  running: boolean;
  /** whether a session exists yet; a draft has none until something needs one */
  hasSession: boolean;
  request: <T = unknown>(method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  /** the runtime id the gateway knows the open chat by, creating the session from a draft */
  sessionId: () => Promise<string | null>;
  /** the runtime id when one is already bound, never creating */
  runtimeId: () => string | null;
  /** a system line in the transcript */
  say: (text: string) => void;
  /** a transient notice outside the transcript */
  notify: (text: string) => void;
  newChat: () => void;
  compact: (focusTopic: string) => Promise<void>;
  stop: () => Promise<void>;
  setEffort: (effort: string) => Promise<void>;
  retitle: (title: string) => void;
  /** send `text` as a user turn; `display` is what the bubble reads when it differs */
  submit: (text: string, display?: string) => Promise<void>;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** the transcript line for a command's output: the command token, then what it printed */
const output = (name: string, body: string) => [`/${name}`, body.trim()].filter(Boolean).join('\n');

/**
 * Runs `text` when it is a slash command. Resolves false for prose that merely
 * starts with a slash (`/usr/local`), which goes out as an ordinary message.
 */
export async function runSlash(env: SlashEnv, text: string): Promise<boolean> {
  if (!looksLikeSlashCommand(text)) return false;
  const { command, name, arg } = parseSlashLine(text);
  if (!name) return false;
  const say = (body: string) => env.say(output(name, body));
  const surface = command?.surface;

  if (surface?.kind === 'action') {
    await runAction(env, command as SlashCommand, surface.action, arg, say);
    return true;
  }
  if (surface?.kind === 'ui') {
    // the chat screen opens these before the text ever reaches the controller
    say(`Open it from the composer: ${command?.description ?? name}.`);
    return true;
  }
  await runExec(env, text, name, arg, command, say);
  return true;
}

async function runAction(env: SlashEnv, command: SlashCommand, action: string, arg: string, say: (body: string) => void) {
  switch (action) {
    case 'new':
      if (env.isBotChat) {
        env.notify('This chat never resets. Bot chats are one continuous conversation, so it is compacting instead.');
        await env.compact('');
      } else {
        env.newChat();
      }
      return;
    case 'compress':
      if (!env.hasSession) return say('Nothing to compress yet.');
      await env.compact(arg.trim());
      return;
    case 'stop': {
      await env.stop();
      const sessionId = env.runtimeId();
      if (!sessionId) return;
      try {
        const result = await env.request<{ killed?: number }>('process.stop', { session_id: sessionId });
        const killed = typeof result?.killed === 'number' ? result.killed : 0;
        say(killed > 0 ? `Stopped ${killed} background process${killed === 1 ? '' : 'es'}.` : 'No background processes to stop.');
      } catch (error) {
        say(`Could not stop background processes: ${errorMessage(error)}`);
      }
      return;
    }
    case 'title': {
      if (!arg) return runExec(env, '/title', 'title', arg, command, say);
      const sessionId = await env.sessionId();
      if (!sessionId) return say('Could not start a session for this command.');
      try {
        const result = await env.request<{ title?: string }>('session.title', { session_id: sessionId, title: arg });
        const title = (result?.title || arg).trim();
        env.retitle(title);
        say(title ? `Session title set: ${title}` : 'Session title cleared.');
      } catch (error) {
        say(`error: ${errorMessage(error)}`);
      }
      return;
    }
    case 'steer': {
      const text = arg.trim();
      if (!text) return say('Usage: /steer <message> — sent after the next tool call without interrupting the turn.');
      // with no turn running the words are simply the next message
      if (!env.running) return env.submit(text);
      const sessionId = env.runtimeId();
      if (!sessionId) return say('Steer rejected — the session is not attached to the gateway.');
      try {
        const result = await env.request<SessionCorrectionResult>('session.steer', { session_id: sessionId, text });
        say(result?.status === 'queued' ? `Steered · "${text}" queued for next tool call` : 'Steer rejected — agent declined input');
      } catch (error) {
        say(`error: ${errorMessage(error)}`);
      }
      return;
    }
    case 'reasoning':
      return runReasoning(env, arg, say);
    case 'status': {
      const sessionId = await env.sessionId();
      if (!sessionId) return say('Could not start a session for this command.');
      try {
        const result = await env.request<{ output?: string }>('session.status', { session_id: sessionId });
        say(result?.output || 'No status.');
      } catch (error) {
        say(`error: ${errorMessage(error)}`);
      }
      return;
    }
    default:
      return;
  }
}

const GLOBAL_FLAGS = new Set(['--global', '-g', 'global']);
const SESSION_FLAGS = new Set(['--session', '-s', 'session']);

/** desktop lib/reasoning-slash.ts `reasoningSlashParams`: the level and the scope flag */
export function reasoningArgs(arg: string): { value: string; scope?: 'global' | 'session' } | null {
  let scope: 'global' | 'session' | undefined;
  const values: string[] = [];
  for (const part of arg.trim().split(/\s+/).filter(Boolean)) {
    const flag = part.toLowerCase();
    if (GLOBAL_FLAGS.has(flag)) scope = 'global';
    else if (SESSION_FLAGS.has(flag)) scope = 'session';
    else values.push(part);
  }
  return values.length ? { value: values.join(' ').toLowerCase(), ...(scope ? { scope } : {}) } : null;
}

async function runReasoning(env: SlashEnv, arg: string, say: (body: string) => void) {
  const parsed = reasoningArgs(arg);
  const sessionId = await env.sessionId();
  if (!sessionId) return say('Could not start a session for this command.');
  try {
    if (!parsed) {
      const current = await env.request<{ value?: string }>('config.get', { key: 'reasoning', session_id: sessionId });
      return say(`reasoning: ${current?.value || 'medium'}`);
    }
    // a bare level is the picker's own path; a scope flag needs the gateway's scope
    if (!parsed.scope) {
      await env.setEffort(parsed.value);
      return say(`reasoning: ${parsed.value}`);
    }
    const result = await env.request<{ value?: string }>('config.set', { key: 'reasoning', session_id: sessionId, value: parsed.value, scope: parsed.scope });
    say(`reasoning: ${result?.value || parsed.value}`);
  } catch (error) {
    say(`error: ${errorMessage(error)}`);
  }
}

/** an exec-routed command narrowed to subcommands refuses the rest, as the desktop's gate does */
export function subcommandRefusal(command: SlashCommand | null, name: string, arg: string): string | null {
  const allowed = command?.subcommands;
  if (!allowed) return null;
  const first = arg.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!first) return `/${name} needs a subcommand here: ${allowed.join(', ')}.`;
  if (!allowed.includes(first)) return `/${name} ${first} is not available on the phone. Available here: ${allowed.join(', ')}.`;
  return null;
}

/** the invocation a skill or bundle dispatch shows in the bubble, never its expanded body */
export function dispatchDisplay(dispatch: CommandDispatchResponse, message: string, typed: string): string {
  const projected = 'display' in dispatch ? dispatch.display?.trim() : '';
  return projected || skillInvocationText(message) || typed;
}

async function runExec(env: SlashEnv, text: string, name: string, arg: string, command: SlashCommand | null, say: (body: string) => void) {
  const refusal = subcommandRefusal(command, name, arg);
  if (refusal) return say(refusal);
  const sessionId = await env.sessionId();
  if (!sessionId) return say('Could not start a session for this command.');

  const handle = async (dispatch: CommandDispatchResponse): Promise<void> => {
    if (dispatch.type === 'exec' || dispatch.type === 'plugin') return say(dispatch.output ?? '(no output)');
    if (dispatch.type === 'alias') {
      await runSlash(env, `/${dispatch.target}${arg ? ` ${arg}` : ''}`);
      return;
    }
    const notice = (dispatch.type === 'send' || dispatch.type === 'prefill') && dispatch.notice?.trim();
    if (notice) say(notice);
    const message = ('message' in dispatch ? dispatch.message : '')?.trim() ?? '';
    if (!message) {
      if (dispatch.type === 'prefill' || notice) return;
      return say(`/${name}: ${dispatch.type === 'skill' ? 'skill payload missing message' : 'empty message'}`);
    }
    if (dispatch.type === 'prefill') return say(message);
    if (env.running) return say('Session busy — stop the current reply first, then send this command.');
    await env.submit(message, dispatchDisplay(dispatch, message, text.trim()));
  };

  let execError: unknown = null;
  try {
    const result = await env.request<unknown>('slash.exec', { session_id: sessionId, command: text.trim().replace(/^\/+/, '') });
    const dispatch = parseCommandDispatch(result);
    if (dispatch) return await handle(dispatch);
    const body = result && typeof result === 'object' ? (result as { output?: string | null; warning?: string | null }) : null;
    const printed = body?.output || `/${name}: no output`;
    return say(body?.warning ? `warning: ${body.warning}\n${printed}` : printed);
  } catch (error) {
    execError = error;
  }

  // a skill, bundle or alias is routed by command.dispatch; keep the worker's error when that has nothing to add
  try {
    const dispatch = parseCommandDispatch(await env.request<unknown>('command.dispatch', { session_id: sessionId, name, arg }));
    if (!dispatch) return say('error: invalid response: command.dispatch');
    await handle(dispatch);
  } catch (error) {
    const message = errorMessage(error);
    if (execError && /not a quick\/plugin\/(?:bundle\/)?skill command/i.test(message)) return say(`error: /${name} failed: ${errorMessage(execError)}`);
    say(`error: ${message}`);
  }
}
