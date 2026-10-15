/**
 * The transcript model: one session's messages built from REST history, then
 * advanced by live gateway events. Pure functions over plain data, so a stream
 * can be replayed in tests exactly as the socket delivers it.
 *
 * A turn's assistant and tool rows merge into one assistant message whose parts
 * keep their order - reasoning, text, tool calls - the way the desktop hydrates
 * them (apps/desktop/src/lib/chat-messages/hydration.ts). A stored tool result
 * pairs with the unresolved call carrying its tool_call_id, or its name when the
 * row has no id; tool-call ids repeat across turns, so a resolved call never
 * takes a second result.
 */

import { reactionsFromMetadata, withAgentReactions, type Reaction } from './actionBar.ts';
import { parseObject } from './json.ts';
import { reviewNoteText } from './reviewNote.ts';
import { applyWaitEvent, idleWait, type TurnWait } from './turnActivity.ts';

export type ToolPart = {
  kind: 'tool';
  id: string;
  name: string;
  /** a one-line description of what the call touched */
  context: string;
  args: Record<string, unknown>;
  status: 'running' | 'done';
  summary?: string;
  /** the tool's raw result, JSON-encoded when it was structured */
  result?: string;
  /** the gateway's display rendering of the result (`result_text`) */
  resultText?: string;
  /** the gateway's own account of a failure (`tool.complete` `error`) */
  error?: string;
  durationS?: number;
};

export type Part = { kind: 'text'; text: string } | { kind: 'reasoning'; text: string } | ToolPart;

export type MessageStatus = 'streaming' | 'complete' | 'error' | 'interrupted';

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: Part[];
  status: MessageStatus;
  /** a sealed segment of a turn that is still running: settled text, no action bar */
  interim?: boolean;
  error?: string;
  /** epoch seconds */
  timestamp?: number;
  /** the durable `messages.id`, once the row exists; reactions and rewinds address a message by it */
  rowId?: number;
  reactions?: Reaction[];
  /** wall-clock seconds a live turn ran */
  durationS?: number;
};

export type Transcript = {
  messages: Message[];
  running: boolean;
  /** the assistant message live deltas append to */
  liveId: string | null;
  /** the next delta opens a new text part (a `null` delta marked a segment boundary) */
  breakText: boolean;
  /** the named waits the tail activity row can show: compaction, a provider wait, a tool being drafted */
  wait: TurnWait;
};

export const emptyTranscript = (): Transcript => ({ messages: [], running: false, liveId: null, breakText: false, wait: idleWait() });

// ─── history ─────────────────────────────────────────────────────────────────

export type SessionMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: unknown;
  display_content?: unknown;
  text?: unknown;
  context?: unknown;
  name?: string;
  reasoning?: string | null;
  reasoning_content?: string | null;
  display_reasoning?: string;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  tool_name?: string;
  args?: unknown;
  display_kind?: string;
  display_metadata?: unknown;
  timestamp?: number;
  id?: number;
  row_id?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** content may be a string or OpenAI-style parts; anything else reads as empty */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        return record && typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const CONTEXT_KEYS = ['context', 'command', 'path', 'file_path', 'query', 'url', 'pattern', 'name', 'goal'];

/** the desktop titles a tool row from its most telling argument */
export function toolContext(args: Record<string, unknown>, fallback = ''): string {
  for (const key of CONTEXT_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ');
  }
  return fallback.trim().replace(/\s+/g, ' ');
}

function storedCall(call: unknown, index: number): ToolPart {
  const row = asRecord(call) ?? {};
  const fn = asRecord(row.function);
  const args = parseObject(fn?.arguments ?? row.arguments ?? row.args ?? row.input);
  return {
    kind: 'tool',
    id: String(row.id ?? row.tool_call_id ?? `stored-tool-${index}`),
    name: String(row.name ?? row.tool_name ?? fn?.name ?? 'tool'),
    context: toolContext(args),
    args,
    status: 'running',
  };
}

