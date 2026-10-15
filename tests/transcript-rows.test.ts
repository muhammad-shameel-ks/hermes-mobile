import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planBars, stablePlans, type BarPlan } from '../src/chat/actionBar.ts';
import type { Message } from '../src/chat/transcript.ts';
import { firstChanged, replanStart, TranscriptRows } from '../src/chat/transcriptRows.ts';

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  parts: text ? [{ kind: 'text', text }] : [],
  status: 'complete',
  ...extra,
});

/** a seeded generator: the property test must be reproducible */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomThread(next: () => number, length: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < length; i += 1) {
    const roll = next();
    const role: Message['role'] = i === 0 || roll < 0.3 ? 'user' : 'assistant';
    out.push(
      msg(`m${i}`, role, next() < 0.15 ? '' : next() < 0.1 ? '   ' : `text ${i}`, {
        interim: role === 'assistant' && next() < 0.3,
        status: role === 'assistant' && i === length - 1 && next() < 0.5 ? 'streaming' : 'complete',
      }),
    );
  }
  return out;
}

/** a random edit the way the controller makes them: structural sharing, so untouched messages keep identity */
function mutate(next: () => number, messages: Message[]): Message[] {
  const roll = next();
  const copy = [...messages];
  if (roll < 0.4 && copy.length) {
    const at = copy.length - 1;
    copy[at] = { ...copy[at], parts: [{ kind: 'text', text: `${copy[at].parts[0]?.kind === 'text' ? copy[at].parts[0].text : ''}!` }] };
  } else if (roll < 0.65) {
    const role: Message['role'] = next() < 0.4 ? 'user' : 'assistant';
    copy.push(msg(`n${copy.length}-${Math.floor(next() * 1e6)}`, role, 'new', { interim: role === 'assistant' && next() < 0.3 }));
  } else if (roll < 0.75 && copy.length) {
    copy.pop();
  } else if (roll < 0.9 && copy.length) {
    const at = Math.floor(next() * copy.length);
    copy[at] = { ...copy[at], interim: !copy[at].interim };
  } else if (copy.length) {
    const at = Math.floor(next() * copy.length);
    copy[at] = { ...copy[at], parts: [{ kind: 'text', text: copy[at].parts.length ? '' : 'filled' }] };
  }
  return copy;
}

const json = (plan: BarPlan | undefined) => JSON.stringify(plan ?? null);

function assertMatchesFullPlan(rows: TranscriptRows, messages: readonly Message[], running: boolean) {
  const expected = planBars(messages, running);
  messages.forEach((message, index) => {
    const view = rows.get(message.id);
    assert.ok(view, `row ${message.id} exists`);
    assert.equal(view.message, message);
    assert.equal(json(view.bar), json(expected.get(message.id)), `bar of ${message.id}`);
    assert.equal(view.latest, index === messages.length - 1, `latest of ${message.id}`);
  });
}

test('incremental planning matches a full plan after every random edit', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const next = rng(seed);
    const rows = new TranscriptRows();
    let messages = randomThread(next, 1 + Math.floor(next() * 14));
    let running = next() < 0.5;
    rows.sync(messages, running);
    assertMatchesFullPlan(rows, messages, running);
    for (let step = 0; step < 40; step += 1) {
      if (next() < 0.12) running = !running;
      else messages = mutate(next, messages);
      rows.sync(messages, running);
      assertMatchesFullPlan(rows, messages, running);
    }
  }
});

test('rows whose message, bar and latest are unchanged keep their view object', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', 'c'), msg('a2', 'assistant', 'd', { status: 'streaming' })];
  const rows = new TranscriptRows();
  rows.sync(thread, true);
  const before = thread.map((m) => rows.get(m.id));
  const live = { ...thread[3], parts: [{ kind: 'text' as const, text: 'dd' }] };
  rows.sync([...thread.slice(0, 3), live], true);
  assert.equal(rows.get('u1'), before[0]);
  assert.equal(rows.get('a1'), before[1]);
  assert.equal(rows.get('u2'), before[2]);
  assert.notEqual(rows.get('a2'), before[3]);
  assert.equal(rows.get('a2')?.message, live);
});

test('only the rows that moved are notified, and only on flush', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', 'c'), msg('a2', 'assistant', 'd', { status: 'streaming' })];
  const rows = new TranscriptRows();
  const heard: Record<string, number> = {};
  for (const m of thread) rows.subscribe(m.id, () => (heard[m.id] = (heard[m.id] ?? 0) + 1));
  rows.sync(thread, true);
  rows.flush();
  for (const key of Object.keys(heard)) heard[key] = 0;

  let current = thread;
  for (let i = 0; i < 50; i += 1) {
    const live = { ...current[3], parts: [{ kind: 'text' as const, text: `d${i}` }] };
    current = [...current.slice(0, 3), live];
    const told = { ...heard };
    rows.sync(current, true);
    assert.deepEqual(heard, told, 'nothing is told before the commit');
    rows.flush();
  }
  assert.deepEqual(heard, { u1: 0, a1: 0, u2: 0, a2: 50 });
});

