/**
 * Dictation as plain arithmetic: how a recogniser's results build the composer's
 * text, the clock and level readouts, and the notices an end or an error earns
 * (desktop use-voice-recorder.ts and the voice strings of i18n/en.ts).
 */

/** desktop `DEFAULT_VOICE_SECONDS`, the cap when `voice.max_recording_seconds` is unset */
export const DEFAULT_MAX_RECORDING_SECONDS = 120;

/** desktop `recordingLimit` then the recorder's own clamp to 1..600 seconds */
export function recordingCapSeconds(value: unknown): number {
  const configured = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_RECORDING_SECONDS;
  return Math.max(1, Math.min(Math.trunc(configured), 600));
}

/** desktop `VoiceActivity`'s clock */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`;
}

/** the recogniser reports -2..10 and anything at or under 0 is inaudible; the bars take 0..1 */
export const levelFromVolume = (value: number) => Math.max(0, Math.min(value / 10, 1));

/** `b` after `a` with one space between, unless either side is empty or `a` already ends in whitespace */
export function joinSpeech(a: string, b: string): string {
  if (a === '') return b;
  if (b === '') return a;
  return /\s$/.test(a) ? `${a}${b}` : `${a} ${b}`;
}

/**
 * One take: the composer's text when it started, the utterances the recogniser
 * has settled, and the one still in flight. Dictation never submits; it only
 * writes the composer's text.
 */
export type Take = { base: string; settled: string; interim: string };

export const startTake = (base: string): Take => ({ base, settled: '', interim: '' });

/** a final result closes an utterance, an interim one replaces the open one */
export function applyResult(take: Take, transcript: string, isFinal: boolean): Take {
  return isFinal ? { ...take, settled: joinSpeech(take.settled, transcript.trim()), interim: '' } : { ...take, interim: transcript.trim() };
}

export const takeText = (take: Take) => joinSpeech(take.base, joinSpeech(take.settled, take.interim));

export const heardSomething = (take: Take) => take.settled !== '' || take.interim !== '';

export type DictationNotice = { title: string; message?: string };

/** desktop `notifications.voice` copy; an abort is the user's own and says nothing */
export const NO_SPEECH: DictationNotice = { title: 'No speech detected', message: 'Try recording again.' };

export function noticeForError(code: string, message: string): DictationNotice | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'no-speech':
    case 'speech-timeout':
      return NO_SPEECH;
    case 'not-allowed':
      return { title: 'Voice unavailable', message: 'Microphone permission was denied.' };
    case 'audio-capture':
      return { title: 'Microphone failed', message: 'No microphone was found.' };
    case 'busy':
      return { title: 'Microphone failed', message: 'Microphone is already in use by another app.' };
    case 'service-not-allowed':
    case 'language-not-supported':
      return { title: 'Voice unavailable', message: 'This runtime does not support microphone recording.' };
    case 'network':
      return { title: 'Voice transcription failed', message: message || undefined };
    default:
      return { title: 'Voice recording failed', message: message || undefined };
  }
}

export const noticeText = ({ title, message }: DictationNotice) => (message ? `${title}. ${message}` : title);
