import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addUserMessage, applyEvent, emptyTranscript, type LiveEvent, type Transcript } from '../src/chat/transcript.ts';
import { applyWaitEvent, createTailStore, deriveTail, idleWait, promptAt } from '../src/chat/turnActivity.ts';

const play = (events: LiveEvent[], start: Transcript) => events.reduce(applyEvent, start);

function watch(store: ReturnType<typeof createTailStore>) {
  const seen = { renders: 0, signatures: 0 };
  store.subscribe(() => (seen.renders += 1));
  store.subscribeSignature(() => (seen.signatures += 1));
  return seen;
}

test('a streamed delta rings the quiet timer and re-renders nobody', () => {
  const store = createTailStore();
  const prompt = addUserMessage(emptyTranscript(), 'go');
  store.update(prompt.messages, true, idleWait());
  const first = play([{ type: 'message.start' }, { type: 'message.delta', payload: { text: 'a' } }], prompt);
  store.update(first.messages, true, idleWait());
  const painted = store.getRender();
  const seen = watch(store);

  let state = first;
  for (const text of ['b', 'c', 'd', 'e']) {
    state = applyEvent(state, { type: 'message.delta', payload: { text } });
    store.update(state.messages, true, idleWait());
  }
  assert.equal(seen.renders, 0);
  assert.equal(seen.signatures, 4);
  assert.equal(store.getRender(), painted);
});

test('what the row paints from changes notify exactly once', () => {
  const store = createTailStore();
  const prompt = addUserMessage(emptyTranscript(), 'go');
  const seen = watch(store);
  store.update(prompt.messages, true, idleWait());
  assert.equal(seen.renders, 1);
  assert.equal(store.getRender().placeholder, true);
  assert.equal(store.getRender().tailIsReply, false);

  // a reply with text lands: placeholder -> activity, and the row moves into the message
  const replying = play([{ type: 'message.start' }, { type: 'message.delta', payload: { text: 'hi' } }], prompt);
  store.update(replying.messages, true, idleWait());
  assert.equal(seen.renders, 2);
  assert.equal(store.getRender().placeholder, false);
  assert.equal(store.getRender().tailIsReply, true);

  // a tool starting narrates the wait itself
  const tooling = applyEvent(replying, { type: 'tool.start', payload: { tool_id: 't1', name: 'terminal', context: 'ls' } });
  store.update(tooling.messages, true, idleWait());
  assert.equal(seen.renders, 3);
  assert.equal(store.getRender().narrating, true);

  // a new wait object with the same content is not a change; a named drafting tool is
  store.update(tooling.messages, true, { ...idleWait() });
  assert.equal(seen.renders, 3);
  store.update(tooling.messages, true, applyWaitEvent(idleWait(), 'tool.generating', { name: 'write_file' }, 5));
  assert.equal(seen.renders, 4);
  store.update(tooling.messages, false, idleWait());
  assert.equal(seen.renders, 5);
  assert.equal(store.getRender().running, false);
});

test('unsubscribed listeners stop hearing', () => {
  const store = createTailStore();
  let calls = 0;
  const off = store.subscribe(() => (calls += 1));
  const prompt = addUserMessage(emptyTranscript(), 'go');
  store.update(prompt.messages, true, idleWait());
  off();
  store.update(prompt.messages, false, idleWait());
  assert.equal(calls, 1);
});

test('the prompt\'s own timestamp seeds a turn that was already running when the chat opened', () => {
  const prompt = addUserMessage(emptyTranscript(), 'go');
  const stamp = prompt.messages[0].timestamp!;
  assert.equal(promptAt(prompt.messages), stamp * 1000);
  assert.equal(promptAt([]), undefined);
  assert.equal(promptAt([{ ...prompt.messages[0], timestamp: undefined }]), undefined);
  const derived = deriveTail(prompt.messages, true, idleWait());
  assert.equal(derived.promptAt, stamp * 1000);
  assert.equal(derived.signature, '0:0:0');
});
