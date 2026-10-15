import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { buildReviewFlatList, buildReviewTree, countAllNodes, flattenReviewRows, headerLine, isExcludedPath, matchReviewFile, recordTurnBase, resetTurnBases, turnBaseFor, type ReviewFile } from '../src/review/tree.ts';

const file = (path: string, added = 1, removed = 0, status = 'M'): ReviewFile => ({ path, added, removed, status, staged: false });

test('the tree aggregates churn, compacts single-child chains and sorts folders first', () => {
  const tree = buildReviewTree([file('src/ui/a.ts', 3, 1), file('src/ui/b.ts', 2, 0), file('docs/deep/er/x.md', 1, 0), file('README.md', 5, 5)]);
  assert.deepEqual(tree.map((n) => n.name), ['docs/deep/er', 'src/ui', 'README.md']);
  const ui = tree[1];
  assert.equal(ui.isDir, true);
  assert.deepEqual([ui.added, ui.removed], [5, 1]);
  assert.deepEqual(ui.children?.map((n) => n.name), ['a.ts', 'b.ts']);
});

test('the flat list splits name from directory and sorts by path', () => {
  const rows = buildReviewFlatList([file('b/z.ts'), file('a/y.ts')]);
  assert.deepEqual(rows.map((r) => [r.name, r.dir]), [['y.ts', 'a'], ['z.ts', 'b']]);
});

test('flattening shows a folder\'s children only while it is open', () => {
  const tree = buildReviewTree([file('src/ui/a.ts'), file('src/ui/b.ts'), file('top.ts')]);
  assert.equal(flattenReviewRows(tree, () => false).length, 2);
  const open = flattenReviewRows(tree, () => true);
  assert.deepEqual(open.map((r) => [r.node.name, r.depth]), [['src/ui', 0], ['a.ts', 1], ['b.ts', 1], ['top.ts', 0]]);
});

test('the node count includes every descendant', () => {
  assert.equal(countAllNodes(buildReviewTree([file('a/b/x.ts'), file('a/b/y.ts'), file('a/c.ts')])), 5);
});

test('noise paths are excluded on any segment', () => {
  assert.equal(isExcludedPath('node_modules/.bin/x'), true);
  assert.equal(isExcludedPath('src/.DS_Store'), true);
  assert.equal(isExcludedPath('src/app.ts'), false);
});

test('a tool-reported absolute path matches the repo-relative changed file on its tail', () => {
  const files = [file('src/a.ts'), file('src/b.ts')];
  assert.equal(matchReviewFile(files, '/srv/repo/src/b.ts')?.path, 'src/b.ts');
  assert.equal(matchReviewFile(files, 'src/a.ts')?.path, 'src/a.ts');
  assert.equal(matchReviewFile(files, '/srv/repo/src/c.ts'), undefined);
});

beforeEach(() => resetTurnBases());

test('turn baselines are per cwd and capped at eight, oldest out first', () => {
  for (let i = 0; i < 9; i += 1) recordTurnBase(`/repo/${i}`, `sha${i}`);
  assert.equal(turnBaseFor('/repo/0'), null);
  assert.equal(turnBaseFor('/repo/8'), 'sha8');
  recordTurnBase('/repo/8', 'newer');
  assert.equal(turnBaseFor('/repo/8 '), 'newer');
});

test('the header line carries branch, divergence and the base for non-uncommitted scopes', () => {
  const status = { branch: 'feat/x', detached: false, ahead: 2, behind: 1, changed: 3 };
  assert.equal(headerLine(status, 'uncommitted', null), 'feat/x · 2 ahead · 1 behind');
  assert.equal(headerLine(status, 'branch', 'origin/main'), 'feat/x · 2 ahead · 1 behind · vs origin/main');
  assert.equal(headerLine(status, 'lastTurn', '0123456789abcdef0123456789abcdef01234567'), 'feat/x · 2 ahead · 1 behind · vs 01234567');
  assert.equal(headerLine({ ...status, branch: null, detached: true, ahead: 0, behind: 0 }, 'uncommitted', null), 'detached');
  assert.equal(headerLine(undefined, 'uncommitted', null), '');
});
