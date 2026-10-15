/**
 * A bot's look, resolved the way apps/desktop/src/plugins/hermes-bots/avatar.tsx
 * resolves it, the math face's geometry, and the face clock's maths (pose per
 * mood, the 0.4 s blend between moods, the projected body and eye frame). The
 * desktop paints these into the DOM; here they are pure functions of time, marked
 * 'worklet' so the animated face evaluates them on the UI thread.
 */

import type { BotMeta } from './roster.ts';

type Point = [number, number];

const LEGACY_SHAPES = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const;
/** the flat shapes the picker offers when blobatar is not in use */
export const AVATAR_PICKER_SHAPES = ['circle', 'blob', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
/** the friendly violet squircle the primary profile wears until customised */
export const PRIMARY_AVATAR_COLOR = '#8b5cf6';

export const BLOB_KINDS = ['round', 'organic', 'boxy', 'capsule', 'nub', 'cloud', 'droplet', 'hexagon', 'sun', 'triangle'];

/** blobatar gen2 band centres, per silhouette */
const BLOB_KIND_TRAIT: Record<string, number> = {
  round: 0.11,
  organic: 0.35,
  boxy: 0.54,
  capsule: 0.65,
  nub: 0.745,
  cloud: 0.825,
  droplet: 0.8875,
  hexagon: 0.9325,
  sun: 0.965,
  triangle: 0.99,
};

function hash31(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

export function defaultShapeFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LEGACY_SHAPES[hash % LEGACY_SHAPES.length];
}

/** lib/profile-color.ts: a stable hue per named profile; none for default (comma syntax for React Native) */
export function profileColor(name: string): string | null {
  const key = name.trim();
  if (!key || key === 'default') return null;
  return `hsl(${hash31(key) % 360}, 68%, 58%)`;
}

/** a stored face colour wins; none falls back to the name's hue, then the primary violet */
export function avatarColor(color: string | null | undefined, name: string): string {
  return color || profileColor(name) || PRIMARY_AVATAR_COLOR;
}

export const isBlobShape = (shape: string | null | undefined) =>
  shape === 'blobatar' || (typeof shape === 'string' && shape.startsWith('blobatar:'));

/**
 * `blobatar` follows the name, `blobatar:<seed>` pins the seed, `blobatar:<seed>:<kind>`
 * pins a silhouette too, `blobatar::<kind>` pins only the silhouette.
 */
export function parseBlobShape(shape: string | null | undefined, name: string | undefined) {
  const parts = typeof shape === 'string' ? shape.split(':') : [];
  const seedPart = parts[1] || '';
  const kind = BLOB_KINDS.includes(parts[2]) ? parts[2] : '';
  return { seed: seedPart || name || 'agent', seedPart, kind };
}

export function blobShapeString(seedPart: string, kind: string): string {
  if (kind) return `blobatar:${seedPart}:${kind}`;
  return seedPart ? `blobatar:${seedPart}` : 'blobatar';
}

/** lib/profile-color.ts: twelve evenly spaced hues at the deterministic palette's saturation and lightness */
export const PROFILE_SWATCHES: readonly string[] = Array.from({ length: 12 }, (_, i) => `hsl(${i * 30}, 68%, 58%)`);

/** avatar.tsx `botAppearance`: what the editor opens on - the primary's violet squircle until customised, else the stored pick or the name's own */
export function botAppearance(name: string, meta: BotMeta): { shape: string; color: string | null } {
  if (name.trim().toLowerCase() === 'default' && !meta.custom) return { shape: 'squircle', color: PRIMARY_AVATAR_COLOR };
  return { shape: meta.shape || defaultShapeFor(name), color: meta.color || profileColor(name) };
}

export type Look =
  | { kind: 'image' }
  | { kind: 'blob'; seed: string; shapeTrait?: number }
  | { kind: 'face'; shape: string; color: string };

/** `botAppearance` + the blob/face split in `BotFace` */
export function resolveLook(name: string, meta: BotMeta, hasAvatar: boolean): Look {
  if (hasAvatar) return { kind: 'image' };
  const isPrimary = name.trim().toLowerCase() === 'default';
  if (isPrimary && !meta.custom) return { kind: 'face', shape: 'squircle', color: PRIMARY_AVATAR_COLOR };
  const shape = meta.shape || defaultShapeFor(name);
  if (shape === 'blobatar' || shape.startsWith('blobatar:')) {
    const { seed, kind } = parseBlobShape(shape, name);
    return { kind: 'blob', seed, shapeTrait: BLOB_KIND_TRAIT[kind] };
  }
  // sigils are line art the phone does not draw; they fall back to the circle face
  const faceShape = shape.startsWith('sigil-') ? 'circle' : shape;
  return { kind: 'face', shape: faceShape, color: meta.color || profileColor(name) || PRIMARY_AVATAR_COLOR };
}

/** eyes flip light on dark bodies; an hsl() colour reads as light, as on the desktop */
export function isDarkColor(color: string): boolean {
  const n = parseInt(color.slice(1), 16);
  if (!color.startsWith('#') || Number.isNaN(n)) return false;
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 110;
}

const cubicAt = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  'worklet';
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

function dropRing(steps: number): Point[] {
  'worklet';
  const pts: Point[] = [];
  const n = Math.max(8, Math.floor(steps / 3));
  for (let i = 0; i < n; i++) pts.push(cubicAt([20, 3], [20, 3], [6, 20], [6, 27], i / n));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    pts.push([20 - 14 * Math.cos(t), 27 + 13.5 * Math.sin(t)]);
  }
  for (let i = 1; i <= n; i++) pts.push(cubicAt([34, 27], [34, 20], [20, 3], [20, 3], i / n));
  return pts;
}

