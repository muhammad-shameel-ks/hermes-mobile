import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, isValidElement, type ReactNode } from 'react';

import { FADE_MS, fadeSpans, fadeTail, growTrail, type FadePainter, type FadeProps } from '../src/chat/streamFade.ts';

test('a block first seen streaming fades in whole, then each growth is its own chunk', () => {
  let trail = growTrail(null, 10, 0);
  assert.deepEqual(fadeSpans(trail, 0), [{ chars: 10, alpha: 0 }]);
  trail = growTrail(trail, 16, 100);
  const spans = fadeSpans(trail, 100);
  assert.deepEqual(spans[0], { chars: 6, alpha: 0 });
  assert.equal(spans[1].chars, 10);
  assert.ok(spans[1].alpha > 0 && spans[1].alpha < 1);
});

test('a chunk is solid once FADE_MS has passed, and solid chunks end the spans', () => {
  let trail = growTrail(null, 10, 0);
  trail = growTrail(trail, 20, FADE_MS / 2);
  // the newer chunk is half way, eased: 1 - 0.5² = 0.75, painted in tenths
  assert.deepEqual(fadeSpans(trail, FADE_MS), [{ chars: 10, alpha: 0.8 }]);
  assert.deepEqual(fadeSpans(trail, FADE_MS * 2), []);
});

test('an unchanged length keeps the trail; a shrunk source paints solid', () => {
  const trail = growTrail(null, 10, 0);
  assert.equal(growTrail(trail, 10, 50), trail);
  assert.deepEqual(fadeSpans(growTrail(trail, 4, 50), 50), []);
});

test('chunks that arrived together at the same alpha merge into one span', () => {
  let trail = growTrail(null, 5, 0);
  trail = growTrail(trail, 9, 0.001);
  assert.deepEqual(fadeSpans(trail, 0.001), [{ chars: 9, alpha: 0 }]);
});

const painter: FadePainter = {
  slot: (element) => (element.type === 'text' || element.type === 'view' ? 'children' : Array.isArray(element.props.li) ? 'li' : null),
  ink: (element) => (element.props.style && typeof element.props.style === 'object' && 'color' in element.props.style ? String(element.props.style.color) : undefined),
  paint: (text, ink, alpha, key) => createElement('paint', { key, ink, alpha }, text),
};

/** the rendered text with each painted run marked as [text@alpha:ink] */
function show(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(show).join('');
  if (!isValidElement<FadeProps & { ink?: string; alpha?: number }>(node)) return '';
  if (node.type === 'paint') return `[${show(node.props.children)}@${node.props.alpha}:${node.props.ink}]`;
  return show(node.props.children) + (node.props.li ? node.props.li.map(show).join('|') : '');
}

test('the trailing characters are repainted across nested runs, in their own ink', () => {
  const link = createElement('text', { key: 'l', style: { color: 'blue' } }, 'link');
  const paragraph = createElement('view', { key: 'p' }, [createElement('text', { key: 't', style: { color: 'ink' } }, ['Hello ', link, ' end'])]);
  const out = fadeTail([paragraph], [{ chars: 6, alpha: 0.2 }, { chars: 3, alpha: 0.6 }], 'base', painter);
  assert.equal(show(out), 'Hello[ @0.6:ink][li@0.6:blue][nk@0.2:blue][ end@0.2:ink]');
});

test('elements off the tail keep their identity', () => {
  const first = createElement('view', { key: 'a' }, createElement('text', null, 'first block'));
  const last = createElement('view', { key: 'b' }, createElement('text', null, 'tail'));
  const nodes = [first, last];
  const out = fadeTail(nodes, [{ chars: 2, alpha: 0 }], 'ink', painter);
  assert.equal(out[0], first);
  assert.notEqual(out[1], last);
  assert.equal(fadeTail(nodes, [], 'ink', painter), nodes);
});

test('an element the painter cannot see into ends the walk, leaving earlier text solid', () => {
  const card = createElement('card', { key: 'c' });
  const text = createElement('text', { key: 't' }, 'before');
  const out = fadeTail([text, card], [{ chars: 4, alpha: 0 }], 'ink', painter);
  assert.equal(out[0], text);
  assert.equal(out[1], card);
});

test('list items are reached through the list element', () => {
  const list = createElement('list', { key: 'list', li: [createElement('text', { key: 1 }, 'one'), createElement('text', { key: 2 }, 'two')] });
  const out = fadeTail([list], [{ chars: 4, alpha: 0.5 }], 'ink', painter);
  assert.equal(show(out), 'on[e@0.5:ink]|[two@0.5:ink]');
});

test('keys stay unique across every painted run', () => {
  const nodes = [createElement('text', { key: 'a' }, 'abc'), createElement('text', { key: 'b' }, 'def')];
  const keys: string[] = [];
  const collect = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (isValidElement<FadeProps>(node)) {
      if (node.type === 'paint' && node.key !== null) keys.push(node.key);
      collect(node.props.children);
    }
  };
  collect(fadeTail(nodes, [{ chars: 2, alpha: 0 }, { chars: 2, alpha: 0.5 }], 'ink', painter));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 3);
});
