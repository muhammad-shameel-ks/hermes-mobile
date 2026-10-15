import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffRows, diffStats, fullFileDiffRows, gutterDigits, isBinaryDiff, overviewRuns, parseHunks } from '../src/review/diff.ts';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ function head()',
  ' one',
  '-two',
  '+two!',
  '+three',
  ' four',
  '@@ -20,2 +21,2 @@',
  ' tail',
  '-old',
  '+new',
  '\\ No newline at end of file',
  '',
].join('\n');

test('hunks carry their start lines and typed lines, headers dropped', () => {
  const hunks = parseHunks(diff);
  assert.equal(hunks.length, 2);
  assert.deepEqual([hunks[0].oldStart, hunks[0].newStart], [1, 1]);
  assert.deepEqual([hunks[1].oldStart, hunks[1].newStart], [20, 21]);
  assert.deepEqual(hunks[0].lines.map((l) => l.kind), ['context', 'remove', 'add', 'add', 'context']);
  assert.equal(hunks[1].lines.length, 3);
});

test('rows number each side from the hunk headers and blank between hunks', () => {
  const rows = diffRows(diff);
  assert.deepEqual(rows[0], { kind: 'context', text: 'one', oldNo: 1, newNo: 1 });
  assert.deepEqual(rows[1], { kind: 'remove', text: 'two', oldNo: 2 });
  assert.deepEqual(rows[2], { kind: 'add', text: 'two!', newNo: 2 });
  assert.deepEqual(rows[3], { kind: 'add', text: 'three', newNo: 3 });
  assert.deepEqual(rows[4], { kind: 'context', text: 'four', oldNo: 3, newNo: 4 });
  assert.deepEqual(rows[5], { kind: 'context', text: '' });
  assert.deepEqual(rows[6], { kind: 'context', text: 'tail', oldNo: 20, newNo: 21 });
  assert.equal(rows.length, 9);
  assert.equal(gutterDigits(rows), 2);
});

test('a removed line that starts with dashes is still a removal', () => {
  const rows = diffRows('@@ -1,2 +1,1 @@\n--- a comment\n keep\n');
  assert.deepEqual(rows[0], { kind: 'remove', text: '-- a comment', oldNo: 1 });
});

test('stats count adds and removes, binary diffs are recognised', () => {
  assert.deepEqual(diffStats(diff), { added: 3, removed: 2 });
  assert.equal(isBinaryDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n'), true);
  assert.equal(isBinaryDiff(diff), false);
  assert.deepEqual(diffRows('Binary files a/x and b/x differ\n'), []);
});

test('an untracked file diff is all additions', () => {
  const rows = diffRows('diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
  assert.deepEqual(rows.map((r) => [r.kind, r.newNo]), [['add', 1], ['add', 2]]);
});

test('a full-file diff keeps every current line and slots removals in', () => {
  const text = 'one\ntwo!\nthree\nfour';
  const rows = fullFileDiffRows('@@ -1,3 +1,4 @@\n one\n-two\n+two!\n+three\n four\n', text);
  assert.deepEqual(rows.map((r) => [r.kind, r.text, r.oldNo, r.newNo]), [
    ['context', 'one', 1, 1],
    ['remove', 'two', 2, undefined],
    ['add', 'two!', undefined, 2],
    ['add', 'three', undefined, 3],
    ['context', 'four', 3, 4],
  ]);
  assert.equal(fullFileDiffRows('', 'a\nb').length, 2);
});

test('the overview ruler coalesces runs of one kind and skips context', () => {
  const rows = diffRows('@@ -1,5 +1,5 @@\n a\n-b\n-c\n+d\n e\n');
  assert.deepEqual(overviewRuns(rows), [
    { kind: 'remove', startPct: 20, sizePct: 40 },
    { kind: 'add', startPct: 60, sizePct: 20 },
  ]);
  assert.deepEqual(overviewRuns([]), []);
});
