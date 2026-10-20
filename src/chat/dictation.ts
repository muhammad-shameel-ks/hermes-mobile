/**
 * Dictation (issue "Transcript and composer parity on touch"): the mic toggles a
 * take and nothing is ever submitted. The desktop's states carry over - idle,
 * recording, then transcribing from stop until the text settles - with its cap
 * on recording length. Two engines sit behind the one surface:
 *
 * - `gateway`, the desktop's own path (use-voice-recorder.ts): the phone records
 *   a clip and `POST /api/audio/transcribe` decodes it with the profile's
 *   `stt.provider`, so each profile dictates with its own provider and model.
 * - `device`, the platform recogniser: interim speech streams into the
 *   composer's text as it is recognised. A profile with `stt.enabled` off keeps it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import type { DictationEngine } from '../settings/voice.ts';
import {
  applyResult,
  heardSomething,
  levelFromDecibels,
  levelFromVolume,
  noticeForError,
  noticeText,
  NO_SPEECH,
  recordingCapSeconds,
  startTake,
  takeText,
  transcribeTimeoutMs,
  withTranscript,
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

/** uploads one clip as the desktop's `transcribeAudio` does, for the profile that was active when the mic opened */
export type Transcribe = (dataUrl: string, mimeType: string, timeoutMs: number) => Promise<string>;

type Options = {
  getText: () => string;
  setText: (text: string) => void;
  onNotice: (text: string) => void;
  /** `voice.max_recording_seconds` */
  maxSeconds?: number | null;
};

const ELAPSED_TICK_MS = 250;
const LEVEL_TICK_MS = 100;

const deviceLocale = () => Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';

function useDeviceDictation({ getText, setText, onNotice, maxSeconds }: Options): Dictation {
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

/** mono AAC at speech quality: an m4a every provider accepts, a fraction of the upload of the stereo HIGH_QUALITY preset */
const SPEECH_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 48000,
  isMeteringEnabled: true,
};
const SPEECH_MIME = 'audio/m4a';

function discard(uri: string | null) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {}
}

function useGatewayDictation({ getText, setText, onNotice, maxSeconds, transcribe }: Options & { transcribe: Transcribe }): Dictation {
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const live = useRef<DictationStatus>('idle');
  const starting = useRef(false);
  /** bumps on every new take and on cancel, so a transcript settling for a dropped take is ignored */
  const takeId = useRef(0);
  /** the take's upload, fixed at mic-open so a profile switch mid-take cannot re-route it */
  const upload = useRef<Transcribe>(transcribe);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ getText, setText, onNotice, transcribe });
  latest.current = { getText, setText, onNotice, transcribe };

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

  const release = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    setLevel(0);
    move('idle');
  }, [clearTimers, move]);

  const stop = useCallback(async () => {
    if (live.current !== 'recording') return;
    const id = takeId.current;
    clearTimers();
    setLevel(0);
    move('transcribing');
    let uri: string | null = null;
    try {
      await recorder.stop();
      release();
      uri = recorder.uri;
      if (!uri) throw new Error('The recording was not saved.');
      const audio = await new File(uri).base64();
      if (id !== takeId.current) return;
      const dataUrl = `data:${SPEECH_MIME};base64,${audio}`;
      const transcript = (await upload.current(dataUrl, SPEECH_MIME, transcribeTimeoutMs(dataUrl))).trim();
      if (id !== takeId.current) return;
      if (transcript === '') latest.current.onNotice(noticeText(NO_SPEECH));
      else latest.current.setText(withTranscript(latest.current.getText(), transcript));
    } catch (error) {
      if (id === takeId.current) {
        latest.current.onNotice(noticeText({ title: 'Voice transcription failed', message: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      discard(uri);
      if (id === takeId.current) finish();
    }
  }, [clearTimers, finish, move, recorder, release]);

  const start = useCallback(async () => {
    if (live.current !== 'idle' || starting.current) return;
    starting.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        latest.current.onNotice(noticeText({ title: 'Voice unavailable', message: 'Microphone permission was denied.' }));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      takeId.current += 1;
      upload.current = latest.current.transcribe;
      startedAt.current = Date.now();
      setElapsedSeconds(0);
      move('recording');
      ticker.current = setInterval(() => {
        setElapsedSeconds((Date.now() - startedAt.current) / 1000);
        setLevel(levelFromDecibels(recorder.getStatus().metering));
      }, ELAPSED_TICK_MS);
      cap.current = setTimeout(() => void stop(), recordingCapSeconds(maxSeconds) * 1000);
    } catch (error) {
      release();
      latest.current.onNotice(noticeText({ title: 'Voice recording failed', message: error instanceof Error ? error.message : String(error) }));
    } finally {
      starting.current = false;
    }
  }, [maxSeconds, move, recorder, release, stop]);

  const toggle = useCallback(() => {
    if (live.current === 'recording') void stop();
    else if (live.current === 'idle') void start();
  }, [start, stop]);

  const cancel = useCallback(() => {
    if (live.current === 'idle') return;
    const wasRecording = live.current === 'recording';
    takeId.current += 1;
    finish();
    if (wasRecording) {
      void recorder
        .stop()
        .then(() => discard(recorder.uri))
        .catch(() => {})
        .finally(release);
    }
  }, [finish, recorder, release]);

  useEffect(
    () => () => {
      takeId.current += 1;
      clearTimers();
      if (live.current === 'recording') void recorder.stop().catch(() => {}).finally(release);
    },
    [clearTimers, recorder, release],
  );

  return { status, elapsedSeconds, level, partial: '', available: true, toggle, cancel };
}

/**
 * The composer's dictation: `engine` picks the profile's provider or the phone's
 * recogniser for the next take; a take in flight keeps the engine it started on.
 */
export function useDictation(options: Options & { engine: DictationEngine; transcribe: Transcribe }): Dictation {
  const device = useDeviceDictation(options);
  const gateway = useGatewayDictation(options);
  if (device.status !== 'idle') return device;
  if (gateway.status !== 'idle') return gateway;
  return options.engine === 'gateway' ? gateway : device;
}
