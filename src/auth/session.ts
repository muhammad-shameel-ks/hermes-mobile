/**
 * The signed-in session's credential holder. Every authenticated call asks it for
 * a bearer; it refreshes once above the skew, shares that refresh between
 * concurrent callers, persists the result, and reports when only a fresh sign-in
 * will do. A provider outage is transient, not a sign-out.
 */

import type { RefreshResult } from './native-flow.ts';
import { isStale, nowSeconds, type Credentials } from './tokens.ts';

export class ReauthRequiredError extends Error {
  constructor(message = 'The session needs a fresh sign-in.') {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

export class AuthUnavailableError extends Error {
  constructor(message = 'The gateway could not reach its sign-in provider.') {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

export type AuthSessionOptions = {
  baseUrl: string;
  credentials: Credentials;
  refresh: (baseUrl: string, refreshToken: string) => Promise<RefreshResult>;
  persist: (credentials: Credentials) => Promise<void>;
  onReauthRequired: (reason: string) => void;
  now?: () => number;
};

export type AuthSession = {
  readonly baseUrl: string;
  /** a bearer that is not stale, refreshing first if it is */
  accessToken: () => Promise<string>;
  /** force the one refresh after the server rejected the current bearer */
  refreshNow: () => Promise<string>;
  /** a terminal auth failure from anywhere: hand the phone back to sign-in */
  fail: (reason: string) => never;
};

export function createAuthSession(options: AuthSessionOptions): AuthSession {
  const now = options.now ?? nowSeconds;
  let credentials = options.credentials;
  let inflight: Promise<string> | null = null;
  let failed = false;

  const fail = (reason: string): never => {
    if (!failed) {
      failed = true;
      options.onReauthRequired(reason);
    }
    throw new ReauthRequiredError(reason);
  };

  const refreshNow = (): Promise<string> => {
    if (failed) return Promise.reject(new ReauthRequiredError());
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        if (!credentials.refreshToken) return fail('The session needs a fresh sign-in.');
        const result = await options.refresh(options.baseUrl, credentials.refreshToken);
        if (result.kind === 'refreshed') {
          credentials = result.credentials;
          await options.persist(credentials);
          return credentials.accessToken;
        }
        if (result.kind === 'unavailable') throw new AuthUnavailableError();
        if (result.kind === 'expired') return fail('The session needs a fresh sign-in.');
        throw new AuthUnavailableError(`Refreshing the session failed: ${result.detail}`);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    baseUrl: options.baseUrl,
    accessToken: async () => {
      if (failed) throw new ReauthRequiredError();
      if (inflight) return inflight;
      return isStale(credentials, now()) ? refreshNow() : credentials.accessToken;
    },
    refreshNow,
    fail,
  };
}
