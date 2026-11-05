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
import type { SignInFailure } from '../auth/native-flow.ts';
import type { Credentials } from '../auth/tokens.ts';
import type { GatewayStatus } from '../gateway/status.ts';

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
};

/** the phone could not read the sign-in it saved: the gateway is untouched, so a retry or a fresh sign-in helps */
export const KEYSTORE_FAILURE = "The phone couldn't read your saved sign-in.";

/**
 * Restore what the last run left behind, from storage alone. Nothing here touches the network: the
 * signed-in stack refreshes a stale bearer itself (`session.ts` single-flights the refresh and persists
 * it; `api.ts` retries a `session_expired` 401), an expired session routes to reauth, and an unavailable
 * gateway leaves the link retrying under the chat's inline banner.
 *
 * Both gates that used to live here cost the common returning-user path the app: an eight-second gateway
 * probe ran before anything could mount, and a stale token meant another fifteen seconds of a full-screen
 * "CONNECTING" word. A gateway that was merely down ended on a failure card instead of the cached chats.
 */
export async function restoreSession(deps: RestoreDeps): Promise<AppState> {
  try {
    const connection = await deps.loadConnection();
    if (!connection) return { kind: 'connect', connection: null, address: '', notice: null };
    let credentials: Credentials | null;
    try {
      credentials = await deps.loadCredentials(connection.id);
    } catch {
      // the keystore, not the gateway: keep the saved gateway so retrying does not mean retyping the address
      return { kind: 'unreachable', connection, headline: KEYSTORE_FAILURE, detail: null };
    }
    if (!credentials) return { kind: 'signed-out', connection };
    return { kind: 'signed-in', connection, credentials, status: null };
  } catch {
    return { kind: 'connect', connection: null, address: '', notice: null };
  }
}
