/**
 * The status stack's model: one session's live rows - goal, todo, subagents,
 * background tasks and the retained todo snapshot - advanced by gateway events.
 * Pure functions over plain data, so an event stream replays in tests exactly as
 * the socket delivers it. Ported from the desktop's stores (todos, goals,
 * subagents, composer-status, session-control) and its use-message-stream
 * routing, one state per session instead of one atom per concern.
 *
 * Nothing here reads the clock or sets a timer: every function takes `now`
 * (epoch ms). A finished todo list, a done goal and a finished background task
 * linger and then drop out; they carry an `expireAt` and `tickStatus` drops them,
 * so the caller only needs `statusNextExpiry` to know when to look again.
 */

import { isRecord, parseObject, type Json } from './json.ts';

// ─── todos (desktop lib/todos.ts) ────────────────────────────────────────────

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TodoItem = {
  content: string;
  id: string;
  /** another item's id: this one nests under it */
  parent?: string;
  status: TodoStatus;
};

type TodoPatch = { id: string; status: TodoStatus; content?: string };

type Rec = Json;

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'cancelled'];
const isStatus = (value: unknown): value is TodoStatus => STATUSES.includes(value as string);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** the task tool is `todo_list` on the wire; `todo` survives as the legacy alias */
export const isTodoToolName = (name: unknown) => name === 'todo_list' || name === 'todo';

function parseTodoArray(value: unknown[]): TodoItem[] {
  return value.flatMap((item) => {
    if (!isRecord(item) || !isStatus(item.status)) return [];
    const id = String(item.id ?? '').trim();
    const content = String(item.content ?? '').trim();
    const parent = String(item.parent ?? '').trim();
    return id && content ? [{ content, id, status: item.status, ...(parent && parent !== id ? { parent } : {}) }] : [];
  });
}

function parsePatchArray(value: unknown[]): TodoPatch[] {
  return value.flatMap((item) => {
    if (!isRecord(item) || !isStatus(item.status)) return [];
    const id = String(item.id ?? '').trim();
    if (!id) return [];
    const content = String(item.content ?? '').trim();
    return content ? [{ content, id, status: item.status }] : [{ id, status: item.status }];
  });
}

/** a list, a JSON string of one, or an object carrying `todos` - up to two levels deep */
function unwrap<T>(value: unknown, depth: number, parseArray: (items: unknown[]) => T[]): T[] | null {
  if (depth > 2) return null;
  if (Array.isArray(value)) return parseArray(value);
  if (typeof value === 'string' && value.trim()) {
    try {
      return unwrap(JSON.parse(value), depth + 1, parseArray);
    } catch {
      return null;
    }
  }
  if (isRecord(value) && Object.hasOwn(value, 'todos')) return unwrap(value.todos, depth + 1, parseArray);
  return null;
}

export const parseTodos = (value: unknown) => unwrap(value, 0, parseTodoArray);
const parseTodoPatch = (value: unknown) => unwrap(value, 0, parsePatchArray);

function parseRevision(value: unknown, depth: number): number | null {
  if (depth > 2) return null;
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseRevision(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0) return value.revision;
  return Object.hasOwn(value, 'result') ? parseRevision(value.result, depth + 1) : null;
}

export const parseTodoRevision = (value: unknown) => parseRevision(value, 0);

