/**
 * Read-aloud on the device's own speech engine (issue "Transcript and composer
 * parity on touch"): start and stop only, since Android's engine has no pause,
 * and one playback at a time as on the desktop. The action bar calls `readAloud`
 * with a reply's text; this strips the markdown, cuts the text at the engine's
 * input cap and speaks the pieces in turn.
 *
 * Availability is probed optimistically - `getAvailableVoicesAsync()` is
 * unreliable on Android - so a `speak()` that fails before any audio starts marks
 * the engine unavailable and the control hides (`useReadAloud().available`).
 */

import { useSyncExternalStore } from 'react';
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

/** Reads `text` aloud; resolves when playback ends or is stopped, rejects when the engine fails. Ignored while anything is already playing. */
export function readAloud(text: string, id: string | null = null): Promise<void> {
  const pieces = splitForSpeech(sanitizeTextForSpeech(text), Speech.maxSpeechInputLength);
  if (pieces.length === 0 || state.status !== 'idle') return Promise.resolve();
  const token = ++run;
  set({ status: 'preparing', id });
  return new Promise<void>((resolve, reject) => {
    let started = false;
    const end = (error?: Error) => {
      if (token !== run) return;
      run++;
      settleActive = null;
      set({ status: 'idle', id: null, ...(error && !started ? { available: false } : {}) });
      if (error) reject(error);
      else resolve();
    };
    settleActive = end;
    const speak = (index: number) => {
      try {
        Speech.speak(pieces[index], {
          onStart: () => {
            if (token !== run) return;
            started = true;
            set({ status: 'speaking' });
          },
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
  });
}

export function stopReadAloud(): void {
  if (state.status === 'idle') return;
  const settle = settleActive;
  void Speech.stop().catch(() => undefined);
  settle?.();
}

export function useReadAloud(): ReadAloudState & { speaking: boolean } {
  const current = useSyncExternalStore(subscribe, () => state);
  return { ...current, speaking: current.status === 'speaking' };
}
