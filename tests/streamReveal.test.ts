import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alphaAt, createRevealClock, FADE_MS, REVEAL_MAX_MS, REVEAL_TICK_MS, StreamReveal, type RevealHost } from '../src/chat/streamReveal.ts';

const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('a first arrival shows at once and fades in whole', () => {
  const reveal = new StreamReveal();
  reveal.arrive(10, 0);
  assert.equal(reveal.head(0), 10);
  assert.deepEqual(reveal.spans(0, 10, 0), [{ chars: 10, alpha: 0 }]);
  // half way, eased: 1 - 0.5² = 0.75, painted in tenths
  assert.deepEqual(reveal.spans(0, 10, FADE_MS / 2), [{ chars: 10, alpha: 0.8 }]);
  assert.deepEqual(reveal.spans(0, 10, FADE_MS), []);
  assert.equal(reveal.animating(FADE_MS), false);
});

test('the alpha steps match the eased fade at every moment', () => {
  for (let elapsed = 0; elapsed <= FADE_MS; elapsed += 1) {
    const reveal = new StreamReveal();
    reveal.arrive(10, 0);
    const alpha = alphaAt(elapsed);
    assert.deepEqual(reveal.spans(0, 10, elapsed), alpha === 1 ? [] : [{ chars: 10, alpha }], `at ${elapsed} ms`);
  }
});

test('steady arrivals sweep in at the arrival rate, without steps', () => {
  const reveal = new StreamReveal();
  reveal.arrive(10, 0);
  for (let beat = 1; beat <= 6; beat++) {
    const at = beat * 50;
    reveal.arrive(10 + beat * 10, at);
    // the head is exactly where the previous arrival planned it: no jump when text lands
    close(reveal.head(at), 10 + (beat - 1) * 10, `head at arrival ${beat}`);
    for (let into = 0; into <= 50; into += 5) close(reveal.head(at + into), 10 + (beat - 1) * 10 + into / 5, `head ${into} ms into beat ${beat}`);
  }
  // newest characters are still clear (the head is at 65 of 70, and what it passed in the last few ms rounds to clear), those passed earlier are fainter the newer they are
  const spans = reveal.spans(0, 70, 325);
  assert.equal(spans[0].alpha, 0);
  assert.ok(spans[0].chars >= 5 && spans[0].chars < 10);
  assert.ok(spans.every((span, index) => index === 0 || span.alpha > spans[index - 1].alpha), 'older text is more solid');
});

test('text arriving early speeds the head up; a stall leaves it waiting at the known end', () => {
  const reveal = new StreamReveal();
  reveal.arrive(10, 0);
  reveal.arrive(20, 50);
  reveal.arrive(30, 75);
  const at75 = reveal.head(75);
  close(at75, 15, 'head when the early text lands');
  // it now covers 15 characters in the time it planned for 10
  assert.ok(reveal.head(100) - at75 > 5, 'faster than the steady 0.2/ms');
  assert.ok(reveal.head(75 + REVEAL_MAX_MS) === 30);
  assert.equal(reveal.head(5_000), 30, 'never past the known end');
  assert.deepEqual(reveal.spans(0, 30, 5_000), []);
});

test('the head reaches every arrival within REVEAL_MAX_MS and never moves back', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const reveal = new StreamReveal();
  let now = 0;
  let length = 0;
  let last = 0;
  for (let index = 0; index < 400; index++) {
    // beats from 50 ms to 250 ms, an occasional long stall, chunks of 1 to 60 characters
    now += random() < 0.05 ? 1_500 : 50 + random() * 200;
    length += 1 + Math.floor(random() * 60);
    reveal.arrive(length, now);
    assert.equal(reveal.head(now + REVEAL_MAX_MS), length, `arrival ${index} is shown within the bound`);
    const head = reveal.head(now);
    assert.ok(head >= last - 1e-9, `arrival ${index} does not move the head back`);
    last = head;
  }
});