/** DFS order of a (possibly nested) list: [item, depth] pairs, parents first. Dangling or cyclic parents degrade to depth 0. */
export function todoTree(todos: readonly TodoItem[]): Array<[TodoItem, number]> {
  const ids = new Set(todos.map((todo) => todo.id));
  const kids = new Map<string, TodoItem[]>();
  const roots: TodoItem[] = [];
  for (const todo of todos) {
    if (todo.parent && ids.has(todo.parent) && todo.parent !== todo.id) {
      const list = kids.get(todo.parent) ?? [];
      list.push(todo);
      kids.set(todo.parent, list);
    } else {
      roots.push(todo);
    }
  }
  const out: Array<[TodoItem, number]> = [];
  const seen = new Set<string>();
  const walk = (item: TodoItem, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push([item, depth]);
    for (const kid of kids.get(item.id) ?? []) walk(kid, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // cycle members never reach a root: append them flat so nothing is lost
  for (const todo of todos) {
    if (!seen.has(todo.id)) {
      seen.add(todo.id);
      out.push([todo, 0]);
    }
  }
  return out;
}

/** the same as the tool's `merge: true` write: update by id, append new items */
function mergeTodos(current: readonly TodoItem[], patch: readonly TodoPatch[]): TodoItem[] {
  const next = current.map((item) => ({ ...item }));
  const indexById = new Map(next.map((item, index) => [item.id, index]));
  for (const item of patch) {
    const index = indexById.get(item.id);
    if (index === undefined) {
      next.push({ content: item.content?.trim() || '(no description)', id: item.id, status: item.status });
      indexById.set(item.id, next.length - 1);
      continue;
    }
    if (item.content) next[index].content = item.content;
    next[index].status = item.status;
  }
  return next;
}

/**
 * A live tool event's next list. `todos` / `result` carry the full store, so they
 * replace; `merge: true` args patch by id so a status-only start event does not
 * wipe the rest of the checklist.
 */
export function nextTodosFromToolEvent(current: readonly TodoItem[], payload: Rec): TodoItem[] | null {
  const fromResult = parseTodos(payload.todos) ?? parseTodos(payload.result);
  if (fromResult) return fromResult;
  const args = payload.args ?? payload.arguments;
  if (isRecord(args) && args.merge === true) {
    const patch = parseTodoPatch(args);
    return patch && patch.length > 0 ? mergeTodos(current, patch) : null;
  }
  return parseTodos(args);
}

export const todoListActive = (todos: readonly TodoItem[]) => todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress');

/** once a list finishes, its last checkmark lingers this long, then the group drops out */
const TODO_FINISHED_LINGER_MS = 4_000;
const GOAL_DONE_LINGER_MS = 8_000;
const BACKGROUND_SUCCESS_LINGER_MS = 4_000;
const BACKGROUND_FAILURE_LINGER_MS = 12_000;
const MAX_RETIRED = 256;

// ─── goal (desktop store/goals.ts, store/session-control.ts) ────────────────

export type GoalStatus = 'active' | 'done' | 'paused' | 'waiting';

export type Goal = { title: string; status: GoalStatus; detail?: string; expireAt?: number };

/** the gateway's structured goal, reduced to what a row shows */
export type ControlGoal = { title: string; status: 'active' | 'done' | 'paused'; turnsUsed: number; maxTurns: number; waiting: boolean; pausedReason?: string };

export type StatusControl = { capability: 'unknown' | 'supported' | 'unsupported'; goal: ControlGoal | null };

const clean = (value: string) => value.replace(/\r/g, '').trim();
const firstLine = (value: string) => clean(value).split('\n')[0]?.trim() ?? '';
const titleFromLine = (line: string, pattern: RegExp) => (line.match(pattern)?.[1] ?? '').trim();

/** the goal command's own status text: a goal, `null` for none, `undefined` for text that says nothing */
function goalFromText(text: string, previous: Goal | null, now: number): Goal | null | undefined {
  const line = firstLine(text);
  if (!line) return undefined;
  if (/^No active goal\b/i.test(line) || /^No goal (?:set|to resume)\b/i.test(line) || /^✓ Goal cleared\b/i.test(line)) return null;

  const set = titleFromLine(line, /^⊙ Goal set(?:\s*\([^)]*\))?:\s*(.+)$/) || titleFromLine(line, /^⊙ Goal\s*\([^)]*active[^)]*\):\s*(.+)$/) || titleFromLine(line, /^▶ Goal resumed:\s*(.+)$/);
  if (set) return { status: 'active', title: set };
  const waiting = titleFromLine(line, /^⏳ Goal\s*\([^)]*(?:parked|active)[^)]*\):\s*(.+)$/);
  if (waiting) return { status: 'waiting', title: waiting };
  const paused = titleFromLine(line, /^⏸ Goal(?:\s*\([^)]*\)| paused)?:\s*(.+)$/);
  if (paused) return { status: 'paused', title: paused };
  const done = titleFromLine(line, /^✓ Goal done\s*\([^)]*\):\s*(.+)$/);
  if (done) return { status: 'done', title: done, expireAt: now + GOAL_DONE_LINGER_MS };

  const standing = previous?.title || 'Standing goal';
  if (/^↻ Continuing toward goal\b/i.test(line)) return { detail: line.replace(/^↻\s*/, ''), status: 'active', title: standing };
  if (/^⏳ Goal parked\b/i.test(line)) return { detail: line.replace(/^⏳\s*/, ''), status: 'waiting', title: standing };
  if (/^⏸ Goal paused\b/i.test(line)) return { detail: line.replace(/^⏸\s*/, ''), status: 'paused', title: standing };
  if (/^✓ Goal achieved\b/i.test(line)) return { detail: line.replace(/^✓\s*/, ''), status: 'done', title: standing, expireAt: now + GOAL_DONE_LINGER_MS };
  return undefined;
}

/**
 * Apply the goal command's output. A done goal is terminal state in the backend,
 * so hydrating one on open reads as no goal: only the live completion lingers.
 */
