/**
 * The profile's speech-to-text choice for the composer's mic: read once from
 * `GET /api/config` when the profile changes and kept in the per-profile cache
 * Settings → Voice writes through, so the next take follows a change made there.
 * Until the config answers (or if it never does) dictation stays on the device.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { GatewayApi } from '../gateway/api.ts';
import type { ConfigRecord } from '../settings/safety.ts';
import { readVoice, rememberVoice, subscribeSttSettings, sttSettingsFor, type SttSettings } from '../settings/voice.ts';
import type { Transcribe } from './dictation.ts';

const FALLBACK: SttSettings = { engine: 'device', maxSeconds: null };

export function useSttSettings(api: GatewayApi, profile: string): SttSettings & { transcribe: Transcribe } {
  const settings = useSyncExternalStore(subscribeSttSettings, () => sttSettingsFor(profile)) ?? FALLBACK;

  useEffect(() => {
    let live = true;
    api
      .get<ConfigRecord>('/api/config', { profile })
      .then((config) => {
        if (live) rememberVoice(profile, readVoice(config ?? {}));
      })
      .catch(() => {});
    return () => void (live = false);
  }, [api, profile]);

  const transcribe = useCallback<Transcribe>(
    async (dataUrl, mimeType, timeoutMs) => {
      const result = await api.post<{ transcript?: string }>('/api/audio/transcribe', { data_url: dataUrl, mime_type: mimeType }, { profile }, { timeoutMs });
      return result?.transcript ?? '';
    },
    [api, profile],
  );

  return { ...settings, transcribe };
}
