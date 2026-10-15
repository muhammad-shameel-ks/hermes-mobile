/**
 * The boot states the phone shows before the chat, and how a cold start picks
 * one (issue "App shell and navigation on a phone": onboarding, connecting,
 * boot failure and re-authentication become distinct phone screens).
 *
 * Ported from the desktop's boot-failure-overlay.tsx and boot-failure-cause.ts:
 * a failure leads with one classified sentence and keeps the raw text behind a
 * disclosure. The decision lives here, pure and dependency-injected, so the
 * screens only render it.
 */

import type { SavedConnection } from '../auth/store.ts';
import type { RefreshResult, SignInFailure } from '../auth/native-flow.ts';
import type { Credentials } from '../auth/tokens.ts';
import type { GatewayProbe, GatewayStatus } from '../gateway/status.ts';

export type AppState =
  | { kind: 'starting' }
  /** first run, or the person chose a different gateway */
  | { kind: 'connect'; connection: SavedConnection | null; address: string; notice: string | null }
  | { kind: 'signed-in'; connection: SavedConnection; credentials: Credentials; status: GatewayStatus | null }
  /** the saved gateway did not answer; retry, or change the gateway */
  | { kind: 'unreachable'; connection: SavedConnection; headline: string; detail: string | null }
  /** the gateway refused the session: only a fresh sign-in helps */
  | { kind: 'reauth'; connection: SavedConnection; reason: string }
  /** the person signed out, or the phone holds no credential for the saved gateway */
  | { kind: 'signed-out'; connection: SavedConnection };

// ─── failure copy ────────────────────────────────────────────────────────────

export type BootFailureCause = 'timedOut' | 'unreachable' | 'secureConnection';

/** desktop `en_boot` causes, adapted to a phone reaching a remote gateway; wording kept where it fits */
export const BOOT_CAUSES: Record<BootFailureCause, string> = {
  timedOut: "Hermes' gateway didn't answer in time.",
  unreachable: "Hermes can't reach that address. Check the URL and that the other computer is running Hermes.",
  secureConnection: "The phone couldn't make a secure connection to the gateway.",
};

// Order matters, as in the desktop table: the specific cause before the generic one.
const CAUSE_PATTERNS: ReadonlyArray<readonly [BootFailureCause, RegExp]> = [
  ['secureConnection', /ssl|tls|certificate|cleartext|trust anchor/i],
  ['timedOut', /timed out|timeout|did not answer within/i],
  ['unreachable', /network request failed|failed to connect|econnrefused|enotfound|unreachable|could not reach|no route|offline|network error|unknown host|unable to resolve/i],
];

export function classifyBootFailure(error: string | null | undefined): BootFailureCause | null {
  const text = String(error ?? '');
  if (!text) return null;
  return CAUSE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export type BootFailureCopy = {
  /** the one classified sentence shown in the red box */
  headline: string;
  /** raw text worth keeping behind "Details"; null when the headline already carries it */
  rawDetail: string | null;
};

/** A classified cause when one is known, otherwise the raw error's first line (never a trace dump). */
export function bootFailureCopy(error: string | null | undefined): BootFailureCopy {
  const raw = String(error ?? '').trim();
  const cause = classifyBootFailure(raw);
  if (cause) return { headline: BOOT_CAUSES[cause], rawDetail: raw || null };
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  return { headline: firstLine, rawDetail: firstLine === raw ? null : raw };
}

/** What a gateway probe that did not come back `ok` means for the boot screen. */
export function probeFailure(probe: Exclude<GatewayProbe, { kind: 'ok' }>): { headline: string; detail: string | null } {
  switch (probe.kind) {
    case 'timeout':
      return { headline: BOOT_CAUSES.timedOut, detail: null };
    case 'unreachable': {
      const copy = bootFailureCopy(probe.detail);
      return { headline: copy.headline, detail: copy.rawDetail };
    }
    case 'http-error':
      return { headline: `The gateway answered ${probe.httpStatus}.`, detail: probe.detail || null };
    case 'not-hermes':
      return { headline: 'No Hermes gateway answered at this address.', detail: probe.detail };
    case 'no-auth-gate':
      return { headline: 'This gateway no longer has a sign-in gate.', detail: null };
    case 'unsupported':
      return { headline: 'This gateway does not offer native PKCE sign-in.', detail: `auth_flows: ${probe.status.authFlows.join(', ') || 'none'}` };
  }
}

export const SIGN_IN_FAILURE_COPY: Record<SignInFailure, string> = {
  'callback-port-busy': 'The redirect port is busy',
  'state-mismatch': 'The gateway answered with a mismatched state',
  'exchange-failed': 'The gateway rejected the authorization code',
  'grant-timeout': 'The browser never returned a code',
  cancelled: 'Sign-in cancelled',
  unreachable: 'The gateway stopped answering',
  unexpected: 'Sign-in failed',
};

// ─── cold start ──────────────────────────────────────────────────────────────

export type RestoreDeps = {
  loadConnection: () => Promise<SavedConnection | null>;
  loadCredentials: (connectionId: string) => Promise<Credentials | null>;
  saveCredentials: (connectionId: string, credentials: Credentials) => Promise<void>;
  refreshCredentials: (baseUrl: string, refreshToken: string) => Promise<RefreshResult>;
  probeGateway: (baseUrl: string) => Promise<GatewayProbe>;
  isStale: (credentials: Credentials, nowSeconds: number) => boolean;
  nowSeconds: () => number;
};

export const SESSION_EXPIRED_REASON = 'The session needs a fresh sign-in.';

/**
 * Restore what the last run left behind. A stale access token gets the single
 * silent refresh the connection model allows; a rejected refresh asks for a
 * fresh sign-in, a provider outage or unreachable gateway is a boot failure
 * the person can retry.
 */
export async function restoreSession(deps: RestoreDeps): Promise<AppState> {
  try {
    const connection = await deps.loadConnection();
    if (!connection) return { kind: 'connect', connection: null, address: '', notice: null };
    const stored = await deps.loadCredentials(connection.id);
    if (!stored) return { kind: 'signed-out', connection };

    let credentials = stored;
    if (deps.isStale(stored, deps.nowSeconds())) {
      const refreshed = await deps.refreshCredentials(connection.baseUrl, stored.refreshToken);
      if (refreshed.kind === 'expired') return { kind: 'reauth', connection, reason: SESSION_EXPIRED_REASON };
      if (refreshed.kind === 'unavailable') {
        return { kind: 'unreachable', connection, headline: 'The gateway could not reach its sign-in provider.', detail: null };
      }
      if (refreshed.kind === 'failed') {
        const copy = bootFailureCopy(refreshed.detail);
        return { kind: 'unreachable', connection, headline: copy.headline, detail: copy.rawDetail };
      }
      credentials = refreshed.credentials;
      await deps.saveCredentials(connection.id, credentials);
    }

    const probe = await deps.probeGateway(connection.baseUrl);
    if (probe.kind === 'ok') return { kind: 'signed-in', connection, credentials, status: probe.status };
    return { kind: 'unreachable', connection, ...probeFailure(probe) };
  } catch {
    return { kind: 'connect', connection: null, address: '', notice: null };
  }
}
