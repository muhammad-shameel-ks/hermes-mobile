import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatEnv, chatMeta, openEntry, openTranscript, sameModel, settingsSlice, shellSlice } from '../src/chat/chatSlices.ts';
import type { ChatEntry, ChatSnapshot } from '../src/chat/controller.ts';
import { NO_HISTORY } from '../src/chat/history.ts';
import { emptyRequests } from '../src/chat/requests.ts';
import { createMemoSelect, shallowEqual } from '../src/chat/selector.ts';
import { emptyStack } from '../src/chat/statusSync.ts';
import { emptyTranscript, type Message } from '../src/chat/transcript.ts';
import { createBotsSlice, createSessionsSlice } from '../src/drawer/drawerSlices.ts';
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

test('the drawer panes hold still while the open chat streams', () => {
  const start = base({ draft: entry('draft'), a: entry('a', { isBotChat: true, bot: 'ada' }), b: entry('b', { transcript: { ...emptyTranscript(), messages: [message('u1', 'hi')] } }) });
  for (const create of [createSessionsSlice, createBotsSlice]) {
    const slice = create() as (snapshot: ChatSnapshot) => object;
    const memo = createMemoSelect<ChatSnapshot, object>();
    const first = memo(start, slice, shallowEqual);
    // the first token flips running (the row's dot), every later one changes nothing a pane reads
    let snapshot = stream(start, 't');
    const running = memo(snapshot, slice, shallowEqual);
    assert.notEqual(running, first);
    for (let i = 0; i < 300; i += 1) {
      snapshot = stream(snapshot, 't'.repeat(i + 2));
      assert.equal(memo(snapshot, slice, shallowEqual), running);
    }
  }
});

test('the panes read each chat activity, and the bots pane the open bot and whether it thinks', () => {
  const requests = { ...emptyRequests(), approvals: [{ requestId: 'r' }] } as never;
  const cases: ChatEntry[] = [
    entry('a'),
    entry('a', { transcript: { ...emptyTranscript(), running: true, messages: [message('u1', 'hi')] } }),
    entry('a', { requests }),
    entry('a', { stack: { ...emptyStack(), status: { ...emptyStack().status, background: [{ state: 'running' }] as never } } }),
  ];
  for (const real of cases) {
    const snapshot = base({ draft: entry('draft'), a: real });
    assert.deepEqual(createSessionsSlice()(snapshot).activities.a, chatActivity(real));
    assert.deepEqual(createBotsSlice()(snapshot).activities.a, chatActivity(real));
  }
  const bots = createBotsSlice();
  const idle = bots(base({ draft: entry('draft'), a: entry('a', { isBotChat: true, bot: 'ada' }) }));
  assert.equal(idle.selected, 'ada');
  assert.equal(idle.thinking, null);
  const thinking = bots(stream(base({ draft: entry('draft'), a: entry('a', { isBotChat: true, bot: 'ada' }) }), 'x'));
  assert.equal(thinking.thinking, 'ada');
  assert.equal(bots(base({ draft: entry('draft'), a: entry('a') })).selected, null);
});

test('a dropped chat drops its activity', () => {
  const slice = createSessionsSlice();
  const one = slice(base({ draft: entry('draft'), a: entry('a') }));
  const two = slice(base({ draft: entry('draft') }));
  assert.notEqual(two.activities, one.activities);
  assert.deepEqual(Object.keys(two.activities), ['draft']);
});
