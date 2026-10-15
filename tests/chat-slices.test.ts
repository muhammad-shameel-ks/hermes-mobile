import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatEnv, chatMeta, createDrawerSlice, openEntry, openTranscript, sameModel, settingsSlice, shellSlice } from '../src/chat/chatSlices.ts';
import type { ChatEntry, ChatSnapshot } from '../src/chat/controller.ts';
import { NO_HISTORY } from '../src/chat/history.ts';
import { emptyRequests } from '../src/chat/requests.ts';
import { createMemoSelect, shallowEqual } from '../src/chat/selector.ts';
import { emptyStack } from '../src/chat/statusSync.ts';
import { emptyTranscript, type Message } from '../src/chat/transcript.ts';
import { chatActivity } from '../src/drawer/sessionStatus.ts';

const message = (id: string, text: string, status: Message['status'] = 'complete'): Message => ({
  id,
  role: id.startsWith('u') ? 'user' : 'assistant',
  parts: [{ kind: 'text', text }],
  status,
});

const entry = (key: string, patch: Partial<ChatEntry> = {}): ChatEntry => ({
  key,
  runtimeId: key === 'draft' ? null : `rt-${key}`,
  profile: 'default',
  title: null,
  isBotChat: false,
  bot: null,
  cwd: null,
  transcript: emptyTranscript(),
  loading: false,
  error: null,
  model: null,
  history: NO_HISTORY,
  stack: emptyStack(),
  requests: emptyRequests(),
  ...patch,
});

const base = (entries: Record<string, ChatEntry>, openKey = 'a'): ChatSnapshot =>
  ({
    link: { kind: 'open' },
    profile: 'default',
    openKey,
    entries,
    sessions: { items: [], messaging: [], loading: false, loaded: true, loadingMore: false, error: null, hasMore: false, hasMoreMessaging: false, corrupt: false },
    finishedAway: {},
    roster: { visible: [], hidden: [], loaded: true, loading: false, error: null },
    openingBot: null,
    notice: null,
    models: { profile: 'default', providers: [], current: null, loading: false, error: null },
    personality: '',
    defaultEffort: null,
    reactionsEnabled: false,
  }) as ChatSnapshot;

/** one streamed token: the open entry's transcript and the entries record are replaced, nothing else */
const stream = (snapshot: ChatSnapshot, text: string): ChatSnapshot => {
  const open = openEntry(snapshot);
  const live = message('a1', text, 'streaming');
  const messages = [...open.transcript.messages.filter((m) => m.id !== 'a1'), live];
  const next = { ...open, transcript: { ...open.transcript, running: true, messages } };
  return { ...snapshot, entries: { ...snapshot.entries, [open.key]: next } };
};

test('openEntry falls back to the draft', () => {
  const draft = entry('draft');
  assert.equal(openEntry(base({ draft }, 'gone')), draft);
});

test('the shell, the chat chrome and the settings slices do not move while a turn streams', () => {
  const start = base({ draft: entry('draft'), a: entry('a', { transcript: { ...emptyTranscript(), messages: [message('u1', 'hi')] } }) });
  const shell = createMemoSelect<ChatSnapshot, ReturnType<typeof shellSlice>>();
  const env = createMemoSelect<ChatSnapshot, ReturnType<typeof chatEnv>>();
  const settings = createMemoSelect<ChatSnapshot, ReturnType<typeof settingsSlice>>();
  const first = { shell: shell(start, shellSlice, shallowEqual), env: env(start, chatEnv, shallowEqual), settings: settings(start, settingsSlice, shallowEqual) };
  let snapshot = stream(start, 'x');
  const meta = createMemoSelect<ChatSnapshot, ReturnType<typeof chatMeta>>();
  meta(snapshot, chatMeta, shallowEqual);
  const running = meta(snapshot, chatMeta, shallowEqual);
  for (let i = 0; i < 200; i += 1) {
    snapshot = stream(snapshot, 'x'.repeat(i + 2));
    assert.equal(shell(snapshot, shellSlice, shallowEqual), first.shell);
    assert.equal(env(snapshot, chatEnv, shallowEqual), first.env);
    assert.equal(settings(snapshot, settingsSlice, shallowEqual), first.settings);
    assert.equal(meta(snapshot, chatMeta, shallowEqual), running);
  }
});