function encodeResult(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function attachResult(parts: Part[], row: SessionMessage): boolean {
  const id = row.tool_call_id || undefined;
  const name = row.tool_name || row.name || 'tool';
  const index = parts.findIndex(
    (part) => part.kind === 'tool' && part.status === 'running' && (id ? part.id === id : part.name === name),
  );
  if (index < 0) return false;
  const part = parts[index] as ToolPart;
  parts[index] = { ...part, status: 'done', result: textOf(row.content ?? row.text) };
  return true;
}

export function fromHistory(rows: SessionMessage[]): Message[] {
  const messages: Message[] = [];
  let turn: Message | null = null;

  const closeTurn = () => {
    if (turn) {
      for (const [i, part] of turn.parts.entries()) {
        // a call whose result never persisted (interrupted turn) is over all the same
        if (part.kind === 'tool' && part.status === 'running') turn.parts[i] = { ...part, status: 'done' };
      }
      if (turn.parts.length) messages.push(turn);
    }
    turn = null;
  };

  rows.forEach((row, index) => {
    if (row.display_kind === 'hidden') return;
    const rowId = row.row_id ?? row.id;
    const id = rowId !== undefined ? `row-${rowId}` : `hist-${index}`;

    if (row.role === 'user' || row.role === 'system') {
      closeTurn();
      const text = textOf(row.display_content ?? row.content ?? row.text);
      if (text.trim()) {
        const reactions = reactionsFromMetadata(row.display_metadata);
        messages.push({
          id,
          role: row.role,
          parts: [{ kind: 'text', text }],
          status: 'complete',
          timestamp: row.timestamp,
          ...(rowId !== undefined ? { rowId } : {}),
          ...(reactions.length ? { reactions } : {}),
        });
      }
      return;
    }

    if (!turn) turn = { id, role: 'assistant', parts: [], status: 'complete', timestamp: row.timestamp };

    if (row.role === 'tool') {
      if (!attachResult(turn.parts, row)) {
        const args = parseObject(row.args);
        turn.parts.push({
          kind: 'tool',
          id: row.tool_call_id || `stored-tool-message-${index}`,
          name: row.tool_name || row.name || 'tool',
          context: toolContext(args, textOf(row.context)),
          args,
          status: 'done',
          result: textOf(row.content ?? row.text),
        });
      }
      return;
    }

    const reasoning = row.display_reasoning ?? row.reasoning ?? row.reasoning_content;
    if (reasoning) turn.parts.push({ kind: 'reasoning', text: reasoning });
    const text = textOf(row.display_content ?? row.content ?? row.text);
    if (text.trim()) turn.parts.push({ kind: 'text', text });
    // the turn answers to its last reply row: that row is what a reaction lands on
    if (rowId !== undefined && (text.trim() || turn.rowId === undefined)) {
      turn.rowId = rowId;
      const reactions = reactionsFromMetadata(row.display_metadata);
      turn.reactions = reactions.length ? reactions : undefined;
    }
    if (Array.isArray(row.tool_calls)) row.tool_calls.forEach((call, i) => turn!.parts.push(storedCall(call, i)));
  });

  closeTurn();
  return messages;
}

// ─── live events ─────────────────────────────────────────────────────────────

export type LiveEvent = { type: string; payload?: unknown };

let liveCounter = 0;
const nextLiveId = () => `live-${Date.now().toString(36)}-${(liveCounter += 1)}`;

/** where a message sits, searched from the tail: the live and the just-sealed messages are the newest */
function indexOfId(messages: readonly Message[], id: string): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].id === id) return i;
  return -1;
}

/** only the one message changes identity; an update that changes nothing hands the transcript back as it was */
function updateMessage(state: Transcript, id: string, update: (message: Message) => Message): Transcript {
  const index = indexOfId(state.messages, id);
  if (index < 0) return state;
  const message = state.messages[index];
  const next = update(message);
  if (next === message) return state;
  const messages = state.messages.slice();
  messages[index] = next;
  return { ...state, messages };
}

