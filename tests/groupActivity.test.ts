import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RoomEvent } from '../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { buildActivity, summarizeActivity } from '../src/groups/activity.ts';
import type { GroupMember } from '../src/groups/rooms.ts';

const members: GroupMember[] = [
  { memberId: 'ada', profile: 'ada', handle: 'ada', label: 'Ada' },
  { memberId: 'bo', profile: 'bo', handle: 'bo', label: 'Bo' },
];

let nextSeq = 1;
const event = (kind: string, payload: Record<string, unknown> = {}, member = 'ada', seq = nextSeq++): RoomEvent => ({
  room_id: 'r1',
  seq,
  event_id: `e${seq}`,
  kind,
  actor: { kind: 'gateway', id: 'gw' },
  payload: { member_id: member, ...payload },
  created_at: 1000 + seq,
});
const coord = { discussion_event_id: 'd', member_index: 0, round_index: 0, task_id: 't', thread_id: 'th', turn_id: 'tu', seen_through_seq: 1 };

test('turn outcomes read as who-did-what rows, and messages stay out', () => {
  const rows = buildActivity(
    [
      event('message.member', { text: 'hi' }, 'ada', 1),
      event('turn.settled', { ...coord, message_event_id: 'm1', passed: false }, 'ada', 2),
      event('turn.settled', { ...coord, message_event_id: null, passed: true }, 'bo', 3),
      event('turn.failed', { ...coord, error: 'quota exceeded' }, 'bo', 4),
      event('turn.cancelled', { ...coord, reason: 'superseded_by_newer_user_event' }, 'ada', 5),
      event('room.activity', { status: 'bounded', reason_code: 'r', thread_id: 'th', discussion_event_id: 'd' }, 'ada', 6),
    ],
    members,
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ['Ada replied', 'Bo passed', 'Bo hit an error — quota exceeded', 'Ada was interrupted by a newer message', 'Turn stopped at the round/message cap'],
  );
  assert.deepEqual(
    rows.map((row) => row.tone),
    ['work', 'info', 'error', 'info', 'info'],
  );
});

test('a member who left the roster is still named from the event itself', () => {
  const [row] = buildActivity([event('turn.failed', { ...coord, error: 'x' }, 'gone', 1)], members);
  assert.equal(row.member, 'gone');
});

test('the summary names live work, pins an unresolved failure, and clears it on success', () => {
  const failed = buildActivity(
    [event('turn.failed', { ...coord, error: 'boom' }, 'bo', 1), event('turn.settled', { ...coord, message_event_id: null, passed: true }, 'ada', 2)],
    members,
  );
  assert.equal(summarizeActivity(failed, true, 2000), 'The room is working…');
  assert.ok(summarizeActivity(failed, false, 2000)?.startsWith('Bo hit an error'));
  const healed = [...failed, ...buildActivity([event('turn.settled', { ...coord, message_event_id: 'm', passed: false }, 'bo', 3)], members)];
  assert.ok(summarizeActivity(healed, false, 2000)?.startsWith('Bo replied'));
  assert.equal(summarizeActivity([], false, 2000), null);
});
