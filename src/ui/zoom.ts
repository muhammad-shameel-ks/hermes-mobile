/**
 * The maths behind pinch, pan and zoom on an image. Limits are the desktop's
 * `useZoomPan` (0.25-8x, 1.25 button steps); offsets are measured from the stage
 * centre. The functions are worklets so the gestures can run them on the UI
 * thread, and plain functions everywhere else. Pure.
 */

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
export const BUTTON_STEP = 1.25;
/** a double tap on a fitted picture lands here */
export const DOUBLE_TAP_SCALE = 2.5;

export type Size = { width: number; height: number };
export type View = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  'worklet';
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** the size `resizeMode="contain"` draws a picture at inside the stage */
export function containSize(natural: Size, stage: Size): Size {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) return stage;
  const fit = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * fit, height: natural.height * fit };
}

/** how far the picture may travel from the centre on one axis: its edge stops at the stage edge */
export function panLimit(content: number, stage: number, scale: number): number {
  'worklet';
  return Math.max(0, (content * scale - stage) / 2);
}

function bounded(value: number, limit: number): number {
  'worklet';
  // + 0 turns a -0 from a zero limit into 0
  return Math.min(limit, Math.max(-limit, value)) + 0;
}

export function clampView(view: View, content: Size, stage: Size): View {
  'worklet';
  return {
    scale: view.scale,
    x: bounded(view.x, panLimit(content.width, stage.width, view.scale)),
    y: bounded(view.y, panLimit(content.height, stage.height, view.scale)),
  };
}

/** zoom to `scale`, holding the point `focal` (from the stage centre) still */
export function zoomAbout(view: View, scale: number, focal: Point, content: Size, stage: Size): View {
  'worklet';
  const next = clampScale(scale);
  const k = next / view.scale;
  return clampView({ scale: next, x: focal.x - k * (focal.x - view.x), y: focal.y - k * (focal.y - view.y) }, content, stage);
}

/** a pinch from `start`: the scale follows the fingers' spread and the picture follows their midpoint */
export function pinchView(start: View, spread: number, from: Point, to: Point, content: Size, stage: Size): View {
  'worklet';
  const next = clampScale(start.scale * spread);
  const k = next / start.scale;
  return clampView(
    { scale: next, x: from.x - k * (from.x - start.x) + (to.x - from.x), y: from.y - k * (from.y - start.y) + (to.y - from.y) },
    content,
    stage,
  );
}

/** a double tap resets a zoomed picture and zooms a fitted one in on the tap */
export function doubleTapView(view: View, tap: Point, content: Size, stage: Size): View {
  'worklet';
  if (Math.abs(view.scale - 1) > 0.01) return IDENTITY;
  return zoomAbout(view, DOUBLE_TAP_SCALE, tap, content, stage);
}
