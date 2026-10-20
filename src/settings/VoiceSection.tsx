/**
 * Settings → Voice (desktop app/settings config section `voice`, its "Speech to
 * text" and "Text to speech" child pages, and `VoiceProviderFields`): which
 * provider this profile transcribes dictation with and reads replies aloud with,
 * each provider's model and voice, the language hint, and the recording cap. As
 * on the desktop only the selected provider's fields show. Values come from
 * `GET /api/config` and each change is the one key sent over `PUT /api/config`,
 * scoped to the active profile, so every profile keeps its own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { setAutoSpeak, useAutoSpeak } from '../chat/autoSpeak.ts';
import { errorText } from '../gateway/http.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../ui/tokens.ts';
import { useSettings } from './context.tsx';
import { ActionButton, ListRow, SettingsContent, SettingsSection, ToggleRow } from './primitives.tsx';
import { parseTimeout, saveBody, type ConfigRecord } from './safety.ts';
import {
  DEFAULT_STT_PROVIDER,
  DEFAULT_TTS_PROVIDER,
  providerLabel,
  readTts,
  readVoice,
  rememberVoice,
  STT_MODELS,
  STT_PROVIDERS,
  sttModelKey,
  TTS_PROVIDERS,
  ttsKey,
  ttsProviderEntry,
  ttsProviderLabel,
  withKey,
  type TtsValues,
  type VoiceValues,
} from './voice.ts';

const COPY = {
  failedLoad: 'Failed to load settings',
  autosaveFailed: 'Autosave failed',
  loading: 'Loading settings...',
  transcription: 'Speech to text',
  enabled: 'Speech-to-Text',
  enabledOn: (provider: string) => `Dictation is transcribed by this profile's provider (${provider}) on the gateway.`,
  enabledOff: "Dictation uses the phone's own recogniser. Turn on to transcribe with this profile's provider.",
  provider: 'Provider',
  providerHint: 'Keys for cloud providers are read from the profile on the gateway.',
  model: 'Model',
  modelHint: 'Pick one, or type any model the provider serves. Blank uses the provider default.',
  modelPlaceholder: 'Provider default',
  language: 'Language',
  languageHint: 'A language code such as en or fr. Blank auto-detects.',
  languagePlaceholder: 'Auto-detect',
  speech: 'Text to speech',
  autoSpeak: 'Read Responses Aloud',
  autoSpeakHint: 'Speak each reply when it finishes, with the voice below. Applies on this phone only.',
  speechProviderHint: (provider: string) =>
    `Read aloud voices replies with ${provider} on the gateway. When the gateway cannot, the phone's own voice reads instead.`,
  voice: 'Voice',
  voiceHint: 'Pick one, or type any voice name or ID the provider offers. Blank uses the provider default.',
  voicePlaceholder: 'Provider default',
  recording: 'Recording',
  maxSeconds: 'Max Recording Length',
  maxSecondsHint: 'Dictation stops on its own after this long (1 to 600 seconds).',
  seconds: 'seconds',
  invalidSeconds: 'Enter a whole number of seconds from 1 to 600.',
};

type Values = { stt: VoiceValues; tts: TtsValues };

const readAll = (config: ConfigRecord): Values => ({ stt: readVoice(config), tts: readTts(config) });

export default function VoiceSection() {
  const t = useTokens();
  const { controller, snapshot } = useSettings();
  const profile = snapshot.profile;
  const [values, setValues] = useState<Values | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const config = useRef<ConfigRecord>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(true);
  const autoSpeak = useAutoSpeak();

  useEffect(() => () => void (live.current = false), []);

  const show = useCallback(() => {
    const next = readAll(config.current);
    setValues(next);
    rememberVoice(profile, next.stt);
  }, [profile]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const loaded = await controller.api.get<ConfigRecord>('/api/config', { profile });
      if (!live.current) return;
      config.current = loaded ?? {};
      show();
    } catch (error) {
      if (live.current) setLoadError(errorText(error));
    }
  }, [controller, profile, show]);

  useEffect(() => {
    setValues(null);
    void load();
  }, [load]);

  /** apply now, write the one key, and reload the profile's values if the write fails */
  const save = (key: string, value: unknown) => {
    setSaveError(null);
    config.current = withKey(config.current, key, value);
    show();
    queue.current = queue.current.then(async () => {
      try {
        await controller.api.put('/api/config', saveBody(key, value), { profile });
      } catch (error) {
        if (!live.current) return;
        setSaveError(`${COPY.autosaveFailed}. ${errorText(error)}`);
        void load();
      }
    });
  };

  /** a text field's commit: write the key when the trimmed text changed */
  const saveText = (key: string, previous: string) => (draft: string) => {
    const next = draft.trim();
    if (next !== previous) save(key, next);
  };

  if (!values) {
    return (
      <SettingsContent>
        {loadError ? (
          <ListRow
            title={COPY.failedLoad}
            description={loadError}
            action={<ActionButton label="Retry" icon="refresh" variant="secondary" onPress={() => void load()} />}
          />
        ) : (
          <View style={styles.loading}>
            <GlyphSpinner size={14} color={t.uiTextTertiary} />
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.loading}</Text>
          </View>
        )}
      </SettingsContent>
    );
  }

  const { stt, tts } = values;
  const sttModelPath = sttModelKey(stt.provider ?? DEFAULT_STT_PROVIDER);
  const speaker = ttsProviderEntry(tts.provider ?? DEFAULT_TTS_PROVIDER);
  const ttsModelPath = ttsKey(speaker.id, 'model');
  const ttsVoicePath = ttsKey(speaker.id, 'voice');

  const commitSeconds = (draft: string) => {
    const seconds = parseTimeout(draft);
    if (seconds === null || seconds < 1 || seconds > 600) {
      setSaveError(COPY.invalidSeconds);
      return false;
    }
    if (seconds !== stt.maxSeconds) save('voice.max_recording_seconds', seconds);
  };

  return (
    <SettingsContent onRefresh={() => void load()}>
      {saveError ? (
        <Text accessibilityLiveRegion="polite" style={{ color: t.dtDestructive, fontSize: t.type.caption, marginBottom: 12 }}>
          {saveError}
        </Text>
      ) : null}
      <SettingsSection title={COPY.transcription} icon="mic">
        <ToggleRow
          label={COPY.enabled}
          description={stt.enabled ? COPY.enabledOn(providerLabel(stt.provider)) : COPY.enabledOff}
          checked={stt.enabled}
          onChange={(on) => save('stt.enabled', on)}
        />
        {stt.enabled ? (
          <>
            <ListRow
              title={COPY.provider}
              description={COPY.providerHint}
              action={<ProviderList options={STT_PROVIDERS} value={stt.provider} onChange={(id) => save('stt.provider', id)} />}
            />
            <ListRow
              title={COPY.model}
              description={COPY.modelHint}
              hint={sttModelPath}
              action={
                <TextField
                  label={COPY.model}
                  value={stt.model}
                  placeholder={COPY.modelPlaceholder}
                  suggestions={STT_MODELS[stt.provider ?? DEFAULT_STT_PROVIDER]}
                  onCommit={saveText(sttModelPath, stt.model)}
                />
              }
            />
            <ListRow
              title={COPY.language}
              description={COPY.languageHint}
              action={
                <TextField label={COPY.language} value={stt.language} placeholder={COPY.languagePlaceholder} onCommit={saveText('stt.language', stt.language)} />
              }
            />
          </>
        ) : null}
      </SettingsSection>
      <SettingsSection title={COPY.speech} icon="unmute">
        <ToggleRow label={COPY.autoSpeak} description={COPY.autoSpeakHint} checked={autoSpeak} onChange={setAutoSpeak} />
        <ListRow
          title={COPY.provider}
          description={COPY.speechProviderHint(ttsProviderLabel(tts.provider))}
          action={<ProviderList options={TTS_PROVIDERS} value={tts.provider} onChange={(id) => save('tts.provider', id)} />}
        />
        {ttsModelPath ? (
          <ListRow
            title={COPY.model}
            description={COPY.modelHint}
            hint={ttsModelPath}
            action={
              <TextField
                label={COPY.model}
                value={tts.model}
                placeholder={COPY.modelPlaceholder}
                suggestions={speaker.model?.options}
                onCommit={saveText(ttsModelPath, tts.model)}
              />
            }
          />
        ) : null}
        {ttsVoicePath ? (
          <ListRow
            title={COPY.voice}
            description={COPY.voiceHint}
            hint={ttsVoicePath}
            action={
              <TextField
                label={COPY.voice}
                value={tts.voice}
                placeholder={COPY.voicePlaceholder}
                suggestions={speaker.voice?.options}
                onCommit={saveText(ttsVoicePath, tts.voice)}
              />
            }
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title={COPY.recording}>
        <ListRow
          title={COPY.maxSeconds}
          description={COPY.maxSecondsHint}
          action={
            <View style={styles.seconds}>
              <TextField
                label={COPY.maxSeconds}
                value={stt.maxSeconds === null ? '' : String(stt.maxSeconds)}
                placeholder="120"
                keyboardType="number-pad"
                onCommit={commitSeconds}
              />
              <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.seconds}</Text>
            </View>
          }
        />
      </SettingsSection>
    </SettingsContent>
  );
}

