import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionInfo } from '../src/chat/controller.ts';
import { rowDotState, stableActivities, NO_ACTIVITIES } from '../src/drawer/dotStates.ts';
import { toSessionRows } from '../src/drawer/sessionDates.ts';
import { buildSessionListItems, type SessionListInput } from '../src/drawer/sessionListItems.ts';

const session = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({ id, title: id, started_at: 1, last_active: 1, message_count: 1, source: null, model: null, preview: null, ...patch }) as SessionInfo;
const rows = (...ids: string[]) => toSessionRows(ids.map((id) => ({ session: session(id) })));

const base = (patch: Partial<SessionListInput> = {}): SessionListInput => ({
  query: '',
  results: { rows: [], pending: false },
  pinsOpen: true,
  recentsOpen: true,
  closedGroups: [],
  pinned: [],
  recents: { rows: rows('a', 'b', 'c'), skeletons: false, loadError: false, allPinned: false, footer: null },
  platforms: [],
  ...patch,
});

test('sections lay out as header, rows, then a closing cell carrying the section padding', () => {
  const items = buildSessionListItems(base({ pinned: rows('p') }));
  assert.deepEqual(
    items.map((i) => `${i.kind}:${i.end ? 'end' : ''}`),
    ['header:', 'row:end', 'header:', 'row:', 'row:', 'row:end'],
  );
});

test('only rows after the first of a list carry the stack gap', () => {
  const items = buildSessionListItems(base());
  const gaps = items.filter((i) => i.kind === 'row').map((i) => (i.kind === 'row' ? i.gap : null));
  assert.deepEqual(gaps, [false, true, true]);
});

test('a closed section is its header alone, and still closes the section', () => {
  const items = buildSessionListItems(base({ recentsOpen: false }));
  const last = items[items.length - 1]!;
  assert.equal(last.kind, 'header');
  assert.equal(last.end, true);
  assert.equal(items.filter((i) => i.kind === 'row').length, 0);
});

test('placeholders stand in for rows', () => {
  const pinnedHint = buildSessionListItems(base()).find((i) => i.kind === 'state');
  assert.equal(pinnedHint?.kind === 'state' && pinnedHint.state, 'pinned-hint');
  const skeleton = buildSessionListItems(base({ recents: { rows: [], skeletons: true, loadError: false, allPinned: false, footer: { loading: false } } }));
  assert.ok(skeleton.some((i) => i.kind === 'state' && i.state === 'skeletons'));
  assert.ok(!skeleton.some((i) => i.kind === 'more'), 'no footer under skeletons');
  const failed = buildSessionListItems(base({ recents: { rows: [], skeletons: false, loadError: true, allPinned: false, footer: null } }));
  assert.ok(failed.some((i) => i.kind === 'state' && i.state === 'load-error'));
  const empty = buildSessionListItems(base({ recents: { rows: [], skeletons: false, loadError: false, allPinned: true, footer: null } }));
  assert.ok(empty.some((i) => i.kind === 'state' && i.state === 'empty' && i.text?.startsWith('Everything here is pinned')));
});

test('a query replaces the sections with Results', () => {
  const items = buildSessionListItems(base({ query: 'x', results: { rows: rows('r1'), pending: false } }));
  assert.deepEqual(items.map((i) => i.kind), ['header', 'row']);
  assert.equal(items[0]!.kind === 'header' && items[0].fold, undefined);
  const none = buildSessionListItems(base({ query: 'x', results: { rows: [], pending: false } }));
  assert.ok(none.some((i) => i.kind === 'state' && i.state === 'empty-tall' && i.text === 'No sessions match “x”.'));
  const waiting = buildSessionListItems(base({ query: 'x', results: { rows: [], pending: true } }));
  assert.ok(waiting.some((i) => i.kind === 'state' && i.state === 'skeletons'));
});

test('platform sections carry their chip, rows and load-more footer', () => {
  const items = buildSessionListItems(base({ platforms: [{ sourceId: 'telegram', label: 'Telegram', open: true, rows: rows('t1'), footer: { loading: false, step: 4, loaded: 9, more: true } }] }));
  const header = items.find((i) => i.kind === 'header' && i.platform === 'telegram');
  assert.ok(header);
  const more = items.find((i) => i.kind === 'more');
  assert.ok(more && more.kind === 'more' && more.step === 4);
  assert.equal(items[items.length - 1], more);
  assert.equal(more.end, true);
});

test('cell keys are unique across the whole list', () => {
  const items = buildSessionListItems(
    base({ pinned: rows('p'), platforms: [{ sourceId: 'telegram', label: 'Telegram', open: true, rows: rows('a', 'b'), footer: null }] }),
  );
  const keys = items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('dividers keep their group key and open state', () => {
  const divider = { kind: 'divider' as const, key: 'yesterday', label: 'Yesterday' };
  const items = buildSessionListItems(base({ recents: { rows: [...rows('a'), divider, ...rows('b')], skeletons: false, loadError: false, allPinned: false, footer: null }, closedGroups: ['yesterday'] }));
  const found = items.find((i) => i.kind === 'divider');
  assert.ok(found && found.kind === 'divider' && found.groupKey === 'yesterday' && found.open === false && found.gap === true);
});

const entry = (running: boolean) => ({ transcript: { running }, requests: { approvals: [], clarify: null, prompts: {} }, stack: { status: { background: [], subagents: [] } } }) as never;

test('the activity map is reused while no chat changed, however the entries churn', () => {
  const first = stableActivities(NO_ACTIVITIES, { a: entry(true), b: entry(false) });
  const again = stableActivities(first, { a: entry(true), b: entry(false) });
  assert.equal(again, first);
  const changed = stableActivities(first, { a: entry(false), b: entry(false) });
  assert.notEqual(changed, first);
  assert.equal(changed.b, first.b);
  assert.equal(changed.a?.running, false);
  const dropped = stableActivities(first, { a: entry(true) });
  assert.notEqual(dropped, first);
  assert.deepEqual(Object.keys(dropped), ['a']);
});

test('a row paints the live chat, else the unread watermark; the open chat is read', () => {
  const activities = stableActivities(NO_ACTIVITIES, { a: entry(true) });
  assert.equal(rowDotState(activities, 'z', {}, { id: 'a' }), 'working');
  assert.equal(rowDotState(activities, 'z', {}, { id: 'b', unread: true }), 'unread');
  assert.equal(rowDotState(activities, 'b', {}, { id: 'b', unread: true }), 'idle');
  assert.equal(rowDotState(activities, 'z', { b: true }, { id: 'b' }), 'unread');
  assert.equal(rowDotState(activities, 'z', {}, { id: 'c' }), 'idle');
});
