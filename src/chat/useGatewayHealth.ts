/**
 * The data behind the status row's Backend item (desktop app/shell/hooks/use-status-snapshot.ts):
 * `GET /api/status` for the messaging platforms, `setup.status` + `setup.runtime_check`
 * over the socket for inference readiness, and the restart in flight.
 *
 * Status refreshes on every open and each minute while the app is in the foreground
 * (a paused link is the background); readiness rides the open and the minute tick only
 * while no verdict exists yet. A transport fallback never replaces a real verdict,
 * so a flap does not flash "Inference not ready".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errorText } from '../gateway/http.ts';
import type { LinkState } from '../gateway/link.ts';
import {
  awaitRestart,
  COPY,
  fetchReadiness,
  gatewayHealth,
  parseGatewayStatus,
  RESTART_ACTION,
  sharedProfiles,
  type ActionStatus,
  type GatewayHealth,
  type GatewayStatus,
  type Readiness,
} from './backendHealth.ts';
import type { ChatController } from './controller.ts';

const REFRESH_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type GatewayHealthModel = {
  health: GatewayHealth;
  status: GatewayStatus | null;
  inference: Readiness | null;
  /** re-reads status and, with the socket open, readiness */
  refresh: () => Promise<void>;
  /** the profiles a restart would take down together, when the gateway is shared */
  shared: string[] | null;
  restart: () => Promise<void>;
};

export function useGatewayHealth(controller: ChatController, link: LinkState, profile: string, enabled: boolean): GatewayHealthModel {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [inference, setInference] = useState<Readiness | null>(null);
  const [restarting, setRestarting] = useState(false);
  const open = link.kind === 'open';
  const paused = link.kind === 'paused';
  const answered = useRef(false);
  const live = useRef(true);
  const scope = useRef(profile);
  scope.current = profile;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // status and readiness belong to one profile: a switch clears the old answer
  useEffect(() => {
    answered.current = false;
    setStatus(null);
    setInference(null);
  }, [profile]);
  useEffect(() => {
    if (!open) {
      answered.current = false;
      setInference(null);
    }
  }, [open]);

  const refresh = useCallback(
    async (readiness = true) => {
      const asked = scope.current;
      const legs: Array<Promise<void>> = [
        controller.api
          .get<unknown>('/api/status', { profile: asked })
          .then((raw) => {
            const next = parseGatewayStatus(raw);
            if (next && live.current && scope.current === asked) setStatus((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
          })
          .catch(() => undefined),
      ];
      if (readiness && open) {
        legs.push(
          fetchReadiness((method, params) => controller.rpc(method, params as never), asked)
            .then((next) => {
              if (next.source === 'fallback' || !live.current || scope.current !== asked) return;
              answered.current = true;
              setInference(next);
            })
            .catch(() => undefined),
        );
      }
      await Promise.all(legs);
    },
    [controller, open],
  );

  useEffect(() => {
    if (!enabled || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (readiness: boolean) => {
      await refresh(readiness);
      if (!cancelled) timer = setTimeout(() => void tick(!answered.current), REFRESH_MS);
    };
    void tick(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, paused, open, profile, refresh]);

  const restart = useCallback(async () => {
    const asked = scope.current;
    setRestarting(true);
    try {
      const shared = sharedProfiles(status);
      await controller.api.post('/api/gateway/restart', {}, { profile: asked });
      await awaitRestart(() => controller.api.get<ActionStatus>(`/api/actions/${RESTART_ACTION}/status`, { lines: 200, profile: asked }), sleep);
      if (shared) controller.notify(COPY.sharedGatewayRestarted(shared.length));
    } catch (error) {
      const detail = errorText(error);
      controller.notify(detail.startsWith(COPY.gatewayRestartFailed) ? detail : `${COPY.gatewayRestartFailed} ${detail}`.trim());
    } finally {
      if (live.current) setRestarting(false);
      // the restart may have taken this socket down; redialling is a no-op while it is still open
      controller.retryLink();
      void refresh();
    }
  }, [controller, refresh, status]);

  const health = useMemo(() => gatewayHealth({ link, inference, status, restarting }), [link, inference, status, restarting]);
  const shared = useMemo(() => sharedProfiles(status), [status]);
  return { health, status, inference, refresh: () => refresh(true), shared, restart };
}
