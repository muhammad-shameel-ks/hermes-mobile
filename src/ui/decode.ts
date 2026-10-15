/**
 * The "CONNECTING" scramble-decode, pure: desktop components/ui/decode-text.tsx.
 * An even-weight mono charset so cycling glyphs never change width; half a
 * character resolves per 45 ms tick; fully resolved it holds for 16 ticks, then
 * replays when looping. The first `prefix` characters never scramble.
 */

export const DECODE_SCRAMBLE_CHARS = '/\\|-_=+<>~:*';
export const DECODE_TICK_MS = 45;
export const DECODE_HOLD_TICKS = 16;

export type DecodeState = { resolved: number; hold: number };

export const DECODE_START: DecodeState = { resolved: 0, hold: 0 };

export function scrambled(tail: string, resolvedCount: number, random: () => number = Math.random): string {
  return Array.from(tail, (ch, i) =>
    ch === ' ' || i < resolvedCount ? ch : DECODE_SCRAMBLE_CHARS[(random() * DECODE_SCRAMBLE_CHARS.length) | 0],
  ).join('');
}

/** One interval tick: the text to paint and whether the interval should stop. */
export function decodeTick(
  state: DecodeState,
  tailText: string,
  loop: boolean,
  random: () => number = Math.random,
): { state: DecodeState; text: string; stop: boolean } {
  if (state.resolved >= tailText.length) {
    const hold = state.hold + 1;
    if (hold > DECODE_HOLD_TICKS) {
      return loop ? { state: DECODE_START, text: tailText, stop: false } : { state: { ...state, hold }, text: tailText, stop: true };
    }
    return { state: { ...state, hold }, text: tailText, stop: false };
  }
  const resolved = state.resolved + 0.5;
  return { state: { ...state, resolved }, text: scrambled(tailText, Math.floor(resolved), random), stop: false };
}
