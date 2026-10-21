/**
 * The kanban plugin's REST router (`plugins/kanban/dashboard/plugin_api.py`, mounted at
 * `/api/plugins/kanban`), over the authenticated client: the desktop's `api.ts` calls, one for one. Every
 * call names the selected board (`?board=`, omitted for the server's current one, so the phone never moves
 * the server-wide pointer) and the active profile.
 *
 * Every write that can change what the dispatcher should run nudges it (debounced, fire-and-forget), so a
 * new Ready task spawns now rather than on the next 60 s tick; a failed nudge is a non-event.
 */

import { ApiError, buildQuery, type GatewayApi, type Query } from '../gateway/api.ts';
import type {
  BoardsResponse,
  BulkResult,
  KanbanBoard,
  KanbanProfile,
  KanbanTask,
  KanbanTaskDetail,
  OrchestrationSettings,
  TaskEstimate,
  WorkerLog,
} from './types.ts';

export const KANBAN_ROOT = '/api/plugins/kanban';

/** the worker log tail the detail reads: 16 KiB, as the desktop's drawer */
export const LOG_TAIL_BYTES = 16384;

const NUDGE_MS = 400;

export type KanbanClock = (ms: number, run: () => void) => () => void;

const defaultAfter: KanbanClock = (ms, run) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export type KanbanScope = {
  /** the active profile */
  profile: () => string;
  /** the selected board's slug; '' is the server's current board */
  board: () => string;
};

export type KanbanRest = ReturnType<typeof createKanbanRest>;

export function createKanbanRest(api: GatewayApi, scope: KanbanScope, after: KanbanClock = defaultAfter) {
  const query = (extra: Query = {}): Query => ({ ...extra, board: scope.board() || undefined, profile: scope.profile() });
  const unboarded = (extra: Query = {}): Query => ({ ...extra, profile: scope.profile() });
  const task = (id: string, rest = '') => `${KANBAN_ROOT}/tasks/${encodeURIComponent(id)}${rest}`;

  let cancelNudge: (() => void) | null = null;
  const nudge = () => {
    cancelNudge?.();
    cancelNudge = after(NUDGE_MS, () => {
      cancelNudge = null;
      api.post(`${KANBAN_ROOT}/dispatch`, {}, query()).catch(() => undefined);
    });
  };
  const nudged = async <T>(write: Promise<T>): Promise<T> => {
    const value = await write;
    nudge();
    return value;
  };

  return {
    // reads
    board: (archived: boolean) => api.get<KanbanBoard>(`${KANBAN_ROOT}/board`, query({ include_archived: archived || undefined })),
    task: (id: string) => api.get<KanbanTaskDetail>(task(id), query()),
    log: (id: string) => api.get<WorkerLog>(task(id, '/log'), query({ tail: LOG_TAIL_BYTES })),
    boards: () => api.get<BoardsResponse>(`${KANBAN_ROOT}/boards`, unboarded()),
    profiles: () => api.get<{ profiles: KanbanProfile[] }>(`${KANBAN_ROOT}/profiles`, unboarded()),
    orchestration: () => api.get<OrchestrationSettings>(`${KANBAN_ROOT}/orchestration`, unboarded()),

    // writes
    patchTask: (id: string, patch: Record<string, unknown>) => nudged(api.patch<unknown>(task(id), patch, query())),
    createTask: (body: Record<string, unknown>) => nudged(api.post<{ task: KanbanTask | null; warning?: string }>(`${KANBAN_ROOT}/tasks`, body, query())),
    /** deleting can unblock dependants (a gone parent no longer gates), so it nudges too */
    deleteTask: (id: string) => nudged(api.del<unknown>(task(id), query())),
    /** one patch, many ids, applied per id: the answer says which ones the backend refused */
    bulk: (ids: string[], patch: Record<string, unknown>) => nudged(api.post<BulkResult>(`${KANBAN_ROOT}/tasks/bulk`, { ids, ...patch }, query())),
    comment: (id: string, body: string) => api.post<unknown>(task(id, '/comments'), { author: 'mobile', body }, query()),
    /** reclaims a running worker first and resets the failure streak: the explicit human recovery */
    reassign: (id: string, profile: string) => nudged(api.post<unknown>(task(id, '/reassign'), { profile, reclaim_first: true }, query())),
    reclaim: (id: string) => nudged(api.post<unknown>(task(id, '/reclaim'), {}, query())),
    /** a model call: only behind an explicit tap */
    estimateTask: (id: string) => api.post<TaskEstimate>(task(id, '/estimate'), {}, query(), { timeoutMs: 60000 }),
    estimateNew: (title: string, body: string) =>
      api.post<TaskEstimate>(`${KANBAN_ROOT}/estimate`, { title, body: body || undefined }, unboarded(), { timeoutMs: 60000 }),
    createBoard: (slug: string, name: string) => api.post<{ board: { slug: string } }>(`${KANBAN_ROOT}/boards`, { slug, name }, unboarded()),

    /** drop a pending nudge, for when the screen that wrote goes away */
    dispose: () => {
      cancelNudge?.();
      cancelNudge = null;
    },
  };
}

/** the authenticated GET that streams one attachment */
export function attachmentUrl(baseUrl: string, id: string | number, board: string, profile: string): string {
  return `${baseUrl}${KANBAN_ROOT}/attachments/${encodeURIComponent(String(id))}${buildQuery({ board: board || undefined, profile })}`;
}

/** the multipart POST (field `file`) that attaches one upload to a task */
export function attachmentUploadUrl(baseUrl: string, taskId: string, board: string, profile: string): string {
  return `${baseUrl}${KANBAN_ROOT}/tasks/${encodeURIComponent(taskId)}/attachments${buildQuery({ board: board || undefined, profile })}`;
}

/**
 * The runtime gate's answer for a plugin the gateway has switched off (`_plugin_api_runtime_gate`: 404
 * `Plugin not found`), told apart from a missing task or board, which name what is missing.
 */
export function isPluginOff(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.body);
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && 'detail' in parsed && parsed.detail === 'Plugin not found';
}