/** the live assistant message, opened on demand */
function ensureLive(state: Transcript): [Transcript, string] {
  if (state.liveId && indexOfId(state.messages, state.liveId) >= 0) return [state, state.liveId];
  const id = nextLiveId();
  const message: Message = { id, role: 'assistant', parts: [], status: 'streaming', timestamp: Math.floor(Date.now() / 1000) };
  return [{ ...state, messages: [...state.messages, message], liveId: id, breakText: false, running: true }, id];
}

function appendText(parts: Part[], kind: 'text' | 'reasoning', text: string, breakText: boolean): Part[] {
  const last = parts[parts.length - 1];
  if (last && last.kind === kind && !(kind === 'text' && breakText)) {
    const next = parts.slice();
    next[next.length - 1] = { kind, text: last.text + text };
    return next;
  }
  return [...parts, { kind, text }];
}

/** Array.prototype.findLast without the copy-and-reverse, and without relying on the engine having it */
export function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) if (test(items[i])) return items[i];
  return undefined;
}

const hasText = (message: Message) => message.parts.some((part) => part.kind === 'text' && part.text.trim() !== '');

function settle(message: Message, status: MessageStatus): Message {
  return {
    ...message,
    status,
    parts: message.parts.map((part) => (part.kind === 'tool' && part.status === 'running' ? { ...part, status: 'done' } : part)),
  };
}

/** seconds since the turn's prompt was sent, as the desktop stamps a finished turn */
function turnDuration(state: Transcript): { durationS?: number } {
  const prompt = findLast(state.messages, (m) => m.role === 'user');
  if (!prompt?.timestamp) return {};
  return { durationS: Math.max(1, Math.round(Date.now() / 1000 - prompt.timestamp)) };
}

export function addUserMessage(state: Transcript, text: string): Transcript {
  const message: Message = {
    id: nextLiveId(),
    role: 'user',
    parts: [{ kind: 'text', text }],
    status: 'complete',
    timestamp: Math.floor(Date.now() / 1000),
  };
  return { ...state, messages: [...state.messages, message], running: true, liveId: null, breakText: false };
}

export function addSystemNotice(state: Transcript, text: string): Transcript {
  const message: Message = { id: nextLiveId(), role: 'system', parts: [{ kind: 'text', text }], status: 'complete' };
  return { ...state, messages: [...state.messages, message] };
}

export function applyEvent(state: Transcript, event: LiveEvent): Transcript {
  const payload = asRecord(event.payload) ?? {};
  const wait = applyWaitEvent(state.wait, event.type, payload);
  return applyStreamEvent(wait === state.wait ? state : { ...state, wait }, event.type, payload);
}

