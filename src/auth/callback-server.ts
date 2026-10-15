/**
 * The loopback capture receiver: an in-process HTTP listener on the phone's own
 * 127.0.0.1, at the fixed port the redirect URI names. A bind failure is the
 * named CallbackPortBusy state - the app must not open a browser that has
 * nothing to return to.
 */

import { HttpServer } from 'react-native-nitro-http-server';

export const CALLBACK_PORT = 9527;

export type CallbackCode = { code: string; state: string };

export type CallbackListener = { port: number; stop: () => Promise<void> };

export class CallbackPortBusyError extends Error {
  constructor(port: number, cause: unknown) {
    super(`127.0.0.1:${port} is already in use`);
    this.name = 'CallbackPortBusyError';
    this.cause = cause;
  }
}

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:ui-monospace,monospace;background:#0d1015;color:#e6edf3;padding:32px"><h1 style="font-size:18px">${title}</h1><p>${body}</p></body></html>`;
}

export async function listenForCallback(onCode: (callback: CallbackCode) => void): Promise<CallbackListener> {
  const server = new HttpServer();
  let bound: number;
  try {
    bound = await server.start(
      CALLBACK_PORT,
      (request) => {
        const path = typeof request.path === 'string' ? request.path : '';
        const queryAt = path.indexOf('?');
        const params = new URLSearchParams(queryAt === -1 ? '' : path.slice(queryAt + 1));
        const code = params.get('code') ?? '';
        if (code === '') {
          return { statusCode: 400, headers: HEADERS, body: page('Hermes', 'No authorization code in this request.') };
        }
        onCode({ code, state: params.get('state') ?? '' });
        return { statusCode: 200, headers: HEADERS, body: page('Hermes', 'Almost done — return to the app to finish signing in.') };
      },
      { host: '127.0.0.1' },
    );
  } catch (error) {
    throw new CallbackPortBusyError(CALLBACK_PORT, error);
  }
  if (bound !== CALLBACK_PORT) {
    // The server picked another port, which the fixed redirect URI cannot reach.
    await server.stop().catch(() => undefined);
    throw new CallbackPortBusyError(CALLBACK_PORT, new Error(`listener bound ${bound} instead`));
  }
  return {
    port: bound,
    stop: async () => {
      await server.stop();
    },
  };
}
