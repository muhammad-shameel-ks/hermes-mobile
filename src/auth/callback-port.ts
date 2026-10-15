/**
 * What the loopback capture receiver shares with its callers, kept apart from the listener itself so
 * the sign-in flow can name the port-busy failure without loading the native HTTP server.
 */

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