function applyStreamEvent(state: Transcript, type: string, payload: Record<string, unknown>): Transcript {
  const str = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : '');

  switch (type) {
    case 'message.start': {
      const [next] = ensureLive({ ...state, running: true });
      return next;
    }
    case 'message.delta': {
      if (payload.text === null) return state.liveId ? { ...state, breakText: true } : state;
      const text = str('text');
      if (!text) return state;
      const [next, id] = ensureLive(state);
      return { ...updateMessage(next, id, (m) => ({ ...m, parts: appendText(m.parts, 'text', text, next.breakText) })), breakText: false };
    }
    case 'reasoning.delta': {
      const text = str('text');
      if (!text) return state;
      const [next, id] = ensureLive(state);
      return updateMessage(next, id, (m) => ({ ...m, parts: appendText(m.parts, 'reasoning', text, false) }));
    }
    case 'reasoning.available': {
      const text = str('text');
      if (!text) return state;
      const [next, id] = ensureLive(state);
      return updateMessage(next, id, (m) =>
        m.parts.some((part) => part.kind === 'reasoning') ? m : { ...m, parts: [{ kind: 'reasoning', text }, ...m.parts] },
      );
    }
    case 'tool.start': {
      const [next, id] = ensureLive(state);
      const args = parseObject(payload.args ?? payload.args_text);
      const tool: ToolPart = {
        kind: 'tool',
        id: str('tool_id') || nextLiveId(),
        name: str('name') || 'tool',
        context: toolContext(args, str('context') || str('preview')),
        args: Object.keys(args).length ? args : { ...(str('context') ? { context: str('context') } : {}), ...(str('preview') ? { preview: str('preview') } : {}) },
        status: 'running',
      };
      return { ...updateMessage(next, id, (m) => ({ ...m, parts: [...m.parts, tool] })), breakText: true };
    }
    case 'tool.complete': {
      const toolId = str('tool_id');
      const name = str('name');
      const target = findLast(state.messages, (m) => m.parts.some((p) => p.kind === 'tool' && p.status === 'running' && (toolId ? p.id === toolId : p.name === name)));
      if (!target) return state;
      return updateMessage(state, target.id, (m) => {
        let done = false;
        return {
          ...m,
          parts: m.parts.map((part) => {
            if (done || part.kind !== 'tool' || part.status !== 'running' || (toolId ? part.id !== toolId : part.name !== name)) return part;
            done = true;
            const args = parseObject(payload.args);
            const error = typeof payload.error === 'string' ? payload.error : payload.error === true ? 'Tool returned an error.' : undefined;
            return {
              ...part,
              args: Object.keys(args).length ? args : part.args,
              status: 'done',
              summary: str('summary') || undefined,
              result: encodeResult(payload.result) ?? (str('result_text') || undefined),
              resultText: str('result_text') || undefined,
              error: error?.trim() || undefined,
              durationS: typeof payload.duration_s === 'number' ? payload.duration_s : undefined,
            };
          }),
        };
      });
    }
    case 'message.interim': {
      if (!state.liveId) return state;
      const text = str('text');
      const sealed = updateMessage(state, state.liveId, (m) => {
        const withText = !payload.already_streamed && text && !hasText(m) ? { ...m, parts: [...m.parts, { kind: 'text' as const, text }] } : m;
        return { ...settle(withText, 'complete'), interim: true };
      });
      return { ...sealed, liveId: null, breakText: false };
    }
    case 'message.complete': {
      const status = (['complete', 'error', 'interrupted'] as const).find((s) => s === payload.status) ?? 'complete';
      const finalText = str('text') || str('rendered');
      const error = str('error') || undefined;
      let next = state;
      let id = state.liveId;
      if (!id && (finalText || error)) [next, id] = ensureLive(state);
      if (id) {
        next = updateMessage(next, id, (m) => {
          const withText = finalText && !hasText(m) ? { ...m, parts: [...m.parts, { kind: 'text' as const, text: finalText }] } : m;
          return { ...settle(withText, status), error, ...turnDuration(next) };
        });
      }
      return { ...next, running: false, liveId: null, breakText: false, wait: idleWait() };
    }
    case 'message.reaction': {
      const rowId = payload.row_id;
      if (typeof rowId !== 'number' || !Array.isArray(payload.reactions)) return state;
      const announced = payload.reactions as Reaction[];
      const target = state.messages.find((m) => m.rowId === rowId);
      return target ? updateMessage(state, target.id, (m) => ({ ...m, reactions: withAgentReactions(m.reactions, announced) })) : state;
    }
    case 'error': {
      const message = str('message') || 'The gateway reported an error.';
      const settled = state.liveId ? updateMessage(state, state.liveId, (m) => settle(m, 'error')) : state;
      return { ...addSystemNotice(settled, message), running: false, liveId: null, wait: idleWait() };
    }
    case 'review.summary': {
      // the background self-improvement review saved to memory or skills; a persistent row, never a toast
      const text = reviewNoteText(str('text'));
      return text ? addSystemNotice(state, text) : state;
    }
    case 'session.info': {
      if (payload.running !== false) return payload.running === true ? { ...state, running: true } : state;
      const settled = state.liveId ? updateMessage(state, state.liveId, (m) => settle(m, m.status === 'streaming' ? 'complete' : m.status)) : state;
      return { ...settled, running: false, liveId: null, wait: idleWait() };
    }
    default:
      return state;
  }
}
