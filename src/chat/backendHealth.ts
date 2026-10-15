/**
 * What the status row's Backend item and its popover say, as pure functions:
 * desktop lib/runtime-readiness.ts, lib/gateway-health-pill.ts,
 * lib/platform-status.ts and the log-trimming in app/shell/gateway-menu-panel.tsx,
 * with the desktop's English copy (i18n `shell.gatewayMenu` / `shell.statusbar`).
 */

import type { LinkState } from '../gateway/link.ts';

export type DotTone = 'good' | 'muted' | 'warn' | 'bad';

/** the item's colour: the status bar's own tone when ready, amber while degraded or connecting, destructive when down */
export type HealthTone = 'default' | 'warn' | 'bad';

export const COPY = {
  backend: 'Backend',
  connected: 'Connected',
  connecting: 'Connecting',
  offline: 'Offline',
  inferenceReady: 'Inference ready',
  inferenceNotReady: 'Inference not ready',
  checkingInference: 'Checking inference',
  disconnected: 'Disconnected',
  reconnectGateway: 'Reconnect gateway',
  restartGateway: 'Restart gateway',
  recentActivity: 'Recent activity',
  messagingPlatforms: 'Messaging platforms',
  gatewayReady: 'ready',
  gatewayNeedsSetup: 'needs setup',
  gatewayUnavailable: 'inference unavailable',
  gatewayChecking: 'checking',
  gatewayConnecting: 'connecting',
  gatewayOffline: 'offline',
  gatewayRestarting: 'restarting…',
  messagingStopped: 'messaging stopped',
  messagingDegraded: (name: string) => `${name} down`,
  gatewayRestartFailed: 'Gateway restart failed.',
  sharedGatewayRestartTitle: 'Restart the shared gateway?',
  sharedGatewayRestartDescription: (bots: string) => `All bots on this device reconnect: ${bots}`,
  sharedGatewayRestartConfirm: 'Restart all',
  sharedGatewayRestarted: (count: number) => `Shared gateway restarted (${count} ${count === 1 ? 'bot' : 'bots'})`,
} as const;

/* readiness: setup.status + setup.runtime_check */

export type SetupStatusSnapshot = { provider_configured?: boolean | null; [key: string]: unknown };
export type RuntimeCheckSnapshot = { ok?: boolean | null; error?: string | null; model?: string | null; free_tier_route?: boolean | null; [key: string]: unknown };

export type ReadinessSignals = {
  setup: SetupStatusSnapshot | null;
  setupError: string | null;
  runtime: RuntimeCheckSnapshot | null;
  runtimeError: string | null;
};

export type Readiness = {
  checksDisagree: boolean;
  ready: boolean;
  reason: string | null;
  source: 'fallback' | 'runtime_check' | 'setup_status';
};

export type ReadinessDisplay = 'checking' | 'needs_setup' | 'ready' | 'unavailable';

const DEFAULT_NOT_READY_REASON = 'Add a provider credential before sending your first message.';

const message = (value: string | null | undefined) => value?.trim() || null;

export function interpretReadiness(signals: ReadinessSignals): Readiness {
  const setupConfigured = typeof signals.setup?.provider_configured === 'boolean' ? signals.setup.provider_configured : undefined;
  const runtimeOk = typeof signals.runtime?.ok === 'boolean' ? signals.runtime.ok : undefined;
  const runtimeFailure = message(signals.runtime?.error) ?? message(signals.runtimeError);
  const setupFailure = message(signals.setupError);
  const checksDisagree = setupConfigured !== undefined && runtimeOk !== undefined && setupConfigured !== runtimeOk;

  if (runtimeOk !== undefined) {
    if (runtimeOk) return { checksDisagree, ready: true, reason: null, source: 'runtime_check' };
    let reason = runtimeFailure ?? DEFAULT_NOT_READY_REASON;
    if (checksDisagree && setupConfigured) reason = `${reason} setup.status reports configured credentials, but runtime resolution still failed.`;
    return { checksDisagree, ready: false, reason, source: 'runtime_check' };
  }
  if (setupConfigured !== undefined) {
    return {
      checksDisagree: false,
      ready: setupConfigured,
      reason: setupConfigured ? null : (runtimeFailure ?? setupFailure ?? DEFAULT_NOT_READY_REASON),
      source: 'setup_status',
    };
  }
  return { checksDisagree: false, ready: false, reason: runtimeFailure ?? setupFailure ?? DEFAULT_NOT_READY_REASON, source: 'fallback' };
}

export function readinessDisplay(readiness: Readiness | null): ReadinessDisplay {
  if (readiness === null) return 'checking';
  if (readiness.ready) return 'ready';
  return readiness.checksDisagree ? 'unavailable' : 'needs_setup';
}

