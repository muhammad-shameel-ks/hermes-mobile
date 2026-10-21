/**
 * The board's pure logic, ported from the desktop plugin (`board.tsx`, `ui.tsx`, `drawer.tsx`): lane
 * presentation, the optimistic edits a move or delete paints before the gateway answers, the client-side
 * filters, the card's machine-activity state and the activity feed's prose. No React, no I/O.
 */

import { compactAge } from '../bots/roster.ts';
import { K, laneLabel } from './text.ts';
import type { KanbanBoard, KanbanEvent, KanbanRun, KanbanTask } from './types.ts';

// ─── lanes ────────────────────────────────────────────────────────────────────

/**
 * Lanes a card can be moved out of but never into: `running` and `review` are claimed by the dispatcher,
 * `scheduled` needs a wake-up time only an agent or the CLI can attach (a bare status move answers 409).
 */
export const LOCKED_LANES = ['review', 'running', 'scheduled'] as const;

export const isLockedTarget = (name: string): boolean => (LOCKED_LANES as readonly string[]).includes(name);

/** the ink a lane's tone falls back to when the desktop names a text shade rather than a hue */
export type LaneInk = { uiTextSecondary: string; uiTextTertiary: string; uiTextQuaternary: string };

/** desktop `COLUMN_META` tones: a hue, or a text shade; anything the backend adds renders with the fallback */
const LANE_TONES: Record<string, string> = {
  triage: 'tertiary',
  todo: 'secondary',
  scheduled: '#a78bfa',
  ready: '#60a5fa',
  running: '#34d399',
  blocked: '#f87171',
  review: '#fbbf24',
  done: 'tertiary',
  archived: 'quaternary',
};

export function laneTone(name: string, ink: LaneInk): string {
  const tone = LANE_TONES[name] ?? 'secondary';
  if (tone === 'secondary') return ink.uiTextSecondary;
  if (tone === 'tertiary') return ink.uiTextTertiary;
  if (tone === 'quaternary') return ink.uiTextQuaternary;
  return tone;
}

/** the amber of a running card whose worker stopped sending heartbeats (`.kanban-arc--stale`) */
export const STALE_TONE = '#fbbf24';
/** desktop `SEVERITY_TONE`, with the fallbacks its CSS variables carry */
export const SEVERITY_TONE: Record<string, string> = { critical: '#f87171', error: '#f87171', warning: '#fbbf24' };
export const PRIORITY_TONE = '#f59e0b';

// ─── ids, text and time ───────────────────────────────────────────────────────

export const shortId = (id?: string | null) => (id ?? '').replace(/^t_/, '').slice(0, 6);

/** desktop board switcher: a board's slug from its display name */
export const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "a, b , ,c" as the create body's skills list */
export const splitSkills = (text: string) =>
  text
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);

/** a reclaim writes an administrative note into `latest_summary`; the detail hides it (Runs still shows it) */
export const isAdminSummary = (summary: string) => /^status changed to \w+ \(dashboard\/direct\)$/.test(summary);

/** backend timestamps are epoch seconds: "now", 5m, 3h, 2d; null without a time */
export const ago = (seconds: number | null | undefined, nowSeconds: number): string | null =>
  seconds ? compactAge(seconds, nowSeconds) || 'now' : null;

/** desktop `coarseElapsed` with the compact suffixes: 42s, 3m, 2h, 1d */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** a run's length, or null when it has no end yet (or the clock ran backwards) */
export function duration(start?: number | null, end?: number | null): string | null {
  if (!start || !end || end < start) return null;
  return elapsedLabel((end - start) * 1000);
}

