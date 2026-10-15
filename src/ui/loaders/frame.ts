/**
 * The loader's per-frame maths, ported from the desktop's components/ui/loader.tsx
 * (`buildPath`, `particleFor`, `detailScaleFor`, `rotationFor`, `roseCurve` and the
 * `lemniscate-bloom` entry), via the prototype/shell-loader branch.
 *
 * One self-contained worklet in a module of its own: the worklets plugin compiles
 * each 'worklet' function into a factory over its closure, so helpers outside it
 * are not reachable from the UI thread. Everything it needs is declared inside
 * it, which also keeps it callable as plain JS for the tests.
 */

export type LoaderKind = 'rose-curve' | 'lemniscate-bloom';

export type CurveConfig = {
  durationMs: number;
  particleCount: number;
  pulseDurationMs: number;
  rotate: boolean;
  rotationDurationMs: number;
  strokeWidth: number;
  trailSpan: number;
};

export type LoaderFrame = { curve: string; trail: string };

/** The curve's path and the trail's discs at `timeMs`, for a spinner that began with `phase` (0..1) of its cycle already elapsed. */
export function loaderFrame(kind: LoaderKind, config: CurveConfig, timeMs: number, phase: number, strokeScale: number, pathSteps: number): LoaderFrame {
  'worklet';
  const TWO_PI = Math.PI * 2;
  const pulse = ((timeMs + phase * config.pulseDurationMs) % config.pulseDurationMs) / config.pulseDurationMs;
  const detailScale = 0.52 + ((Math.sin(pulse * TWO_PI + 0.55) + 1) / 2) * 0.48;
  const rotation = config.rotate ? -(((timeMs + phase * config.rotationDurationMs) % config.rotationDurationMs) / config.rotationDurationMs) * 360 : 0;
  const radians = (rotation * Math.PI) / 180;
  const cosR = Math.cos(radians);
  const sinR = Math.sin(radians);
  const progress = ((timeMs + phase * config.durationMs) % config.durationMs) / config.durationMs;

  // the desktop rotates the whole group; baking it into the points needs no third animated prop
  const point = (at: number): [number, number] => {
    const t = at * TWO_PI;
    let x = 0;
    let y = 0;
    if (kind === 'rose-curve') {
      const a = 9.2 + detailScale * 0.6;
      const r = a * (0.72 + detailScale * 0.28) * Math.cos(5 * t);
      x = 50 + Math.cos(t) * r * 3.25;
      y = 50 + Math.sin(t) * r * 3.25;
    } else {
      const scale = 20 + detailScale * 7;
      const denom = 1 + Math.sin(t) ** 2;
      x = 50 + (scale * Math.cos(t)) / denom;
      y = 50 + (scale * Math.sin(t) * Math.cos(t)) / denom;
    }
    if (rotation === 0) return [x, y];
    const dx = x - 50;
    const dy = y - 50;
    return [50 + dx * cosR - dy * sinR, 50 + dx * sinR + dy * cosR];
  };

  let curve = '';
  for (let index = 0; index <= pathSteps; index++) {
    const [x, y] = point(index / pathSteps);
    curve += `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }

  let trail = '';
  for (let index = 0; index < config.particleCount; index++) {
    const tailOffset = index / (config.particleCount - 1);
    const wrapped = (((progress - tailOffset * config.trailSpan) % 1) + 1) % 1;
    const [x, y] = point(wrapped);
    const fade = (1 - tailOffset) ** 0.56;
    const radius = (0.9 + fade * 2.7) * strokeScale;
    const diameter = radius * 2;
    // a disc as two arcs, so all particles share one path
    trail +=
      `M ${(x - radius).toFixed(2)} ${y.toFixed(2)}` +
      ` a ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 ${diameter.toFixed(3)} 0` +
      ` a ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 -${diameter.toFixed(3)} 0 Z `;
  }

  return { curve, trail };
}
