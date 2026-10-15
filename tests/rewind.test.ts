import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  durableRowIds,
  isDeepTruncateRefusal,
  isSessionBusyError,
  isStaleTargetError,
  matchDurableRowId,
  planRewind,
  RecentInterrupts,
  rebindRowIds,
  retryWhileBusy,
  rewindOptimistic,
  stampUserRowId,
  survivorRowIdsFrom,
  truncateParams,
  userTurnIndex,
} from '../src/chat/rewind.ts';
import { emptyTranscript, type Message } from '../src/chat/transcript.ts';

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  parts: [{ kind: 'text', text }],
  status: 'complete',
  ...extra,
});

const thread = [
  msg('u1', 'user', 'first', { rowId: 10 }),
  msg('a1', 'assistant', 'one', { rowId: 11 }),
  msg('u2', 'user', 'second', { rowId: 12 }),
  msg('a2', 'assistant', 'two', { rowId: 13 }),
];

test('a reply rewinds to the prompt it answers, a prompt to itself', () => {
  assert.equal(userTurnIndex(thread, 'a2'), 2);
  assert.equal(userTurnIndex(thread, 'u1'), 0);
  assert.equal(userTurnIndex(thread, 'nope'), -1);
  const retry = planRewind(thread, 'a1');
  assert.equal(retry?.index, 0);
  assert.equal(retry?.text, 'first');
  assert.equal(retry?.rowId, 10);
  assert.equal(retry?.laterUserTurns, 1);
  assert.equal(retry?.targetIsLast, false);
  const last = planRewind(thread, 'a2');
  assert.equal(last?.laterUserTurns, 0);
  assert.equal(last?.targetIsLast, true);
});

test('an edit runs the new text, and an empty prompt has nothing to run', () => {
  const plan = planRewind(thread, 'u2', '  better  ');
  assert.equal(plan?.text, 'better');
  assert.equal(plan?.sourceText, 'second');
  assert.equal(planRewind([msg('u', 'user', '  ')], 'u'), null);
  assert.equal(planRewind([msg('a', 'assistant', 'orphan')], 'a'), null, 'a reply with no prompt before it');
});

test('a row-addressed cut confirms the truncation and the empty-prefix gate; a deep cut adds its consent', () => {
  assert.deepEqual(truncateParams(12, false), { confirm_truncate: true, truncate_before_row_id: 12, confirm_empty_truncate: true });
  assert.deepEqual(truncateParams(12, true), { confirm_truncate: true, truncate_before_row_id: 12, confirm_empty_truncate: true, confirm_deep_truncate: true });
});

test('a prompt without a row id is found by content in the durable history, exact or nothing', () => {
  const rows = [
    { role: 'user', text: 'hello', row_id: 1 },
    { role: 'assistant', text: 'hi', row_id: 2 },
    { role: 'user', text: 'again', row_id: 3 },
    { role: 'user', text: 'again', row_id: 5 },
    { role: 'user', text: 'hidden', row_id: 6, display_kind: 'hidden' },
  ];
  assert.equal(matchDurableRowId(rows, 'hello', false), 1);
  assert.equal(matchDurableRowId(rows, ' hello ', false), 1);
  assert.equal(matchDurableRowId(rows, 'again', false), undefined, 'a repeat is ambiguous');
  assert.equal(matchDurableRowId(rows.slice(0, 4), 'again', true), 5, 'a repeat resolves to the newest persisted turn when the target is the newest');
  assert.equal(matchDurableRowId([...rows.slice(0, 4), { role: 'user', text: 'later', row_id: 7 }], 'again', true), undefined);
  assert.equal(matchDurableRowId(rows, 'hidden', false), undefined);
  assert.equal(matchDurableRowId(rows, '', false), undefined);
});

test('survivor ids come as an old-to-new map, or in user order on older servers', () => {
  const map = survivorRowIdsFrom({ survivor_row_id_map: { '10': 20, '12': null, x: 3 } });
  assert.ok(map instanceof Map);
  assert.deepEqual([...map], [[10, 20], [12, null]]);
  assert.deepEqual(survivorRowIdsFrom({ survivor_user_row_ids: [4, null, 'x'] }), [4, null, null]);
  assert.equal(survivorRowIdsFrom({}), undefined);
  assert.equal(survivorRowIdsFrom(undefined), undefined);
});

