/**
 * The REST half of a session row's long-press actions: pin, rename, archive and
 * delete, as the desktop sends them (apps/desktop/src/api/sessions.ts
 * `mutateSessionHttp`). Every write is fenced: read the session's mutation
 * snapshot, then send the edit with the snapshot's request id and revision. An
 * older gateway without the snapshot route keeps the plain write.
 */

import { createSessionMutationClient, type SessionMutationIdentity, type SessionMutationSnapshot } from '../../vendor/hermes-shared/src/session-http-mutations.ts';
import type { GatewayApi, Query } from '../gateway/api.ts';

type Method = 'PATCH' | 'DELETE';

/** desktop lib/gateway-rpc.ts `isUnroutedRestPath`: the route is absent, not the session */
function isUnroutedRestPath(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such api endpoint|endpoint is likely missing/i.test(message) || /404:.*headless backend \(hermes serve\): web ui disabled/i.test(message);
}

class MissingSnapshotRoute extends Error {}

export type SessionActionsApi = Pick<GatewayApi, 'get' | 'patch' | 'del'>;

export function createSessionActions(api: SessionActionsApi) {
  const run = createSessionMutationClient();

  const mutate = <T>(id: string, method: Method, payload: Record<string, unknown>, profile: string | null | undefined): Promise<T> => {
    const scope = (profile ?? '').trim();
    const path = `/api/sessions/${encodeURIComponent(id)}`;
    const query: Query = scope ? { profile: scope } : {};

    const send = (identity: Partial<SessionMutationIdentity>) =>
      method === 'DELETE'
        ? api.del<T>(path, { ...query, ...identity })
        : api.patch<T>(path, { ...payload, ...identity, ...(scope ? { profile: scope } : {}) });

    const read = () =>
      api.get<SessionMutationSnapshot>(`${path}/mutation-snapshot`, query).catch((error: unknown) => {
        if (isUnroutedRestPath(error)) throw new MissingSnapshotRoute(String(error));
        throw error;
      });

    const key = JSON.stringify([scope, id, method, payload]);
    return run<T>(key, read, send).catch((error: unknown) => {
      if (!(error instanceof MissingSnapshotRoute)) throw error;
      return send({});
    });
  };

  return {
    setPinned: (id: string, pinned: boolean, profile?: string | null) => mutate<{ ok: boolean }>(id, 'PATCH', { pinned }, profile),
    setArchived: (id: string, archived: boolean, profile?: string | null) => mutate<{ ok: boolean }>(id, 'PATCH', { archived }, profile),
    rename: (id: string, title: string, profile?: string | null) => mutate<{ ok: boolean; title: string }>(id, 'PATCH', { title }, profile),
    remove: (id: string, profile?: string | null) => mutate<{ ok: boolean }>(id, 'DELETE', {}, profile),
  };
}

export type SessionActions = ReturnType<typeof createSessionActions>;

/** desktop `row.deleteDesc` */
export const deleteSessionDescription = (title: string) => `This will permanently delete “${title}”. This cannot be undone.`;