type Ask = (method: 'setup.status' | 'setup.runtime_check', params: Record<string, unknown>) => Promise<unknown>;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : typeof error === 'string' ? error : String(error));

async function attempt<T>(run: Promise<unknown>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: (await run) as T, error: null };
  } catch (error) {
    return { value: null, error: errorMessage(error) };
  }
}

/** both readiness legs for one profile; either may fail without failing the other */
export async function fetchReadiness(ask: Ask, profile: string): Promise<Readiness> {
  const params = profile ? { profile } : {};
  const [setup, runtime] = await Promise.all([
    attempt<SetupStatusSnapshot>(ask('setup.status', params)),
    attempt<RuntimeCheckSnapshot>(ask('setup.runtime_check', params)),
  ]);
  return interpretReadiness({ setup: setup.value, setupError: setup.error, runtime: runtime.value, runtimeError: runtime.error });
}

/* /api/status */

export type PlatformState = { state: string };

export type GatewayStatus = {
  running: boolean | undefined;
  state: string | null;
  platforms: Record<string, PlatformState>;
  sharedWith: string[] | null;
};

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export function parseGatewayStatus(raw: unknown): GatewayStatus | null {
  const body = record(raw);
  if (!body) return null;
  const platforms: Record<string, PlatformState> = {};
  for (const [name, value] of Object.entries(record(body.gateway_platforms) ?? {})) {
    const state = record(value)?.state;
    if (typeof state === 'string') platforms[name] = { state };
  }
  return {
    running: typeof body.gateway_running === 'boolean' ? body.gateway_running : undefined,
    state: typeof body.gateway_state === 'string' ? body.gateway_state : null,
    platforms,
    sharedWith: Array.isArray(body.gateway_shared_with) ? body.gateway_shared_with.filter((name): name is string => typeof name === 'string') : null,
  };
}

/* the pill */

/** the desktop's `gatewayState` string for the phone's link */
export function connectionState(link: LinkState): 'open' | 'connecting' | 'closed' | 'idle' | 'error' {
  switch (link.kind) {
    case 'open':
      return 'open';
    case 'connecting':
      return 'connecting';
    case 'waiting':
      return 'closed';
    case 'paused':
      return 'idle';
    default:
      return 'error';
  }
}

const HEALTHY_PLATFORM_STATES = new Set(['connected']);
const IGNORED_PLATFORM_STATES = new Set(['disabled', 'not_configured', 'not configured']);

const platformLeaf = (id: string) => id.slice(id.lastIndexOf(':') + 1);

function unhealthyPlatformNames(platforms: GatewayStatus['platforms']): string[] {
  return Object.entries(platforms)
    .filter(([, platform]) => {
      const state = platform.state.trim().toLowerCase();
      return Boolean(state) && !HEALTHY_PLATFORM_STATES.has(state) && !IGNORED_PLATFORM_STATES.has(state);
    })
    .map(([id]) => platformLeaf(id));
}

function messagingWasConfigured(state: string | null, platforms: GatewayStatus['platforms']): boolean {
  const normalized = (state ?? '').trim().toLowerCase();
  return normalized === 'stopped' || normalized === 'startup_failed' || Object.keys(platforms).length > 0;
}

export type GatewayHealth = {
  label: string;
  detail: string;
  title: string | undefined;
  /** the messaging side is down while the socket is up */
  degraded: boolean;
  /** open, inference ready and messaging healthy: the desktop's `inferenceReady` */
  ready: boolean;
  restarting: boolean;
  tone: HealthTone;
  /** the desktop draws a spinner while restarting, Activity when ready and AlertCircle otherwise */
  icon: 'spinner' | 'pulse' | 'alert';
};

export function gatewayHealth({ link, inference, status, restarting }: { link: LinkState; inference: Readiness | null; status: GatewayStatus | null; restarting: boolean }): GatewayHealth {
  const state = connectionState(link);
  const open = state === 'open';
  const connecting = state === 'connecting';
  const platforms = status?.platforms ?? {};
  const downNames = unhealthyPlatformNames(platforms);
  const messagingDown = messagingWasConfigured(status?.state ?? null, platforms) && (status?.running === false || downNames.length > 0);
  const messagingText = downNames.length > 0 ? COPY.messagingDegraded(downNames[0]!) : COPY.messagingStopped;

  const connectionDetail = open
    ? {
        checking: COPY.gatewayChecking,
        needs_setup: COPY.gatewayNeedsSetup,
        ready: COPY.gatewayReady,
        unavailable: COPY.gatewayUnavailable,
      }[readinessDisplay(inference)]
    : connecting
      ? COPY.gatewayConnecting
      : COPY.gatewayOffline;

  const degraded = messagingDown && open;
  const ready = open && inference?.ready === true && !degraded;
  const detail = restarting ? COPY.gatewayRestarting : degraded ? messagingText : connectionDetail;
  const tone: HealthTone = restarting || ready ? 'default' : open || connecting || degraded ? 'warn' : 'bad';

  return {
    label: COPY.backend,
    detail,
    title: (degraded ? messagingText : undefined) || inference?.reason || undefined,
    degraded,
    ready,
    restarting,
    tone,
    icon: restarting ? 'spinner' : ready ? 'pulse' : 'alert',
  };
}

