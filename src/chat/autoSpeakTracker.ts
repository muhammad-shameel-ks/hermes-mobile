/**
 * When "Read Responses Aloud" speaks (desktop use-auto-speak-replies.ts), as a
 * pure step over what the open chat shows: a reply is read once, when a turn
 * that ran in front of the user finishes. Opening a chat, switching to another
 * or its history loading never reads what is already there, and turning the
 * toggle on consumes the reply at the bottom.
 */

import type { Message } from './transcript.ts';

export type SpeakTracker = { session: string | null; armed: boolean; spoken: string | null };

export type SpeakObservation = { session: string; running: boolean; lastReplyId: string | null };

export const idleTracker = (): SpeakTracker => ({ session: null, armed: false, spoken: null });

/** the reply a finished turn leaves at the bottom: the last assistant message that is not an interim segment */
export function lastReplyId(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') return null;
    if (message.role === 'assistant' && !message.interim) return message.id;
  }
  return null;
}

/** the next tracker, and the reply to read now if a turn just finished with a new one */
export function observeReply(tracker: SpeakTracker, seen: SpeakObservation): { tracker: SpeakTracker; speak: string | null } {
  if (seen.session !== tracker.session) {
    // a chat that is mid-turn when it opens still has its finish read (its live reply is the one that
    // finishes, so nothing counts as spoken yet); one at rest has nothing new
    return { tracker: { session: seen.session, armed: seen.running, spoken: seen.running ? null : seen.lastReplyId }, speak: null };
  }
  if (seen.running) return { tracker: tracker.armed ? tracker : { ...tracker, armed: true }, speak: null };
  if (!tracker.armed) return { tracker, speak: null };
  const fresh = seen.lastReplyId !== null && seen.lastReplyId !== tracker.spoken;
  return { tracker: { ...tracker, armed: false, spoken: fresh ? seen.lastReplyId : tracker.spoken }, speak: fresh ? seen.lastReplyId : null };
}
