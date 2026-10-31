/**
 * Pure rule for the transcript's motion between chats: when the open chat has really changed, so the
 * pane fades its content in.
 */

import { FRESH_DRAFT_KEY } from '../store/drafts.ts';

/** what the pane last committed: the chat it showed, that chat's first message, and how many switches it has made */
export type Seen = { key: string; first: string | null; epoch: number };

/**
 * The pane's state after rendering `key`. `epoch` advances when the reader moved to another chat. The
 * first send from a fresh chat is not a move: the draft's entry is re-keyed to the session it created, so
 * the key changes while the very same transcript (same first message) stays on screen.
 * Returns `prev` when nothing moved, so the caller can compare by identity.
 */
export function nextSeen(prev: Seen, key: string, first: string | null): Seen {
  if (key === prev.key) return first === prev.first ? prev : { ...prev, first };
  const promoted = prev.key === FRESH_DRAFT_KEY && prev.first !== null && prev.first === first;
  return { key, first, epoch: promoted ? prev.epoch : prev.epoch + 1 };
}
