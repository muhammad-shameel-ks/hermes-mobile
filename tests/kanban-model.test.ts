import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLaneItems } from '../src/kanban/laneListItems.ts';
import {
  arcState,
  attachedAgent,
  compactNumber,
  duration,
  eventText,
  filterBoard,
  flowSegments,
  isLockedTarget,
  laneTone,
  moveCard,
  NO_FILTERS,
  pruneSelection,
  removeCard,
  slugify,
  stableBoard,
  wontRun,
} from '../src/kanban/model.ts';
import type { KanbanBoard, KanbanTask } from '../src/kanban/types.ts';

const task = (id: string, status: string, extra: Partial<KanbanTask> = {}): KanbanTask => ({ id, title: `Task ${id}`, status, ...extra });

function board(columns: Record<string, KanbanTask[]>, extra: Partial<KanbanBoard> = {}): KanbanBoard {
  return { columns: Object.entries(columns).map(([name, tasks]) => ({ name, tasks })), tenants: [], assignees: [], latest_event_id: 1, now: 1000, ...extra };
}

test('a move lands the card at the head of its new lane and leaves other lanes untouched', () => {
  const b = board({ triage: [task('a', 'triage'), task('b', 'triage')], ready: [task('c', 'ready')], done: [] });
  const moved = moveCard(b, 'b', 'ready');
  assert.deepEqual(moved.columns[0].tasks.map((t) => t.id), ['a']);
  assert.deepEqual(moved.columns[1].tasks.map((t) => t.id), ['b', 'c']);
  assert.equal(moved.columns[1].tasks[0].status, 'ready');
  assert.equal(moved.columns[2], b.columns[2]);
  assert.equal(moveCard(b, 'nope', 'ready'), b);
});

test('a delete drops the card, and an unknown id changes nothing', () => {
  const b = board({ todo: [task('a', 'todo'), task('b', 'todo')], done: [task('c', 'done')] });
  const removed = removeCard(b, 'a');
  assert.deepEqual(removed.columns[0].tasks.map((t) => t.id), ['b']);
  assert.equal(removed.columns[1], b.columns[1]);
  assert.equal(removeCard(b, 'nope'), b);
});

test('filters search title, body and id, and match tenant and assignee exactly; no filter keeps the board', () => {
  const b = board({
    todo: [
      task('t_abc', 'todo', { title: 'Ship the parser', tenant: 'acme', assignee: 'ada' }),
      task('t_def', 'todo', { title: 'Docs', body: 'mention the PARSER flag', assignee: 'bob' }),
      task('t_xyz', 'todo', { title: 'Unrelated' }),
    ],
  });
  assert.equal(filterBoard(b, NO_FILTERS), b);
  const ids = (f: Partial<typeof NO_FILTERS>) => filterBoard(b, { ...NO_FILTERS, ...f }).columns[0].tasks.map((t) => t.id);
  assert.deepEqual(ids({ search: 'parser' }), ['t_abc', 't_def']);
  assert.deepEqual(ids({ search: 'xyz' }), ['t_xyz']);
  assert.deepEqual(ids({ tenant: 'acme' }), ['t_abc']);
  assert.deepEqual(ids({ assignee: 'bob', search: 'parser' }), ['t_def']);
  assert.deepEqual(ids({ search: '   ' }), ['t_abc', 't_def', 't_xyz']);
});

test('the arc runs only while a worker is on the card, goes stale after two silent minutes, and queues who is coming', () => {
  const now = 10_000;
  assert.equal(arcState(task('a', 'running', { last_heartbeat_at: now - 30 }), '', now), 'running');
  assert.equal(arcState(task('a', 'running', { last_heartbeat_at: now - 121 }), '', now), 'stale');
  assert.equal(arcState(task('a', 'running'), '', now), 'running');
  assert.equal(arcState(task('a', 'triage'), '', now), 'queued');
  assert.equal(arcState(task('a', 'review'), '', now), 'queued');
  assert.equal(arcState(task('a', 'ready'), '', now), null);
  assert.equal(arcState(task('a', 'ready'), 'ops', now), 'queued');
  assert.equal(arcState(task('a', 'ready', { assignee: 'ada' }), '', now), 'queued');
  assert.equal(arcState(task('a', 'done', { assignee: 'ada' }), '', now), null);
});

