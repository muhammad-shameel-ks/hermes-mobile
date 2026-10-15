/**
 * The sidebar row's measurements, in one place, as the desktop spells them in
 * apps/desktop/src/app/chat/sidebar/row-geometry.ts: the session row is canonical and everything
 * else composes these, so no row floats a pixel off the ones above it.
 *
 * Parity deviation (touch): the desktop's row is 1.625rem (26) tall; a phone's is ROW_MIN_H, the
 * platform's 44pt row. The type is set at phone reading size (16pt labels, as native chat apps do)
 * rather than the desktop's 13px, and the padding grows with it.
 */

/** `SIDEBAR_ROW_MIN_H` is 26 on the desktop; 44 is the phone's comfortable row */
export const ROW_MIN_H = 44;
/** `SIDEBAR_ROW_PAD_X`: `pl-2 pr-2`, widened for touch */
export const ROW_PAD_X = 10;
/** `SIDEBAR_ROW_GAP`: `gap-1.5`, widened to sit the larger label off its lead */
export const ROW_GAP = 10;
/** `SIDEBAR_ROW_LEAD`: the fixed leading cell (dot, icon) every label starts after */
export const ROW_LEAD = 14;
/** the stack of rows: `gap-px` */
export const ROW_STACK_GAP = 1;
/** `SIDEBAR_ROW_LABEL`: the desktop's 0.8125rem, at phone reading size */
export const LABEL_SIZE = 16;
/** `SIDEBAR_TRUNCATED_LEADING`: `leading-[1.35]` */
export const LABEL_LINE = Math.round(LABEL_SIZE * 1.35);
/** the age and metadata: the desktop's 0.625rem, at phone size */
export const AGE_SIZE = 12;
/** the sidebar's own content inset: `px-2.5`, widened for the phone */
export const SIDEBAR_INSET = 12;
/** a branch row's extra indent: `pl-3.5` */
export const BRANCH_INDENT = 14;
/** the running arc's ring: `--arc-width: 0.078125rem` */
export const ARC_WIDTH = 1.25;