function faceRing(shape: string, steps = 52): Point[] {
  'worklet';
  if (shape === 'drop' || shape === 'teardrop') return dropRing(steps);
  const pts: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let rx = 16.2;
    let ry = 16.2;
    if (shape === 'blob') {
      rx = ry = 16 + 1.7 * Math.sin(3 * a) + 0.7 * Math.cos(5 * a);
    } else if (shape === 'squircle') {
      rx = ry = 16.2 / (Math.pow(Math.abs(c) ** 5 + Math.abs(s) ** 5, 1 / 5) || 1);
    } else if (shape === 'pill') {
      rx = ry = 16 / (Math.pow(Math.abs(c) ** 8 + Math.abs(s / 0.72) ** 8, 1 / 8) || 1);
    } else if (shape === 'triangle' || shape === 'tetrahedron' || shape === 'wedge') {
      const u = (a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      const sector = (u / ((Math.PI * 2) / 3)) % 1;
      rx = ry = 13.5 / Math.max(0.42, Math.cos((sector - 0.5) * 1.9));
    } else if (shape === 'hexagon' || shape === 'hex' || shape === 'icosahedron' || shape === 'dodecahedron') {
      const seg = Math.PI / 3;
      rx = ry = 16.2 * (Math.cos(seg / 2) / Math.cos(a - seg * Math.round(a / seg)));
    } else if (shape === 'cube' || shape === 'octahedron') {
      rx = ry = 16 / (Math.pow(Math.abs(c) ** 3.1 + Math.abs(s) ** 3.1, 1 / 3.1) || 1);
    } else if (shape === 'pebble') {
      rx = 16.4 * (1.04 - 0.14 * Math.cos(2 * a));
      ry = 15.2 * (1.06 + 0.08 * Math.sin(2 * a));
    }
    pts.push([20 + rx * c, 20 + ry * s]);
  }
  return pts;
}

