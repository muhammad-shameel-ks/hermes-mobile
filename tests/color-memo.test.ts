import assert from 'node:assert/strict';
import { test } from 'node:test';

import { harmonize, hexToOklch, mixOklab, mixPct, normalizeHex, readableInk, transparentOf } from '../src/ui/color.ts';
import { resolveTheme } from '../src/ui/tokens.ts';

test('memoised colour maths returns the same values on every call', () => {
  const first = [mixPct('#0053fd', 0.4, 'transparent'), mixPct('#ffffff', 0.5, '#000000'), transparentOf('#123456'), readableInk('#336699'), normalizeHex('#abc'), mixOklab('#ff0000', '#0000ff', 0.5), harmonize('#10b981', '#0053fd', 0.25)];
  const second = [mixPct('#0053fd', 0.4, 'transparent'), mixPct('#ffffff', 0.5, '#000000'), transparentOf('#123456'), readableInk('#336699'), normalizeHex('#abc'), mixOklab('#ff0000', '#0000ff', 0.5), harmonize('#10b981', '#0053fd', 0.25)];
  assert.deepEqual(first, second);
  assert.equal(mixPct('#ffffff', 0.5, '#000000'), '#808080');
  assert.equal(normalizeHex('#abc'), '#aabbcc');
});

test('misses are remembered too: unparseable input keeps its fallback', () => {
  assert.equal(normalizeHex('nope'), null);
  assert.equal(normalizeHex('nope'), null);
  assert.equal(hexToOklch('nope'), null);
  assert.equal(hexToOklch('nope'), null);
  assert.equal(mixPct('nope', 0.5, '#000000'), 'nope');
});

test('the memo stays correct past its bound', () => {
  for (let i = 0; i < 5000; i += 1) mixPct('#336699', i / 5000, 'transparent');
  assert.equal(mixPct('#ffffff', 0.5, '#000000'), '#808080');
  assert.equal(mixPct('#336699', 0, 'transparent'), mixPct('#336699', 0, 'transparent'));
});

test('a theme is one object per spec, and a Chat Text Size change reuses the colours', () => {
  const a = resolveTheme({ skin: 'nous', mode: 'dark', chatTextScale: 1.1, fontScale: 1 });
  assert.equal(resolveTheme({ skin: 'nous', mode: 'dark', chatTextScale: 1.1, fontScale: 1 }), a);
  const b = resolveTheme({ skin: 'nous', mode: 'dark', chatTextScale: 1.3, fontScale: 1 });
  assert.notEqual(a, b);
  assert.equal(b.uiBgChrome, a.uiBgChrome);
  assert.equal(b.radius, a.radius);
  assert.equal(b.chatTextScale, 1.3);
  assert.ok(Math.abs(b.type.text - 15 * 1.3) < 1e-9);
  assert.ok(Math.abs(a.type.lineHeight - 22 * 1.1) < 1e-9);
  assert.equal(a.type.base, 15);
});

test('every token the resolver wrote before the split is still present', () => {
  const t = resolveTheme({ mode: 'light' });
  for (const key of ['skin', 'mode', 'renderedMode', 'chatTextScale', 'uiBgChrome', 'dtPrimarySolid', 'dtScrollbarThumb', 'radius', 'type', 'scrim']) assert.ok(key in t, key);
});