/* the popover */

export const prettyState = (state: string) => state.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export type MenuRows = { connectionLabel: string; connectionTone: DotTone; inferenceLabel: string; inferenceTone: DotTone };

export function menuRows(link: LinkState, inference: Readiness | null): MenuRows {
  const state = connectionState(link);
  const open = state === 'open';
  const connecting = state === 'connecting';
  const inferenceReady = open && inference?.ready === true;
  return {
    connectionLabel: open ? COPY.connected : connecting ? COPY.connecting : prettyState(state || COPY.offline),
    connectionTone: open ? 'good' : connecting ? 'warn' : 'bad',
    inferenceLabel: open ? (inference?.ready ? COPY.inferenceReady : inference ? COPY.inferenceNotReady : COPY.checkingInference) : COPY.disconnected,
    inferenceTone: inferenceReady ? 'good' : open ? 'warn' : 'bad',
  };
}

const PLATFORM_TONES: Record<string, DotTone> = { connected: 'good', disabled: 'muted', fatal: 'bad', startup_failed: 'bad' };

/** anything enabled that is not connected or failed is waiting on something */
export const platformTone = (state: string | null | undefined): DotTone => (state && PLATFORM_TONES[state]) || 'warn';

export type PlatformRow = { name: string; label: string; tone: DotTone };

export function platformRows(status: GatewayStatus | null): PlatformRow[] {
  return Object.entries(status?.platforms ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, platform]) => ({ name, label: prettyState(platform.state), tone: platformTone(platform.state) }));
}

/** the profiles a restart would blip when this one is carried by the shared multiplexer, default first */
export function sharedProfiles(status: Pick<GatewayStatus, 'sharedWith'> | null): string[] | null {
  const names = [...new Set((status?.sharedWith ?? []).map((name) => name.trim()).filter(Boolean))];
  if (names.length < 2) return null;
  return names.sort((left, right) => (left === 'default' ? -1 : right === 'default' ? 1 : left.localeCompare(right)));
}

/* recent activity: /api/logs?file=gui */

export const LOG_TAIL = 120;
export const LOG_VISIBLE = 40;
export const LOG_POLL_MS = 3000;

/** per-connection socket churn drowns out anything useful */
const LOG_NOISE_RE = /\bws (?:accepted|closed|response sent|ping|pong)\b/i;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.\d]*\s+/;
const RUNTIME_BRACKET_RE = /^\[[^\]]+]\s+/;

/** a log line without its leading timestamp and `[runtime_id]` prefixes */
export const trimLogLine = (raw: string) => raw.trim().replace(TIMESTAMP_RE, '').replace(RUNTIME_BRACKET_RE, '');

/** the lines worth showing, newest last, already trimmed */
export function logTail(lines: readonly string[], visible = LOG_VISIBLE): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !LOG_NOISE_RE.test(line))
    .slice(-visible)
    .map(trimLogLine);
}

/* restart */

export const RESTART_ACTION = 'gateway-restart';
export const RESTART_POLL_ATTEMPTS = 18;
export const RESTART_POLL_INTERVAL_MS = 1200;

export type ActionStatus = { running: boolean; exit_code: number | null };

/**
 * Polls the restart action to completion or the end of its window. The restart
 * takes down the process being asked, so refusals mid-window are the expected
 * shape; only an answered poll proves the backend came back, so a window refused
 * end to end is a failure. Still running when the window closes counts as success.
 */
export async function awaitRestart(fetchStatus: () => Promise<ActionStatus>, sleep: (ms: number) => Promise<void>): Promise<void> {
  let answered = false;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RESTART_POLL_ATTEMPTS; attempt += 1) {
    await sleep(RESTART_POLL_INTERVAL_MS);
    let status: ActionStatus;
    try {
      status = await fetchStatus();
    } catch (error) {
      lastError = error;
      continue;
    }
    answered = true;
    lastError = null;
    if (status.running) continue;
    if (status.exit_code == null) continue;
    if (status.exit_code !== 0) throw new Error(COPY.gatewayRestartFailed);
    return;
  }
  if (!answered) throw lastError ?? new Error(COPY.gatewayRestartFailed);
}
