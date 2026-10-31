import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

import { BlockKeys, firstKey } from '../src/chat/markdownKeys.ts';
import { counterKeys, markdownTree, type KeySource } from './support/markdownTree.ts';

type Element = ReactElement<{ children?: ReactNode }>;

/** the elements among `nodes`, nested arrays flattened as React reads them */
function elementsOf(nodes: readonly ReactNode[]): Element[] {
  return nodes.flat(4).filter((node): node is Element => isValidElement(node));
}

/** every element in the tree as `path -> type#key`, children addressed by their position */
function flatten(nodes: readonly ReactNode[], path = '', out = new Map<string, string>()): Map<string, string> {
  elementsOf(nodes).forEach((node, index) => {
    const here = `${path}/${index}`;
    out.set(here, `${String(node.type)}#${node.key}`);
    const children = node.props.children;
    if (Array.isArray(children)) flatten(children, here, out);
  });
  return out;
}

/** sibling keys are unique at every level */
function uniqueSiblings(nodes: readonly ReactNode[]): boolean {
  const elements = elementsOf(nodes);
  const keys = new Set(elements.map((node) => node.key));
  if (keys.size !== elements.length) return false;
  return elements.every((node) => !Array.isArray(node.props.children) || uniqueSiblings(node.props.children));
}

/** the elements whose key moved between two renders, where the element at that place kept its type */
function moved(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, was] of before) {
    const now = after.get(path);
    if (!now) continue;
    const [typeWas] = was.split('#');
    const [typeNow] = now.split('#');
    if (typeWas === typeNow && was !== now) out.push(`${path}: ${was} -> ${now}`);
  }
  return out;
}

const STREAMS = [
  '1. **Metro cache**: the cache was stale after the `expo` upgrade.\n2. **Hermes flags**: set *twice* in `app.json`.\n3. **CI**: see [the log](https://ci.example.com/run/1).\n',
  '| File | Problem | Fix |\n|---|---|---|\n| `a.ts` | **unused** import | remove |\n| `b.ts` | *slow* loop | cache it |\n| `c.ts` | ok | none |\n',
  'A paragraph with **bold**, *italic*, `code`, ~~gone~~ and a [link with **bold**](https://example.com) that keeps going on.',
  '- first with `code`\n  - nested **bold** item\n  - another\n- second\n\n> quoted **text** and more\n> continues here',
  '## Heading with `code` and **bold**\n\nThen text.',
];

/** stream each corpus entry character by character, returning every key that moved */
function streamKeys(keys: KeySource & { reset(): void }) {
  const moves: string[] = [];
  let collisions = 0;
  for (const text of STREAMS) {
    let before = new Map<string, string>();
    for (let end = 1; end <= text.length; end++) {
      const tree = markdownTree(text.slice(0, end), keys);
      if (!uniqueSiblings(tree)) collisions += 1;
      const after = flatten(tree);
      for (const move of moved(before, after)) moves.push(`@${end} ${JSON.stringify(text.slice(Math.max(0, end - 12), end))} ${move}`);
      before = after;
    }
  }
  return { moves, collisions };
}

test('a plain post-order counter moves a container key whenever content is added inside it', () => {
  // react-native-marked's own scheme: why the open list or table remounted while it streamed
  const { moves } = streamKeys(counterKeys());
  assert.ok(moves.length > 100, `expected many moved keys, saw ${moves.length}`);
});

test('BlockKeys: no element changes key while the text streams, and siblings never collide', () => {
  const { moves, collisions } = streamKeys(new BlockKeys());
  assert.deepEqual(moves, []);
  assert.equal(collisions, 0);
});

test('firstKey finds the first keyed element through nested arrays', () => {
  const a = createElement('a', { key: 'k1' });
  const b = createElement('b', { key: 'k2' });
  assert.equal(firstKey('text'), null);
  assert.equal(firstKey([]), null);
  assert.equal(firstKey(['text', null, [[], [a, b]]]), 'k1');
  assert.equal(firstKey([createElement('c', null), b]), 'k2');
});

test('a lent key goes to the first request only and never leaks past the element', () => {
  const keys = new BlockKeys();
  const inner = keys.lend('lent', () => [keys.next(), keys.next()]);
  assert.deepEqual(inner, ['lent', 'md-1']);
  assert.equal(keys.lend('unused', () => 'no request'), 'no request');
  assert.equal(keys.next(), 'md-2');
  keys.reset();
  assert.equal(keys.next(), 'md-1');
});
