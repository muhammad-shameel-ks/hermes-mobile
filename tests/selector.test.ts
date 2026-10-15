import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemoSelect, shallowEqual, shallowEqualArray } from '../src/chat/selector.ts';

type State = { stream: number; roster: string[]; link: string };

test('the selector runs once per state and its result is cached', () => {
  const select = createMemoSelect<State, string>();
  let calls = 0;
  const pick = (s: State) => {
    calls += 1;
    return s.link;
  };
  const state: State = { stream: 0, roster: [], link: 'open' };
  assert.equal(select(state, pick), 'open');
  assert.equal(select(state, pick), 'open');
  assert.equal(calls, 1);
});

test('an equal selection keeps its identity while the state moves under it', () => {
  const select = createMemoSelect<State, { roster: string[]; link: string }>();
  const pick = (s: State) => ({ roster: s.roster, link: s.link });
  const roster = ['a'];
  const first = select({ stream: 0, roster, link: 'open' }, pick, shallowEqual);
  // 500 streamed tokens: the state is replaced every time, the slice never changes
  let latest = first;
  for (let i = 1; i <= 500; i += 1) latest = select({ stream: i, roster, link: 'open' }, pick, shallowEqual);
  assert.equal(latest, first);
});

test('a changed slice returns the new selection, then holds it', () => {
  const select = createMemoSelect<State, { link: string }>();
  const pick = (s: State) => ({ link: s.link });
  const open = select({ stream: 0, roster: [], link: 'open' }, pick, shallowEqual);
  const waiting = select({ stream: 1, roster: [], link: 'waiting' }, pick, shallowEqual);
  assert.notEqual(waiting, open);
  assert.equal(select({ stream: 2, roster: [], link: 'waiting' }, pick, shallowEqual), waiting);
});

test('the default equality is identity: a fresh object each read is a change', () => {
  const select = createMemoSelect<State, { link: string }>();
  const pick = (s: State) => ({ link: s.link });
  const a = select({ stream: 0, roster: [], link: 'open' }, pick);
  const b = select({ stream: 1, roster: [], link: 'open' }, pick);
  assert.notEqual(a, b);
});

test('a new selector is run against the same state, but an equal result keeps the previous identity', () => {
  const select = createMemoSelect<State, { link: string }>();
  const state: State = { stream: 0, roster: [], link: 'open' };
  const first = select(state, (s) => ({ link: s.link }), shallowEqual);
  let calls = 0;
  const second = select(
    state,
    (s) => {
      calls += 1;
      return { link: s.link };
    },
    shallowEqual,
  );
  assert.equal(calls, 1);
  assert.equal(second, first);
  const third = select(state, (s) => ({ link: `${s.link}!` }), shallowEqual);
  assert.notEqual(third, first);
});

test('a selection that is undefined or null still memoises', () => {
  const select = createMemoSelect<State, string | undefined>();
  const pick = (s: State) => s.roster[0];
  assert.equal(select({ stream: 0, roster: [], link: 'x' }, pick), undefined);
  assert.equal(select({ stream: 1, roster: [], link: 'x' }, pick), undefined);
  assert.equal(select({ stream: 2, roster: ['a'], link: 'x' }, pick), 'a');
});

test('shallowEqual compares own fields by identity', () => {
  const shared = { n: 1 };
  assert.ok(shallowEqual({ a: shared, b: 2 }, { a: shared, b: 2 }));
  assert.ok(!shallowEqual({ a: { n: 1 }, b: 2 }, { a: { n: 1 }, b: 2 }));
  assert.ok(!shallowEqual({ a: 1 }, { a: 1, b: undefined } as never));
  assert.ok(!shallowEqual({ a: 1, b: undefined }, { a: 1, c: undefined } as never));
  assert.ok(shallowEqual(null, null));
  assert.ok(!shallowEqual(null, {} as never));
  assert.ok(shallowEqual({ x: NaN }, { x: NaN }));
});

test('shallowEqualArray compares length and items by identity', () => {
  const item = {};
  assert.ok(shallowEqualArray([item, 1], [item, 1]));
  assert.ok(!shallowEqualArray([item], [item, item]));
  assert.ok(!shallowEqualArray([{}], [{}]));
});
