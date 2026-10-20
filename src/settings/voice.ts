/**
 * Settings → Voice, speech to text (desktop app/settings: the `stt.*` keys of the
 * `voice` section in constants.ts, `voiceFieldVisible` in helpers.ts, and the
 * enum lists of ENUM_OPTIONS). The provider and its model live in the profile's
 * config, so each profile transcribes with its own provider; the gateway's
 * `POST /api/audio/transcribe` reads them when the phone uploads a take. Pure
 * helpers and a small per-profile cache the composer reads at mic-open.
 */

import { readPath, type ConfigRecord } from './safety.ts';

export type SttProvider = 'local' | 'groq' | 'openai' | 'mistral' | 'xai' | 'elevenlabs' | 'deepinfra';

/** desktop ENUM_OPTIONS['stt.provider'], in its order */
export const STT_PROVIDERS: readonly { id: SttProvider; label: string }[] = [
  { id: 'local', label: 'Local (faster-whisper)' },
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral (Voxtral)' },
  { id: 'xai', label: 'xAI' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'deepinfra', label: 'DeepInfra' },
];

/** desktop ENUM_OPTIONS for each provider's model key; the desktop treats them as suggestions (FREE_INPUT_KEYS) */
export const STT_MODELS: Record<SttProvider, readonly string[]> = {
  local: ['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'],
  groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
  openai: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-transcribe'],
  mistral: ['voxtral-mini-latest', 'voxtral-mini-2602'],
  xai: ['grok-voice-transcribe-2.0', 'grok-voice-transcribe-1.0'],
  elevenlabs: ['scribe_v2', 'scribe_v1'],
  deepinfra: [],
};

/** the backend's default when `stt.provider` is unset (desktop `voiceFieldVisible` fallback) */
export const DEFAULT_STT_PROVIDER: SttProvider = 'local';

export const isSttProvider = (value: unknown): value is SttProvider => STT_PROVIDERS.some((p) => p.id === value);

/** ElevenLabs names its model `model_id`; every other provider names it `model` */
export const sttModelKey = (provider: SttProvider) => `stt.${provider}.${provider === 'elevenlabs' ? 'model_id' : 'model'}`;

export type VoiceValues = {
  /** `stt.enabled`; on routes dictation through the profile's provider, off leaves it on the phone's recogniser */
  enabled: boolean;
  /** `stt.provider`, or null when unset (the backend auto-detects) */
  provider: SttProvider | null;
  /** the selected provider's model, '' when unset */
  model: string;
  /** `stt.language`, the global hint; '' auto-detects */
  language: string;
  /** `voice.max_recording_seconds`, or null when unset */
  maxSeconds: number | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function readVoice(config: ConfigRecord): VoiceValues {
  const enabled = readPath(config, 'stt.enabled');
  const provider = text(readPath(config, 'stt.provider')).toLowerCase();
  const chosen = isSttProvider(provider) ? provider : null;
  const seconds = readPath(config, 'voice.max_recording_seconds');
  return {
    // config_defaults.py ships stt.enabled: true
    enabled: typeof enabled === 'boolean' ? enabled : true,
    provider: chosen,
    model: text(readPath(config, sttModelKey(chosen ?? DEFAULT_STT_PROVIDER))),
    language: text(readPath(config, 'stt.language')),
    maxSeconds: typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
  };
}

/** `config` with one dotted key set, as the desktop's `setNested` (the server deep-merges the same key from `saveBody`) */
export function withKey(config: ConfigRecord, path: string, value: unknown): ConfigRecord {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...config, [head]: value };
  const inner = config[head];
  const child = typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? (inner as ConfigRecord) : {};
  return { ...config, [head]: withKey(child, rest.join('.'), value) };
}

export const providerLabel = (provider: SttProvider | null) =>
  provider ? (STT_PROVIDERS.find((p) => p.id === provider)?.label ?? provider) : 'Auto-detect';

// ---------------------------------------------------------------------------
// The per-profile cache the composer reads: which engine a take uses and its
// recording cap. Settings writes through it so a change applies to the next take.
// ---------------------------------------------------------------------------

export type DictationEngine = 'gateway' | 'device';

export type SttSettings = { engine: DictationEngine; maxSeconds: number | null };

/** the profile's STT drives dictation when it is on; a profile with it off (or unreadable) keeps the phone's recogniser */
export const engineFor = (values: Pick<VoiceValues, 'enabled'> | null): DictationEngine => (values?.enabled ? 'gateway' : 'device');

const cache = new Map<string, SttSettings>();
const listeners = new Set<() => void>();

export function sttSettingsFor(profile: string): SttSettings | null {
  return cache.get(profile) ?? null;
}

