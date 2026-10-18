/**
 * Streamed text fading in. Every paced render appends a chunk to the open markdown block; a chunk
 * starts clear and reaches full ink over `FADE_MS`, so a reply arrives behind a soft leading edge
 * instead of in 50 ms steps. The trail is arithmetic over source lengths and clock time; `fadeTail`
 * then repaints only the trailing characters of the rendered elements, walking back from the end
 * and cloning just the elements on that path, so a render costs O(fading text), never O(block).
 *
 * Source characters stand in for rendered ones: markdown syntax in the newest chunk (a `**`, a
 * list marker) shifts the edge by those few characters, which a fade this short does not show.
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

/** how long a chunk takes to reach full ink */
export const FADE_MS = 320;
/** alpha is painted in these steps: it bounds the distinct colours (and their memo entries) a fade mints */
const STEPS = 10;

/** a stretch of the block's source, `[start, end)`, that arrived at `at` */
type FadeChunk = { start: number; end: number; at: number };

/** the block's source length and its chunks still fading in, oldest first */
export type FadeTrail = { length: number; chunks: readonly FadeChunk[] };

/** `chars` characters at `alpha`, counted back from the end of the text, newest first */
export type FadeSpan = { chars: number; alpha: number };

/**
 * The trail after the block's source reached `length` at `now`. A first sighting fades the whole
 * block in; growth adds a chunk; a source that shrank was rewritten, so it paints solid.
 */
export function growTrail(trail: FadeTrail | null, length: number, now: number): FadeTrail {
  if (!trail) return { length, chunks: length > 0 ? [{ start: 0, end: length, at: now }] : [] };
  if (length === trail.length) return trail;
  if (length < trail.length) return { length, chunks: [] };
  const chunks = trail.chunks.filter((chunk) => now - chunk.at < FADE_MS);
  chunks.push({ start: trail.length, end: length, at: now });
  return { length, chunks };
}

/** ease-out: a chunk shows most of its ink early, so the edge reads as arriving, not as lagging */
function alphaAt(elapsed: number): number {
  const progress = Math.min(1, Math.max(0, elapsed / FADE_MS));
  return Math.round((1 - (1 - progress) ** 2) * STEPS) / STEPS;
}

/** the trail's still-fading tail at `now`, newest first; empty once everything is solid */
export function fadeSpans(trail: FadeTrail, now: number): FadeSpan[] {
  const spans: FadeSpan[] = [];
  for (let index = trail.chunks.length - 1; index >= 0; index--) {
    const chunk = trail.chunks[index];
    const alpha = alphaAt(now - chunk.at);
    // older chunks are at least as solid
    if (alpha >= 1) break;
    const chars = chunk.end - chunk.start;
    const last = spans[spans.length - 1];
    if (last && last.alpha === alpha) last.chars += chars;
    else spans.push({ chars, alpha });
  }
  return spans;
}

/** the props of the elements markdown renders that the fade looks into */
export type FadeProps = { children?: ReactNode; li?: ReactNode[]; style?: StyleProp<TextStyle> };

export type FadePainter = {
  /** which prop holds the content the element's text runs live in, or null when it is opaque to the fade */
  slot(element: ReactElement<FadeProps>): 'children' | 'li' | null;
  /** the element's own text colour, when it sets one */
  ink(element: ReactElement<FadeProps>): string | undefined;
  /** `text` drawn in `ink` at `alpha` */
  paint(text: string, ink: string, alpha: number, key: string): ReactNode;
};

type Walk = { spans: readonly FadeSpan[]; index: number; left: number; done: boolean; painted: number };

/**
 * `nodes` with their last characters repainted per `spans`. Elements off the tail keep their
 * identity; an element the painter cannot see into ends the walk, leaving what precedes it solid.
 */
export function fadeTail(nodes: readonly ReactNode[], spans: readonly FadeSpan[], ink: string, painter: FadePainter): ReactNode[] {
  if (spans.length === 0) return nodes as ReactNode[];
  const walk: Walk = { spans, index: 0, left: spans[0].chars, done: false, painted: 0 };
  return fadeList(nodes, ink, painter, walk);
}

function fadeList(nodes: readonly ReactNode[], ink: string, painter: FadePainter, walk: Walk): ReactNode[] {
  let out: ReactNode[] | null = null;
  for (let index = nodes.length - 1; index >= 0 && !walk.done; index--) {
    const node = nodes[index];
    const next = fadeNode(node, ink, painter, walk);
    if (next !== node) {
      out ??= nodes.slice();
      out[index] = next;
    }
  }
  return out ?? (nodes as ReactNode[]);
}

function fadeNode(node: ReactNode, ink: string, painter: FadePainter, walk: Walk): ReactNode {
  if (typeof node === 'string' || typeof node === 'number') return fadeString(String(node), ink, painter, walk);
  if (Array.isArray(node)) return fadeList(node, ink, painter, walk);
  if (!isValidElement<FadeProps>(node)) return node;
  const slot = painter.slot(node);
  if (slot === null) {
    walk.done = true;
    return node;
  }
  const content = node.props[slot];
  const own = painter.ink(node) ?? ink;
  const next = Array.isArray(content) ? fadeList(content, own, painter, walk) : fadeNode(content, own, painter, walk);
  return next === content ? node : cloneElement(node, { [slot]: next });
}

function fadeString(text: string, ink: string, painter: FadePainter, walk: Walk): ReactNode {
  const pieces: ReactNode[] = [];
  let end = text.length;
  while (end > 0 && !walk.done) {
    const take = Math.min(walk.left, end);
    pieces.push(painter.paint(text.slice(end - take, end), ink, walk.spans[walk.index].alpha, `fade-${walk.painted++}`));
    end -= take;
    walk.left -= take;
    if (walk.left === 0) {
      walk.index += 1;
      if (walk.index === walk.spans.length) walk.done = true;
      else walk.left = walk.spans[walk.index].chars;
    }
  }
  if (pieces.length === 0) return text;
  if (end > 0) pieces.push(text.slice(0, end));
  return pieces.reverse();
}
