import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countDiffLineStats, inlineDiffFromResult, parseDiff, stripDiffFileHeaders, stripInlineDiffChrome } from '../src/chat/diff.ts';

const GIT_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 83db48f..bf2a3c1 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' import a from "a";',
  '-const x = 1;',
  '+const x = 2;',
  '+const y = 3;',
  ' export {};',
  '@@ -10,2 +11,2 @@',
  ' tail',
  '-old',
  '+new',
].join('\n');

test('header preamble is dropped up to the first hunk', () => {
  assert.equal(stripDiffFileHeaders(GIT_DIFF).split('\n')[0], '@@ -1,3 +1,4 @@');
  assert.equal(stripDiffFileHeaders('a/x.ts → b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b').split('\n')[0], '@@ -1 +1 @@');
});

test('lines carry their kind, stripped marker and numbers from the hunk headers', () => {
  const lines = parseDiff(GIT_DIFF);
  assert.deepEqual(lines[0], { kind: 'context', text: 'import a from "a";', oldNo: 1, newNo: 1 });
  assert.deepEqual(lines[1], { kind: 'remove', text: 'const x = 1;', oldNo: 2 });
  assert.deepEqual(lines[2], { kind: 'add', text: 'const x = 2;', newNo: 2 });
  assert.deepEqual(lines[3], { kind: 'add', text: 'const y = 3;', newNo: 3 });
  assert.deepEqual(lines[4], { kind: 'context', text: 'export {};', oldNo: 3, newNo: 4 });
});

test('a blank context row separates hunks and the second hunk restarts its numbers', () => {
  const lines = parseDiff(GIT_DIFF);
  assert.deepEqual(lines[5], { kind: 'context', text: '' });
  assert.deepEqual(lines[6], { kind: 'context', text: 'tail', oldNo: 10, newNo: 11 });
  assert.equal(lines.length, 9);
});

test('a payload without hunks falls back to colouring each line', () => {
  const lines = parseDiff('-gone\n+here\n kept');
  assert.deepEqual(
    lines.map((line) => [line.kind, line.text]),
    [
      ['remove', 'gone'],
      ['add', 'here'],
      ['context', 'kept'],
    ],
  );
});

test('"\\ No newline" markers and +++/--- file lines never count as changes', () => {
  const diff = '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b';
  assert.deepEqual(countDiffLineStats(diff), { added: 1, removed: 1 });
  assert.equal(parseDiff(diff).length, 2);
});

test('inline diffs come from the result, chrome and escape codes stripped', () => {
  const diff = '┊ review diff\n\u001b[32m@@ -1 +1 @@\u001b[0m\n-a\n+b';
  assert.equal(stripInlineDiffChrome(diff), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult(JSON.stringify({ success: true, diff: '@@ -1 +1 @@\n-a\n+b' })), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult({ inline_diff: '@@ -1 +1 @@\n-a\n+b', diff: 'ignored' }), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult('not json'), '');
  assert.equal(inlineDiffFromResult(undefined), '');
});