const ringToPath = (pts: Point[]) => {
  'worklet';
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 1) d += `L${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  return `${d}Z`;
};

const CLOUD_BODY = 'M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z';

export type FaceGeometry = {
  /** in a 40×44 viewBox */
  body: string;
  eyeY: number;
  eyeFill: string;
  highlightFill: string;
};

export function faceGeometry(shape: string, color: string): FaceGeometry {
  const dark = isDarkColor(color);
  return {
    body:
      shape === 'cloud'
        ? CLOUD_BODY
        : ringToPath(faceRing(shape)),
    eyeY: shape === 'cloud' ? 22 : 17.2,
    eyeFill: dark ? 'rgba(232,220,195,0.95)' : 'rgba(0,0,0,0.85)',
    highlightFill: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
  };
}

export type FaceMood = 'idle' | 'think' | 'work';

/** avatar.tsx `botWorkingMood`: a turn running in the bot's chat reads as thinking, a live worker as working */
export function faceMood(thinking: boolean, working: boolean): FaceMood {
  return thinking ? 'think' : working ? 'work' : 'idle';
}

/** one frame of the head: orientation, gaze offset, blink, and the three working dots' opacities */
export type FacePose = {
  turn: number;
  tilt: number;
  roll: number;
  gazeX: number;
  gazeY: number;
  blink: boolean;
  d0: number;
  d1: number;
  d2: number;
};

/** avatar.tsx `facePose`: working poses lean and sway, idle stays small */
export function facePose(mood: string, t: number): FacePose {
  'worklet';
  if (mood === 'think' || mood === 'work') {
    const thinking = mood === 'think';
    const rate = thinking ? 2.4 : 2.6;
    const dot = (lag: number) => 0.2 + 0.8 * Math.max(0, Math.sin(t * rate - lag));
    return {
      turn: thinking ? -18 + Math.sin(t * 0.55) * 14 : -11 + Math.sin(t * 0.48) * 8,
      tilt: thinking ? Math.sin(t * 0.48) * 12 + Math.sin(t * 1.35) * 3 : Math.sin(t * 0.42) * 8 + Math.sin(t * 1.1) * 1.6,
      roll: thinking ? Math.sin(t * 0.95) * 10 : Math.sin(t * 0.75) * 4.2,
      gazeX: thinking ? Math.sin(t * 0.7) * 3.6 : Math.sin(t * 0.55) * 3.6,
      gazeY: thinking ? -2.2 + Math.sin(t * 0.4) * 2.2 : -1.6 + Math.sin(t * 0.38) * 2,
      blink: t % 1.45 > 1.26,
      d0: dot(0),
      d1: dot(0.7),
      d2: dot(1.4),
    };
  }
  return {
    turn: Math.sin(t * 0.5) * 1.5,
    tilt: Math.sin(t * 0.27),
    roll: Math.sin(t * 0.85) * 1.2,
    gazeX: 0,
    gazeY: 0,
    blink: t % 3.2 > 3.02,
    d0: 0,
    d1: 0,
    d2: 0,
  };
}

export type PoseTransition = { mood: string; pose: FacePose; from: FacePose; since: number };

/** a mood change blends from the last painted pose over this long (avatar.tsx `settlePose`) */
export const POSE_BLEND_S = 0.4;

/** avatar.tsx `settlePose`: eases (quadratic out) from the last painted pose into the new mood's, in elapsed time */
export function settlePose(prev: PoseTransition | null, mood: string, target: FacePose, t: number): PoseTransition {
  'worklet';
  let state: PoseTransition = prev ?? { mood, pose: target, from: target, since: t - POSE_BLEND_S };
  if (state.mood !== mood) state = { mood, pose: state.pose, from: state.pose, since: t };
  const progress = Math.min(1, Math.max(0, (t - state.since) / POSE_BLEND_S));
  const blend = 1 - (1 - progress) ** 2;
  const from = state.from;
  const pose: FacePose = {
    turn: from.turn + (target.turn - from.turn) * blend,
    tilt: from.tilt + (target.tilt - from.tilt) * blend,
    roll: from.roll + (target.roll - from.roll) * blend,
    gazeX: from.gazeX + (target.gazeX - from.gazeX) * blend,
    gazeY: from.gazeY + (target.gazeY - from.gazeY) * blend,
    blink: target.blink,
    d0: from.d0 + (target.d0 - from.d0) * blend,
    d1: from.d1 + (target.d1 - from.d1) * blend,
    d2: from.d2 + (target.d2 - from.d2) * blend,
  };
  return { mood, pose, from, since: state.since };
}

function projectFacePoint(x: number, y: number, turn: number, tilt: number, roll: number): Point {
  'worklet';
  const dx = x - 20;
  const dy = y - 20;
  const r = (roll * Math.PI) / 180;
  const xr = dx * Math.cos(r) - dy * Math.sin(r);
  const yr = dx * Math.sin(r) + dy * Math.cos(r);
  const sx = 0.74 + 0.26 * Math.abs(Math.cos((turn * Math.PI) / 180));
  const sy = 0.8 + 0.2 * Math.abs(Math.cos((tilt * Math.PI) / 180));
  return [20 + xr * sx, 20 + yr * sy];
}

/** everything the clock moves, for one pose */
export type FaceFrame = {
  body: string;
  eyeL: number;
  eyeR: number;
  eyeY: number;
  /** the catchlights ride the pupils, upper-left */
  hlL: number;
  hlR: number;
  hlY: number;
  /** eyes open (1) or shut (0); the shut line is `shut` */
  open: number;
  shut: string;
  shutOpacity: number;
  d0: number;
  d1: number;
  d2: number;
  /** degrees, about 50% / 70% of the face box */
  tilt: number;
};

const r2 = (n: number) => {
  'worklet';
  return Math.round(n * 100) / 100;
};

/** avatar.tsx `paintMathFace`, as a value instead of DOM writes */
export function faceFrame(shape: string, pose: FacePose): FaceFrame {
  'worklet';
  let body = CLOUD_BODY;
  if (shape !== 'cloud') {
    const ring = faceRing(shape);
    const projected: Point[] = [];
    for (let i = 0; i < ring.length; i += 1) projected.push(projectFacePoint(ring[i][0], ring[i][1], pose.turn, pose.tilt, pose.roll));
    body = ringToPath(projected);
  }
  const eyeY = (shape === 'cloud' ? 22 : 17.2) + pose.gazeY;
  const eyeL = 15.4 + pose.gazeX;
  const eyeR = 24.6 + pose.gazeX;
  return {
    body,
    eyeL,
    eyeR,
    eyeY,
    hlL: eyeL - 0.6,
    hlR: eyeR - 0.6,
    hlY: eyeY - 0.7,
    open: pose.blink ? 0 : 1,
    shut: `M${r2(eyeL - 2.6)} ${r2(eyeY)} L${r2(eyeL + 2.6)} ${r2(eyeY)} M${r2(eyeR - 2.6)} ${r2(eyeY)} L${r2(eyeR + 2.6)} ${r2(eyeY)}`,
    shutOpacity: pose.blink ? 1 : 0,
    d0: pose.d0,
    d1: pose.d1,
    d2: pose.d2,
    tilt: pose.tilt,
  };
}