export function applyGoalText(state: StatusState, text: string, now: number, { hydrate = false } = {}): StatusState {
  const next = goalFromText(text, state.goal, now);
  if (next === null) return state.goal ? { ...state, goal: null } : state;
  if (!next) return state;
  if (hydrate && next.status === 'done') return state.goal ? { ...state, goal: null } : state;
  return { ...state, goal: next };
}

function controlGoalFrom(value: unknown): ControlGoal | null {
  if (!isRecord(value) || typeof value.title !== 'string') return null;
  const status = value.status === 'done' || value.status === 'paused' ? value.status : value.status === 'active' ? 'active' : null;
  if (!status) return null;
  return {
    title: value.title,
    status,
    turnsUsed: num(value.turns_used) ?? 0,
    maxTurns: num(value.max_turns) ?? 0,
    waiting: isRecord(value.wait_barrier),
    ...(typeof value.paused_reason === 'string' && value.paused_reason ? { pausedReason: value.paused_reason } : {}),
  };
}

/** a `session.control` snapshot: the gateway supports structured controls, and the goal follows it */
export function applyControlSnapshot(state: StatusState, snapshot: unknown): StatusState {
  if (!isRecord(snapshot) || !('goal' in snapshot)) return state;
  const goal = snapshot.goal === null ? null : controlGoalFrom(snapshot.goal);
  if (snapshot.goal !== null && !goal) return state;
  return { ...state, control: { capability: 'supported', goal } };
}

export const markControlUnsupported = (state: StatusState): StatusState =>
  state.control.capability === 'unsupported' ? state : { ...state, control: { capability: 'unsupported', goal: null } };

// ─── subagents (desktop store/subagents.ts) ─────────────────────────────────

export type SubagentStatus = 'completed' | 'failed' | 'interrupted' | 'queued' | 'running';

export type Subagent = {
  id: string;
  parentId: string | null;
  goal: string;
  /** the child's own stored session id */
  sessionId?: string;
  delegationId?: string;
  status: SubagentStatus;
  taskIndex: number;
  startedAt: number;
  updatedAt: number;
  durationSeconds?: number;
  /** the active tool while running, cleared on a terminal status */
  currentTool?: string;
  /** the latest line of its stream: a tool call, progress, thinking or its summary */
  activity: string;
  summary?: string;
};

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(['completed', 'failed', 'interrupted']);
const PREVIEW_MAX = 220;
const TOOL_PREVIEW_MAX = 96;

export const SUBAGENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.thinking',
  'subagent.tool',
  'subagent.progress',
  'subagent.complete',
]);

const capitalize = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
export const toolLabel = (name: string) => name.split('_').filter(Boolean).map(capitalize).join(' ') || name;

const strList = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function asStatus(value: unknown, terminalEvent = false): SubagentStatus {
  if (value === 'completed' || value === 'failed' || value === 'interrupted') return value;
  if (value === 'timeout' || value === 'error') return 'failed';
  if (value === 'cancelled' || value === 'canceled') return 'interrupted';
  // a subagent.complete event is terminal by definition: an unrecognised or still-active status is a failure, not a row left spinning
  if (terminalEvent) return 'failed';
  return value === 'queued' ? 'queued' : 'running';
}

