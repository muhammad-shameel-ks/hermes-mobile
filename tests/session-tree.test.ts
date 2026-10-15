import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionInfo } from '../src/chat/controller.ts';
import { flattenSessionsWithBranches, forkParentId } from '../src/drawer/sessionTree.ts';

const row = (id: string, last: number, extra: Partial<SessionInfo> = {}): SessionInfo => ({ id, title: id, preview: null, started_at: last, last_active: last, ...extra });
const ids = (entries: ReturnType<typeof flattenSessionsWithBranches>) => entries.map((e) => `${e.branchStem ?? ''}${e.session.id}`);

test('a branch nests under its parent with a stem; the last child closes the tree', () => {
  const out = flattenSessionsWithBranches([row('parent', 10), row('b1', 30, { _branched_from: 'parent' }), row('b2', 20, { _branched_from: 'parent' })]);
  assert.deepEqual(ids(out), ['parent', '├─ b1', '└─ b2']);
});

test('activity on a branch lifts its whole cluster above a newer root', () => {
  const out = flattenSessionsWithBranches([row('solo', 50), row('parent', 10), row('kid', 90, { _branched_from: 'parent' })]);
  assert.deepEqual(ids(out), ['parent', '└─ kid', 'solo']);
});

test('a reset successor is a sibling, not a fork', () => {
  const session = row('next', 5, { parent_session_id: 'prev', _reset_from: 'prev' });
  assert.equal(forkParentId(session), undefined);
  assert.deepEqual(ids(flattenSessionsWithBranches([row('prev', 4), session])), ['next', 'prev']);
});

test('a compression chain collapses to the row nothing continues from', () => {
  const out = flattenSessionsWithBranches([row('old', 5, { _lineage_root_id: 'old' }), row('tip', 9, { _lineage_root_id: 'old', parent_session_id: 'old' })]);
  assert.deepEqual(ids(out), ['tip']);
});

test('preserveOrder keeps the caller\'s roots', () => {
  const out = flattenSessionsWithBranches([row('first', 1), row('second', 99)], { preserveOrder: true });
  assert.deepEqual(ids(out), ['first', 'second']);
});
