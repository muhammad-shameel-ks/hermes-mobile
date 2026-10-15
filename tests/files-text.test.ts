import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chunkLines, displayLine, MAX_COLUMNS, maxColumns, splitLines } from '../src/files/text.ts';

test('a line is drawn with tabs expanded and no carriage return', () => {
  assert.equal(displayLine('\tif (x) {\r'), '    if (x) {');
});

test('an overlong line is clipped with an ellipsis', () => {
  const clipped = displayLine('x'.repeat(MAX_COLUMNS + 50));
  assert.equal(clipped.length, MAX_COLUMNS + 1);
  assert.equal(clipped.endsWith('…'), true);
});

test('text splits into lines without a phantom last row', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines(''), ['']);
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
});

test('lines chunk in order with their start index', () => {
  const chunks = chunkLines(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(chunks, [{ start: 0, lines: ['a', 'b'] }, { start: 2, lines: ['c', 'd'] }, { start: 4, lines: ['e'] }]);
  assert.equal(maxColumns(['ab', 'abcd', 'a']), 4);
});