/** the desktop's provider select as a radio list; an unset provider leaves every row unchecked */
function ProviderList<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T | null; onChange: (id: T) => void }) {
  const t = useTokens();
  return (
    <View style={styles.options}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => !active && onChange(option.id)}
            style={({ pressed }) => [styles.option, { borderRadius: t.radius['2xl'], backgroundColor: active || pressed ? t.uiBgSecondary : 'transparent' }]}
          >
            <Text style={{ flex: 1, color: active ? t.uiTextPrimary : t.uiTextSecondary, fontSize: t.type.base, fontWeight: active ? '500' : '400' }}>{option.label}</Text>
            {active ? <Codicon name="check" size={16} color={t.uiAccent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A free-input config field (desktop FREE_INPUT_KEYS): the suggestions as chips
 * over a text box, committed on blur or done. `onCommit` returning false rejects
 * the draft and puts the saved value back.
 */
function TextField({
  label,
  value,
  placeholder,
  suggestions,
  keyboardType,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  suggestions?: readonly string[];
  keyboardType?: KeyboardTypeOptions;
  onCommit: (draft: string) => boolean | void;
}) {
  const t = useTokens();
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = (text: string) => {
    setDraft(text.trim());
    if (onCommit(text) === false) setDraft(value);
  };

  return (
    <View style={keyboardType ? undefined : styles.list}>
      {suggestions?.length ? (
        <View style={styles.chips}>
          {suggestions.map((option) => {
            const active = option === value;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => commit(active ? '' : option)}
                style={[styles.chip, { borderRadius: t.radius.full, borderColor: active ? t.uiAccent : t.uiStrokeSecondary, backgroundColor: active ? t.uiBgSecondary : 'transparent' }]}
              >
                <Text style={{ color: active ? t.uiTextPrimary : t.uiTextSecondary, fontSize: 12 }}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => commit(draft)}
        onSubmitEditing={() => commit(draft)}
        placeholder={placeholder}
        placeholderTextColor={t.uiTextQuaternary}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        selectionColor={t.uiAccent}
        accessibilityLabel={label}
        style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  input: { minWidth: 96, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, borderWidth: StyleSheet.hairlineWidth },
  options: { width: '100%', gap: 2 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12 },
  list: { width: '100%', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
  seconds: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
