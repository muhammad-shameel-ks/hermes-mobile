/**
 * The signed-in stack - credential holder, REST client, socket link and chat controller - built once
 * per sign-in and shared by the app and the assistant card (see `controllerHost.ts`), plus the boot
 * restore both of them start from.
 */

import { refreshCredentials } from '../auth/native-flow.ts';
import { createAuthSession } from '../auth/session.ts';
import { loadConnection, loadCredentials, saveCredentials, type SavedConnection } from '../auth/store.ts';
import { isStale, nowSeconds, type Credentials } from '../auth/tokens.ts';
import { setCardEnv } from '../chat/cards/env.ts';
import { ChatController } from '../chat/controller.ts';
import { createMediaResolver } from '../chat/mediaResolver.ts';
import { bindGateway } from '../files/gateway.ts';
import { createGatewayApi } from '../gateway/api.ts';
import { gatewaySocketUrl, GatewayLink } from '../gateway/link.ts';
import { probeGateway } from '../gateway/status.ts';
import { createPersistence } from '../store/index.ts';
import { restoreSession } from './boot-state.ts';
import { createControllerHost, type Hosted } from './controllerHost.ts';

/** long enough to open the app from the card (or the card from the app) on the same socket */
const RELEASE_GRACE_MS = 60_000;

const host = createControllerHost<ChatController>({
  idle: (controller) => controller.pause(),
  dispose: (controller) => controller.dispose(),
  graceMs: RELEASE_GRACE_MS,
  setTimer: setTimeout,
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

/** the connection's stack; credentials refresh inside its auth session afterwards */
export function signedInStack(connection: SavedConnection, credentials: Credentials): Hosted<ChatController> {
  return host.get(connection.id, (onReauthRequired) => {
    const auth = createAuthSession({
      baseUrl: connection.baseUrl,
      credentials,
      refresh: refreshCredentials,
      persist: (next) => saveCredentials(connection.id, next),
      onReauthRequired,
    });
    const api = createGatewayApi(auth);
    const link = new GatewayLink({
      mintUrl: async () => {
        const { ticket } = await api.post<{ ticket: string }>('/api/auth/ws-ticket');
        return gatewaySocketUrl(connection.baseUrl, ticket);
      },
      onAuthRejected: onReauthRequired,
    });
    setCardEnv({ media: createMediaResolver(auth, api) });
    const controller = new ChatController(link, api, undefined, createPersistence(connection.id));
    bindGateway({ auth, api, profile: () => controller.getSnapshot().profile });
    return controller;
  });
}

/** the stack already running in this process, if any: the card opens on it without a restore */
export const runningStack = (): Hosted<ChatController> | null => host.current();

/** the connection's credentials were cleared (sign-out, reauth): its stack is never handed out again */
export const endSignedIn = (connectionId: string): void => host.end(connectionId);

export const restore = () =>
  restoreSession({ loadConnection, loadCredentials, saveCredentials, refreshCredentials, probeGateway, isStale, nowSeconds });
