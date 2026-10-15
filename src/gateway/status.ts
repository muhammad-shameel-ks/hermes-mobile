/**
 * The capability probe the connect screen runs before offering sign-in.
 *
 * `GET /api/status` is public by design - it is the only readiness probe a
 * pre-auth client has - and the app requires `native_pkce` in `auth_flows`
 * (issue "Connection model and credential storage"). A gateway that does not
 * advertise it gets an explicit unsupported state, never a password form.
 */

import { errorText, HttpTimeoutError, requestText, truncate } from './http.ts';

export type GatewayStatus = {
  version: string | null;
  authRequired: boolean | null;
  authFlows: string[];
  authProviders: string[];
};

export type GatewayProbe =
  | { kind: 'ok'; status: GatewayStatus }
  | { kind: 'no-auth-gate'; status: GatewayStatus }
  | { kind: 'unsupported'; status: GatewayStatus }
  | { kind: 'not-hermes'; httpStatus: number; detail: string }
  | { kind: 'http-error'; httpStatus: number; detail: string }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'timeout' };

export const PROBE_TIMEOUT_MS = 8000;

function asRecord(parsed: unknown): Record<string, unknown> | null {
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function classifyStatusResponse(httpStatus: number, bodyText: string): GatewayProbe {
  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: 'http-error', httpStatus, detail: truncate(bodyText) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { kind: 'not-hermes', httpStatus, detail: 'the answer was not JSON' };
  }
  const record = asRecord(parsed);
  const version = record && typeof record.version === 'string' ? record.version : null;
  if (!record || version === null) {
    return { kind: 'not-hermes', httpStatus, detail: 'the answer carried no Hermes version' };
  }
  const status: GatewayStatus = {
    version,
    authRequired: typeof record.auth_required === 'boolean' ? record.auth_required : null,
    authFlows: stringList(record.auth_flows),
    authProviders: stringList(record.auth_providers),
  };
  if (status.authFlows.includes('native_pkce')) return { kind: 'ok', status };
  if (status.authRequired === false) return { kind: 'no-auth-gate', status };
  return { kind: 'unsupported', status };
}

export type ProbeOptions = { timeoutMs?: number; fetchImpl?: typeof fetch; signal?: AbortSignal };

export async function probeGateway(baseUrl: string, options: ProbeOptions = {}): Promise<GatewayProbe> {
  try {
    const result = await requestText(
      `${baseUrl}/api/status`,
      { headers: { Accept: 'application/json' } },
      { timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS, fetchImpl: options.fetchImpl, signal: options.signal },
    );
    return classifyStatusResponse(result.status, result.body);
  } catch (error) {
    if (error instanceof HttpTimeoutError) return { kind: 'timeout' };
    return { kind: 'unreachable', detail: errorText(error) };
  }
}
