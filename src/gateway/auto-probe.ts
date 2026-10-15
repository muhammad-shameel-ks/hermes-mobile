/**
 * Validates the connect screen's address as the reader types, so there is no
 * "Check" step between typing an address and seeing the Sign in button.
 *
 * Every edit withdraws the previous verdict at once - a Sign in button must never
 * outlive the address it was earned for - then waits for a pause in typing before
 * parsing and probing. Each new edit aborts the probe in flight, and a result that
 * arrives for an address the reader has since left is dropped. An edit that
 * resolves to the base URL already probed (a trailing slash, an explicit default
 * port) keeps the standing verdict rather than probing again.
 */

import { parseGatewayAddress, type GatewayAddress } from './address.ts';
import type { GatewayProbe } from './status.ts';

export type AutoProbeState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'probing'; address: GatewayAddress }
  | { kind: 'probed'; address: GatewayAddress; probe: GatewayProbe };

export const TYPING_PAUSE_MS = 600;

export type AutoProbeOptions = {
  probe: (baseUrl: string, signal: AbortSignal) => Promise<GatewayProbe>;
  onChange: (state: AutoProbeState) => void;
  pauseMs?: number;
};

export type AutoProbe = {
  /** feed the field's text; `immediate` skips the typing pause (restore, return key) */
  input: (raw: string, options?: { immediate?: boolean }) => void;
  /** probe the last address again, e.g. after starting the gateway */
  retry: () => void;
  dispose: () => void;
};

export function createAutoProbe({ probe, onChange, pauseMs = TYPING_PAUSE_MS }: AutoProbeOptions): AutoProbe {
  let state: AutoProbeState = { kind: 'idle' };
  let raw = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let disposed = false;

  const emit = (next: AutoProbeState) => {
    state = next;
    onChange(next);
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
  };

  const run = () => {
    timer = null;
    const parsed = parseGatewayAddress(raw);
    if (!parsed.ok) {
      emit({ kind: 'invalid', reason: parsed.reason });
      return;
    }
    const { address } = parsed;
    const controller = new AbortController();
    inFlight = controller;
    emit({ kind: 'probing', address });
    void probe(address.baseUrl, controller.signal).then(
      (result) => {
        if (disposed || inFlight !== controller) return;
        inFlight = null;
        emit({ kind: 'probed', address, probe: result });
      },
      (error: unknown) => {
        if (disposed || inFlight !== controller) return;
        inFlight = null;
        const detail = error instanceof Error ? error.message : String(error);
        emit({ kind: 'probed', address, probe: { kind: 'unreachable', detail } });
      },
    );
  };

  const schedule = (immediate: boolean) => {
    if (immediate) run();
    else timer = setTimeout(run, pauseMs);
  };

  return {
    input(text, options = {}) {
      if (disposed) return;
      raw = text;
      const immediate = options.immediate ?? false;

      if (raw.trim() === '') {
        cancel();
        if (state.kind !== 'idle') emit({ kind: 'idle' });
        return;
      }

      const parsed = parseGatewayAddress(raw);
      const standing = state.kind === 'probing' || state.kind === 'probed' ? state.address.baseUrl : null;
      if (parsed.ok && parsed.address.baseUrl === standing && timer === null) return;

      cancel();
      if (state.kind !== 'pending' && !immediate) emit({ kind: 'pending' });
      schedule(immediate);
    },
    retry() {
      if (disposed || raw.trim() === '') return;
      cancel();
      run();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
