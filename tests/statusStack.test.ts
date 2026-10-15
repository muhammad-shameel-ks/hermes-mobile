import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyControlSnapshot,
  applyGoalText,
  applyProcessList,
  applySubagentSnapshot,
  applyTodoSnapshot,
  dismissBackground,
  emptyStatus,
  formatElapsed,
  groupLabel,
  groupStatusItems,
  hydrateStatus,
  isStatusEvent,
  liveSubagents,
  nextTodosFromToolEvent,
  parseTodos,
  reduceStatus,
  retainedTodoItems,
  statusItems,
  statusNextExpiry,
  tickStatus,
  todoTree,
  type StatusEvent,
  type StatusState,
} from '../src/chat/statusStack.ts';

const play = (events: StatusEvent[], start: StatusState = emptyStatus(), now = 1_000) => events.reduce((state, event) => reduceStatus(state, event, now), start);

const todo = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, content: `task ${id}`, status, ...extra });
const todoUpdated = (todos: unknown[], revision?: number): StatusEvent => ({ type: 'todo.updated', payload: { todos, revision } });

// ─── todos ───────────────────────────────────────────────────────────────────

test('todos parse from a list, a JSON string or a wrapped object, and drop malformed rows', () => {
  const list = [todo('a', 'pending'), { id: 'b', content: '', status: 'pending' }, { id: 'c', content: 'x', status: 'later' }];
  assert.deepEqual(parseTodos(list)?.map((t) => t.id), ['a']);
  assert.deepEqual(parseTodos(JSON.stringify({ todos: list }))?.map((t) => t.id), ['a']);
  assert.equal(parseTodos('not json'), null);
  assert.equal(parseTodos({ nothing: true }), null);
});

test('the todo tree nests subtasks under their parent and degrades dangling or cyclic parents', () => {
  const tree = todoTree(parseTodos([todo('a', 'pending'), todo('b', 'pending', { parent: 'a' }), todo('c', 'pending', { parent: 'ghost' }), todo('x', 'pending', { parent: 'y' }), todo('y', 'pending', { parent: 'x' })])!);
  assert.deepEqual(
    tree.map(([t, depth]) => `${t.id}:${depth}`),
    ['a:0', 'b:1', 'c:0', 'x:0', 'y:0'],
  );
});

test('a merge write patches by id and appends new items; a full result replaces', () => {
  const current = parseTodos([todo('a', 'pending'), todo('b', 'pending')])!;
  const merged = nextTodosFromToolEvent(current, { name: 'todo_list', args: { merge: true, todos: [{ id: 'a', status: 'completed' }, { id: 'c', status: 'pending', content: 'new' }] } })!;
  assert.deepEqual(merged.map((t) => `${t.id}:${t.status}`), ['a:completed', 'b:pending', 'c:pending']);
  const replaced = nextTodosFromToolEvent(current, { name: 'todo_list', result: JSON.stringify({ todos: [todo('z', 'in_progress')] }) })!;
  assert.deepEqual(replaced.map((t) => t.id), ['z']);
});

test('tool events for the todo tool feed the live list, including anonymous frames carrying todos', () => {
  const state = play([
    { type: 'tool.start', payload: { name: 'todo_list', args: { todos: [todo('a', 'in_progress'), todo('b', 'pending')] } } },
    { type: 'tool.start', payload: { name: 'terminal', args: { command: 'ls' } } },
  ]);
  assert.deepEqual(state.todos?.map((t) => t.id), ['a', 'b']);
  const anonymous = play([{ type: 'tool.complete', payload: { todos: [todo('q', 'pending')], revision: 3 } }]);
  assert.deepEqual(anonymous.todos?.map((t) => t.id), ['q']);
  assert.equal(anonymous.todoRevision, 3);
});