test('the chat meta moves when a turn starts or ends, the transcript itself on every token', () => {
  const start = base({ draft: entry('draft'), a: entry('a', { transcript: { ...emptyTranscript(), messages: [message('u1', 'hi')] } }) });
  const meta = createMemoSelect<ChatSnapshot, ReturnType<typeof chatMeta>>();
  const before = meta(start, chatMeta, shallowEqual);
  assert.equal(before.running, false);
  const streaming = stream(start, 'x');
  const during = meta(streaming, chatMeta, shallowEqual);
  assert.notEqual(during, before);
  assert.equal(during.running, true);
  assert.notEqual(openTranscript(stream(streaming, 'xy')), openTranscript(streaming));
});

test('the model compares by its fields and null-safely', () => {
  assert.ok(sameModel(null, null));
  assert.ok(sameModel({ model: 'm', provider: 'p', effort: null }, { model: 'm', provider: 'p', effort: null }));
  assert.ok(!sameModel({ model: 'm', provider: 'p', effort: null }, { model: 'm', provider: 'p', effort: 'high' }));
  assert.ok(!sameModel(null, { model: 'm', provider: 'p', effort: null }));
});

test('the drawer slice holds still while the open chat streams', () => {
  const slice = createDrawerSlice();
  const memo = createMemoSelect<ChatSnapshot, ChatSnapshot>();
  const start = base({ draft: entry('draft'), a: entry('a'), b: entry('b', { transcript: { ...emptyTranscript(), messages: [message('u1', 'hi')] } }) });
  const first = memo(start, slice, shallowEqual);
  // the first token flips running (the drawer's dot), every later one changes nothing it reads
  const running = memo(stream(start, 't'), slice, shallowEqual);
  assert.notEqual(running, first);
  let snapshot = stream(start, 't');
  for (let i = 0; i < 300; i += 1) {
    snapshot = stream(snapshot, 't'.repeat(i + 2));
    assert.equal(memo(snapshot, slice, shallowEqual), running);
  }
});

test('the drawer slice keeps unchanged entries by identity and never carries a message list', () => {
  const slice = createDrawerSlice();
  const start = base({ draft: entry('draft'), a: entry('a', { transcript: { ...emptyTranscript(), messages: [message('u1', 'secret')] } }), b: entry('b') });
  const one = slice(start);
  assert.equal(one.entries.a.transcript.messages.length, 0);
  const two = slice(stream(start, 'x'));
  assert.equal(two.entries.b, one.entries.b);
  assert.equal(two.entries.draft, one.entries.draft);
  assert.notEqual(two.entries.a, one.entries.a);
  const three = slice(stream(stream(start, 'x'), 'xy'));
  assert.equal(three.entries, two.entries);
});

test('the drawer reads the same activity off a thin entry as off the real one', () => {
  const slice = createDrawerSlice();
  const requests = { ...emptyRequests(), approvals: [{ requestId: 'r' }] } as never;
  const cases: ChatEntry[] = [
    entry('a'),
    entry('a', { transcript: { ...emptyTranscript(), running: true, messages: [message('u1', 'hi')] } }),
    entry('a', { requests }),
    entry('a', { stack: { ...emptyStack(), status: { ...emptyStack().status, background: [{ state: 'running' }] as never } } }),
  ];
  for (const real of cases) {
    const thin = slice(base({ draft: entry('draft'), a: real })).entries.a;
    assert.deepEqual(chatActivity(thin), chatActivity(real));
    assert.equal(thin.isBotChat, real.isBotChat);
    assert.equal(thin.bot, real.bot);
  }
});

test('a reordered or dropped entry is a change', () => {
  const slice = createDrawerSlice();
  const one = slice(base({ draft: entry('draft'), a: entry('a') }));
  const two = slice(base({ draft: entry('draft') }));
  assert.notEqual(two.entries, one.entries);
  assert.equal(Object.keys(two.entries).length, 1);
});
