import assert from 'node:assert/strict';
import { test } from 'node:test';

import { idleTracker, lastReplyId, observeReply, type SpeakObservation, type SpeakTracker } from '../src/chat/autoSpeakTracker.ts';
import type { Message } from '../src/chat/transcript.ts';

const msg = (id: string, role: Message['role'], interim = false): Message => ({ id, role, parts: [], status: 'complete', ...(interim ? { interim } : {}) });

/** feeds observations in order and collects what would be read */
function run(steps: SpeakObservation[], start: SpeakTracker = idleTracker()): (string | null)[] {
  let tracker = start;
  return steps.map((seen) => {
    const step = observeReply(tracker, seen);
    tracker = step.tracker;
    return step.speak;
  });
}

test('the last reply skips interim segments and stops at the user turn', () => {
  assert.equal(lastReplyId([msg('u1', 'user'), msg('a1', 'assistant', true), msg('a2', 'assistant')]), 'a2');
  assert.equal(lastReplyId([msg('a1', 'assistant'), msg('u2', 'user')]), null);
  assert.equal(lastReplyId([msg('u1', 'user'), msg('a1', 'assistant', true)]), null);
  assert.equal(lastReplyId([]), null);
});

test('a turn that finishes in front of the user is read once', () => {
  assert.deepEqual(
    run([
      { session: 's', running: false, lastReplyId: 'a1' },
      { session: 's', running: true, lastReplyId: null },
      { session: 's', running: true, lastReplyId: 'a2' },
      { session: 's', running: false, lastReplyId: 'a2' },
      { session: 's', running: false, lastReplyId: 'a2' },
    ]),
    [null, null, null, 'a2', null],
  );
});

test('opening a chat or its history loading reads nothing', () => {
  assert.deepEqual(
    run([
      { session: 's', running: false, lastReplyId: null },
      { session: 's', running: false, lastReplyId: 'a9' },
      { session: 't', running: false, lastReplyId: 'b9' },
    ]),
    [null, null, null],
  );
});

test('a chat opened mid-turn has its finish read', () => {
  assert.deepEqual(
    run([
      { session: 's', running: true, lastReplyId: 'a2' },
      { session: 's', running: false, lastReplyId: 'a2' },
    ]),
    [null, 'a2'],
  );
});

test('a turn that ends without a new reply reads nothing', () => {
  assert.deepEqual(
    run([
      { session: 's', running: false, lastReplyId: 'a1' },
      { session: 's', running: true, lastReplyId: null },
      { session: 's', running: false, lastReplyId: null },
    ]),
    [null, null, null],
  );
});

test('a draft promoted to a session mid-turn still reads its finish', () => {
  assert.deepEqual(
    run([
      { session: 'draft', running: false, lastReplyId: null },
      { session: 'draft', running: true, lastReplyId: null },
      { session: 'abc', running: true, lastReplyId: 'a1' },
      { session: 'abc', running: false, lastReplyId: 'a1' },
    ]),
    [null, null, null, 'a1'],
  );
});
