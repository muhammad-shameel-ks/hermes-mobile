/**
 * The signed-in session's REST reach for the Files, Review and Kanban surfaces. Their
 * entry points (`openFiles`, `openPreview`, `openReview`, `openKanban`) are called from the
 * drawer and from transcript cards that hold no client, so SignedInApp binds the
 * session's client here once per sign-in and the screens read it back.
 */

import type { AuthSession } from '../auth/session.ts';
import type { GatewayApi } from '../gateway/api.ts';

export type GatewayBinding = {
  auth: AuthSession;
  api: GatewayApi;
  /** the active profile, named on the `/api/fs` calls that take one */
  profile: () => string;
};

let bound: GatewayBinding | null = null;

export function bindGateway(binding: GatewayBinding): void {
  bound = binding;
}

export function gateway(): GatewayBinding {
  if (!bound) throw new Error('The Files, Review and Kanban surfaces need a signed-in gateway.');
  return bound;
}