test('an older revision cannot overwrite a newer one, but an unversioned start can still land', () => {
  let state = play([todoUpdated([todo('a', 'in_progress')], 5)]);
  state = play([todoUpdated([todo('old', 'pending')], 4)], state);
  assert.deepEqual(state.todos?.map((t) => t.id), ['a']);
  state = play([{ type: 'tool.start', payload: { name: 'todo_list', args: { todos: [todo('opt', 'in_progress')] } } }], state);
  assert.deepEqual(state.todos?.map((t) => t.id), ['opt']);
  // optimistic starts do not touch the watermark or the retained snapshot
  assert.equal(state.todoRevision, 5);
  assert.deepEqual(state.retainedTodos.map((t) => t.id), ['a']);
});

test('a finished list lingers four seconds, then drops out and stays reviewable as retained', () => {
  let state = play([todoUpdated([todo('a', 'completed'), todo('b', 'cancelled')], 1)], emptyStatus(), 10_000);
  assert.equal(state.todosDropAt, 14_000);
  assert.equal(statusNextExpiry(state), 14_000);
  assert.equal(tickStatus(state, 13_999).todos?.length, 2);
  state = tickStatus(state, 14_000);
  assert.equal(state.todos, null);
  assert.equal(statusNextExpiry(state), null);
  assert.equal(retainedTodoItems(state, true).length, 0);
  assert.deepEqual(retainedTodoItems(state, false).map((i) => i.title), ['task a', 'task b']);
});

test('a turn that ends with an unfinished list drops it; a finished list keeps its linger', () => {
  const active = play([todoUpdated([todo('a', 'in_progress')], 1), { type: 'message.complete', payload: {} }]);
  assert.equal(active.todos, null);
  assert.equal(active.retainedTodos.length, 1);
  const finished = play([todoUpdated([todo('a', 'completed')], 1), { type: 'message.complete', payload: {} }]);
  assert.equal(finished.todos?.length, 1);
  assert.equal(play([todoUpdated([todo('a', 'pending')], 1), { type: 'error', payload: {} }]).todos, null);
});

test('resume snapshots keep the stale-active guard and an empty store is not a snapshot', () => {
  const stale = { todos: [todo('a', 'in_progress')], revision: 2 };
  const idle = applyTodoSnapshot(emptyStatus(), stale, false, 0);
  assert.equal(idle.todos, null);
  assert.equal(idle.retainedTodos.length, 1);
  assert.equal(applyTodoSnapshot(emptyStatus(), stale, true, 0).todos?.length, 1);
  assert.deepEqual(applyTodoSnapshot(emptyStatus(), { todos: [], revision: 0 }, true, 0), emptyStatus());
  assert.equal(hydrateStatus(emptyStatus(), { running: true, todo_state: stale }, 0).todos?.length, 1);
  assert.equal(hydrateStatus(emptyStatus(), {}, 0).todos, null);
});

test('retained todos hide while the turn is busy or a live list is up', () => {
  const state = play([todoUpdated([todo('a', 'completed')], 1)]);
  assert.equal(retainedTodoItems(state, false).length, 0);
  assert.equal(retainedTodoItems({ ...state, todos: null }, true).length, 0);
});

// ─── subagents ───────────────────────────────────────────────────────────────

const sub = (type: string, extra: Record<string, unknown> = {}): StatusEvent => ({ type, payload: { subagent_id: 'sa-1', goal: 'Research', task_count: 1, task_index: 0, ...extra } });

test('a subagent runs from spawn to completion and its row follows the stream', () => {
  let state = play([sub('subagent.spawn_requested'), sub('subagent.start'), sub('subagent.tool', { tool_name: 'web_search', tool_preview: 'cats' })]);
  const [row] = liveSubagents(state);
  assert.equal(row.goal, 'Research');
  assert.equal(row.currentTool, 'web_search');
  assert.equal(row.activity, 'Web Search("cats")');
  assert.equal(statusItems(state).filter((i) => i.type === 'subagent').length, 1);

  state = play([sub('subagent.complete', { status: 'completed', summary: 'Found it.' })], state);
  assert.equal(liveSubagents(state).length, 0);
  assert.equal(state.subagents[0].currentTool, undefined);
  assert.equal(state.subagents[0].activity, 'Found it.');
});

