/**
 * The native PKCE flow, desktop parity: system browser to /auth/native/authorize,
 * the app's loopback listener captures ?code=&state=, the code is redeemed at
 * /auth/native/token with the verifier (JSON only - form bodies are 422).
 * Refresh is a single attempt; the gate never rotates bearers by itself.
 */

import { AppState } from 'react-native';

import { errorText, HttpTimeoutError, postJson, truncate, type HttpResult } from '../gateway/http.ts';
import { CallbackPortBusyError, type CallbackCode, type CallbackListener } from './callback-port.ts';
import { ForegroundAbortedError, waitForForeground } from './foreground.ts';
import { authorizeUrl, computeCodeChallenge, createCodeVerifier, createState } from './pkce.ts';
import { parseTokenPayload, type Credentials } from './tokens.ts';

export const GRANT_TIMEOUT_MS = 180_000;
export const TOKEN_TIMEOUT_MS = 15000;
export const EXCHANGE_RETRY_DELAY_MS = 1000;

export type SignInFailure =
  | 'callback-port-busy'
  | 'state-mismatch'
  | 'exchange-failed'
  | 'grant-timeout'
  | 'cancelled'
  | 'unreachable'
  | 'unexpected';

export type SignInResult =
  | { kind: 'signed-in'; credentials: Credentials }
  | { kind: 'failed'; reason: SignInFailure; detail: string };

export type RefreshResult =
  | { kind: 'refreshed'; credentials: Credentials }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; detail: string };

class CancelledError extends Error {}
class GrantTimeoutError extends Error {}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GrantTimeoutError()), timeoutMs);
    const onAbort = () => reject(new CancelledError());
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        finish();
        reject(new CancelledError());
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error instanceof Error ? error : new Error(errorText(error)));
      },
    );
  });
}

/**
 * Redeems the code, retrying once on a network failure: the network can lag
 * for a moment after the app returns to the foreground. A timeout is final.
 */
async function exchangeCode(url: string, payload: unknown, signal?: AbortSignal): Promise<HttpResult> {
  try {
    return await postJson(url, payload, { timeoutMs: TOKEN_TIMEOUT_MS, signal });
  } catch (error) {
    if (error instanceof HttpTimeoutError || signal?.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, EXCHANGE_RETRY_DELAY_MS));
    if (signal?.aborted) throw new CancelledError();
    return postJson(url, payload, { timeoutMs: TOKEN_TIMEOUT_MS, signal });
  }
}

export async function signIn(baseUrl: string, signal?: AbortSignal): Promise<SignInResult> {
  let listener: CallbackListener | null = null;
  try {
    // only a sign-in needs the browser and the native loopback server; a silent refresh at launch must not load them
    const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');
    const { listenForCallback } = require('./callback-server.ts') as typeof import('./callback-server.ts');
    const verifier = createCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    const state = createState();
    const arrived = deferred<CallbackCode>();
    listener = await listenForCallback(arrived.resolve);
    await WebBrowser.openBrowserAsync(authorizeUrl(baseUrl, challenge, state));
    const callback = await withDeadline(arrived.promise, GRANT_TIMEOUT_MS, signal);
    if (callback.state !== state) {
      return { kind: 'failed', reason: 'state-mismatch', detail: 'the redirect carried an unexpected state value' };
    }
    // The callback arrives while the browser is still in front; a background
    // app's requests are blocked on Android, so redeem only once the user is back.
    await waitForForeground(AppState, signal);
    let exchanged: HttpResult;
    try {
      exchanged = await exchangeCode(
        `${baseUrl}/auth/native/token`,
        { code: callback.code, code_verifier: verifier },
        signal,
      );
    } catch (error) {
      if (signal?.aborted) return { kind: 'failed', reason: 'cancelled', detail: '' };
      const detail = error instanceof HttpTimeoutError ? error.message : errorText(error);
      return { kind: 'failed', reason: 'unreachable', detail };
    }
    const credentials = parseTokenPayload(exchanged.body);
    if (exchanged.status !== 200 || credentials === null) {
      return { kind: 'failed', reason: 'exchange-failed', detail: `${exchanged.status} ${truncate(exchanged.body)}` };
    }
    return { kind: 'signed-in', credentials };
  } catch (error) {
    if (error instanceof CallbackPortBusyError) {
      return { kind: 'failed', reason: 'callback-port-busy', detail: error.message };
    }
    if (error instanceof GrantTimeoutError) {
      return { kind: 'failed', reason: 'grant-timeout', detail: 'the browser never returned a code' };
    }
    if (error instanceof CancelledError || error instanceof ForegroundAbortedError) {
      return { kind: 'failed', reason: 'cancelled', detail: '' };
    }
    return { kind: 'failed', reason: 'unexpected', detail: errorText(error) };
  } finally {
    if (listener) {
      try {
        await listener.stop();
      } catch {
        // Teardown is best effort; the port frees when the app process ends.
      }
    }
  }
}

/** One silent attempt. 401 means sign in again; 503 means the provider is unreachable. */
export async function refreshCredentials(baseUrl: string, refreshToken: string): Promise<RefreshResult> {
  try {
    const result = await postJson(
      `${baseUrl}/auth/native/refresh`,
      { refresh_token: refreshToken, provider: '' },
      { timeoutMs: TOKEN_TIMEOUT_MS },
    );
    if (result.status === 200) {
      const credentials = parseTokenPayload(result.body);
      return credentials ? { kind: 'refreshed', credentials } : { kind: 'failed', detail: truncate(result.body) };
    }
    if (result.status === 401) return { kind: 'expired' };
    if (result.status === 503) return { kind: 'unavailable' };
    return { kind: 'failed', detail: `${result.status} ${truncate(result.body)}` };
  } catch (error) {
    return { kind: 'failed', detail: errorText(error) };
  }
}
