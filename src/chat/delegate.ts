/**
 * A delegation's rows. A `delegate_task` call carries the goals it dispatched,
 * the live subagent list carries what those children are doing, and the result
 * carries how they finished; one row is all three views of the same child. Port
 * of the desktop's tool/delegate-model. Pure.
 */

export type SubagentStatus = 'completed' | 'failed' | 'interrupted' | 'queued' | 'running';

/** the slice of a live subagent a row reads; the status stack's store satisfies it structurally */
export type SubagentProgress = {
  id: string;
  goal: string;
  sessionId?: string;
  model?: string;
  status: SubagentStatus;
  taskIndex: number;
  durationSeconds?: number;
  stream: readonly { text: string }[];
};

/**
 * `dispatched` is the state the other two sources cannot describe: a background
 * delegation whose children outlived the turn, seen from a transcript reloaded
 * since. It is running, but nothing here watches it, so it must not spin.
 */
export type DelegateRowStatus = SubagentStatus | 'dispatched';

export type DelegateRow = {
  /** relayed activity, oldest to newest */
  activity: string[];
  durationSeconds?: number;
  goal: string;
  id: string;
  model?: string;
  /** the child's own session id, when it reported one */
  sessionId?: string;
  status: DelegateRowStatus;
};

type Json = Record<string, unknown>;

function parseObject(value: unknown): Json {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Json;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

const field = (record: Json, key: string): string => {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
};

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/** the goals a `delegate_task` call dispatched, in task order */
export function delegateGoals(args: unknown): string[] {
  const record = parseObject(args);
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  if (tasks.length > 0) return tasks.map((task, index) => field(parseObject(task), 'goal') || `Task ${index + 1}`);
  const goal = field(record, 'goal');
  return goal ? [goal] : [];
}

function resultRows(result: unknown): Json[] {
  const results = parseObject(result).results;
  return Array.isArray(results) ? results.map(parseObject) : [];
}

// the tool settles rows as 'ok', 'error', 'timeout', 'failed'; anything that is
// not a success must read as failed, or a timed-out child hides behind a check
function settledRowStatus(status: string): DelegateRowStatus {
  return status === '' || status === 'ok' || status === 'completed' ? 'completed' : 'failed';
}

function dispatchedGoals(result: unknown): string[] {
  const record = parseObject(result);
  if (field(record, 'status') !== 'dispatched') return [];
  return Array.isArray(record.goals) ? record.goals.filter((goal): goal is string => typeof goal === 'string') : [];
}

/**
 * The rows a call describes on its own, before any live subagent state: what a
 * rehydrated transcript has. A call with no result is still being placed, so its
 * rows read as running; the moment a background dispatch answers they park.
 */
export function delegateRowsFromCall(args: unknown, result: unknown, toolCallId = ''): DelegateRow[] {
  const goals = delegateGoals(args);
  const finished = resultRows(result);
  const dispatched = dispatchedGoals(result);
  const titles = goals.length > 0 ? goals : dispatched.length > 0 ? dispatched : finished.map(() => 'Delegated task');
  const idle: DelegateRowStatus = result === undefined ? 'running' : 'dispatched';

  return titles.map((goal, index) => {
    const entry = finished[index];
    const summary = entry ? field(entry, 'summary') : '';
    const seconds = entry && typeof entry.duration_seconds === 'number' && Number.isFinite(entry.duration_seconds) ? entry.duration_seconds : undefined;
    return {
      activity: summary ? [summary] : [],
      durationSeconds: seconds,
      goal,
      id: `${toolCallId}:${index}`,
      model: entry ? field(entry, 'model') || undefined : undefined,
      status: entry ? settledRowStatus(field(entry, 'status')) : idle,
    };
  });
}

function fromSubagent(live: SubagentProgress, fallbackId: string, fallbackGoal: string): DelegateRow {
  return {
    activity: live.stream.map((entry) => entry.text).filter(Boolean),
    durationSeconds: live.durationSeconds,
    goal: live.goal || fallbackGoal,
    id: live.id || fallbackId,
    model: live.model,
    sessionId: live.sessionId,
    status: live.status,
  };
}

/**
 * Layer the session's live subagents over a call's rows. Three joins, narrowest
 * first: the call id (the delegate fallback keys its rows off it), the goal
 * string (native events carry it verbatim), then task order, trusted only when
 * both sides agree on how many children there are. Live state wins wherever it
 * exists.
 */
export function mergeDelegateRows(rows: readonly DelegateRow[], live: readonly SubagentProgress[], toolCallId = ''): DelegateRow[] {
  if (live.length === 0) return [...rows];
  const unclaimed = [...live];
  const claim = (predicate: (candidate: SubagentProgress) => boolean) => {
    const index = unclaimed.findIndex(predicate);
    return index >= 0 ? unclaimed.splice(index, 1)[0] : undefined;
  };
  const prefix = toolCallId ? `delegate-tool:${toolCallId}:` : '';
  const byId = rows.map((_row, index) => (prefix ? claim((c) => c.id === `${prefix}${index}`) : undefined));
  const byGoal = rows.map((row, index) => byId[index] ?? claim((c) => normalize(c.goal) === normalize(row.goal)));
  const sameShape = rows.length === live.length;
  return rows.map((row, index) => {
    const matched = byGoal[index] ?? (sameShape ? claim((c) => c.taskIndex === index) : undefined);
    return matched ? fromSubagent(matched, row.id, row.goal) : row;
  });
}

export const isDelegateRowLive = (status: DelegateRowStatus): boolean => status === 'running' || status === 'queued';

export const isDelegateRowFailed = (status: DelegateRowStatus): boolean => status === 'failed' || status === 'interrupted';
