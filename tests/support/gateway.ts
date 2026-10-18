import { ChatController } from '../../src/chat/controller.ts';
import type { GatewayApi } from '../../src/gateway/api.ts';
import { GatewayLink } from '../../src/gateway/link.ts';
import type { Persistence } from '../../src/store/index.ts';

type Handler = (params: Record<string, unknown>) => unknown;

/** A scripted gateway on the far side of a fake socket: answers RPCs and pushes events. */
export class FakeGateway extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers: Record<string, Handler> = {};
  send(text: string) {
    const frame = JSON.parse(text) as { id?: string; method?: string; params?: Record<string, unknown> };
    if (!frame.method) return;
    this.calls.push({ method: frame.method, params: frame.params ?? {} });
    const handler = this.handlers[frame.method];
    queueMicrotask(() => {
      try {
        this.push({ jsonrpc: '2.0', id: frame.id, result: handler ? handler(frame.params ?? {}) : {} });
      } catch (error) {
        this.push({ jsonrpc: '2.0', id: frame.id, error: { code: 4000, message: (error as Error).message } });
      }
    });
  }
  push(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }));
  }
  event(type: string, sessionId: string, payload: unknown = {}) {
    this.push({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sessionId, payload } });
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: '' }));
  }
}

export const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** a controller over a fake socket and a scripted REST client */
export async function rig(get: (path: string, query: Record<string, unknown>) => unknown | Promise<unknown>, persistence: Persistence | null = null) {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info: {} });
  const api: GatewayApi = {
    get: async <T>(path: string, query: Record<string, unknown> = {}) => (path.startsWith('/api/sessions/') ? ((await get(path, query)) as T) : ({ sessions: [] } as T)),
    post: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    del: async <T>() => ({}) as T,
  };
  const link = new GatewayLink({
    mintUrl: async () => 'wss://gw/api/ws?ticket=t',
    onAuthRejected: () => undefined,
    socketFactory: () => gateway as unknown as WebSocket,
  });
  const controller = new ChatController(link, api, 'default', persistence);
  controller.start();
  await flush();
  gateway.open();
  await flush();
  return { gateway, link, controller, snap: () => controller.getSnapshot() };
}
