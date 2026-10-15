/**
 * The soft keyboard's geometry rule, pure. The dashboard's `keyboard-inset.ts`
 * (web/src/lib) treats an inset under 80 px as no keyboard at all: collapsing
 * chrome and floating or split keyboards report small, transient heights that
 * must not read as an open IME, shift the composer or claim the back press.
 */

export const KEYBOARD_INSET_MIN_PX = 80;

/** the keyboard's inset, or 0 when the reading is below the floor or unusable */
export function keyboardInset(height: number | null | undefined): number {
  if (typeof height !== 'number' || !Number.isFinite(height)) return 0;
  const inset = Math.round(height);
  return inset >= KEYBOARD_INSET_MIN_PX ? inset : 0;
}

export const keyboardOpen = (height: number | null | undefined) => keyboardInset(height) > 0;
