import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarBucket, groupEntriesByRecency, hideCollapsedGroupRows, sessionAge, sessionBucketLabel, toSessionRows } from '../src/drawer/sessionDates.ts';
import type { SessionEntry } from '../src/drawer/sessionTree.ts';

// Thu 2026-10-15 15:00 local, weeks starting Monday
const NOW = new Date(2026, 9, 15, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 15 - daysAgo, hour, 0, 0).getTime() / 1000;
const entry = (id: string, seconds: number, branchStem?: string): SessionEntry => ({ session: { id, title: id, preview: null, started_at: seconds, last_active: seconds }, branchStem });
const group = (entries: SessionEntry[]) => groupEntriesByRecency(entries, NOW, 1);
const shape = (rows: ReturnType<typeof group>) => rows.map((row) => (row.kind === 'divider' ? `— ${row.label}` : row.entry.session.id));

test('a row age reads now, minutes, hours, days', () => {
  const now = 1_000_000;
  assert.equal(sessionAge(now - 20, now), 'now');
  assert.equal(sessionAge(now - 52 * 60, now), '52m');
  assert.equal(sessionAge(now - 3 * 3600, now), '3h');
  assert.equal(sessionAge(now - 18 * 86400, now), '18d');
});

test('buckets coarsen with age and the day rolls over at 4 AM', () => {
  assert.equal(calendarBucket(at(0, 9), NOW, 1).kind, 'today');
  assert.equal(calendarBucket(at(1), NOW, 1).kind, 'yesterday');
  // 01:30 today still belongs to yesterday's evening
  assert.equal(calendarBucket(new Date(2026, 9, 15, 1, 30).getTime() / 1000, NOW, 1).kind, 'yesterday');
  assert.equal(calendarBucket(at(3), NOW, 1).kind, 'thisWeek'); // Mon 12th
  assert.equal(calendarBucket(at(6), NOW, 1).kind, 'lastWeek'); // Sat 9th
  assert.equal(calendarBucket(at(13), NOW, 1).kind, 'thisMonth'); // 2nd
  assert.equal(calendarBucket(new Date(2026, 8, 20).getTime() / 1000, NOW, 1).kind, 'month');
  assert.equal(calendarBucket(new Date(2025, 8, 20).getTime() / 1000, NOW, 1).kind, 'monthYear');
});

test('divider labels are the desktop strings, months from Intl', () => {
  assert.equal(sessionBucketLabel(calendarBucket(at(1), NOW, 1)), 'Yesterday');
  assert.equal(sessionBucketLabel(calendarBucket(at(6), NOW, 1)), 'Last week');
  assert.equal(sessionBucketLabel(calendarBucket(new Date(2026, 8, 20).getTime() / 1000, NOW, 1)), 'September');
  assert.match(sessionBucketLabel(calendarBucket(new Date(2025, 8, 20).getTime() / 1000, NOW, 1)), /September.*2025/);
});

test('the newest run stays unlabelled and older sessions fall under one divider per range', () => {
  const rows = group([
    entry('a', at(0, 14)),
    entry('b', at(0, 13)),
    entry('c', at(1)),
    entry('d', at(1, 10)),
    entry('e', at(6)),
    entry('f', at(20)),
  ]);
  assert.equal(rows[0]!.kind, 'session');
  const labels = rows.filter((row) => row.kind === 'divider').map((row) => (row.kind === 'divider' ? row.label : ''));
  assert.deepEqual([...labels].sort(), [...new Set(labels)].sort(), 'one divider per bucket');
  assert.ok(labels.includes('Yesterday'));
  assert.ok(labels.includes('Last week'));
});

test('the first rendered row is never labelled', () => {
  const rows = group([entry('old', at(40)), entry('older', at(80))]);
  assert.equal(rows[0]!.kind, 'session');
});

test('a branch child rides its parent and never opens a divider', () => {
  const rows = group([entry('p', at(1)), entry('kid', at(30), '└─ '), entry('q', at(9))]);
  assert.deepEqual(shape(rows).filter((id) => id === 'kid'), ['kid']);
  const kid = shape(rows).indexOf('kid');
  assert.ok(!shape(rows)[kid - 1]!.startsWith('—'));
});

test('a divider cap stops the list at that many groups', () => {
  const entries = [entry('a', at(0, 14)), entry('b', at(1)), entry('c', at(6)), entry('d', at(20)), entry('e', at(70))];
  const capped = groupEntriesByRecency(entries, NOW, 1, 2);
  assert.ok(capped.filter((row) => row.kind === 'divider').length <= 1);
});

test('collapsing a divider drops the sessions beneath it and keeps the divider', () => {
  const rows = [...toSessionRows([entry('a', 1)]), { kind: 'divider' as const, key: 'yesterday', label: 'Yesterday' }, ...toSessionRows([entry('b', 1)])];
  const hidden = hideCollapsedGroupRows(rows, (key) => key !== 'yesterday');
  assert.deepEqual(shape(hidden), ['a', '— Yesterday']);
  assert.equal(hideCollapsedGroupRows(rows, () => true), rows, 'nothing hidden keeps the array');
});
