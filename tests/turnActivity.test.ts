import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addUserMessage, applyEvent, emptyTranscript, type LiveEvent, type Message, type Part, type Transcript } from '../src/chat/transcript.ts';
import {
  activitySignature,
  applyWaitEvent,
  COMPACTION_LABEL,
  idleWait,
  parseModelLoadWait,
  providerWaitText,
  tailSlot,
  toolNarratesWait,
  waitHint,
} from '../src/chat/turnActivity.ts';
import { toolPresentVerb } from '../src/chat/toolView.ts';
import { shimmerHighlight, shimmerRings, shimmerTiming } from '../src/ui/shimmer.ts';

const play = (events: LiveEvent[], start: Transcript = emptyTranscript()) => events.reduce(applyEvent, start);
const tool = (name: string, status: 'running' | 'done'): Part => ({ kind: 'tool', id: name, name, context: '', args: {}, status });

test('a drafted tool is named by its present verb and keeps its first timestamp', () => {
  let wait = applyWaitEvent(idleWait(), 'tool.generating', { name: 'write_file' }, 1000);
  wait = applyWaitEvent(wait, 'tool.generating', { name: 'write_file' }, 5000);
  assert.deepEqual(wait.drafting, { name: 'write_file', since: 1000 });
  assert.equal(waitHint(wait, false), '');
  assert.equal(waitHint(wait, true), 'Editing');
  assert.equal(applyWaitEvent(wait, 'tool.start', {}).drafting, null);
  assert.equal(toolPresentVerb('terminal'), 'Running');
  assert.equal(toolPresentVerb('skill_view'), 'Loading skill');
  assert.equal(toolPresentVerb('mystery'), 'Using');
});

test('only explained provider waits name the row, and output retires them', () => {
  assert.equal(providerWaitText('(｡•́︿•̀｡) pondering...'), '');
  assert.equal(providerWaitText('⏳ still waiting on the provider (30s)'), '⏳ still waiting on the provider (30s)');
  const wait = applyWaitEvent(idleWait(), 'thinking.delta', { text: '⏳ waiting on anthropic' });
  assert.equal(waitHint(wait, true), '⏳ waiting on anthropic');
  assert.equal(applyWaitEvent(wait, 'message.delta', { text: 'hi' }).providerWait, '');
});

test('compaction outranks every other name and clears when the turn resumes', () => {
  let wait = applyWaitEvent(idleWait(), 'thinking.delta', { text: '⏳ waiting on x' });
  wait = applyWaitEvent(wait, 'status.update', { kind: 'compacting', text: 'compacting…' });
  assert.equal(waitHint(wait, true), COMPACTION_LABEL);
  assert.equal(applyWaitEvent(wait, 'status.update', { kind: 'compacted' }).compacting, false);
  assert.equal(applyWaitEvent(wait, 'message.delta', { text: 'a' }).compacting, false);
});

test('the transcript carries the waits and drops them when the turn ends', () => {
  const running = play([{ type: 'message.start' }, { type: 'tool.generating', payload: { name: 'terminal' } }], addUserMessage(emptyTranscript(), 'go'));
  assert.equal(running.wait.drafting?.name, 'terminal');
  const done = applyEvent(running, { type: 'message.complete', payload: { status: 'complete', text: 'ok' } });
  assert.deepEqual(done.wait, idleWait());
  // a raw status line is no longer shown
  assert.deepEqual(applyEvent(running, { type: 'status.update', payload: { text: 'Thinking hard' } }).wait, running.wait);
});

test('progress is what changes the signature: new parts, more text, a call landing', () => {
  const base = activitySignature([{ kind: 'text', text: 'ab' }, tool('terminal', 'running')]);
  assert.notEqual(activitySignature([{ kind: 'text', text: 'abc' }, tool('terminal', 'running')]), base);
  assert.notEqual(activitySignature([{ kind: 'text', text: 'ab' }, tool('terminal', 'done')]), base);
  // an answered question card is the user's move, not progress
  assert.equal(activitySignature([tool('clarify', 'done')]), activitySignature([tool('clarify', 'running')]));
});

test('a running call narrates its own wait unless it is silent or a question', () => {
  assert.equal(toolNarratesWait([tool('terminal', 'running')]), true);
  assert.equal(toolNarratesWait([tool('terminal', 'done')]), false);
  assert.equal(toolNarratesWait([tool('todo', 'running')]), false);
  assert.equal(toolNarratesWait([tool('clarify', 'running')]), false);
});

test('the tail owes the always-on row until the reply puts something on screen', () => {
  const user: Message = { id: 'u', role: 'user', parts: [{ kind: 'text', text: 'hi' }], status: 'complete' };
  const empty: Message = { id: 'a', role: 'assistant', parts: [], status: 'streaming' };
  assert.equal(tailSlot([user]), 'placeholder');
  assert.equal(tailSlot([user, empty]), 'placeholder');
  assert.equal(tailSlot([user, { ...empty, parts: [{ kind: 'reasoning', text: 'hm' }] }]), 'activity');
  assert.equal(tailSlot([user, { ...empty, status: 'complete', interim: true, parts: [{ kind: 'text', text: 'x' }] }]), 'activity');
});

test('managed-local load frames parse into a label and a percent', () => {
  assert.deepEqual(parseModelLoadWait('⏳ loading qwen3 into memory — 43% (12s)'), { label: 'Loading qwen3 into memory', percent: 43 });
  assert.deepEqual(parseModelLoadWait('⚙ processing prompt'), { label: 'Processing prompt', percent: null });
  assert.equal(parseModelLoadWait('⏳ waiting on anthropic'), null);
});

test('the shimmer keeps tw-shimmer timing and stacks rings up to the falloff', () => {
  const timing = shimmerTiming(12);
  assert.equal(timing.delayMs, 100);
  assert.ok(Math.abs(timing.spread - (4 * 0.55 * 12 + 80)) < 1e-9);
  const rings = shimmerRings(100);
  assert.ok(rings.every((ring, i) => i === 0 || ring.halfWidth < rings[i - 1].halfWidth));
  // stacked coverage reaches each stop's weight; the centre is fully the highlight
  const covered = rings.reduce((c, ring) => c + (1 - c) * ring.opacity, 0);
  assert.ok(Math.abs(covered - 1) < 1e-9);
  const light = shimmerRings(100, 0.8).reduce((c, ring) => c + (1 - c) * ring.opacity, 0);
  assert.ok(Math.abs(light - 0.8) < 1e-9);
  assert.deepEqual(shimmerHighlight('#ffffffa3', '#101010', false), { color: '#101010', peak: 0.8 });
  assert.equal(shimmerHighlight('#808080a3', '#101010', true).peak, 1);
});
