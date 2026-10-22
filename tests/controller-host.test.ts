import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createControllerHost } from '../src/app/controllerHost.ts';

type Stack = { name: string; idled: number; disposed: boolean; reauth: (reason: string) => void };

function rig() {
  const timers = new Map<number, () => void>();
  let next = 0;
  const host = createControllerHost<Stack>({
    idle: (stack) => void (stack.idled += 1),
    dispose: (stack) => void (stack.disposed = true),
    graceMs: 60_000,
    setTimer: (run) => {
      timers.set(++next, run);
      return next;
    },
    clearTimer: (timer) => void timers.delete(timer as number),
  });
  const build = (name: string) => (reauth: (reason: string) => void): Stack => ({ name, idled: 0, disposed: false, reauth });
  const elapse = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const run of due) run();
  };
  return { host, build, elapse };
}

test('the card and the app share one stack per connection', () => {
  const { host, build } = rig();
  const app = host.get('home', build('first'));
  const card = host.get('home', build('second'));
  assert.equal(card.value, app.value);
  assert.equal(app.value.name, 'first');
  assert.equal(host.current(), app);
});

test('a stack outlives its last holder by the grace period, then goes', () => {
  const { host, build, elapse } = rig();
  const card = host.get('home', build('card'));
  const release = card.hold(() => {});
  release();
  assert.equal(card.value.idled, 1);
  assert.equal(card.value.disposed, false);
  // the app opened from the card within the grace period picks up the same controller
  const app = host.get('home', build('app'));
  assert.equal(app.value.name, 'card');
  const releaseApp = app.hold(() => {});
  elapse();
  assert.equal(card.value.disposed, false);
  releaseApp();
  elapse();
  assert.equal(card.value.disposed, true);
  assert.equal(host.current(), null);
  assert.equal(host.get('home', build('fresh')).value.name, 'fresh');
});

test('a stack built in a render that never committed expires without being idled', () => {
  const { host, build, elapse } = rig();
  const stack = host.get('home', build('orphan')).value;
  elapse();
  assert.equal(stack.disposed, true);
  assert.equal(stack.idled, 0);
});

test('a release is idempotent and the same handler held twice counts twice', () => {
  const { host, build } = rig();
  const hosted = host.get('home', build('x'));
  const handler = () => {};
  const first = hosted.hold(handler);
  const second = hosted.hold(handler);
  first();
  first();
  assert.equal(hosted.value.idled, 0);
  second();
  assert.equal(hosted.value.idled, 1);
});

test('rejected credentials reach every holder and the stack is never reused', () => {
  const { host, build } = rig();
  const hosted = host.get('home', build('old'));
  const heard: string[] = [];
  const releaseApp = hosted.hold((reason) => heard.push(`app:${reason}`));
  const releaseCard = hosted.hold((reason) => heard.push(`card:${reason}`));
  hosted.value.reauth('expired');
  assert.deepEqual(heard, ['app:expired', 'card:expired']);
  assert.equal(host.current(), null);
  assert.equal(host.get('home', build('new')).value.name, 'new');
  releaseApp();
  assert.equal(hosted.value.disposed, false);
  // a dead stack goes with its last holder, with no grace period
  releaseCard();
  assert.equal(hosted.value.disposed, true);
  assert.equal(hosted.value.idled, 0);
});

test('signing out ends the stack: an unheld one goes at once', () => {
  const { host, build } = rig();
  const hosted = host.get('home', build('x'));
  host.end('other');
  assert.equal(host.current(), hosted);
  host.end('home');
  assert.equal(hosted.value.disposed, true);
  assert.equal(host.current(), null);
});

test('switching connection disposes an idle stack but leaves a held one to its holders', () => {
  const { host, build } = rig();
  const idle = host.get('a', build('a'));
  const b = host.get('b', build('b'));
  assert.equal(idle.value.disposed, true);
  const release = b.hold(() => {});
  const c = host.get('c', build('c'));
  assert.equal(b.value.disposed, false);
  assert.equal(host.current(), c);
  release();
  assert.equal(b.value.idled, 1);
});
