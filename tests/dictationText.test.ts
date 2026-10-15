import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyResult,
  formatElapsed,
  heardSomething,
  joinSpeech,
  levelFromVolume,
  noticeForError,
  noticeText,
  NO_SPEECH,
  recordingCapSeconds,
  startTake,
  takeText,
} from '../src/chat/dictationText.ts';

test('interim speech replaces itself, a final result settles and the next utterance joins it', () => {
  let take = startTake('Please');
  take = applyResult(take, 'hel', false);
  assert.equal(takeText(take), 'Please hel');
  take = applyResult(take, 'hello wor', false);
  assert.equal(takeText(take), 'Please hello wor');
  take = applyResult(take, 'hello world', true);
  assert.equal(takeText(take), 'Please hello world');
  assert.equal(take.interim, '');
  take = applyResult(take, 'and more', false);
  assert.equal(takeText(take), 'Please hello world and more');
  take = applyResult(take, 'and more', true);
  assert.equal(takeText(take), 'Please hello world and more');
});

test('dictating into an empty composer, or one that ends in a space, adds no extra space', () => {
  assert.equal(takeText(applyResult(startTake(''), 'hello', false)), 'hello');
  assert.equal(takeText(applyResult(startTake('Note: '), 'hello', true)), 'Note: hello');
  assert.equal(joinSpeech('a', ''), 'a');
  assert.equal(joinSpeech('', ''), '');
});

test('a take that heard nothing is the no-speech case', () => {
  assert.equal(heardSomething(startTake('typed before')), false);
  assert.equal(heardSomething(applyResult(startTake(''), '  ', false)), false);
  assert.equal(heardSomething(applyResult(startTake(''), 'hi', false)), true);
});

test('the cap follows the desktop: unset is two minutes, and it clamps to 1..600', () => {
  assert.equal(recordingCapSeconds(undefined), 120);
  assert.equal(recordingCapSeconds(0), 120);
  assert.equal(recordingCapSeconds(Number.NaN), 120);
  assert.equal(recordingCapSeconds(45.9), 45);
  assert.equal(recordingCapSeconds(0.4), 1);
  assert.equal(recordingCapSeconds(5000), 600);
});

test('the clock and level readouts', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(65.9), '1:05');
  assert.equal(formatElapsed(-3), '0:00');
  assert.equal(levelFromVolume(-2), 0);
  assert.equal(levelFromVolume(5), 0.5);
  assert.equal(levelFromVolume(12), 1);
});

test('errors map to the desktop voice notices, and an abort is silent', () => {
  assert.equal(noticeForError('aborted', ''), null);
  assert.deepEqual(noticeForError('no-speech', ''), NO_SPEECH);
  assert.deepEqual(noticeForError('speech-timeout', ''), NO_SPEECH);
  assert.deepEqual(noticeForError('not-allowed', ''), { title: 'Voice unavailable', message: 'Microphone permission was denied.' });
  assert.deepEqual(noticeForError('client', 'boom'), { title: 'Voice recording failed', message: 'boom' });
  assert.equal(noticeText(NO_SPEECH), 'No speech detected. Try recording again.');
  assert.equal(noticeText({ title: 'Voice recording failed' }), 'Voice recording failed');
});
