/**
 * The one HTTP helper the pre-auth screens need: a text request with a deadline.
 * Anything richer arrives with the gateway client proper.
 */

export type HttpResult = { status: number; body: string };

export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`${url} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'HttpTimeoutError';
  }
}

export type RequestOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** the caller's cancellation; an abort through it is never reported as a timeout */
  signal?: AbortSignal;
};

export async function requestText(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<HttpResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onCallerAbort);
  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    if (timedOut) throw new HttpTimeoutError(url, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

export function postJson(url: string, payload: unknown, options: RequestOptions = {}): Promise<HttpResult> {
  return requestText(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

export function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
