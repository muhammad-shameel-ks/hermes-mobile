/**
 * The sidebar row's measurements, in one place, as the desktop spells them in
 * apps/desktop/src/app/chat/sidebar/row-geometry.ts: the session row is canonical and everything
 * else composes these, so no row floats a pixel off the ones above it.
 *
 * Parity deviation (touch): the desktop's row is 1.625rem (26) tall; a phone's is never under
 * ROW_MIN_H, the platform's 40dp hit area. Every other figure is the desktop's, 1:1 in dp.
 */

/** `SIDEBAR_ROW_MIN_H` is 26 on the desktop; 40 is the phone's minimum hit area */
export const ROW_MIN_H = 40;
/** `SIDEBAR_ROW_PAD_X`: `pl-2 pr-2` */
export const ROW_PAD_X = 8;
/** `SIDEBAR_ROW_GAP`: `gap-1.5` */
export const ROW_GAP = 6;
/** `SIDEBAR_ROW_LEAD`: the fixed leading cell (dot, icon) every label starts after */
export const ROW_LEAD = 14;
/** the stack of rows: `gap-px` */
export const ROW_STACK_GAP = 1;
/** `SIDEBAR_ROW_LABEL`: `text-[0.8125rem]` */
export const LABEL_SIZE = 13;
/** `SIDEBAR_TRUNCATED_LEADING`: `leading-[1.35]` */
export const LABEL_LINE = Math.round(LABEL_SIZE * 1.35);
/** the age and metadata: `text-[0.625rem]` */
export const AGE_SIZE = 10;
/** the sidebar's own content inset: `px-2.5` */
export const SIDEBAR_INSET = 10;
/** a branch row's extra indent: `pl-3.5` */
export const BRANCH_INDENT = 14;
/** the running arc's ring: `--arc-width: 0.078125rem` */
export const ARC_WIDTH = 1.25;