export function rememberVoice(profile: string, values: VoiceValues): void {
  const next: SttSettings = { engine: engineFor(values), maxSeconds: values.maxSeconds };
  const previous = cache.get(profile);
  if (previous && previous.engine === next.engine && previous.maxSeconds === next.maxSeconds) return;
  cache.set(profile, next);
  for (const listener of listeners) listener();
}

export function subscribeSttSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Text to speech: the profile's `tts.*` keys (desktop ENUM_OPTIONS and the
// `tts.<provider>.*` fields of the `voice` section). Read aloud synthesizes with
// them over `POST /api/audio/speak`; each provider names its model and voice keys.
// ---------------------------------------------------------------------------

export type TtsProvider = 'edge' | 'elevenlabs' | 'openai' | 'xai' | 'minimax' | 'mistral' | 'gemini' | 'deepinfra' | 'neutts' | 'kittentts' | 'piper';

type TtsField = { key: string; options: readonly string[] };

/** desktop ENUM_OPTIONS['tts.provider'] (plus DeepInfra, which the backend ships) with each provider's model and voice fields */
export const TTS_PROVIDERS: readonly { id: TtsProvider; label: string; model?: TtsField; voice?: TtsField }[] = [
  {
    id: 'edge',
    label: 'Edge (free)',
    voice: { key: 'voice', options: ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-AndrewNeural', 'en-US-BrianNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural'] },
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    model: { key: 'model_id', options: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'] },
    voice: { key: 'voice_id', options: [] },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    model: { key: 'model', options: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
    voice: { key: 'voice', options: ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] },
  },
  { id: 'xai', label: 'xAI', voice: { key: 'voice_id', options: ['eve'] } },
  {
    id: 'minimax',
    label: 'MiniMax',
    model: { key: 'model', options: ['speech-02-hd', 'speech-02-turbo'] },
    voice: { key: 'voice_id', options: [] },
  },
  {
    id: 'mistral',
    label: 'Mistral (Voxtral)',
    model: { key: 'model', options: ['voxtral-mini-tts-2603'] },
    voice: { key: 'voice_id', options: [] },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    model: { key: 'model', options: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'] },
    voice: { key: 'voice', options: ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede'] },
  },
  { id: 'deepinfra', label: 'DeepInfra', model: { key: 'model', options: [] }, voice: { key: 'voice', options: [] } },
  { id: 'neutts', label: 'NeuTTS (local)', model: { key: 'model', options: ['neuphonic/neutts-air-q4-gguf', 'neuphonic/neutts-air-q8-gguf', 'neuphonic/neutts-air'] } },
  {
    id: 'kittentts',
    label: 'KittenTTS (local)',
    model: { key: 'model', options: ['KittenML/kitten-tts-nano-0.8-int8', 'KittenML/kitten-tts-micro-0.8-int8', 'KittenML/kitten-tts-mini-0.8-int8'] },
    voice: { key: 'voice', options: ['Jasper'] },
  },
  { id: 'piper', label: 'Piper (local)', voice: { key: 'voice', options: ['en_US-lessac-medium', 'en_US-amy-medium', 'en_US-ryan-high', 'en_GB-alan-medium'] } },
];

/** config_defaults.py `tts.provider` */
export const DEFAULT_TTS_PROVIDER: TtsProvider = 'edge';

export const isTtsProvider = (value: unknown): value is TtsProvider => TTS_PROVIDERS.some((p) => p.id === value);

export const ttsProviderEntry = (provider: TtsProvider) => TTS_PROVIDERS.find((p) => p.id === provider)!;

/** the dotted config key of a provider's model or voice, or null when the provider has none */
export function ttsKey(provider: TtsProvider, field: 'model' | 'voice'): string | null {
  const entry = ttsProviderEntry(provider)[field];
  return entry ? `tts.${provider}.${entry.key}` : null;
}

export type TtsValues = {
  /** `tts.provider`, or null when unset (the backend uses Edge) */
  provider: TtsProvider | null;
  /** the selected provider's model and voice, '' when unset */
  model: string;
  voice: string;
};

export function readTts(config: ConfigRecord): TtsValues {
  const raw = text(readPath(config, 'tts.provider')).toLowerCase();
  const provider = isTtsProvider(raw) ? raw : null;
  const selected = provider ?? DEFAULT_TTS_PROVIDER;
  const modelKey = ttsKey(selected, 'model');
  const voiceKey = ttsKey(selected, 'voice');
  return {
    provider,
    model: modelKey ? text(readPath(config, modelKey)) : '',
    voice: voiceKey ? text(readPath(config, voiceKey)) : '',
  };
}

export const ttsProviderLabel = (provider: TtsProvider | null) => ttsProviderEntry(provider ?? DEFAULT_TTS_PROVIDER).label;