test('progress for an unknown subagent does not create a row', () => {
  assert.equal(play([sub('subagent.progress', { text: 'working' })]).subagents.length, 0);
});

test('an unrecognised completion status reads as a failure rather than a row left spinning', () => {
  const state = play([sub('subagent.start'), sub('subagent.complete', { status: 'running' })]);
  assert.equal(state.subagents[0].status, 'failed');
  assert.equal(play([sub('subagent.start'), sub('subagent.complete', { status: 'timeout' })]).subagents[0].summary, 'Timed out after ?s');
});

test('a finished subagent is retired: late frames cannot bring it back', () => {
  let state = play([sub('subagent.start'), sub('subagent.complete', { status: 'completed' })]);
  state = play([{ type: 'message.start', payload: {} }], state);
  assert.equal(state.subagents.length, 0);
  state = play([sub('subagent.start'), sub('subagent.progress', { text: 'late' })], state);
  assert.equal(state.subagents.length, 0);
});

test('a new turn flushes finished rows and keeps the ones still running', () => {
  const state = play([
    sub('subagent.start', { subagent_id: 'old' }),
    sub('subagent.complete', { subagent_id: 'old', status: 'completed' }),
    sub('subagent.start', { subagent_id: 'live' }),
    { type: 'message.start', payload: {} },
  ]);
  assert.deepEqual(state.subagents.map((s) => s.id), ['live']);
});

test('delegate_task stands in for a gateway with no subagent frames, until a native frame arrives', () => {
  let state = play([{ type: 'tool.start', payload: { name: 'delegate_task', tool_id: 't1', args: { tasks: [{ goal: 'A' }, { goal: 'B' }] } } }]);
  assert.deepEqual(liveSubagents(state).map((s) => s.goal), ['A', 'B']);
  state = play([{ type: 'tool.complete', payload: { name: 'delegate_task', tool_id: 't1', args: { tasks: [{ goal: 'A' }, { goal: 'B' }] }, result: { summary: 'done' } } }], state);
  assert.equal(liveSubagents(state).length, 0);

  const native = play([{ type: 'tool.start', payload: { name: 'delegate_task', tool_id: 't2', args: { goal: 'P' } } }, sub('subagent.start', { subagent_id: 'real', goal: 'Real' })]);
  assert.deepEqual(liveSubagents(native).map((s) => s.goal), ['Real']);
  assert.equal(native.nativeSubagents, true);
  // a native frame this turn keeps the placeholders away
  assert.equal(play([{ type: 'tool.start', payload: { name: 'delegate_task', tool_id: 't3', args: { goal: 'Q' } } }], native).subagents.length, 1);
});

test('a roster snapshot adds live children, drops ones the roster lost and restores failed delegations', () => {
  let state = play([sub('subagent.start', { subagent_id: 'gone' })]);
  state = applySubagentSnapshot(state, [{ subagent_id: 'kept', goal: 'Kept', status: 'running', started_at: 100, last_tool: 'read_file' }], [{ delegation_id: 'd1', task_index: 0, goal: 'Broken', error: 'boom', status: 'failed' }], 5_000);
  assert.deepEqual(state.subagents.map((s) => `${s.id}:${s.status}`), ['kept:running', 'delegation:d1:0:failed']);
  assert.equal(state.subagents[0].startedAt, 100_000);
  assert.equal(state.subagents[0].activity, 'Read File');
  assert.equal(state.subagents[1].summary, 'boom');
  assert.equal(applySubagentSnapshot(state, [{ subagent_id: 'kept', goal: 'Kept', status: 'running', started_at: 100, last_tool: 'read_file' }], [{ delegation_id: 'd1', task_index: 0, error: 'boom' }], 6_000), state);
});

// ─── background tasks ────────────────────────────────────────────────────────

