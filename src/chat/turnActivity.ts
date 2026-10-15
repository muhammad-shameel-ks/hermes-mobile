/**
 * The transcript's tail activity row, as pure logic (desktop
 * components/assistant-ui/thread/status.tsx and turn-activity.ts, and the wait
 * stores they read: store/provider-wait.ts, store/tool-drafting.ts,
 * store/compaction.ts).
 *
 * The row is the dithered pulse, an optional named wait, and the seconds the
 * wait has run. Before a reply has put anything on screen it always shows;
 * after that only a named wait shows at once, an unnamed gap has to go quiet
 * for TURN_QUIET_S first, and a running tool row or an open question to the
 * user already accounts for the wait.
 */

import { toolPresentVerb } from './toolView.ts';
import type { Message, Part } from './transcript.ts';

/** seconds of silence before an unnamed wait earns a row of its own */
export const TURN_QUIET_S = 2;

/** long enough that a tool whose arguments land in a few frames never strobes a label */
export const DRAFTING_REVEAL_MS = 200;

/** fixed label while compaction runs, decoupled from the backend's status text */
export const COMPACTION_LABEL = 'Summarizing thread';

export type TurnWait = {
  /** `status.update` compacting/compressing, until compacted/ready or the turn resumes */
  compacting: boolean;
  /** an explained provider wait frame from `thinking.delta` */
  providerWait: string;
  /** the tool whose arguments the model is streaming, and since when (epoch ms) */
  drafting: { name: string; since: number } | null;
};

export const idleWait = (): TurnWait => ({ compacting: false, providerWait: '', drafting: null });

// any other output proves the session moved on from what it was drafting
const DRAFT_SUPERSEDING = new Set([
  'error',
  'message.complete',
  'message.delta',
  'message.start',
  'reasoning.delta',
  'thinking.delta',
  'tool.complete',
  'tool.start',
]);

const PROVIDER_WAIT_SUPERSEDING = new Set([
  'error',
  'message.complete',
  'message.delta',
  'message.interim',
  'message.start',
  'reasoning.available',
  'reasoning.delta',
  'tool.complete',
  'tool.generating',
  'tool.start',
]);

// mid-turn compaction emits no second message.start: the first output after it means the turn resumed
const COMPACTION_RESUME = new Set([
  'message.delta',
  'message.interim',
  'thinking.delta',
  'reasoning.delta',
  'reasoning.available',
  'moa.reference',
  'moa.aggregating',
  'moa.progress',
  'moa.phase',
  'tool.start',
  'tool.generating',
  'tool.complete',
]);

/** only the core's explained wait and reconnect frames belong in the row; spinner rewrites are noise */
export function providerWaitText(text: string): string {
  const value = text.trim();
  return /^(?:⏳|⚠|↻|⚙)\s*(?:(?:still\s+)?waiting on|loading|processing prompt|no (?:output|response)|model returned|rate limited|provider (?:overloaded|temporarily unavailable))/i.test(
    value,
  )
    ? value
    : '';
}

export type ModelLoadWait = { label: string; percent: number | null };

/**
 * A managed-local load or prefill frame as a label and a real percent, or null
 * for every other wait: "⏳ loading <model> into memory — 43% …" and
 * "⚙ processing prompt — 31%" (a percentless prefill keeps its label, no bar).
 */
export function parseModelLoadWait(text: string): ModelLoadWait | null {
  const value = text.trim();
  const clamp = (raw: string) => Math.max(0, Math.min(100, Number(raw)));
  const load = /^⏳\s*loading\s+(.+?)\s+into memory\s+—\s+(\d{1,3})%/i.exec(value);
  if (load) return { label: `Loading ${load[1]} into memory`, percent: clamp(load[2]) };
  const prefill = /^⚙\s*processing prompt(?:\s+—\s+(\d{1,3})%)?/i.exec(value);
  if (prefill) return { label: 'Processing prompt', percent: prefill[1] === undefined ? null : clamp(prefill[1]) };
  return null;
}

/** advance the named waits by one gateway event */
export function applyWaitEvent(wait: TurnWait, type: string, payload: Record<string, unknown>, now = Date.now()): TurnWait {
  let next = wait;
  const set = (patch: Partial<TurnWait>) => {
    next = { ...next, ...patch };
  };
  if (next.drafting && DRAFT_SUPERSEDING.has(type)) set({ drafting: null });
  if (next.providerWait && PROVIDER_WAIT_SUPERSEDING.has(type)) set({ providerWait: '' });
  if (next.compacting && COMPACTION_RESUME.has(type)) set({ compacting: false });

  const text = typeof payload.text === 'string' ? payload.text : '';
  if (type === 'tool.generating') {
    const name = typeof payload.name === 'string' ? payload.name : '';
    // re-announcing the same tool keeps its timestamp, so the count reads as one wait
    if (!name) set({ drafting: null });
    else if (next.drafting?.name !== name) set({ drafting: { name, since: now } });
  } else if (type === 'thinking.delta') {
    const providerWait = providerWaitText(text);
    if (providerWait !== next.providerWait) set({ providerWait });
  } else if (type === 'status.update') {
    if (payload.kind === 'compacting' || payload.kind === 'compressing') set({ compacting: true });
    else if (payload.kind === 'compacted' || payload.kind === 'ready') set({ compacting: false });
  }
  return next;
}

/** what to call the wait, if it deserves a name; compaction outranks a provider wait, which outranks a draft */
export function waitHint(wait: TurnWait, draftRevealed: boolean): string {
  if (wait.compacting) return COMPACTION_LABEL;
  if (wait.providerWait) return wait.providerWait;
  return draftRevealed && wait.drafting ? toolPresentVerb(wait.drafting.name) : '';
}

// `todo` lives in its own panel and a reaction's UI is the emoji: neither leaves a row to time
const SILENT_TOOLS = new Set(['react_to_message', 'todo', 'todo_list']);
// a question card is the user's move, not the agent's
const QUESTION_CARD_TOOLS = new Set(['clarify']);

const isQuestionCard = (part: Part) => part.kind === 'tool' && QUESTION_CARD_TOOLS.has(part.name);

/** a value that changes exactly when the turn makes visible progress */
export function activitySignature(parts: readonly Part[]): string {
  let textLength = 0;
  let settledTools = 0;
  for (const part of parts) {
    if (part.kind === 'tool') {
      if (part.status === 'done' && !isQuestionCard(part)) settledTools += 1;
    } else {
      textLength += part.text.length;
    }
  }
  return `${parts.length}:${textLength}:${settledTools}`;
}

/** a call in flight renders its own row, so a second indicator would count the same seconds twice */
export function toolNarratesWait(parts: readonly Part[]): boolean {
  return parts.some((part) => part.kind === 'tool' && part.status === 'running' && !SILENT_TOOLS.has(part.name) && !isQuestionCard(part));
}

/**
 * Which row the tail owes the user: `placeholder` before the reply has put
 * anything on screen (always shown), `activity` once it has (shown through
 * named waits and quiet gaps). The phone always draws reasoning, so a reply that
 * has only thought counts as on screen.
 */
export function tailSlot(messages: readonly Message[]): 'placeholder' | 'activity' {
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return 'placeholder';
  if (last.role === 'assistant' && last.status === 'streaming' && last.parts.length === 0) return 'placeholder';
  return 'activity';
}

/** the tail message's parts, where the signature and the narration check look */
export function tailParts(messages: readonly Message[]): readonly Part[] {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' ? last.parts : [];
}
