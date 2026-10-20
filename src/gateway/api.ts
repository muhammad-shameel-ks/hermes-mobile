/**
 * The authenticated REST client. Every call carries the bearer, and a 401 follows
 * the connection model's policy: `session_expired` gets one refresh and one retry;
 * any other 401 hands the phone back to sign-in. The active profile rides as
 * `?profile=` on every call that takes one.
 */

import type { AuthSession } from '../auth/session.ts';
import { errorText, requestText, truncate } from './http.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} answered ${status}${body ? `: ${truncate(body, 160)}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class ApiUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export type CallOptions = { query?: Query; body?: unknown; timeoutMs?: number };

export type GatewayApi = {
  get: <T>(path: string, query?: Query) => Promise<T>;
  post: <T>(path: string, body?: unknown, query?: Query, options?: { timeoutMs?: number }) => Promise<T>;
  put: <T>(path: string, body?: unknown, query?: Query) => Promise<T>;
  patch: <T>(path: string, body?: unknown, query?: Query) => Promise<T>;
  del: <T>(path: string, query?: Query) => Promise<T>;
};

export function buildQuery(query: Query = {}): string {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function authReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; reason?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

export function createGatewayApi(auth: AuthSession, fetchImpl?: typeof fetch): GatewayApi {
  const send = async (method: string, path: string, token: string, options: CallOptions) => {
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await requestText(
        `${auth.baseUrl}${path}${buildQuery(options.query)}`,
        { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
        { timeoutMs: options.timeoutMs ?? 20000, fetchImpl },
      );
    } catch (error) {
      throw new ApiUnreachableError(errorText(error));
    }
  };

  const call = async <T>(method: string, path: string, options: CallOptions = {}): Promise<T> => {
    let result = await send(method, path, await auth.accessToken(), options);
    if (result.status === 401) {
      if (authReason(result.body) !== 'session_expired') auth.fail('The gateway no longer accepts this sign-in.');
      result = await send(method, path, await auth.refreshNow(), options);
      if (result.status === 401) auth.fail('The gateway no longer accepts this sign-in.');
    }
    if (result.status < 200 || result.status >= 300) throw new ApiError(method, path, result.status, result.body);
    if (result.body.trim() === '') return undefined as T;
    try {
      return JSON.parse(result.body) as T;
    } catch {
      throw new ApiError(method, path, result.status, 'the answer was not JSON');
    }
  };

  return {
    get: (path, query) => call('GET', path, { query }),
    post: (path, body, query, options) => call('POST', path, { body: body ?? {}, query, timeoutMs: options?.timeoutMs }),
    put: (path, body, query) => call('PUT', path, { body, query }),
    patch: (path, body, query) => call('PATCH', path, { body, query }),
    del: (path, query) => call('DELETE', path, { query }),
  };
}
