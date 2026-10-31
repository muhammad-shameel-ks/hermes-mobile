import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

import { contentChars, fadeTail, type FadePainter, type FadeProps, type FadeSlot } from '../src/chat/streamFade.ts';

const CHILDREN: readonly FadeSlot[] = ['children'];

// `code` and `card` stand for inline code and a card: the fade cannot see into them, but can dim them whole
const painter: FadePainter = {
  slots: (element) => {
    if (element.type === 'text' || element.type === 'view') return CHILDREN;
    if (Array.isArray(element.props.li)) return ['li'];
    return element.props.header && element.props.rows ? ['header', 'rows'] : null;
  },
  ink: (element) => (element.props.style && typeof element.props.style === 'object' && 'color' in element.props.style ? String(element.props.style.color) : undefined),
  paint: (text, ink, alpha, key) => createElement('paint', { key, ink, alpha }, text),
  dim: (element, alpha) => (element.type === 'code' || element.type === 'card' ? cloneElement(element, { alpha }) : element),
};

type Shown = FadeProps & { ink?: string; text?: string };

/** the rendered text with each painted run marked as [text@alpha:ink] and each dimmed element as {type text@alpha} */
function show(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(show).join('');
  if (!isValidElement<Shown>(node)) return '';
  if (node.type === 'paint') return `[${show(node.props.children)}@${node.props.alpha}:${node.props.ink}]`;
  if (node.type === 'code' || node.type === 'card') return `{${String(node.type)} ${node.props.text}${node.props.alpha === undefined ? '' : `@${node.props.alpha}`}}`;
  const table = node.props.header && node.props.rows ? `${show(node.props.header)}/${show(node.props.rows)}` : '';
  return show(node.props.children) + (node.props.li ? node.props.li.map(show).join('|') : '') + table;
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

test('inline code past the head is clear like the text around it, and the text before it still reveals', () => {
  const code: ReactElement = createElement('code', { key: 'c', text: 'npm test' });
  const line = createElement('text', { key: 't', style: { color: 'ink' } }, ['Run ', code]);
  // the newest 10 characters are clear: the 8 of the code and 2 before it; 20 more are half inked
  const out = fadeTail([line], [{ chars: 10, alpha: 0 }, { chars: 20, alpha: 0.5 }], 'base', painter);
  assert.equal(show(out), '[Ru@0.5:ink][n @0:ink]{code npm test@0}');
});

test('a card counts its content and dims whole to its newest alpha; the walk goes on before it', () => {
  const card = createElement('card', { key: 'c', text: 'abcd' });
  const text = createElement('text', { key: 't' }, 'before');
  // 2 clear characters fall inside the card, which then shows clear whole; 4 more at 0.5 cover its rest and 2 of the text
  const out = fadeTail([text, card], [{ chars: 2, alpha: 0 }, { chars: 4, alpha: 0.5 }], 'ink', painter);
  assert.equal(show(out), 'befo[re@0.5:ink]{card abcd@0}');
  assert.equal(contentChars(card), 4);
});

test("a table's cells are reached newest first, rows before the header", () => {
  const cell = (text: string) => [createElement('text', { key: text }, text)];
  const table = createElement('table', { key: 'tb', header: [cell('Ah'), cell('Bh')], rows: [[cell('c1'), cell('d1')]] });
  const out = fadeTail([table], [{ chars: 3, alpha: 0 }], 'ink', painter);
  assert.equal(show(out), 'AhBh/c[1@0:ink][d1@0:ink]');
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
