import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRoster, reuseRoster } from '../src/bots/roster.ts';
import { dataEqual, reuseList } from '../src/chat/selector.ts';

const key = (row: { id: string }) => row.id;

test('a refetch that brought nothing new is the previous list, row for row', () => {
  const before = [{ id: 'a', title: 'A', tags: ['x'] }, { id: 'b', title: 'B', tags: [] }];
  const again = reuseList(before, structuredClone(before), key);
  assert.equal(again, before);
});

test('a changed row is the new object; the rest keep their identity', () => {
  const before = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const next = reuseList(before, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B2' }], key);
  assert.notEqual(next, before);
  assert.equal(next[0], before[0]);
  assert.equal(next[1]?.title, 'B2');
});

test('a reorder, an insert or a drop is a new list that still reuses the unchanged rows', () => {
  const before = [{ id: 'a' }, { id: 'b' }];
  const reordered = reuseList(before, [{ id: 'b' }, { id: 'a' }], key);
  assert.notEqual(reordered, before);
  assert.equal(reordered[0], before[1]);
  const inserted = reuseList(before, [{ id: 'c' }, { id: 'a' }, { id: 'b' }], key);
  assert.equal(inserted[1], before[0]);
  assert.deepEqual(reuseList(before, [{ id: 'a' }], key), [{ id: 'a' }]);
});

test('data equality is structural and tells arrays from objects', () => {
  assert.ok(dataEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] }));
  assert.ok(!dataEqual({ a: [1] }, { a: { 0: 1 } }));
  assert.ok(!dataEqual({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!dataEqual([1, 2], [1, 2, 3]));
});

test('a roster refetched unchanged is the previous roster; a changed bot alone is new', () => {
  const rows = [
    { name: 'default', is_default: true, ui_meta: {} },
    { name: 'ada', ui_meta: { 'hermes-bots': { hidden: true } } },
    { name: 'bob', ui_meta: {} },
  ] as never[];
  const now = 1_000_000;
  const first = buildRoster(rows, now);
  assert.equal(reuseRoster(first, buildRoster(structuredClone(rows), now)), first);
  const renamed = structuredClone(rows) as Array<{ name: string; display_name?: string }>;
  renamed[2]!.display_name = 'Bobby';
  const next = reuseRoster(first, buildRoster(renamed as never[], now));
  assert.equal(next.hidden, first.hidden);
  assert.equal(next.visible.find((bot) => bot.name === 'default'), first.visible.find((bot) => bot.name === 'default'));
  assert.equal(next.visible.find((bot) => bot.name === 'bob')?.label, 'Bobby');
});
