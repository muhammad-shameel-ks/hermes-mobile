import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_AUTO_DRAIN_ATTEMPTS, emptyQueue, type QueueState } from '../src/chat/queue.ts';
import { QueueDriver, type QueueHost } from '../src/chat/queueDrain.ts';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** a session and a clock the test advances by hand */
function setup(options: { busy?: boolean; ready?: boolean; send?: (text: string) => boolean } = {}) {
  const state = { queue: emptyQueue(), busy: options.busy ?? true, ready: options.ready ?? true };
  const log = { sent: [] as string[], steered: [] as string[], interrupts: 0, notices: [] as string[] };
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  let clock = 0;
  let driver!: QueueDriver;
  const host: QueueHost = {
    queue: () => state.queue,
    setQueue: (_key, update) => {
      state.queue = update(state.queue);
    },
    busy: () => state.busy,
    ready: () => state.ready,
    send: async (_key, text) => {
      log.sent.push(text);
      const accepted = options.send ? options.send(text) : true;
      // an accepted prompt starts a turn, as the optimistic bubble does in the controller
      if (accepted) state.busy = true;
      return accepted;
    },
    steer: async (_key, text) => {
      log.steered.push(text);
      return true;
    },
    interrupt: async () => {
      log.interrupts += 1;
    },
    notify: (text) => log.notices.push(text),
    after: (ms, run) => {
      const timer = { at: clock + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    now: () => clock,
  };
  driver = new QueueDriver(host);
  const advance = async (ms: number) => {
    clock += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= clock) {
        timer.live = false;
        timer.run();
      }
    }
    await settle();
  };
  const texts = () => state.queue.entries.map((entry) => entry.text);
  return { driver, state, log, advance, texts };
}

test('queued prompts wait while the turn runs and drain one at a time as it ends', async () => {
  const { driver, state, log, texts } = setup();
  driver.enqueue('s', 'first');
  driver.enqueue('s', 'second');
  await settle();
  assert.deepEqual(log.sent, []);

  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['first']);
  assert.deepEqual(texts(), ['second']);

  // the turn that first started now runs; the second waits for its end
  state.busy = true;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['first']);
  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['first', 'second']);
  assert.deepEqual(texts(), []);
});

test('a parked queue does not drain at turn end and runs again when resumed', async () => {
  const { driver, state, log, texts } = setup();
  driver.enqueue('s', 'held');
  driver.park('s');
  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, []);
  assert.equal(state.queue.parked, true);
  assert.deepEqual(texts(), ['held']);

  driver.resume('s');
  await settle();
  assert.deepEqual(log.sent, ['held']);
  assert.equal(state.queue.parked, false);
});

test('queueing a fresh prompt lifts a park', async () => {
  const { driver, state, log } = setup();
  driver.enqueue('s', 'held');
  driver.park('s');
  state.busy = false;
  driver.enqueue('s', 'fresh');
  await settle();
  assert.equal(log.sent[0], 'held');
});

test('a queue never fires while the gateway is unreachable and drains once it is', async () => {
  const { driver, state, log } = setup({ busy: false, ready: false });
  driver.enqueue('s', 'later');
  await settle();
  assert.deepEqual(log.sent, []);
  state.ready = true;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['later']);
});

test('a refused send retries with backoff, then stops and says so', async () => {
  const { driver, state, log, advance } = setup({ busy: false, send: () => false });
  driver.enqueue('s', 'stubborn');
  await settle();
  assert.equal(log.sent.length, 1);
  assert.equal(state.queue.entries[0].drainFailures, 1);

  await advance(749);
  assert.equal(log.sent.length, 1);
  await advance(1);
  assert.equal(log.sent.length, 2);
  await advance(1500);
  await advance(2250);
  assert.equal(log.sent.length, MAX_AUTO_DRAIN_ATTEMPTS);
  assert.equal(state.queue.entries.length, 1);
  assert.equal(log.notices.length, 1);

  await advance(60_000);
  assert.equal(log.sent.length, MAX_AUTO_DRAIN_ATTEMPTS);
});

test('send-now mid-turn promotes the entry, lifts a park and interrupts', async () => {
  const { driver, state, log } = setup();
  driver.enqueue('s', 'one');
  driver.enqueue('s', 'two');
  driver.park('s');
  await driver.sendNow('s', state.queue.entries[1].id);
  assert.equal(log.interrupts, 1);
  assert.equal(state.queue.parked, false);
  assert.deepEqual(state.queue.entries.map((e) => e.text), ['two', 'one']);

  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['two']);
});

test('send-now when idle sends that entry directly, even parked', async () => {
  const { driver, state, log, texts } = setup();
  driver.enqueue('s', 'one');
  driver.park('s');
  state.busy = false;
  const sent = await driver.sendNow('s', state.queue.entries[0].id);
  assert.equal(sent, true);
  assert.deepEqual(log.sent, ['one']);
  assert.deepEqual(texts(), []);
});

test('steer-now consumes an entry only when the redirect is delivered', async () => {
  const { driver, state, log, texts } = setup();
  driver.enqueue('s', 'turn left');
  driver.enqueue('s', '/compact');
  assert.equal(await driver.steerNow('s', state.queue.entries[1].id), false);
  assert.equal(await driver.steerNow('s', state.queue.entries[0].id), true);
  assert.deepEqual(log.steered, ['turn left']);
  assert.deepEqual(texts(), ['/compact']);
});

test('an entry being edited is passed over by the drain, and saving it sends the new text', async () => {
  const { driver, state, log } = setup();
  driver.enqueue('s', 'one');
  driver.enqueue('s', 'two');
  const [first] = state.queue.entries;
  driver.beginEdit('s', first.id);
  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['two']);

  state.busy = true;
  assert.equal(driver.saveEdit('s', first.id, '   '), false);
  assert.equal(driver.saveEdit('s', first.id, 'uno'), true);
  assert.deepEqual(state.queue.entries.map((e) => e.text), ['uno']);
  state.busy = false;
  driver.sweep('s');
  await settle();
  assert.deepEqual(log.sent, ['two', 'uno']);
});

test('a blank prompt is never queued', () => {
  const { driver, state } = setup();
  assert.equal(driver.enqueue('s', '   '), null);
  assert.deepEqual(state.queue satisfies QueueState, emptyQueue());
});
