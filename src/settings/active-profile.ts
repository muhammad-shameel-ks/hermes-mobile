/**
 * First connect seeds the active profile (issue "Connection model and credential
 * storage"). The gateway names the profile it serves at `GET /api/profiles/active`
 * (`current`), the endpoint the desktop's `refreshActiveProfile` reads; the
 * public `/api/status` only lists profile names.
 */

import type { GatewayApi } from '../gateway/api.ts';

export type ActiveProfileResponse = { active?: unknown; current?: unknown };

/** `current` is the profile this server is scoped to; `custom` means it cannot name its own home. */
export function pickActiveProfile(response: ActiveProfileResponse | null | undefined, known: readonly string[]): string | null {
  const current = typeof response?.current === 'string' ? response.current.trim() : '';
  if (!current || current === 'custom') return null;
  return known.length === 0 || known.includes(current) ? current : null;
}

export async function readActiveProfile(api: Pick<GatewayApi, 'get'>, known: readonly string[] = []): Promise<string | null> {
  try {
    return pickActiveProfile(await api.get<ActiveProfileResponse>('/api/profiles/active'), known);
  } catch {
    // the profile stays `default` until a bot is opened
    return null;
  }
}
