/**
 * The one status a session row paints, so the sessions list and the bot roster never disagree about
 * what a session is doing (apps/desktop/src/store/session-dot-state.ts `$sessionDotStateById`).
 * The desktop's `stalled` refinement needs its stream watchdog and is not ported: a running session
 * stays `working`.
 */

import type { ChatEntry } from '../chat/controller.ts';

export type DotState = 'background' | 'draft' | 'idle' | 'needs-input' | 'unread' | 'working';

export type Activity = { running: boolean; needsInput: boolean; background: boolean };

export const IDLE_ACTIVITY: Activity = { running: false, needsInput: false, background: false };

/** what a live chat is doing: a turn streaming, a question blocking it, a process or subagent outliving it */
export function chatActivity(entry: ChatEntry | undefined): Activity {
  if (!entry) return IDLE_ACTIVITY;
  const { approvals, clarify, prompts } = entry.requests;
  const status = entry.stack.status;
  return {
    running: entry.transcript.running,
    needsInput: approvals.length > 0 || clarify !== null || Object.keys(prompts).length > 0,
    background: status.background.some((item) => item.state === 'running') || status.subagents.some((agent) => agent.status === 'running' || agent.status === 'queued'),
  };
}

/**
 * Weakest claim first, as the desktop paints it: a blocking prompt outranks everything because it is
 * the only state that needs the reader; then the turn itself; then work that outlived it; then a
 * finished turn the reader has not seen; then a draft (nothing has run yet).
 */
export function resolveDotState({ activity, unread = false, draft = false }: { activity: Activity; unread?: boolean; draft?: boolean }): DotState {
  if (activity.needsInput) return 'needs-input';
  if (activity.running) return 'working';
  if (activity.background) return 'background';
  if (unread) return 'unread';
  if (draft) return 'draft';
  return 'idle';
}

/** a turn is live: the brighter title (a turn waiting on an answer has not ended) */
export const hasLiveTurn = (state: DotState) => state === 'working' || state === 'needs-input';

/** the desktop dot's accessible labels (`sidebar.row`) */
export const DOT_LABELS: Record<DotState, string | undefined> = {
  'needs-input': 'Needs your input',
  working: 'Session running',
  background: 'Background task running',
  unread: 'Finished — unread',
  draft: 'Draft — nothing sent yet',
  idle: undefined,
};

type Runs = Record<string, { transcript: { running: boolean } } | undefined>;

/**
 * The sessions whose turn finished while another chat was on screen. A turn that ends in the chat the
 * reader is looking at is not news; opening a session reads it.
 */
export function nextFinishedAway(marks: Readonly<Record<string, true>>, before: Runs, after: Runs, openKey: string): Readonly<Record<string, true>> {
  const finished = Object.entries(after).filter(
    ([key, entry]) => key !== openKey && !marks[key] && before[key]?.transcript.running === true && entry !== undefined && !entry.transcript.running,
  );
  if (finished.length === 0 && !marks[openKey]) return marks;
  const next = { ...marks };
  for (const [key] of finished) next[key] = true;
  delete next[openKey];
  return next;
}
