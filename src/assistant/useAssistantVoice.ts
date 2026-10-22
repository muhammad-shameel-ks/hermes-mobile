/**
 * The card's ear. Unlike the composer's dictation, which never submits, a take here is one question:
 * the phone's recogniser decides when the speaker has finished (`continuous: false`) and the words
 * heard are handed to `onHeard` to be asked. The voice level goes to a tiny store of its own, so only
 * the edge glow re-renders at its 10 Hz.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { applyResult, heardSomething, levelFromVolume, noticeForError, noticeText, startTake, takeText, type Take } from '../chat/dictationText.ts';

export type ListenStatus = 'off' | 'listening' | 'settling';

export type LevelStore = {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
};

export type AssistantVoice = {
  status: ListenStatus;
  /** what has been heard of the take so far */
  heard: string;
  level: LevelStore;
  /** false when the phone has no recogniser: the card is typed into */
  available: boolean;
  listen: () => void;
  /** stop listening and ask what was heard */
  finish: () => void;
  /** stop listening and drop the take */
  cancel: () => void;
};

const LEVEL_TICK_MS = 100;

const deviceLocale = () => Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';

function createLevelStore() {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => level,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: number) => {
      if (next === level) return;
      level = next;
      for (const listener of listeners) listener();
    },
  };
}

export function useAssistantVoice({ onHeard, onNotice }: { onHeard: (text: string) => void; onNotice: (text: string) => void }): AssistantVoice {
  const [status, setStatus] = useState<ListenStatus>('off');
  const [heard, setHeard] = useState('');
  const level = useMemo(createLevelStore, []);
  const live = useRef<ListenStatus>('off');
  const take = useRef<Take>(startTake(''));
  const dropped = useRef(false);
  const starting = useRef(false);
  const latest = useRef({ onHeard, onNotice });
  latest.current = { onHeard, onNotice };

  const available = useMemo(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }, []);

  const move = useCallback((next: ListenStatus) => {
    live.current = next;
    setStatus(next);
  }, []);

  // the composer's dictation shares the recogniser's events; each ignores a take that is not its own
  useSpeechRecognitionEvent('result', (event) => {
    if (live.current === 'off') return;
    const transcript = event.results[0]?.transcript;
    if (transcript === undefined) return;
    take.current = applyResult(take.current, transcript, event.isFinal);
    setHeard(takeText(take.current));
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (live.current === 'listening') level.set(levelFromVolume(event.value));
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (live.current === 'off' || dropped.current) return;
    const notice = noticeForError(event.error, event.message);
    if (notice) latest.current.onNotice(noticeText(notice));
  });
  useSpeechRecognitionEvent('end', () => {
    if (live.current === 'off') return;
    const text = takeText(take.current).trim();
    const ask = !dropped.current && heardSomething(take.current) && text !== '';
    level.set(0);
    setHeard('');
    move('off');
    if (ask) latest.current.onHeard(text);
  });

  const listen = useCallback(async () => {
    if (live.current !== 'off' || starting.current) return;
    starting.current = true;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        latest.current.onNotice('Microphone permission was denied. Type your question instead.');
        return;
      }
      take.current = startTake('');
      dropped.current = false;
      setHeard('');
      ExpoSpeechRecognitionModule.start({
        lang: deviceLocale(),
        interimResults: true,
        continuous: false,
        volumeChangeEventOptions: { enabled: true, intervalMillis: LEVEL_TICK_MS },
      });
      move('listening');
    } catch (error) {
      latest.current.onNotice(noticeText({ title: 'Voice recording failed', message: error instanceof Error ? error.message : String(error) }));
    } finally {
      starting.current = false;
    }
  }, [move]);

  const finish = useCallback(() => {
    if (live.current !== 'listening') return;
    move('settling');
    ExpoSpeechRecognitionModule.stop();
  }, [move]);

  const cancel = useCallback(() => {
    if (live.current === 'off') return;
    dropped.current = true;
    ExpoSpeechRecognitionModule.abort();
    level.set(0);
    setHeard('');
    move('off');
  }, [level, move]);

  useEffect(
    () => () => {
      if (live.current !== 'off') ExpoSpeechRecognitionModule.abort();
    },
    [],
  );

  const listenNow = useCallback(() => void listen(), [listen]);
  return { status, heard, level, available, listen: listenNow, finish, cancel };
}