test('a new message tells the old tail its latest flag moved', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')];
  const rows = new TranscriptRows();
  const heard: string[] = [];
  for (const id of ['u1', 'a1']) rows.subscribe(id, () => heard.push(id));
  rows.sync(thread, false);
  rows.flush();
  heard.length = 0;
  rows.sync([...thread, msg('u2', 'user', 'again')], false);
  rows.flush();
  assert.deepEqual(heard.sort(), ['a1', 'u1']);
  assert.equal(rows.get('a1')?.latest, false);
  assert.equal(rows.get('u2')?.latest, true);
});

test('the turn starting or ending replans the whole thread', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b', { interim: true }), msg('u2', 'user', 'c')];
  const rows = new TranscriptRows();
  rows.sync(thread, false);
  const idle = json(rows.get('a1')?.bar);
  rows.sync(thread, true);
  assertMatchesFullPlan(rows, thread, true);
  assert.notEqual(json(rows.get('a1')?.bar), idle);
});

test('a removed message drops its row and wakes its listeners', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')];
  const rows = new TranscriptRows();
  let heard = 0;
  rows.subscribe('a1', () => (heard += 1));
  rows.sync(thread, false);
  rows.flush();
  heard = 0;
  rows.sync(thread.slice(0, 1), false);
  rows.flush();
  assert.equal(rows.get('a1'), undefined);
  assert.equal(heard, 1);
});

test('unsubscribing stops notifications', () => {
  const rows = new TranscriptRows();
  let heard = 0;
  const off = rows.subscribe('u1', () => (heard += 1));
  off();
  rows.sync([msg('u1', 'user', 'a')], false);
  rows.flush();
  assert.equal(heard, 0);
});

test('firstChanged and replanStart bound the work', () => {
  const a = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('a2', 'assistant', 'c')];
  assert.equal(firstChanged(a, [...a]), 3);
  assert.equal(firstChanged(a, [...a, msg('a3', 'assistant', 'd')]), 3);
  assert.equal(firstChanged(a, [a[0], { ...a[1] }, a[2]]), 1);
  assert.equal(firstChanged([], a), 0);
  // an edit inside a reply run replans from the run's first reply, and the newest user turn is always in range
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', 'c'), msg('a2', 'assistant', 'd'), msg('a3', 'assistant', 'e')];
  const edited = [...thread.slice(0, 4), { ...thread[4], parts: [] }];
  assert.equal(replanStart(thread, edited), 2);
});

test('a streamed token plans the tail, not the thread', () => {
  // `parts` is read once per message that a pass inspects: untouched history must not be inspected at all
  const reads = new Map<string, number>();
  const watched = (id: string, role: Message['role'], text: string): Message => {
    const parts = [{ kind: 'text' as const, text }];
    return {
      id,
      role,
      status: 'complete',
      get parts() {
        reads.set(id, (reads.get(id) ?? 0) + 1);
        return parts;
      },
    };
  };
  const history: Message[] = [];
  for (let turn = 0; turn < 1000; turn += 1) {
    history.push(watched(`u${turn}`, 'user', 'q'), watched(`a${turn}`, 'assistant', 'r'));
  }
  const live = (text: string): Message => ({ ...watched('live', 'assistant', text), status: 'streaming' });
  const rows = new TranscriptRows();
  rows.sync([...history, watched('uN', 'user', 'go'), live('')], true);
  reads.clear();

  let current: Message[] = [...history, watched('uN', 'user', 'go'), live('')];
  rows.sync(current, true);
  reads.clear();
  for (let i = 0; i < 100; i += 1) {
    current = [...current.slice(0, -1), live('x'.repeat(i))];
    rows.sync(current, true);
  }
  const touchedHistory = history.filter((m) => reads.has(m.id)).length;
  assert.equal(touchedHistory, 0);
});

test('stablePlans-equivalent: an unchanged bar keeps its plan object across tokens', () => {
  const thread = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b', { status: 'streaming' })];
  const rows = new TranscriptRows();
  rows.sync(thread, true);
  const bar = rows.get('a1')?.bar;
  const reference = stablePlans(new Map([['a1', bar as BarPlan]]), planBars(thread, true));
  assert.equal(reference.get('a1'), bar);
  rows.sync([thread[0], { ...thread[1], parts: [{ kind: 'text', text: 'bb' }] }], true);
  assert.equal(rows.get('a1')?.bar, bar);
});