test('the attached agent is the assignee, else the default for Ready, else the orchestrator for Triage', () => {
  assert.equal(attachedAgent(task('a', 'ready', { assignee: 'ada' }), 'ops', 'spec'), 'ada');
  assert.equal(attachedAgent(task('a', 'ready'), 'ops', 'spec'), 'ops');
  assert.equal(attachedAgent(task('a', 'triage'), 'ops', 'spec'), 'spec');
  assert.equal(attachedAgent(task('a', 'review'), 'ops', 'spec'), '');
});

test('a Ready card with no assignee and no default never runs', () => {
  assert.equal(wontRun(task('a', 'ready'), ''), true);
  assert.equal(wontRun(task('a', 'ready'), 'ops'), false);
  assert.equal(wontRun(task('a', 'ready', { assignee: 'ada' }), ''), false);
  assert.equal(wontRun(task('a', 'todo'), ''), false);
});

test('the dispatcher lanes are closed to moves', () => {
  assert.deepEqual(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived'].filter(isLockedTarget), ['scheduled', 'running', 'review']);
});

test('lane tones resolve text shades from the theme and fall back for unknown lanes', () => {
  const ink = { uiTextSecondary: '#222', uiTextTertiary: '#333', uiTextQuaternary: '#444' };
  assert.equal(laneTone('ready', ink), '#60a5fa');
  assert.equal(laneTone('triage', ink), '#333');
  assert.equal(laneTone('archived', ink), '#444');
  assert.equal(laneTone('mystery', ink), '#222');
});

test('a poll that changed nothing keeps every card, lane and the board itself', () => {
  const first = board({ todo: [task('a', 'todo', { link_counts: { parents: 1, children: 0 } })], done: [task('b', 'done')] }, { assignees: ['ada'] });
  const again = board({ todo: [task('a', 'todo', { link_counts: { parents: 1, children: 0 } })], done: [task('b', 'done')] }, { assignees: ['ada'], now: 2000 });
  assert.equal(stableBoard(first, again), first);
});

test('fields no card renders, like the age block that ticks on every read, do not count as a change', () => {
  const card = (age: number, latest: number) => ({ ...task('a', 'todo', { warnings: { count: 1, highest_severity: 'warning' } }), age: { created_age_seconds: age }, diagnostics: [{ last_seen_at: latest }] });
  const first = board({ todo: [card(40, 1)] });
  const next = board({ todo: [card(50, 2)] });
  assert.equal(stableBoard(first, next), first);
  const warned = board({ todo: [{ ...card(60, 3), warnings: { count: 2, highest_severity: 'error' } }] });
  assert.notEqual(stableBoard(first, warned).columns[0], first.columns[0]);
});

test('a poll keeps unchanged cards by identity and replaces only the lanes that changed', () => {
  const first = board({ todo: [task('a', 'todo'), task('b', 'todo')], done: [task('c', 'done')] });
  const next = board({ todo: [task('a', 'todo'), task('b', 'todo', { comment_count: 2 })], done: [task('c', 'done')] }, { latest_event_id: 2 });
  const stable = stableBoard(first, next);
  assert.notEqual(stable, first);
  assert.equal(stable.columns[0].tasks[0], first.columns[0].tasks[0]);
  assert.notEqual(stable.columns[0].tasks[1], first.columns[0].tasks[1]);
  assert.equal(stable.columns[0].tasks[1].comment_count, 2);
  assert.equal(stable.columns[1], first.columns[1]);
  assert.equal(stable.latest_event_id, 2);
});

test('a card that changed lanes leaves its old lane and arrives as a new card in a new lane', () => {
  const first = board({ todo: [task('a', 'todo')], ready: [] });
  const next = board({ todo: [], ready: [task('a', 'ready')] });
  const stable = stableBoard(first, next);
  assert.equal(stable.columns[0].tasks.length, 0);
  assert.equal(stable.columns[1].tasks[0].status, 'ready');
  assert.notEqual(stable.columns[1], first.columns[1]);
});

test('the ribbon gives each lane its share, and an empty board all zeros', () => {
  assert.deepEqual(
    flowSegments(board({ todo: [task('a', 'todo')], ready: [task('b', 'ready'), task('c', 'ready'), task('d', 'ready')], done: [] })).map((s) => s.share),
    [0.25, 0.75, 0],
  );
  assert.deepEqual(flowSegments(board({ todo: [], done: [] })).map((s) => s.share), [0, 0]);
});

test('a selection drops ids that left the board and is kept as is when none did', () => {
  const b = board({ todo: [task('a', 'todo'), task('b', 'todo')] });
  const kept: ReadonlySet<string> = new Set(['a', 'b']);
  assert.equal(pruneSelection(kept, b), kept);
  assert.deepEqual([...pruneSelection(new Set(['a', 'gone']), b)], ['a']);
});

test('Running groups by worker, alphabetically, unassigned under its own heading; other lanes stay flat', () => {
  const tasks = [task('1', 'running', { assignee: 'zed' }), task('2', 'running'), task('3', 'running', { assignee: 'ada' }), task('4', 'running', { assignee: 'zed' })];
  assert.deepEqual(
    buildLaneItems('running', tasks, true).map((i) => i.key),
    ['group:ada', '3', 'group:unassigned', '2', 'group:zed', '1', '4'],
  );
  assert.deepEqual(buildLaneItems('running', tasks, false).map((i) => i.key), ['1', '2', '3', '4']);
  assert.deepEqual(buildLaneItems('todo', [task('x', 'todo', { assignee: 'ada' })], true).map((i) => i.kind), ['card']);
});

test('activity rows read as prose, unknown kinds as key=value, and a bad payload string as itself', () => {
  const event = (kind: string, payload: unknown) => ({ id: 1, kind, payload, created_at: 0 });
  assert.deepEqual(eventText(event('status', { status: 'ready' })), { label: 'moved to Ready', detail: undefined });
  assert.deepEqual(eventText(event('status', '{"status":"todo","reason":"parent_reopened","parent":"t_1"}')), { label: 'moved to Todo', detail: 'parent t_1 reopened' });
  assert.deepEqual(eventText(event('created', { status: 'triage', assignee: 'ada' })), { label: 'created in Triage · assigned to ada' });
  assert.deepEqual(eventText(event('assigned', { assignee: null })), { label: 'unassigned' });
  assert.deepEqual(eventText(event('spawned', { pid: 42 })), { label: 'worker started', detail: 'pid 42' });
  assert.deepEqual(eventText(event('new_thing', { a: 1, b: 'x', nested: { c: 1 } })), { label: 'new thing', detail: 'a=1 b=x' });
  assert.deepEqual(eventText(event('weird', 'not json')), { label: 'weird', detail: 'not json' });
});

test('slugs, run lengths and estimate counts format as the desktop does', () => {
  assert.equal(slugify('  My Board — v2! '), 'my-board-v2');
  assert.equal(slugify('!!!'), '');
  assert.equal(duration(100, 142), '42s');
  assert.equal(duration(100, 100 + 3 * 3600), '3h');
  assert.equal(duration(100, null), null);
  assert.equal(duration(200, 100), null);
  assert.equal(compactNumber(999), '999');
  assert.equal(compactNumber(12_345), '12k');
  assert.equal(compactNumber(1_500), '1.5k');
  assert.equal(compactNumber(2_000_000), '2M');
});
