import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyStack, persistedStack, restoreStack, StatusSync, type StatusHost } from '../src/chat/statusSync.ts';
import { queueFrom } from '../src/chat/queue.ts';
import { emptyStatus, type StatusState } from '../src/chat/statusStack.ts';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

function setup(answers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const store = { status: emptyStatus() as StatusState, clock: 0 };
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const notices: string[] = [];
  const host: StatusHost = {
    get: () => store.status,
    set: (_key, update) => {
      store.status = update(store.status);
    },
    runtimeId: () => 'rt-1',
    profile: () => 'default',
    ready: () => true,
    request: (async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) throw Object.assign(new Error('Method not found'), { code: -32601 });
      return answer(params);
    }) as StatusHost['request'],
    notify: (text) => notices.push(text),
    after: (ms, run) => {
      const timer = { at: store.clock + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    now: () => store.clock,
  };
  const sync = new StatusSync(host);
  const advance = (ms: number) => {
    store.clock += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= store.clock) {
        timer.live = false;
        timer.run();
      }
    }
  };
  return { sync, store, calls, notices, advance };
}

test('a finished todo list drops out on its own once its linger has passed', () => {
  const { sync, store, advance } = setup();
  sync.observe('s', { type: 'todo.updated', payload: { todos: [{ id: 'a', content: 'Done', status: 'completed' }], revision: 1 } });
  assert.equal(store.status.todos?.length, 1);
  advance(3_999);
  assert.equal(store.status.todos?.length, 1);
  advance(1);
  assert.equal(store.status.todos, null);
  assert.equal(store.status.retainedTodos.length, 1);
});

test('a terminal tool completion and a process announcement both re-read the registry', async () => {
  const { sync, calls, store } = setup({ 'process.list': () => ({ processes: [{ session_id: 'p', command: 'make', status: 'running' }] }) });
  sync.observe('s', { type: 'tool.complete', payload: { name: 'terminal' } });
  await settle();
  assert.equal(calls.filter((c) => c.method === 'process.list').length, 1);
  assert.deepEqual(store.status.background.map((b) => b.title), ['make']);
  sync.observe('s', { type: 'status.update', payload: { kind: 'process' } });
  sync.observe('s', { type: 'tool.complete', payload: { name: 'read_file' } });
  await settle();
  assert.equal(calls.filter((c) => c.method === 'process.list').length, 2);
});

test('a gateway without session controls falls back to the goal command', async () => {
  const { sync, store, calls } = setup({ 'slash.exec': () => ({ output: '⊙ Goal set: Fallback' }) });
  await sync.refreshControl('s');
  assert.equal(store.status.control.capability, 'unsupported');
  assert.equal(store.status.goal?.title, 'Fallback');
  assert.equal(calls.at(-1)?.params.command, 'goal status');
  await sync.refreshControl('s');
  assert.equal(calls.length, 2, 'unsupported is remembered, not retried');
});

test('a gateway with session controls shows its goal and never asks the goal command', async () => {
  const goal = { title: 'Ship', status: 'active', turns_used: 1, max_turns: 3, contract: {}, subgoals: [], gates: [] };
  const { sync, store, calls } = setup({ 'session.control.read': () => ({ control: { goal, loop: null, heartbeat: null, revision: 'r', updated_at: 1 } }) });
  await sync.refreshControl('s');
  assert.equal(store.status.control.goal?.title, 'Ship');
  assert.equal(calls.some((c) => c.method === 'slash.exec'), false);
});

test('stopping a process drops its row only after the kill is confirmed', async () => {
  let fail = true;
  const { sync, store, notices, calls } = setup({
    'process.list': () => ({ processes: [{ session_id: 'p', command: 'serve', status: 'running' }] }),
    'process.kill': () => {
      if (fail) throw new Error('refused');
      return { status: 'killed' };
    },
  });
  await sync.refreshProcesses('s');
  await sync.stopProcess('s', 'p');
  assert.equal(store.status.background.length, 1);
  assert.match(notices[0], /Could not stop the process/);
  fail = false;
  await sync.stopProcess('s', 'p');
  assert.equal(store.status.background.length, 0);
  assert.deepEqual(calls.at(-1)?.params, { session_id: 'rt-1', profile: 'default', process_id: 'p' });
});

test('resetting the background kills what still runs and drops every row for good', async () => {
  const { sync, store, calls } = setup({
    'process.list': () => ({
      processes: [
        { session_id: 'a', command: 'serve', status: 'running' },
        { session_id: 'b', command: 'make', status: 'exited', exit_code: 0 },
      ],
    }),
    'process.kill': () => ({ status: 'killed' }),
  });
  await sync.refreshProcesses('s');
  sync.resetBackground('s');
  await settle();
  assert.deepEqual(store.status.background, []);
  assert.deepEqual(calls.filter((c) => c.method === 'process.kill').map((c) => c.params.process_id), ['a']);
  await sync.refreshProcesses('s');
  assert.deepEqual(store.status.background, [], 'a registry that still lists them does not resurrect the rows');
});

test('subagent steering and stopping answer with the desktop copy', async () => {
  const { sync } = setup({ 'subagent.steer': () => ({ status: 'queued' }), 'subagent.interrupt': () => ({ found: false }) });
  assert.equal(await sync.steerSubagent('s', 'sa', ' go left '), 'Queued for the next checkpoint');
  assert.equal(await sync.interruptSubagent('s', 'sa'), 'The subagent did not accept the request');
});

test('a resume hydrates the todo snapshot before the gateway reads land', async () => {
  const { sync, store } = setup({ 'process.list': () => ({ processes: [] }), 'subagent.list': () => ({ subagents: [] }), 'session.control.read': () => ({ control: null }) });
  sync.hydrate('s', { running: true, todo_state: { todos: [{ id: 'a', content: 'Plan', status: 'pending' }], revision: 1 } });
  assert.equal(store.status.todos?.length, 1);
  await settle();
});

test('only the queue and the folded choice are persisted, and restoring never overwrites newer prompts', () => {
  const stack = { ...emptyStack(), hidden: true, queue: { ...queueFrom([{ id: 'q', text: 'kept', queuedAt: 1 }]), parked: true } };
  assert.deepEqual(persistedStack(stack), { queue: [{ id: 'q', text: 'kept', queuedAt: 1 }], hidden: true });

  const restored = restoreStack(emptyStack(), persistedStack(stack));
  assert.equal(restored.hidden, true);
  assert.equal(restored.queue.parked, false);
  assert.deepEqual(restored.queue.entries.map((e) => e.text), ['kept']);

  const newer = { ...emptyStack(), queue: queueFrom([{ id: 'n', text: 'newer', queuedAt: 2 }]) };
  assert.deepEqual(restoreStack(newer, persistedStack(stack)).queue.entries.map((e) => e.text), ['newer']);
});

test('a forgotten session leaves no retire timer behind', () => {
  const { sync, store, advance } = setup();
  sync.observe('s', { type: 'todo.updated', payload: { todos: [{ id: 'a', content: 'Done', status: 'completed' }], revision: 1 } });
  sync.forget('s');
  advance(60_000);
  assert.equal(store.status.todos?.length, 1, 'nothing ticked the list away');
});