test('rebinding swaps a row id for its rewritten one and drops the ones that no longer exist', () => {
  const rebound = rebindRowIds(thread, new Map([[10, 20], [12, null]]));
  assert.deepEqual(rebound.map((m) => m.rowId), [20, 11, undefined, 13]);
  assert.equal('rowId' in rebound[2], false);
  assert.equal(rebound[1], thread[1], 'untouched rows keep their identity');
  const byOrder = rebindRowIds(thread, [30, null]);
  assert.deepEqual(byOrder.map((m) => m.rowId), [30, 11, undefined, 13]);
  assert.deepEqual(durableRowIds(thread), [10, 11, 12, 13]);
});

test('the optimistic rewind drops what follows, swaps in an edit and runs', () => {
  const state = { ...emptyTranscript(), messages: thread };
  const restored = rewindOptimistic(state, planRewind(thread, 'u1')!);
  assert.deepEqual(restored.messages.map((m) => m.id), ['u1']);
  assert.equal(restored.messages[0], thread[0]);
  assert.equal(restored.running, true);
  const edited = rewindOptimistic(state, planRewind(thread, 'u2', 'second, but better')!);
  assert.deepEqual(edited.messages.map((m) => m.id), ['u1', 'a1', 'u2']);
  assert.deepEqual(edited.messages[2].parts, [{ kind: 'text', text: 'second, but better' }]);
});

test('the row id a submit minted lands on the newest user message that has none', () => {
  const state = { ...emptyTranscript(), messages: [msg('u1', 'user', 'a', { rowId: 1 }), msg('u2', 'user', 'b'), msg('a', 'assistant', 'c')] };
  const stamped = stampUserRowId(state, 9);
  assert.equal(stamped.messages[1].rowId, 9);
  assert.equal(stampUserRowId(stamped, 10), stamped, 'a stamped turn is left alone');
});

test('a rewind interrupts first when busy or within three seconds of Stop', () => {
  const interrupts = new RecentInterrupts();
  assert.equal(interrupts.shouldInterruptFirst({ busy: false, sessionId: 's', now: 0 }), false);
  assert.equal(interrupts.shouldInterruptFirst({ busy: true, sessionId: 's', now: 0 }), true);
  interrupts.mark('s', 1_000);
  assert.equal(interrupts.shouldInterruptFirst({ busy: false, sessionId: 's', now: 3_999 }), true);
  assert.equal(interrupts.shouldInterruptFirst({ busy: false, sessionId: 's', now: 4_000 }), false);
  assert.equal(interrupts.shouldInterruptFirst({ busy: false, sessionId: 'other', now: 1_500 }), false);
});

test('the gateway refusals are told apart', () => {
  assert.equal(isSessionBusyError(new Error('session busy')), true);
  assert.equal(isSessionBusyError(new Error('session_busy')), true);
  assert.equal(isSessionBusyError(new Error('nope')), false);
  assert.equal(isDeepTruncateRefusal(Object.assign(new Error('x'), { code: 4033 })), true);
  assert.equal(isDeepTruncateRefusal(new Error('x')), false);
  assert.equal(isStaleTargetError(new Error('row 12 is no longer in session history')), true);
  assert.equal(isStaleTargetError(new Error('other')), false);
});

test('a call that races the end of a turn is repeated until it lands', async () => {
  let calls = 0;
  const slept: number[] = [];
  const result = await retryWhileBusy(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('session busy');
      return 'ok';
    },
    { sleep: async (ms) => void slept.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(slept, [150, 150]);
  await assert.rejects(retryWhileBusy(async () => Promise.reject(new Error('boom')), { sleep: async () => undefined }), /boom/);
  await assert.rejects(
    retryWhileBusy(async () => Promise.reject(new Error('session busy')), { timeoutMs: 0, sleep: async () => undefined }),
    /session busy/,
  );
});
