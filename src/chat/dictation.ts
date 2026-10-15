/**
 * Dictation on the device recogniser (issue "Transcript and composer parity on
 * touch"): the mic toggles a take, interim speech streams into the composer's
 * text as it is recognised, and nothing is ever submitted. The desktop's states
 * carry over - idle, recording, then transcribing from stop until the recogniser
 * settles - with its cap on recording length.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import {
  applyResult,
  heardSomething,
  levelFromVolume,
  noticeForError,
  noticeText,
  NO_SPEECH,
  recordingCapSeconds,
  startTake,
  takeText,
  type Take,
} from './dictationText.ts';

export type DictationStatus = 'idle' | 'recording' | 'transcribing';

export type Dictation = {
  status: DictationStatus;
  elapsedSeconds: number;
  /** 0..1 input level for the bars */
  level: number;
  /** the utterance in flight, as the activity row shows it */
  partial: string;
  /** false when the device has no recogniser, so the mic stays out of the composer */
  available: boolean;
  toggle: () => void;
  /** drops the take without waiting for a final result; what was heard stays in the composer */
  cancel: () => void;
};

type Options = {
  getText: () => string;
  setText: (text: string) => void;
  onNotice: (text: string) => void;
  /** `voice.max_recording_seconds` */
  maxSeconds?: number;
};

const ELAPSED_TICK_MS = 250;
const LEVEL_TICK_MS = 100;

const deviceLocale = () => Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';

export function useDictation({ getText, setText, onNotice, maxSeconds }: Options): Dictation {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const take = useRef<Take>(startTake(''));
  const live = useRef<DictationStatus>('idle');
  const starting = useRef(false);
  const noticed = useRef(false);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ getText, setText, onNotice });
  latest.current = { getText, setText, onNotice };

  const available = useMemo(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }, []);

  const move = useCallback((next: DictationStatus) => {
    live.current = next;
    setStatus(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    if (cap.current) clearTimeout(cap.current);
    ticker.current = null;
    cap.current = null;
  }, []);

  const settle = useCallback(() => {
    if (live.current === 'idle') return;
    clearTimers();
    if (!noticed.current && !heardSomething(take.current)) latest.current.onNotice(noticeText(NO_SPEECH));
    noticed.current = false;
    setPartial('');
    setLevel(0);
    move('idle');
  }, [clearTimers, move]);

  useSpeechRecognitionEvent('result', (event) => {
    if (live.current === 'idle') return;
    const transcript = event.results[0]?.transcript;
    if (transcript === undefined) return;
    take.current = applyResult(take.current, transcript, event.isFinal);
    latest.current.setText(takeText(take.current));
    setPartial(take.current.interim);
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (live.current === 'recording') setLevel(levelFromVolume(event.value));
  });
  useSpeechRecognitionEvent('error', (event) => {
    const notice = noticeForError(event.error, event.message);
    if (notice && live.current !== 'idle' && !noticed.current) {
      noticed.current = true;
      latest.current.onNotice(noticeText(notice));
    } else if (!notice) {
      noticed.current = true;
    }
  });
  useSpeechRecognitionEvent('end', settle);

  const stop = useCallback(() => {
    if (live.current !== 'recording') return;
    clearTimers();
    move('transcribing');
    ExpoSpeechRecognitionModule.stop();
  }, [clearTimers, move]);

  const start = useCallback(async () => {
    if (live.current !== 'idle' || starting.current) return;
    starting.current = true;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        latest.current.onNotice(noticeText({ title: 'Voice unavailable', message: 'Microphone permission was denied.' }));
        return;
      }
      take.current = startTake(latest.current.getText());
      noticed.current = false;
      ExpoSpeechRecognitionModule.start({
        lang: deviceLocale(),
        interimResults: true,
        continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: LEVEL_TICK_MS },
      });
      startedAt.current = Date.now();
      setElapsedSeconds(0);
      move('recording');
      ticker.current = setInterval(() => setElapsedSeconds((Date.now() - startedAt.current) / 1000), ELAPSED_TICK_MS);
      cap.current = setTimeout(stop, recordingCapSeconds(maxSeconds) * 1000);
    } catch (error) {
      latest.current.onNotice(noticeText({ title: 'Voice recording failed', message: error instanceof Error ? error.message : String(error) }));
    } finally {
      starting.current = false;
    }
  }, [maxSeconds, move, stop]);

  const toggle = useCallback(() => {
    if (live.current === 'recording') stop();
    else if (live.current === 'idle') void start();
  }, [start, stop]);

  const cancel = useCallback(() => {
    if (live.current === 'idle') return;
    noticed.current = true;
    ExpoSpeechRecognitionModule.abort();
    settle();
  }, [settle]);

  useEffect(
    () => () => {
      clearTimers();
      if (live.current !== 'idle') ExpoSpeechRecognitionModule.abort();
    },
    [clearTimers],
  );

  return { status, elapsedSeconds, level, partial, available, toggle, cancel };
}