const proc = (id: string, extra: Record<string, unknown> = {}) => ({ session_id: id, command: `run ${id}\nsecond line`, status: 'running', ...extra });

test('background rows hold their place as status flips, and finished ones arm a self-clear', () => {
  let state = applyProcessList(emptyStatus(), [proc('p1'), proc('p2')], 0);
  assert.deepEqual(state.background.map((b) => `${b.id}:${b.state}`), ['p1:running', 'p2:running']);
  assert.equal(state.background[0].title, 'run p1');

  state = applyProcessList(state, [proc('p2'), proc('p1', { status: 'exited', exit_code: 0 })], 1_000);
  assert.deepEqual(state.background.map((b) => `${b.id}:${b.state}`), ['p1:done', 'p2:running']);
  assert.equal(state.background[0].expireAt, 5_000);
  assert.equal(statusNextExpiry(state), 5_000);

  state = applyProcessList(state, [proc('p2'), proc('p1', { status: 'exited', exit_code: 0 })], 2_000);
  assert.equal(state.background[0].expireAt, 5_000);
  assert.deepEqual(tickStatus(state, 5_000).background.map((b) => b.id), ['p2']);
});

test('a failed task keeps its exit code and lingers longer', () => {
  const state = applyProcessList(emptyStatus(), [proc('p1', { status: 'exited', exit_code: 2 })], 0);
  assert.equal(state.background[0].state, 'failed');
  assert.equal(state.background[0].exitCode, 2);
  assert.equal(state.background[0].expireAt, 12_000);
});

test('a dismissed row stays gone across refreshes until the registry stops reporting it', () => {
  let state = dismissBackground(applyProcessList(emptyStatus(), [proc('p1')], 0), 'p1');
  assert.equal(state.background.length, 0);
  state = applyProcessList(state, [proc('p1')], 1);
  assert.equal(state.background.length, 0);
  state = applyProcessList(state, [], 2);
  assert.deepEqual(state.dismissedBackground, []);
  assert.equal(applyProcessList(state, [proc('p1')], 3).background.length, 1);
});

test('an unchanged registry snapshot leaves the same state object', () => {
  const state = applyProcessList(emptyStatus(), [proc('p1')], 0);
  assert.equal(applyProcessList(state, [proc('p1')], 5), state);
});

test('a process that restarts running clears its linger', () => {
  let state = applyProcessList(emptyStatus(), [proc('p1', { status: 'exited', exit_code: 0 })], 0);
  state = applyProcessList(state, [proc('p1')], 1);
  assert.equal(state.background[0].expireAt, undefined);
});

// ─── goal ────────────────────────────────────────────────────────────────────

test('the goal command text sets, pauses, continues and clears the goal', () => {
  let state = applyGoalText(emptyStatus(), '⊙ Goal set (20 turns): Ship the thing', 0);
  assert.deepEqual([state.goal?.status, state.goal?.title], ['active', 'Ship the thing']);
  state = applyGoalText(state, '↻ Continuing toward goal (turn 3/20)', 0);
  assert.equal(state.goal?.title, 'Ship the thing');
  assert.equal(state.goal?.detail, 'Continuing toward goal (turn 3/20)');
  state = applyGoalText(state, '⏸ Goal paused: Ship the thing', 0);
  assert.equal(state.goal?.status, 'paused');
  assert.equal(applyGoalText(state, '✓ Goal cleared', 0).goal, null);
  assert.equal(applyGoalText(state, 'unrelated chatter', 0), state);
});

test('a done goal lingers eight seconds live and reads as no goal when hydrated', () => {
  const live = applyGoalText(emptyStatus(), '✓ Goal done (5 turns): Ship it', 1_000);
  assert.equal(live.goal?.status, 'done');
  assert.equal(statusNextExpiry(live), 9_000);
  assert.equal(tickStatus(live, 9_000).goal, null);
  assert.equal(applyGoalText(emptyStatus(), '✓ Goal done (5 turns): Ship it', 1_000, { hydrate: true }).goal, null);
});

