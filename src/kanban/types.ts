/**
 * The slice of the kanban REST contract the phone renders (the desktop's `plugins/kanban/types.ts`, from
 * `plugins/kanban/dashboard/plugin_api.py`). The backend returns more per task; only what the UI reads is
 * typed, so a schema addition never breaks the build.
 */

/** One card. `status` is the lane it sits in. */
export type KanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  status: string;
  assignee?: string | null;
  priority?: number;
  tenant?: string | null;
  created_at?: number;
  latest_summary?: string | null;
  comment_count?: number;
  link_counts?: { parents: number; children: number };
  /** N-of-M child completion, or null when the task has no children */
  progress?: { done: number; total: number } | null;
  /** present only when a card has warnings */
  warnings?: { count: number; highest_severity?: string | null } | null;
  started_at?: number | null;
  /** start of the current run; absent on older backends, where the run clock falls back to `started_at` */
  current_run_started_at?: number | null;
  worker_pid?: number | null;
  last_heartbeat_at?: number | null;
  /** `dependency`, `needs_input`, `capability`, `transient`; kept across unblock, so current only while `blocked` */
  block_kind?: string | null;
  block_recurrences?: number;
};

export type KanbanColumn = { name: string; tasks: KanbanTask[] };

export type KanbanBoard = {
  columns: KanbanColumn[];
  tenants: string[];
  assignees: string[];
  latest_event_id: number;
  now: number;
};

export type DiagnosticAction = { kind: string; label: string; payload?: Record<string, unknown>; suggested?: boolean };

export type Diagnostic = {
  kind: string;
  severity: 'critical' | 'error' | 'warning';
  title: string;
  detail: string;
  actions: DiagnosticAction[];
  count: number;
  last_seen_at: number;
  data: Record<string, unknown>;
};

export type KanbanRun = {
  id: number | string;
  profile?: string | null;
  status: string;
  outcome?: string | null;
  summary?: string | null;
  error?: string | null;
  worker_pid?: number | null;
  started_at?: number | null;
  ended_at?: number | null;
};

export type KanbanComment = { id: number | string; author: string; body: string; created_at: number };

export type KanbanEvent = { id: number; kind: string; payload: unknown; created_at: number };

export type KanbanAttachment = { id: number | string; filename: string; stored_path?: string | null; size?: number | null };

/** one resolved row per linked task; older backends omit it and chips fall back to short ids */
export type KanbanLinkTask = { id: string; title: string; status: string };

export type KanbanTaskFull = KanbanTask & {
  result?: string | null;
  created_by?: string | null;
  model_override?: string | null;
  provider_override?: string | null;
  reasoning_effort?: string | null;
  completed_at?: number | null;
  last_failure_error?: string | null;
  workspace_kind?: string | null;
  workspace_path?: string | null;
  branch_name?: string | null;
  consecutive_failures?: number;
  diagnostics?: Diagnostic[];
};

/** GET /tasks/:id: the task plus its collections, which are siblings of `task` */
export type KanbanTaskDetail = {
  task: KanbanTaskFull;
  comments: KanbanComment[];
  events: KanbanEvent[];
  /** absent on backends without attachments, which hides the section */
  attachments?: KanbanAttachment[] | null;
  links: { parents: string[]; children: string[] };
  link_tasks?: KanbanLinkTask[] | null;
  runs: KanbanRun[];
};

export type BoardMeta = {
  slug: string;
  name?: string | null;
  description?: string | null;
  is_current?: boolean;
  total?: number;
  default_workdir?: string | null;
  default_workspace_kind?: string | null;
  project_id?: string | null;
  project_name?: string | null;
};

export type BoardsResponse = { boards: BoardMeta[]; current: string };

export type WorkerLog = { exists: boolean; size_bytes: number; content: string; truncated: boolean };

export type OrchestrationSettings = {
  orchestrator_profile: string;
  default_assignee: string;
  auto_decompose: boolean;
  resolved_orchestrator_profile: string;
  resolved_default_assignee: string;
};

export type KanbanProfile = { name: string; is_default: boolean; description: string; description_auto: boolean };

/** POST /estimate, /tasks/:id/estimate: a rough auxiliary-model read, never dollars */
export type TaskEstimate = {
  ok: boolean;
  reason?: string | null;
  est_tokens?: number;
  complexity?: 'S' | 'M' | 'L' | null;
  rationale?: string | null;
  model?: string | null;
};

export type BulkResult = { results: Array<{ id: string; ok: boolean; error?: string }> };
