/**
 * Streamed text painted at per-character alpha. `streamReveal.ts` decides how solid the tail of a
 * streamed block is (clear ahead of the reveal head, fading in behind it); `fadeTail` repaints only
 * those trailing characters of the rendered elements, walking back from the end and cloning just the
 * elements on that path, so a repaint costs O(fading text), never O(block).
 *
 * Source characters stand in for rendered ones: markdown syntax in the newest text (a `**`, a list
 * marker) shifts the edge by those few characters, which a fade this short does not show.
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

/** `chars` characters at `alpha`, counted back from the end of the text, newest first */
export type FadeSpan = { chars: number; alpha: number };

/**
 * The props of the elements markdown renders that the fade looks into (`header` and `rows` are a table's
 * cells), and the `alpha` an opaque element that can be dimmed takes.
 */
export type FadeProps = {
  children?: ReactNode;
  li?: ReactNode[];
  header?: ReactNode[][];
  rows?: ReactNode[][][];
  style?: StyleProp<TextStyle>;
  alpha?: number;
};

export type FadeSlot = 'children' | 'li' | 'header' | 'rows';

export type FadePainter = {
  /** the props holding the element's text runs, in document order; null when the fade cannot see into it */
  slots(element: ReactElement<FadeProps>): readonly FadeSlot[] | null;
  /** the element's own text colour, when it sets one */
  ink(element: ReactElement<FadeProps>): string | undefined;
  /** `text` drawn in `ink` at `alpha` */
  paint(text: string, ink: string, alpha: number, key: string): ReactNode;
  /** an element the fade cannot see into, drawn whole at `alpha` (itself when it cannot be dimmed) */
  dim(element: ReactElement<FadeProps>, alpha: number): ReactNode;
};

type Walk = { spans: readonly FadeSpan[]; index: number; left: number; done: boolean; painted: number };

/**
 * `nodes` with their last characters repainted per `spans`. Elements off the tail keep their
 * identity. An element the painter cannot see into (inline code, a card) stands for its content's
 * characters (`contentChars`) and is dimmed whole to the newest alpha among them, and the walk goes
 * on past it, so text before it still shows in order.
 */
export function fadeTail(nodes: readonly ReactNode[], spans: readonly FadeSpan[], ink: string, painter: FadePainter): ReactNode[] {
  if (spans.length === 0) return nodes as ReactNode[];
  const walk: Walk = { spans, index: 0, left: spans[0].chars, done: false, painted: 0 };
  return fadeList(nodes, ink, painter, walk);
}

const charsCache = new WeakMap<object, number>();

/**
 * The characters an opaque element stands for: the strings among its props and the elements in them,
 * as source characters stand in for rendered ones everywhere in the fade. Cached per element, which
 * the parser builds once per text, so a repaint tick does not count it again.
 */
export function contentChars(node: ReactNode): number {
  if (typeof node === 'string') return node.length;
  if (Array.isArray(node)) return node.reduce((sum: number, child: ReactNode) => sum + contentChars(child), 0);
  if (!isValidElement<Record<string, unknown>>(node)) return 0;
  const hit = charsCache.get(node);
  if (hit !== undefined) return hit;
  let chars = 0;
  for (const value of Object.values(node.props)) {
    if (typeof value === 'string' || Array.isArray(value) || isValidElement(value)) chars += contentChars(value as ReactNode);
  }
  charsCache.set(node, chars);
  return chars;
}

/** `chars` characters of the walk are spent: move to the next span when this one runs out */
function spend(walk: Walk, chars: number) {
  walk.left -= chars;
  if (walk.left > 0) return;
  walk.index += 1;
  if (walk.index === walk.spans.length) walk.done = true;
  else walk.left = walk.spans[walk.index].chars;
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
  const slots = painter.slots(node);
  if (slots === null) return fadeOpaque(node, painter, walk);
  const own = painter.ink(node) ?? ink;
  let changed: Partial<FadeProps> | null = null;
  // the walk runs from the end, so the last slot (a table's rows) comes first
  for (let index = slots.length - 1; index >= 0 && !walk.done; index--) {
    const slot = slots[index];
    const content = node.props[slot];
    const next = Array.isArray(content) ? fadeList(content, own, painter, walk) : fadeNode(content, own, painter, walk);
    if (next !== content) (changed ??= {})[slot] = next as never;
  }
  return changed ? cloneElement(node, changed) : node;
}

function fadeOpaque(node: ReactElement<FadeProps>, painter: FadePainter, walk: Walk): ReactNode {
  // the newest of its characters decides: an element the head has not fully passed stays as clear as its end
  const alpha = walk.spans[walk.index].alpha;
  let chars = contentChars(node);
  while (chars > 0 && !walk.done) {
    const take = Math.min(walk.left, chars);
    chars -= take;
    spend(walk, take);
  }
  return painter.dim(node, alpha);
}

function fadeString(text: string, ink: string, painter: FadePainter, walk: Walk): ReactNode {
  const pieces: ReactNode[] = [];
  let end = text.length;
  while (end > 0 && !walk.done) {
    const take = Math.min(walk.left, end);
    pieces.push(painter.paint(text.slice(end - take, end), ink, walk.spans[walk.index].alpha, `fade-${walk.painted++}`));
    end -= take;
    spend(walk, take);
  }
  if (pieces.length === 0) return text;
  if (end > 0) pieces.push(text.slice(0, end));
  return pieces.reverse();
}
