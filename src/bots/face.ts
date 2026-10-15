/**
 * A bot's look, resolved the way apps/desktop/src/plugins/hermes-bots/avatar.tsx
 * resolves it, and the static math face's geometry. The desktop's face clock
 * (blink, sway, working dots) is DOM-driven and is not ported yet; this is its
 * rest pose.
 */

import type { BotMeta } from './roster.ts';

type Point = [number, number];

const LEGACY_SHAPES = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const;
/** the friendly violet squircle the primary profile wears until customised */
export const PRIMARY_AVATAR_COLOR = '#8b5cf6';

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
    const [, seedPart = '', kind = ''] = shape.split(':');
    return { kind: 'blob', seed: seedPart || name || 'agent', shapeTrait: BLOB_KIND_TRAIT[kind] };
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
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

function dropRing(steps: number): Point[] {
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

const ringToPath = (pts: Point[]) =>
  pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z` : '';

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
        ? 'M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z'
        : ringToPath(faceRing(shape)),
    eyeY: shape === 'cloud' ? 22 : 17.2,
    eyeFill: dark ? 'rgba(232,220,195,0.95)' : 'rgba(0,0,0,0.85)',
    highlightFill: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
  };
}