test('a goal status.update event reaches the stack', () => {
  const state = play([{ type: 'status.update', payload: { kind: 'goal', text: '⊙ Goal set: Win' } }]);
  assert.equal(state.goal?.title, 'Win');
  assert.deepEqual(play([{ type: 'status.update', payload: { kind: 'process', text: 'x' } }]), emptyStatus());
});

const controlGoal = (extra: Record<string, unknown> = {}) => ({ title: 'Refactor', status: 'active', turns_used: 2, max_turns: 10, contract: {}, subgoals: [], gates: [], ...extra });
const snapshot = (goal: unknown) => ({ goal, loop: null, heartbeat: null, revision: 'r', updated_at: 1 });

test('structured controls own the goal once the gateway supports them', () => {
  let state = applyGoalText(emptyStatus(), '⊙ Goal set: Legacy', 0);
  state = applyControlSnapshot(state, snapshot(controlGoal()));
  const [goal] = statusItems(state);
  assert.deepEqual([goal.title, goal.goalStatus, goal.currentTool], ['Refactor', 'active', 'Turn 2/10']);

  assert.equal(statusItems(applyControlSnapshot(state, snapshot(null))).length, 0);
  assert.equal(statusItems(applyControlSnapshot(state, snapshot(controlGoal({ wait_barrier: { type: 'pid', target: 4, reason: 'x' } }))))[0].goalStatus, 'waiting');
  assert.equal(statusItems(applyControlSnapshot(state, snapshot(controlGoal({ status: 'done', turns_used: 1 }))))[0].currentTool, '1 turn');
  assert.equal(statusItems(applyControlSnapshot(state, snapshot(controlGoal({ status: 'paused', paused_reason: 'budget' }))))[0].currentTool, 'budget');
});

test('a malformed control snapshot is ignored', () => {
  const state = applyControlSnapshot(emptyStatus(), { goal: { title: 5 } });
  assert.equal(state.control.capability, 'unknown');
  assert.deepEqual(applyControlSnapshot(emptyStatus(), 'nope'), emptyStatus());
});

test('a control update event replaces the goal row', () => {
  const state = play([{ type: 'session.control.update', payload: { control: snapshot(controlGoal({ title: 'Live' })) } }]);
  assert.equal(statusItems(state)[0].title, 'Live');
});

// ─── groups ──────────────────────────────────────────────────────────────────

test('groups stack goal, todo, subagent and background, labelled as the desktop labels them', () => {
  let state = play([
    todoUpdated([todo('a', 'completed'), todo('b', 'in_progress')], 1),
    { type: 'status.update', payload: { kind: 'goal', text: '⏳ Goal parked: Wait for CI' } },
    sub('subagent.start'),
    sub('subagent.start', { subagent_id: 'sa-2', goal: 'Second' }),
  ]);
  state = applyProcessList(state, [proc('p1')], 0);
  const groups = groupStatusItems(statusItems(state));
  assert.deepEqual(groups.map((g) => g.type), ['goal', 'todo', 'subagent', 'background']);
  assert.deepEqual(groups.map(groupLabel), ['Goal waiting', 'Tasks 1/2', '2 Subagents', '1 Background']);
  assert.equal(groupLabel({ type: 'subagent', items: [groups[2].items[0]] }), '1 Subagent');
});

test('only status events reach the reducer, so a text delta never churns the stack', () => {
  assert.equal(isStatusEvent('message.delta'), false);
  assert.equal(isStatusEvent('reasoning.delta'), false);
  for (const type of ['todo.updated', 'tool.start', 'subagent.tool', 'message.start', 'session.control.update']) assert.equal(isStatusEvent(type), true);
  const state = emptyStatus();
  assert.equal(reduceStatus(state, { type: 'message.delta', payload: { text: 'hi' } }, 0), state);
});

test('elapsed time reads seconds, then minutes and seconds', () => {
  assert.equal(formatElapsed(9), '9s');
  assert.equal(formatElapsed(65), '1:05');
});
