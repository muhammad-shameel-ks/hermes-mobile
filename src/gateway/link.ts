/**
 * The phone's one gateway socket (issue "Connection model and credential storage").
 *
 * One JsonRpcGatewayClient lives as long as the signed-in session, so its seq
 * watermarks survive redials and the client replays what a drop missed. Each dial
 * mints a single-use ticket first; drops redial with full-jitter backoff that only
 * resets once a socket has stayed up; a 4401/4403 close, or a ticket the gateway
 * refuses, is terminal and goes back to sign-in. The socket is foreground-scoped:
 * `pause` closes it, `resume` dials again.
 */

import {
  JsonRpcGatewayClient,
  type ConnectionState,
  type GatewayEvent,
} from '../../vendor/hermes-shared/src/json-rpc-gateway.ts';
import { isStableOpen, reconnectBackoffDelayMs } from '../../vendor/hermes-shared/src/reconnect-backoff.ts';
import { ReauthRequiredError } from '../auth/session.ts';
import { ApiError } from './api.ts';
import { errorText } from './http.ts';

export type LinkState =
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'waiting'; attempt: number; retryAt: number; detail: string }
  | { kind: 'paused' }
  | { kind: 'unsupported'; detail: string }
  | { kind: 'signed-out'; detail: string };

export type LinkOptions = {
  /** a fresh `wss://…/api/ws?ticket=` URL; minted per dial */
  mintUrl: () => Promise<string>;
  onAuthRejected: (reason: string) => void;
  /** tests hand the real client a fake socket */
  socketFactory?: (url: string) => WebSocket;
  now?: () => number;
};

const AUTH_CLOSE_CODES = new Set([4401, 4403]);

export class GatewayLink {
  readonly client: JsonRpcGatewayClient;
  private state: LinkState = { kind: 'paused' };
  private readonly stateHandlers = new Set<(state: LinkState) => void>();
  private readonly openHandlers = new Set<() => void>();
  private readonly options: LinkOptions;
  private readonly now: () => number;
  private running = false;
  private dialing = false;
  private attempt = 0;
  private openedAt: number | null = null;
  private lastCloseCode: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LinkOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.client = new JsonRpcGatewayClient({
      socketFactory: options.socketFactory,
      onSocketClose: (event) => {
        this.lastCloseCode = event.code;
        return false;
      },
    });
    this.client.onState((state) => this.onClientState(state));
    this.client.on('gateway.ready', (event: GatewayEvent<'gateway.ready'>) => {
      const payload = event.payload as { session_authority?: unknown } | undefined;
      if (payload?.session_authority === true) {
        this.halt({
          kind: 'unsupported',
          detail: 'This gateway speaks the session-authority protocol, which the phone does not support yet.',
        });
      }
    });
  }

  get current(): LinkState {
    return this.state;
  }

  onState(handler: (state: LinkState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  /** runs after every successful open, the first and each redial */
  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  resume(): void {
    if (this.running || this.state.kind === 'signed-out' || this.state.kind === 'unsupported') return;
    this.running = true;
    this.attempt = 0;
    void this.dial();
  }

  /** dial now, skipping the rest of a backoff wait */
  retryNow(): void {
    if (!this.running || this.dialing || this.state.kind === 'open') return;
    this.clearTimer();
    void this.dial();
  }

  pause(): void {
    this.running = false;
    this.clearTimer();
    this.client.close();
    this.setState({ kind: 'paused' });
  }

  private halt(state: LinkState): void {
    this.running = false;
    this.clearTimer();
    this.client.close();
    this.setState(state);
  }

  private setState(next: LinkState): void {
    this.state = next;
    for (const handler of this.stateHandlers) handler(next);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async dial(): Promise<void> {
    if (!this.running || this.dialing) return;
    this.dialing = true;
    this.lastCloseCode = null;
    this.setState({ kind: 'connecting' });
    try {
      const url = await this.options.mintUrl();
      if (!this.running) return;
      await this.client.connect(url);
      if (!this.running) {
        this.client.close();
        return;
      }
      this.openedAt = this.now();
      this.setState({ kind: 'open' });
      for (const handler of this.openHandlers) handler();
    } catch (error) {
      if (!this.running) return;
      if (error instanceof ReauthRequiredError) {
        this.signOut(error.message);
        return;
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.signOut('The gateway refused a socket ticket for this sign-in.');
        return;
      }
      if (this.lastCloseCode !== null && AUTH_CLOSE_CODES.has(this.lastCloseCode)) {
        this.signOut(
          this.lastCloseCode === 4403
            ? 'The gateway refused the chat socket (chat disabled or origin rejected).'
            : 'The gateway rejected the socket credential.',
        );
        return;
      }
      this.scheduleRetry(errorText(error));
    } finally {
      this.dialing = false;
    }
  }

  private onClientState(state: ConnectionState): void {
    if (this.dialing || !this.running || this.state.kind !== 'open') return;
    if (state !== 'closed' && state !== 'error') return;
    if (this.lastCloseCode !== null && AUTH_CLOSE_CODES.has(this.lastCloseCode)) {
      this.signOut('The gateway closed the socket for authentication.');
      return;
    }
    if (isStableOpen(this.openedAt, this.now())) this.attempt = 0;
    this.scheduleRetry('The connection dropped.');
  }

  private scheduleRetry(detail: string): void {
    const delay = reconnectBackoffDelayMs(this.attempt);
    this.attempt += 1;
    this.setState({ kind: 'waiting', attempt: this.attempt, retryAt: this.now() + delay, detail });
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.dial();
    }, delay);
  }

  private signOut(detail: string): void {
    this.halt({ kind: 'signed-out', detail });
    this.options.onAuthRejected(detail);
  }
}

/** `https://host:443` + ticket → `wss://host:443/api/ws?ticket=…` */
export function gatewaySocketUrl(baseUrl: string, ticket: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`;
}