test('settling flushes the head to the end and fades the rest in', () => {
  const reveal = new StreamReveal();
  reveal.arrive(10, 0);
  reveal.arrive(40, 100);
  const head = reveal.head(110);
  assert.ok(head < 40);
  reveal.settle(40, 110);
  assert.equal(reveal.head(110), 40);
  assert.deepEqual(reveal.spans(30, 40, 110), [{ chars: 10, alpha: 0 }]);
  assert.equal(reveal.animating(110 + FADE_MS), false);
});

test('a source that shrank, or text that never streamed, paints solid', () => {
  const rewritten = new StreamReveal();
  rewritten.arrive(10, 0);
  rewritten.arrive(40, 100);
  rewritten.arrive(25, 120);
  assert.deepEqual(rewritten.spans(0, 25, 120), []);
  const settled = new StreamReveal();
  settled.settle(30, 0);
  assert.deepEqual(settled.spans(0, 30, 0), []);
  assert.equal(settled.animating(0), false);
});

test('each block reads its own range of the reply, counted back from its end', () => {
  const reveal = new StreamReveal();
  reveal.arrive(10, 0);
  reveal.arrive(40, 400);
  // part way through the sweep from 10 to 40 the second block (20..40) is partly clear
  const now = 450;
  const head = Math.round(reveal.head(now));
  assert.ok(head > 20 && head < 40, `head ${head}`);
  const whole = reveal.spans(0, 40, now);
  const first = reveal.spans(0, 20, now);
  const second = reveal.spans(20, 40, now);
  assert.ok(second[0].alpha === 0 && second[0].chars >= 40 - head);
  const total = (spans: { chars: number }[]) => spans.reduce((sum, span) => sum + span.chars, 0);
  assert.equal(total(first) + total(second), total(whole));
  // the first block holds the oldest of the sweep: no clear text, nothing newer than the second block's
  assert.ok(first.every((span) => span.alpha > 0));
  assert.ok(first[0].alpha >= second[second.length - 1].alpha);
});

function fakeHost() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const host: RevealHost = {
    now: () => now,
    after: (ms, run) => {
      const key = (id += 1);
      timers.set(key, { at: now + ms, run });
      return () => timers.delete(key);
    },
  };
  return {
    host,
    get timers() {
      return timers.size;
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

test('one timer ticks every subscriber and stops with the last one', () => {
  const fake = fakeHost();
  const clock = createRevealClock(fake.host);
  const heard: string[] = [];
  const offA = clock.subscribe((now) => heard.push(`a@${now}`));
  const offB = clock.subscribe((now) => heard.push(`b@${now}`));
  assert.equal(fake.timers, 1);
  fake.advance(REVEAL_TICK_MS * 2);
  assert.deepEqual(heard, [`a@${REVEAL_TICK_MS}`, `b@${REVEAL_TICK_MS}`, `a@${REVEAL_TICK_MS * 2}`, `b@${REVEAL_TICK_MS * 2}`]);
  offA();
  assert.equal(fake.timers, 1);
  offB();
  assert.equal(fake.timers, 0);
  fake.advance(REVEAL_TICK_MS * 4);
  assert.equal(heard.length, 4);
  const offC = clock.subscribe((now) => heard.push(`c@${now}`));
  fake.advance(REVEAL_TICK_MS);
  assert.equal(heard[heard.length - 1], `c@${REVEAL_TICK_MS * 7}`);
  offC();
});

test('a listener leaving inside a tick stops the timer', () => {
  const fake = fakeHost();
  const clock = createRevealClock(fake.host);
  const off = clock.subscribe(() => off());
  fake.advance(REVEAL_TICK_MS);
  assert.equal(fake.timers, 0);
});

test('no ticks in the background; they resume in the foreground', () => {
  const fake = fakeHost();
  const clock = createRevealClock(fake.host);
  let heard = 0;
  const off = clock.subscribe(() => (heard += 1));
  clock.setForeground(false);
  assert.equal(fake.timers, 0);
  fake.advance(REVEAL_TICK_MS * 4);
  assert.equal(heard, 0);
  clock.setForeground(true);
  fake.advance(REVEAL_TICK_MS);
  assert.equal(heard, 1);
  off();
  assert.equal(fake.timers, 0);
});