const compact = (text: string, max = PREVIEW_MAX) => {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const formatTool = (name: string, preview = '') => {
  const snippet = compact(preview, TOOL_PREVIEW_MAX);
  return snippet ? `${toolLabel(name)}("${snippet}")` : toolLabel(name);
};

const idOf = (payload: Rec) => str(payload.subagent_id) || `${str(payload.parent_id) || 'root'}:${num(payload.task_index) ?? 0}:${str(payload.goal)}`;

// the backend sends no summary on a hard child timeout, only a preview and a duration
const timeoutSummary = (payload: Rec) => (str(payload.status) === 'timeout' ? `Timed out after ${num(payload.duration_seconds) ?? '?'}s` : '');

/** the stream lines one event adds, in order; the newest is what the row shows */
function streamLines(payload: Rec, status: SubagentStatus, eventType: string): string[] {
  const out: string[] = [];
  const tool = str(payload.tool_name);
  const preview = str(payload.tool_preview) || str(payload.text);
  const text = compact(str(payload.text) || preview);

  if (Array.isArray(payload.output_tail)) {
    for (const entry of payload.output_tail) {
      if (!isRecord(entry)) continue;
      const line = str(entry.tool) ? formatTool(str(entry.tool), str(entry.preview)) : compact(str(entry.preview));
      if (line) out.push(line);
    }
  }
  if (tool) out.push(formatTool(tool, preview));
  if ((eventType === 'subagent.progress' || eventType === 'subagent.thinking') && text) out.push(text);
  const summary = compact(str(payload.summary) || str(payload.text) || timeoutSummary(payload));
  if (TERMINAL.has(status) && summary) out.push(summary);
  return out;
}

function toSubagent(payload: Rec, prev: Subagent | undefined, eventType: string, now: number): Subagent {
  const status = asStatus(payload.status, eventType === 'subagent.complete');
  const tool = str(payload.tool_name);
  const lines = streamLines(payload, status, eventType);
  return {
    id: prev?.id ?? idOf(payload),
    parentId: str(payload.parent_id) || prev?.parentId || null,
    goal: str(payload.goal) || prev?.goal || 'Subagent',
    sessionId: str(payload.child_session_id) || prev?.sessionId,
    delegationId: str(payload.delegation_id) || prev?.delegationId,
    status,
    taskIndex: num(payload.task_index) ?? prev?.taskIndex ?? 0,
    startedAt: prev?.startedAt ?? now,
    updatedAt: now,
    durationSeconds: num(payload.duration_seconds) ?? prev?.durationSeconds,
    currentTool: TERMINAL.has(status) ? undefined : tool || prev?.currentTool,
    activity: lines.at(-1) ?? prev?.activity ?? '',
    summary: str(payload.summary) || timeoutSummary(payload) || prev?.summary || undefined,
  };
}

/** a turn prunes display rows, not child identities: retired ids stop late starts from recreating finished work */
function commitSubagents(state: StatusState, next: Subagent[]): StatusState {
  const retired = new Set(state.retiredSubagents);
  for (const item of state.subagents) if (TERMINAL.has(item.status)) retired.add(item.id);
  return { ...state, subagents: next, retiredSubagents: [...retired].slice(-MAX_RETIRED) };
}

function upsertSubagent(state: StatusState, payload: Rec, createIfMissing: boolean, eventType: string, now: number): StatusState {
  const id = idOf(payload);
  const index = state.subagents.findIndex((item) => item.id === id);
  if (state.retiredSubagents.includes(id) || (index < 0 && !createIfMissing)) return state;
  const prev = index >= 0 ? state.subagents[index] : undefined;
  if (prev && TERMINAL.has(prev.status)) return state;
  const next = toSubagent(payload, prev, eventType, now);
  return commitSubagents(state, index >= 0 ? state.subagents.map((item) => (item.id === id ? next : item)) : [...state.subagents, next]);
}

const failedDelegationId = (payload: Rec) => `delegation:${str(payload.delegation_id)}:${num(payload.task_index) ?? 0}`;

/**
 * Reconcile a `subagent.list` snapshot: live rows the roster no longer holds go,
 * new ones land, and failed delegations the live roster missed come back as
 * terminal rows unless a turn already retired them.
 */
export function applySubagentSnapshot(state: StatusState, children: Rec[], failedDelegations: Rec[], now: number): StatusState {
  const ids = new Set(children.map((p) => str(p.subagent_id)).filter(Boolean));
  const next = state.subagents.filter((item) => TERMINAL.has(item.status) || ids.has(item.id));

  for (const payload of children) {
    const id = str(payload.subagent_id);
    if (!id || state.retiredSubagents.includes(id)) continue;
    const index = next.findIndex((item) => item.id === id);
    const prev = next[index];
    if (prev && TERMINAL.has(prev.status)) continue;
    const projected = toSubagent(payload, prev, '', now);
    projected.startedAt = (num(payload.started_at) ?? 0) * 1000 || prev?.startedAt || projected.startedAt;
    projected.updatedAt = prev?.updatedAt ?? projected.startedAt;
    // a roster records the last tool, not a running call: seed cold activity only, never over newer live text
    if (!projected.activity && str(payload.last_tool)) projected.activity = formatTool(str(payload.last_tool));
    if (index < 0) next.push(projected);
    else next[index] = JSON.stringify(prev) === JSON.stringify(projected) ? prev : projected;
  }

  for (const payload of failedDelegations) {
    const id = failedDelegationId(payload);
    const delegationId = str(payload.delegation_id);
    const taskIndex = num(payload.task_index) ?? 0;
    if (!delegationId || state.retiredSubagents.includes(id) || next.some((item) => item.id === id || (item.delegationId === delegationId && item.taskIndex === taskIndex))) continue;
    const at = (num(payload.completed_at) ?? 0) * 1000 || now;
    const startedAt = (num(payload.dispatched_at) ?? 0) * 1000 || at;
    next.push({
      ...toSubagent({ ...payload, subagent_id: id, summary: str(payload.error) }, undefined, 'subagent.complete', now),
      durationSeconds: Math.max(0, Math.round((at - startedAt) / 1000)),
      id,
      startedAt,
      updatedAt: at,
    });
  }

  if (next.length === state.subagents.length && next.every((item, index) => item === state.subagents[index])) return state;
  return commitSubagents(state, next);
}

/** a new turn flushes the previous turn's finished rows; subagents that outlived it stay */
function pruneFinishedSubagents(state: StatusState): StatusState {
  const next = state.subagents.filter((item) => item.status === 'running' || item.status === 'queued');
  return next.length === state.subagents.length ? state : commitSubagents(state, next);
}

const pruneDelegateFallbacks = (state: StatusState): StatusState => {
  const next = state.subagents.filter((item) => !item.id.startsWith('delegate-tool:'));
  return next.length === state.subagents.length ? state : commitSubagents(state, next);
};

const firstString = (...candidates: unknown[]) => candidates.find((v): v is string => typeof v === 'string' && v !== '') ?? '';

/**
 * Older gateways emit no `subagent.*` frames: a `delegate_task` tool call stands in,
 * one placeholder per task, until the first native frame retires them.
 */
export function delegateTaskPayloads(payload: Rec, phase: 'running' | 'complete', sourceEventType: string): Rec[] {
  if (payload.name !== 'delegate_task') return [];
  const args = parseObject(payload.args ?? payload.input);
  const result = parseObject(payload.result);
  const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
  const tasks = rawTasks.length ? rawTasks.map(parseObject) : [args];
  const resultStatus = typeof result.status === 'string' ? result.status.toLowerCase() : '';
  const failed = Boolean(payload.error) || ['timeout', 'error', 'failed', 'failure'].includes(resultStatus);
  const status = phase === 'complete' ? (failed ? 'failed' : 'completed') : 'running';
  const toolId = payload.tool_id || payload.tool_call_id || payload.id || 'delegate_task';
  const progressText = firstString(payload.preview, payload.message, payload.context);
  const eventType = phase === 'complete' ? 'subagent.complete' : sourceEventType === 'tool.start' ? 'subagent.start' : 'subagent.progress';

  return tasks.map((task, index) => {
    const goal = firstString(task.goal, args.goal, payload.context) || 'Delegated task';
    const summary = firstString(result.summary, payload.summary, payload.message);
    return {
      goal,
      status,
      subagent_id: `delegate-tool:${String(toolId)}:${index}`,
      summary: summary || undefined,
      task_count: tasks.length,
      task_index: index,
      text: eventType === 'subagent.progress' ? progressText || goal : undefined,
      tool_name: eventType === 'subagent.start' ? 'delegate_task' : undefined,
      tool_preview: eventType === 'subagent.start' ? progressText : undefined,
      event_type: eventType,
      duration_seconds: payload.duration_s,
      output_tail: phase === 'complete' && summary ? [{ is_error: Boolean(payload.error), preview: summary, tool: 'delegate_task' }] : undefined,
    };
  });
}

// ─── background tasks (desktop store/composer-status.ts) ────────────────────

export type BackgroundItem = {
  id: string;
  title: string;
  state: 'done' | 'failed' | 'running';
  exitCode?: number;
  output?: string;
  expireAt?: number;
};

/** one `process.list` row */
export type ProcessEntry = { session_id?: string; command?: string; exit_code?: number | null; output_tail?: string | null; status?: string };

function toBackgroundItem(proc: ProcessEntry): BackgroundItem {
  const exited = proc.status === 'exited';
  const exitCode = typeof proc.exit_code === 'number' ? proc.exit_code : undefined;
  return {
    exitCode,
    id: proc.session_id ?? '',
    output: proc.output_tail || undefined,
    state: exited ? (exitCode ? 'failed' : 'done') : 'running',
    title: (proc.command ?? '').split('\n')[0]!.trim() || 'background process',
  };
}

const sameBackground = (a: BackgroundItem, b: BackgroundItem) => a.state === b.state && a.title === b.title && a.output === b.output && a.exitCode === b.exitCode;

/**
 * A layout-stable sync of the process registry: existing rows keep their place
 * (status flips in place, never reorders), new processes append, dismissed ids
 * stay gone, and finished rows arm their self-clear - failures linger longer.
 */
export function applyProcessList(state: StatusState, procs: readonly ProcessEntry[], now: number): StatusState {
  const dismissed = new Set(state.dismissedBackground);
  const fresh = new Map(procs.filter((proc) => proc.session_id && !dismissed.has(proc.session_id)).map((proc) => [proc.session_id!, toBackgroundItem(proc)]));

  const kept = state.background.flatMap((old) => {
    const next = fresh.get(old.id);
    fresh.delete(old.id);
    return next ? [sameBackground(old, next) ? old : next] : [];
  });

  const merged = [...kept, ...fresh.values()].map((item) => {
    if (item.state === 'running') return item.expireAt === undefined ? item : { ...item, expireAt: undefined };
    if (item.expireAt !== undefined) return item;
    return { ...item, expireAt: now + (item.state === 'failed' ? BACKGROUND_FAILURE_LINGER_MS : BACKGROUND_SUCCESS_LINGER_MS) };
  });

  // a dismissal only needs remembering while the registry still reports the id
  const reported = new Set(procs.map((proc) => proc.session_id));
  const remembered = state.dismissedBackground.filter((id) => reported.has(id));

  const unchanged = merged.length === state.background.length && merged.every((item, index) => item === state.background[index]);
  if (unchanged && remembered.length === state.dismissedBackground.length) return state;
  return { ...state, background: merged, dismissedBackground: remembered };
}

/** the X on a finished row (or a confirmed kill): drop it now and keep it dropped across refreshes */
export function dismissBackground(state: StatusState, id: string): StatusState {
  return {
    ...state,
    background: state.background.filter((item) => item.id !== id),
    dismissedBackground: state.dismissedBackground.includes(id) ? state.dismissedBackground : [...state.dismissedBackground, id],
  };
}

/**
 * Rewind cleanup (desktop `resetSessionBackground`): the turns that spawned these
 * processes were discarded, so every row goes and every id is remembered as
 * dismissed, which keeps an in-flight `process.list` from resurrecting a process
 * whose kill is still on its way.
 */
export function resetBackground(state: StatusState): StatusState {
  if (state.background.length === 0) return state;
  const dismissed = new Set(state.dismissedBackground);
  for (const item of state.background) dismissed.add(item.id);
  return { ...state, background: [], dismissedBackground: [...dismissed] };
}

// ─── the state ──────────────────────────────────────────────────────────────

export type StatusState = {
  /** the live list the stack shows; `null` once it retires */
  todos: TodoItem[] | null;
  todosDropAt: number | null;
  /** the highest revision accepted, so a late older snapshot cannot win */
  todoRevision: number | null;
  /** the last authoritative snapshot, reviewable after the live list retires */
  retainedTodos: TodoItem[];
  goal: Goal | null;
  control: StatusControl;
  subagents: Subagent[];
  retiredSubagents: string[];
  /** a native `subagent.*` frame has arrived this turn, so `delegate_task` placeholders stand down */
  nativeSubagents: boolean;
  background: BackgroundItem[];
  dismissedBackground: string[];
};

export const emptyStatus = (): StatusState => ({
  todos: null,
  todosDropAt: null,
  todoRevision: null,
  retainedTodos: [],
  goal: null,
  control: { capability: 'unknown', goal: null },
  subagents: [],
  retiredSubagents: [],
  nativeSubagents: false,
  background: [],
  dismissedBackground: [],
});

function setTodos(state: StatusState, todos: TodoItem[], revision: number | null, now: number): StatusState {
  if (revision !== null && state.todoRevision !== null && revision < state.todoRevision) return state;
  return {
    ...state,
    todoRevision: revision ?? state.todoRevision,
    // an unversioned tool.start is optimistic, not a durable result
    retainedTodos: revision !== null ? todos : state.retainedTodos,
    todos,
    todosDropAt: todoListActive(todos) ? null : now + TODO_FINISHED_LINGER_MS,
  };
}

const dropTodos = (state: StatusState): StatusState => (state.todos === null && state.todosDropAt === null ? state : { ...state, todos: null, todosDropAt: null });

/** a turn that ended without a final `todo` update leaves an unfinished list pinned: drop it, keep a finished one for its linger */
function clearActiveTodos(state: StatusState): StatusState {
  return state.todos && todoListActive(state.todos) ? dropTodos(state) : state;
}

/**
 * A full snapshot from `todo.updated` or a resume. An idle session keeps the
 * stale-active guard - a list still pending at rest was abandoned, so only a
 * finished one is restored - while a running session restores the active plan,
 * because the backend has proved that turn is live.
 */
export function applyTodoSnapshot(state: StatusState, snapshot: unknown, running: boolean, now: number): StatusState {
  const todos = parseTodos(snapshot);
  if (todos === null) return state;
  const revision = parseTodoRevision(snapshot);
  // an unused store serialises as {todos: [], revision: 0}: not a real snapshot
  if (todos.length === 0 && (revision === null || revision === 0)) return state;
  const visible = running || !todoListActive(todos) ? todos : null;
  if (visible !== null) return setTodos(state, visible, revision, now);
  if (revision !== null && state.todoRevision !== null && revision < state.todoRevision) return state;
  return dropTodos({ ...state, todoRevision: revision ?? state.todoRevision, retainedTodos: revision !== null ? todos : state.retainedTodos });
}

// ─── events ─────────────────────────────────────────────────────────────────

export type StatusEvent = { type: string; payload?: unknown };

/** the event types that can change the stack; everything else (every text delta) skips the reducer */
export function isStatusEvent(type: string): boolean {
  return (
    type === 'todo.updated' ||
    type === 'tool.start' ||
    type === 'tool.complete' ||
    type === 'message.start' ||
    type === 'message.complete' ||
    type === 'error' ||
    type === 'status.update' ||
    type === 'session.control.update' ||
    SUBAGENT_EVENT_TYPES.has(type)
  );
}

/** an anonymous tool frame that carries todos but no name still belongs to the todo stream */
const asTodoPayload = (payload: Rec): Rec | null => (isTodoToolName(payload.name) || (!payload.name && Object.hasOwn(payload, 'todos')) ? { ...payload, name: 'todo_list' } : null);

export function reduceStatus(state: StatusState, event: StatusEvent, now: number): StatusState {
  const payload = isRecord(event.payload) ? event.payload : {};

  if (event.type === 'todo.updated') return applyTodoSnapshot(state, payload, true, now);

  if (event.type === 'tool.start' || event.type === 'tool.complete') {
    const phase = event.type === 'tool.start' ? 'running' : 'complete';
    let next = state;
    const todo = asTodoPayload(payload);
    if (todo) {
      const todos = nextTodosFromToolEvent(state.todos ?? [], todo);
      if (todos) next = setTodos(next, todos, parseTodoRevision(todo), now);
    }
    if (!next.nativeSubagents) {
      for (const task of delegateTaskPayloads(payload, phase, event.type)) {
        next = upsertSubagent(next, task, true, phase === 'complete' ? 'delegate.complete' : 'delegate.running', now);
      }
    }
    return next;
  }

  if (SUBAGENT_EVENT_TYPES.has(event.type)) {
    const base = state.nativeSubagents ? state : { ...pruneDelegateFallbacks(state), nativeSubagents: true };
    return upsertSubagent(base, payload, event.type === 'subagent.spawn_requested' || event.type === 'subagent.start', event.type, now);
  }

  if (event.type === 'message.start') return { ...pruneFinishedSubagents(state), nativeSubagents: false };
  if (event.type === 'message.complete' || event.type === 'error') return clearActiveTodos(state);

  if (event.type === 'status.update' && payload.kind === 'goal') return applyGoalText(state, str(payload.text), now);
  if (event.type === 'session.control.update') return applyControlSnapshot(state, payload.control);
  return state;
}

/** drop whatever has outlived its linger */
export function tickStatus(state: StatusState, now: number): StatusState {
  let next = state;
  if (next.todosDropAt !== null && next.todosDropAt <= now) next = dropTodos(next);
  if (next.goal?.expireAt !== undefined && next.goal.expireAt <= now) next = { ...next, goal: null };
  const expired = next.background.filter((item) => item.expireAt !== undefined && item.expireAt <= now);
  for (const item of expired) next = dismissBackground(next, item.id);
  return next;
}

/** when `tickStatus` next has something to drop, or `null` for never */
export function statusNextExpiry(state: StatusState): number | null {
  const times = [state.todosDropAt, state.goal?.expireAt, ...state.background.map((item) => item.expireAt)].filter((t): t is number => t !== null && t !== undefined);
  return times.length ? Math.min(...times) : null;
}

// ─── what the stack shows ───────────────────────────────────────────────────

export type StatusItem = {
  id: string;
  type: 'background' | 'goal' | 'subagent' | 'todo';
  state: 'done' | 'failed' | 'running';
  title: string;
  /** todo nesting depth */
  depth?: number;
  goalStatus?: GoalStatus;
  todoStatus?: TodoStatus;
  /** subagent: its active tool; goal: the detail line */
  currentTool?: string;
  exitCode?: number;
  sessionId?: string;
};

export type StatusGroup = { type: StatusItem['type']; items: StatusItem[] };

const turnsLabel = (turns: number) => `${turns} turn${turns === 1 ? '' : 's'}`;

function goalItem(state: StatusState): StatusItem | null {
  // structured controls own the goal once the gateway supports them; the command's text is the fallback
  if (state.control.capability === 'supported') {
    const goal = state.control.goal;
    if (!goal) return null;
    const status: GoalStatus = goal.status === 'active' && goal.waiting ? 'waiting' : goal.status;
    const detail =
      goal.status === 'active' ? (goal.maxTurns > 0 ? `Turn ${goal.turnsUsed}/${goal.maxTurns}` : `Turn ${goal.turnsUsed}`) : goal.status === 'done' ? turnsLabel(goal.turnsUsed) : goal.pausedReason;
    return { id: 'goal:standing', type: 'goal', state: status === 'active' || status === 'waiting' ? 'running' : 'done', title: goal.title, goalStatus: status, currentTool: detail };
  }
  const goal = state.goal;
  if (!goal) return null;
  return { id: 'goal:standing', type: 'goal', state: goal.status === 'active' || goal.status === 'waiting' ? 'running' : 'done', title: goal.title, goalStatus: goal.status, currentTool: goal.detail };
}

export function statusItems(state: StatusState): StatusItem[] {
  const items: StatusItem[] = [];
  for (const [todo, depth] of todoTree(state.todos ?? [])) {
    items.push({ depth, id: `todo:${todo.id}`, state: todo.status === 'in_progress' ? 'running' : 'done', title: todo.content, todoStatus: todo.status, type: 'todo' });
  }
  const goal = goalItem(state);
  if (goal) items.push(goal);
  for (const sub of state.subagents) {
    if (sub.status === 'running' || sub.status === 'queued') {
      items.push({ currentTool: sub.currentTool, id: sub.id, sessionId: sub.sessionId, state: 'running', title: sub.goal, type: 'subagent' });
    }
  }
  for (const item of state.background) {
    items.push({ exitCode: item.exitCode, id: item.id, state: item.state, title: item.title, type: 'background' });
  }
  return items;
}

/** top to bottom: the plan the reader is following, then how Hermes is executing it */
const TYPE_ORDER: readonly StatusItem['type'][] = ['goal', 'todo', 'subagent', 'background'];

export function groupStatusItems(items: readonly StatusItem[]): StatusGroup[] {
  return TYPE_ORDER.flatMap((type) => {
    const list = items.filter((item) => item.type === type);
    return list.length ? [{ type, items: list }] : [];
  });
}

/** a settled snapshot is reviewable but never re-enters the live feed: only once the live list has retired and the turn is idle */
export function retainedTodoItems(state: StatusState, busy: boolean): StatusItem[] {
  if (busy || state.retainedTodos.length === 0 || state.todos !== null) return [];
  return todoTree(state.retainedTodos).map(([todo, depth]) => ({ depth, id: `retained-todo:${todo.id}`, state: 'done', title: todo.content, todoStatus: todo.status, type: 'todo' }));
}

export const liveSubagents = (state: StatusState) => state.subagents.filter((item) => item.status === 'running' || item.status === 'queued');

export const hasRunningBackground = (state: StatusState) => state.background.some((item) => item.state === 'running');

export const STATUS_COPY = {
  hideStack: 'Hide status stack',
  showStack: 'Show status stack',
  goalActive: 'Goal active',
  goalDone: 'Goal done',
  goalPaused: 'Goal paused',
  goalWaiting: 'Goal waiting',
  subagents: (count: number) => `${count} Subagent${count === 1 ? '' : 's'}`,
  todos: (done: number, total: number) => `Tasks ${done}/${total}`,
  previousTodos: (done: number, total: number) => `Previous tasks ${done}/${total}`,
  background: (count: number) => `${count} Background`,
  running: 'Running',
  queued: 'Queued',
  waitingActivity: 'Waiting for activity',
  stop: 'Stop',
  dismiss: 'Dismiss',
  exit: (code: number) => `exit ${code}`,
  steer: 'Steer',
  steerPlaceholder: 'Instructions for this subagent',
  steerQueued: 'Queued for the next checkpoint',
  stopRequested: 'Stop requested',
  requestRejected: 'The subagent did not accept the request',
} as const;

export function groupLabel(group: StatusGroup): string {
  if (group.type === 'goal') {
    const status = group.items[0]?.goalStatus;
    return status === 'paused' ? STATUS_COPY.goalPaused : status === 'waiting' ? STATUS_COPY.goalWaiting : status === 'done' ? STATUS_COPY.goalDone : STATUS_COPY.goalActive;
  }
  if (group.type === 'todo') return STATUS_COPY.todos(group.items.filter((item) => item.todoStatus === 'completed').length, group.items.length);
  return group.type === 'subagent' ? STATUS_COPY.subagents(group.items.length) : STATUS_COPY.background(group.items.length);
}

/** whether the stack has anything to draw; the queue is counted by the caller */
export function hasStatusRows(state: StatusState, busy: boolean): boolean {
  return statusItems(state).length > 0 || retainedTodoItems(state, busy).length > 0;
}

/** a resume's snapshot: the todo list, restored only when it is still live or finished */
export function hydrateStatus(state: StatusState, resumed: { todo_state?: unknown; running?: boolean | null }, now: number): StatusState {
  return resumed.todo_state ? applyTodoSnapshot(state, resumed.todo_state, resumed.running === true, now) : state;
}
