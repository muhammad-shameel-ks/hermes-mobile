/**
 * Read-aloud (issue "Transcript and composer parity on touch"): start and stop
 * only, and one playback at a time as on the desktop. The action bar calls
 * `readAloud` with a reply's text; this strips the markdown and speaks it.
 *
 * With a `synthesize` (the desktop's lib/voice-playback.ts data-URL rung) the
 * profile's own `tts.provider` voices it: `POST /api/audio/speak` per piece, the
 * next piece synthesized while this one plays. When that fails before any audio
 * plays - the gateway unreachable, the provider refusing - the phone's engine
 * reads it instead and `onFallback` says why.
 *
 * Without one, the device's engine cuts the text at its input cap and speaks the
 * pieces in turn. Its availability is probed optimistically -
 * `getAvailableVoicesAsync()` is unreliable on Android - so a `speak()` that
 * fails before any audio starts marks it unavailable and the control hides
 * (`useReadAloud().available`).
 */

import { useSyncExternalStore } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { sanitizeTextForSpeech, splitForSpeech } from './speechText.ts';

export type ReadAloudStatus = 'idle' | 'preparing' | 'speaking';

export type ReadAloudState = {
  status: ReadAloudStatus;
  /** the caller's id for what is being read, so a reply's bar can tell its own playback */
  id: string | null;
  available: boolean;
};

let state: ReadAloudState = { status: 'idle', id: null, available: true };
const listeners = new Set<() => void>();
let run = 0;
let settleActive: ((error?: Error) => void) | null = null;

function set(patch: Partial<ReadAloudState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** one clip from the profile's TTS provider, as `POST /api/audio/speak` returns it */
export type SpokenClip = { dataUrl: string; mimeType: string };
export type Synthesize = (text: string) => Promise<SpokenClip>;
export type ReadAloudOptions = { synthesize?: Synthesize | null; onFallback?: (error: Error) => void };

/** short enough that the first words play soon, long enough that a provider's prosody spans a few sentences */
const GATEWAY_PIECE_CHARS = 600;
/** desktop PLAYBACK_STALL_MS: a clip that never starts or stops progressing ends the read */
const STALL_MS = 15_000;
const CLIP_EXTENSIONS: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac' };

let stopClip: (() => void) | null = null;

function playClip({ dataUrl, mimeType }: SpokenClip, name: string, onPlaying: () => void): Promise<void> {
  const extension = CLIP_EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()] ?? 'mp3';
  const file = new File(Paths.cache, `read-aloud-${name}.${extension}`);
  file.write(dataUrl.slice(dataUrl.indexOf(',') + 1), { encoding: 'base64' });
  const player = createAudioPlayer({ uri: file.uri });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(stall);
      stopClip = null;
      subscription.remove();
      player.remove();
      try {
        file.delete();
      } catch {}
      if (error) reject(error);
      else resolve();
    };
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => done(new Error('Playback stalled.')), STALL_MS);
    };
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.error) done(new Error(status.error));
      else if (status.didJustFinish) done();
      else if (status.playing) {
        onPlaying();
        arm();
      }
    });
    stopClip = () => {
      player.pause();
      done();
    };
    arm();
    player.play();
  });
}

async function playOnGateway(text: string, synthesize: Synthesize, token: number, onPlaying: () => void): Promise<void> {
  const pieces = splitForSpeech(text, GATEWAY_PIECE_CHARS);
  await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  const stamp = Date.now();
  let next = synthesize(pieces[0]);
  for (let index = 0; index < pieces.length; index++) {
    const clip = await next;
    if (token !== run) return;
    if (index + 1 < pieces.length) {
      next = synthesize(pieces[index + 1]);
      next.catch(() => undefined);
    }
    await playClip(clip, `${stamp}-${index}`, onPlaying);
    if (token !== run) return;
  }
}

/** Reads `text` aloud; resolves when playback ends or is stopped, rejects when the engine fails. Ignored while anything is already playing. */
export function readAloud(text: string, id: string | null = null, options: ReadAloudOptions = {}): Promise<void> {
  const speakable = sanitizeTextForSpeech(text).trim();
  if (speakable === '' || state.status !== 'idle') return Promise.resolve();
  const token = ++run;
  set({ status: 'preparing', id });
  return new Promise<void>((resolve, reject) => {
    let started = false;
    let device = false;
    const end = (error?: Error) => {
      if (token !== run) return;
      run++;
      settleActive = null;
      set({ status: 'idle', id: null, ...(error && !started && device ? { available: false } : {}) });
      if (error) reject(error);
      else resolve();
    };
    settleActive = end;
    const playing = () => {
      if (token !== run || started) return;
      started = true;
      set({ status: 'speaking' });
    };
    const speakOnDevice = () => {
      device = true;
      const pieces = splitForSpeech(speakable, Speech.maxSpeechInputLength);
      const speak = (index: number) => {
        try {
          Speech.speak(pieces[index], {
            onStart: playing,
            onDone: () => {
              if (token !== run) return;
              if (index + 1 < pieces.length) speak(index + 1);
              else end();
            },
            onStopped: () => end(),
            onError: (error) => end(error),
          });
        } catch (error) {
          end(error instanceof Error ? error : new Error(String(error)));
        }
      };
      speak(0);
    };
    const { synthesize, onFallback } = options;
    if (!synthesize) return speakOnDevice();
    playOnGateway(speakable, synthesize, token, playing).then(
      () => end(),
      (error: unknown) => {
        if (token !== run) return;
        const failure = error instanceof Error ? error : new Error(String(error));
        if (started) return end(failure);
        onFallback?.(failure);
        speakOnDevice();
      },
    );
  });
}

export function stopReadAloud(): void {
  if (state.status === 'idle') return;
  const settle = settleActive;
  stopClip?.();
  void Speech.stop().catch(() => undefined);
  settle?.();
}

export const subscribeReadAloud = subscribe;
export const readAloudState = () => state;

export function useReadAloud(): ReadAloudState & { speaking: boolean } {
  const current = useSyncExternalStore(subscribe, () => state);
  return { ...current, speaking: current.status === 'speaking' };
}
