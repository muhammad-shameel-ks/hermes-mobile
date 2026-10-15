/**
 * The credential pair the gateway mints, and the two rules that go with it:
 * `expires_at` is an absolute epoch second, and the client refreshes itself -
 * the gate never rotates bearers. One silent attempt above a 60 s skew is the
 * whole policy (desktop parity).
 */

export type Credentials = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** absolute epoch seconds */
  expiresAt: number;
  provider: string;
  userId: string;
};

export const REFRESH_SKEW_SECONDS = 60;

export function isStale(credentials: Credentials, nowSeconds: number): boolean {
  return credentials.expiresAt - REFRESH_SKEW_SECONDS <= nowSeconds;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseTokenPayload(bodyText: string): Credentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const accessToken = record.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  return {
    accessToken,
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : '',
    tokenType: typeof record.token_type === 'string' ? record.token_type : 'Bearer',
    expiresAt: typeof record.expires_at === 'number' ? record.expires_at : 0,
    provider: typeof record.provider === 'string' ? record.provider : '',
    userId: typeof record.user_id === 'string' ? record.user_id : '',
  };
}

/** "11 h 59 m", "3 m", "expired" - the signed-in screen's one relative time. */
export function describeRemaining(expiresAt: number, now: number): string {
  const seconds = expiresAt - now;
  if (seconds <= 0) return 'expired';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
  return `${Math.floor(hours / 24)} d`;
}
