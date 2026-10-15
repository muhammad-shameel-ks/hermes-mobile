/**
 * The self-improvement review's summary (desktop gateway-event/status.ts and
 * thread/system-message.tsx). The gateway sends `review.summary` with prose
 * like "💾 Self-improvement review: …"; the transcript keeps it as a system
 * message under the `review:` marker, so the row can paint it as the memory
 * write it is instead of sniffing the backend's prose.
 */

export const REVIEW_NOTE_PREFIX = 'review:';
const REVIEW_NOTE_RE = /^review:(?<label>[^:\n]+):?\s*(?<detail>[\s\S]*)$/;

/** the summary without its leading emoji (the row draws its own glyph), marked as a review note */
export function reviewNoteText(raw: string): string {
  const text = raw.trim().replace(/^[^\p{L}\p{N}]+/u, '');
  return text ? `${REVIEW_NOTE_PREFIX}${text}` : '';
}

export function parseReviewNote(text: string): { label: string; detail: string } | null {
  const match = REVIEW_NOTE_RE.exec(text);
  if (!match?.groups) return null;
  return { label: match.groups.label.trim(), detail: match.groups.detail.trim() };
}