/** "~12.3k" for an estimate's token count */
export function compactNumber(value: number | undefined): string {
  const n = value ?? 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// ─── the card's machine activity ──────────────────────────────────────────────

export type ArcState = 'queued' | 'running' | 'stale';

/** no heartbeat for this long and a running card stops claiming it is working */
export const STALE_AFTER_S = 120;

/**
 * desktop `arcState`: the travelling border only while an agent is actually on the card (amber once its
 * heartbeat is gone); `queued` (triage, review, a Ready card someone will take) is said by the named-agent chip.
 */
export function arcState(task: KanbanTask, fallbackAssignee: string, nowSeconds: number): ArcState | null {
  if (task.status === 'running') {
    const stale = task.last_heartbeat_at ? nowSeconds - task.last_heartbeat_at > STALE_AFTER_S : false;
    return stale ? 'stale' : 'running';
  }
  const queued = task.status === 'triage' || task.status === 'review' || (task.status === 'ready' && Boolean(task.assignee || fallbackAssignee));
  return queued ? 'queued' : null;
}

/** The agent on the hook for a queued card: the assignee, else the auto-default (Ready), else the specifier (Triage). */
export function attachedAgent(task: KanbanTask, fallbackAssignee: string, orchestrator: string): string {
  return task.assignee || (task.status === 'ready' ? fallbackAssignee : task.status === 'triage' ? orchestrator : '');
}

/** Ready with nobody to run it and no default assignee: the card silently never runs */
export const wontRun = (task: KanbanTask, fallbackAssignee: string) => task.status === 'ready' && !task.assignee && !fallbackAssignee;

// ─── optimistic edits (reconciled by the follow-up read) ──────────────────────

/** `id` moved to the head of `toStatus`; the same board when the card is not on it */
export function moveCard(board: KanbanBoard, id: string, toStatus: string): KanbanBoard {
  let moved: KanbanTask | undefined;
  const columns = board.columns.map((col) => {
    const index = col.tasks.findIndex((task) => task.id === id);
    if (index === -1) return col;
    moved = { ...col.tasks[index], status: toStatus };
    return { ...col, tasks: [...col.tasks.slice(0, index), ...col.tasks.slice(index + 1)] };
  });
  if (!moved) return board;
  const card = moved;
  return { ...board, columns: columns.map((col) => (col.name === toStatus ? { ...col, tasks: [card, ...col.tasks] } : col)) };
}

export function removeCard(board: KanbanBoard, id: string): KanbanBoard {
  if (!board.columns.some((col) => col.tasks.some((task) => task.id === id))) return board;
  return { ...board, columns: board.columns.map((col) => (col.tasks.some((task) => task.id === id) ? { ...col, tasks: col.tasks.filter((task) => task.id !== id) } : col)) };
}

export const findTask = (board: KanbanBoard | null, id: string): KanbanTask | undefined => {
  if (!board) return undefined;
  for (const col of board.columns) for (const task of col.tasks) if (task.id === id) return task;
  return undefined;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((key) => key in b && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * What a card renders. The board payload carries more per card (an `age` block that ticks every read,
 * diagnostics with their own timestamps), so comparing whole payloads would call every card changed.
 */
const CARD_FIELDS = [
  'id',
  'title',
  'body',
  'status',
  'assignee',
  'priority',
  'tenant',
  'created_at',
  'latest_summary',
  'comment_count',
  'link_counts',
  'progress',
  'started_at',
  'current_run_started_at',
  'worker_pid',
  'last_heartbeat_at',
  'block_kind',
  'block_recurrences',
] as const satisfies ReadonlyArray<keyof KanbanTask>;

function sameCard(a: KanbanTask, b: KanbanTask): boolean {
  return (
    CARD_FIELDS.every((key) => sameValue(a[key], b[key])) &&
    (a.warnings?.count ?? 0) === (b.warnings?.count ?? 0) &&
    (a.warnings?.highest_severity ?? null) === (b.warnings?.highest_severity ?? null)
  );
}

/**
 * A poll's board with every card that renders the same, and every lane whose cards all do, carried over from
 * the previous read by identity, so memoised cards and lane lists skip the re-render a fresh payload would
 * otherwise cause on every poll.
 */
export function stableBoard(prev: KanbanBoard | null, next: KanbanBoard): KanbanBoard {
  if (!prev) return next;
  const before = new Map<string, KanbanTask>();
  for (const col of prev.columns) for (const task of col.tasks) before.set(task.id, task);
  const prevColumns = new Map(prev.columns.map((col) => [col.name, col]));
  let changed = prev.columns.length !== next.columns.length;
  const columns = next.columns.map((col, index) => {
    const tasks = col.tasks.map((task) => {
      const old = before.get(task.id);
      return old && sameCard(old, task) ? old : task;
    });
    const old = prevColumns.get(col.name);
    if (old && prev.columns[index] === old && old.tasks.length === tasks.length && old.tasks.every((task, i) => task === tasks[i])) return old;
    changed = true;
    return { ...col, tasks };
  });
  const sameLists = sameValue(prev.tenants, next.tenants) && sameValue(prev.assignees, next.assignees);
  if (!changed && sameLists) return prev.latest_event_id === next.latest_event_id ? prev : { ...prev, latest_event_id: next.latest_event_id, now: next.now };
  return { ...next, columns, tenants: sameLists ? prev.tenants : next.tenants, assignees: sameLists ? prev.assignees : next.assignees };
}

// ─── filters and counts ───────────────────────────────────────────────────────

export type BoardFilters = { search: string; tenant: string; assignee: string };

export const NO_FILTERS: BoardFilters = { search: '', tenant: '', assignee: '' };

export const filtersActive = (f: BoardFilters) => Boolean(f.search.trim() || f.tenant || f.assignee);

/** desktop board page: search over title, body and id, and exact tenant / assignee; the same board when nothing filters */
export function filterBoard(board: KanbanBoard, filters: BoardFilters): KanbanBoard {
  if (!filtersActive(filters)) return board;
  const q = filters.search.trim().toLowerCase();
  const keep = (task: KanbanTask) =>
    (!q || `${task.title} ${task.body ?? ''} ${task.id}`.toLowerCase().includes(q)) &&
    (!filters.tenant || task.tenant === filters.tenant) &&
    (!filters.assignee || task.assignee === filters.assignee);
  return { ...board, columns: board.columns.map((col) => ({ ...col, tasks: col.tasks.filter(keep) })) };
}

export const boardTotal = (board: KanbanBoard) => board.columns.reduce((sum, col) => sum + col.tasks.length, 0);

export type FlowSegment = { name: string; count: number; share: number };

/**
 * The pipeline ribbon: each lane's share of the board's cards, in lane order. Lanes with no cards keep a
 * zero share so the ribbon's segments line up with the rail; an empty board is all zeros.
 */
export function flowSegments(board: KanbanBoard): FlowSegment[] {
  const total = boardTotal(board);
  return board.columns.map((col) => ({ name: col.name, count: col.tasks.length, share: total ? col.tasks.length / total : 0 }));
}

/** the ids still on the board; the same set when nothing left, so a poll does not re-render the selection */
export function pruneSelection(selected: ReadonlySet<string>, board: KanbanBoard): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const alive = new Set<string>();
  for (const col of board.columns) for (const task of col.tasks) if (selected.has(task.id)) alive.add(task.id);
  return alive.size === selected.size ? selected : alive;
}

// ─── the detail's feeds ───────────────────────────────────────────────────────

const FAILED_OUTCOMES: Record<string, true> = { crashed: true, failed: true, timed_out: true, gave_up: true };

export const runFailed = (run: KanbanRun) => FAILED_OUTCOMES[run.outcome ?? run.status] === true;

/**
 * desktop `eventText`: a task_events row as an operator-readable line. Known kinds get prose with the
 * payload folded in; unknown kinds fall back to the kind and compact key=value detail.
 */
export function eventText(event: KanbanEvent): { label: string; detail?: string } {
  let p: Record<string, unknown> = {};
  if (typeof event.payload === 'string' && event.payload) {
    try {
      p = JSON.parse(event.payload) as Record<string, unknown>;
    } catch {
      return { label: event.kind.replace(/_/g, ' '), detail: event.payload };
    }
  } else if (event.payload && typeof event.payload === 'object') {
    p = event.payload as Record<string, unknown>;
  }
  const str = (key: string): string | null => {
    const value = p[key];
    return typeof value === 'string' && value ? value : null;
  };
  const lane = (key: string) => {
    const value = str(key);
    return value ? laneLabel(value) : null;
  };

  switch (event.kind) {
    case 'created':
      return { label: K.evtCreated(lane('status') ?? '', str('assignee') ?? '') };
    case 'status': {
      const reason = str('reason');
      return { label: K.evtMovedTo(lane('status') ?? '?'), detail: reason === 'parent_reopened' ? K.evtParentReopened(str('parent') ?? '') : (reason ?? undefined) };
    }
    case 'assigned': {
      const assignee = str('assignee');
      return { label: assignee ? K.evtAssignedTo(assignee) : K.evtUnassigned };
    }
    case 'commented':
      return { label: K.evtCommentBy(str('author') ?? K.someone) };
    case 'claimed':
      return { label: str('source_status') === 'review' ? K.evtClaimedReview : K.evtClaimedWorker };
    case 'spawned':
      return { label: K.evtWorkerStarted, detail: p.pid != null ? `pid ${String(p.pid)}` : undefined };
    case 'completed':
      return { label: K.evtCompleted };
    case 'blocked':
      return { label: K.evtBlocked, detail: str('reason') ?? undefined };
    case 'unblocked':
      return { label: K.evtUnblocked(lane('status') ?? '') };
    case 'reclaimed':
      return { label: K.evtReclaimed, detail: str('reason') ?? undefined };
    case 'specified':
      return { label: K.evtSpecified };
    case 'promoted':
      return { label: K.evtPromoted };
    case 'scheduled':
      return { label: K.evtScheduled, detail: str('reason') ?? undefined };
    case 'archived':
      return { label: K.evtArchived };
    case 'reprioritized':
      return { label: K.evtReprioritized(String(p.priority ?? '?')) };
    default: {
      const detail = Object.entries(p)
        .filter(([, value]) => value != null && typeof value !== 'object')
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      return { label: event.kind.replace(/_/g, ' '), detail: detail || undefined };
    }
  }
}
