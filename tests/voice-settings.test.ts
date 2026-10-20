import assert from 'node:assert/strict';
import { test } from 'node:test';

import { levelFromDecibels, transcribeTimeoutMs, withTranscript } from '../src/chat/dictationText.ts';
import { speakTimeoutMs } from '../src/chat/speechText.ts';
import {
  DEFAULT_TTS_PROVIDER,
  engineFor,
  readTts,
  readVoice,
  rememberVoice,
  STT_MODELS,
  STT_PROVIDERS,
  sttModelKey,
  sttSettingsFor,
  subscribeSttSettings,
  TTS_PROVIDERS,
  ttsKey,
  withKey,
} from '../src/settings/voice.ts';

test('the providers are the desktop choices, in its order, each with a model list', () => {
  assert.deepEqual(
    STT_PROVIDERS.map((p) => p.id),
    ['local', 'groq', 'openai', 'mistral', 'xai', 'elevenlabs', 'deepinfra'],
  );
  for (const { id } of STT_PROVIDERS) assert.ok(Array.isArray(STT_MODELS[id]));
});

test('ElevenLabs keeps its model under model_id', () => {
  assert.equal(sttModelKey('mistral'), 'stt.mistral.model');
  assert.equal(sttModelKey('elevenlabs'), 'stt.elevenlabs.model_id');
});

test('an empty config reads as the backend defaults', () => {
  assert.deepEqual(readVoice({}), { enabled: true, provider: null, model: '', language: '', maxSeconds: null });
});

test("the selected provider's model is the one read", () => {
  const config = {
    stt: { enabled: true, provider: 'Mistral', language: ' en ', mistral: { model: 'voxtral-mini-2602' }, local: { model: 'base' } },
    voice: { max_recording_seconds: 90 },
  };
  assert.deepEqual(readVoice(config), { enabled: true, provider: 'mistral', model: 'voxtral-mini-2602', language: 'en', maxSeconds: 90 });
  assert.equal(readVoice({ stt: { local: { model: 'base' } } }).model, 'base');
});

test('an unknown provider reads as unset', () => {
  assert.equal(readVoice({ stt: { provider: 'carrier-pigeon' } }).provider, null);
});

test('stt.enabled picks the engine; an unread profile stays on the device', () => {
  assert.equal(engineFor({ enabled: true }), 'gateway');
  assert.equal(engineFor({ enabled: false }), 'device');
  assert.equal(engineFor(null), 'device');
});

test('withKey sets one nested key and leaves its siblings', () => {
  const config = { stt: { enabled: true, mistral: { model: 'a' } }, other: 1 };
  assert.deepEqual(withKey(config, 'stt.mistral.model', 'b'), { stt: { enabled: true, mistral: { model: 'b' } }, other: 1 });
  assert.deepEqual(withKey({}, 'voice.max_recording_seconds', 30), { voice: { max_recording_seconds: 30 } });
  assert.deepEqual(config.stt.mistral, { model: 'a' });
});

test('the per-profile cache keeps each profile apart and notifies only on change', () => {
  let calls = 0;
  const off = subscribeSttSettings(() => (calls += 1));
  rememberVoice('work', readVoice({ stt: { enabled: true, provider: 'mistral' } }));
  rememberVoice('home', readVoice({ stt: { enabled: false } }));
  rememberVoice('work', readVoice({ stt: { enabled: true, provider: 'groq' } }));
  off();
  assert.deepEqual(sttSettingsFor('work'), { engine: 'gateway', maxSeconds: null });
  assert.deepEqual(sttSettingsFor('home'), { engine: 'device', maxSeconds: null });
  assert.equal(sttSettingsFor('nobody'), null);
  assert.equal(calls, 2);
});

test('the upload timeout scales from the desktop floor to its cap', () => {
  assert.equal(transcribeTimeoutMs('data:audio/m4a;base64,AAAA'), 180_000);
  assert.equal(transcribeTimeoutMs('x'.repeat(2_000_000)), 200_000);
  assert.equal(transcribeTimeoutMs('x'.repeat(10_000_000)), 600_000);
});

test('metering maps the top 50 dB onto the bars', () => {
  assert.equal(levelFromDecibels(undefined), 0);
  assert.equal(levelFromDecibels(-160), 0);
  assert.equal(levelFromDecibels(-25), 0.5);
  assert.equal(levelFromDecibels(3), 1);
});

test('a transcript joins the composer text with one space', () => {
  assert.equal(withTranscript('', ' hello '), 'hello');
  assert.equal(withTranscript('Fix', 'the build'), 'Fix the build');
  assert.equal(withTranscript('Fix ', 'it'), 'Fix it');
});

test('the TTS providers are the desktop choices plus DeepInfra, Edge first as the default', () => {
  assert.deepEqual(
    TTS_PROVIDERS.map((p) => p.id),
    ['edge', 'elevenlabs', 'openai', 'xai', 'minimax', 'mistral', 'gemini', 'deepinfra', 'neutts', 'kittentts', 'piper'],
  );
  assert.equal(DEFAULT_TTS_PROVIDER, 'edge');
});

test('each TTS provider names its own model and voice keys', () => {
  assert.equal(ttsKey('mistral', 'model'), 'tts.mistral.model');
  assert.equal(ttsKey('mistral', 'voice'), 'tts.mistral.voice_id');
  assert.equal(ttsKey('elevenlabs', 'model'), 'tts.elevenlabs.model_id');
  assert.equal(ttsKey('edge', 'model'), null);
  assert.equal(ttsKey('neutts', 'voice'), null);
});

test("the TTS read takes the selected provider's fields, Edge when unset", () => {
  assert.deepEqual(readTts({}), { provider: null, model: '', voice: '' });
  assert.deepEqual(readTts({ tts: { edge: { voice: 'en-GB-SoniaNeural' } } }), { provider: null, model: '', voice: 'en-GB-SoniaNeural' });
  const config = { tts: { provider: 'mistral', mistral: { model: 'voxtral-mini-tts-2603', voice_id: 'abc' }, edge: { voice: 'x' } } };
  assert.deepEqual(readTts(config), { provider: 'mistral', model: 'voxtral-mini-tts-2603', voice: 'abc' });
  assert.equal(readTts({ tts: { provider: 'nope' } }).provider, null);
});

test('the speak timeout scales from the desktop floor to its cap', () => {
  assert.equal(speakTimeoutMs('hello'), 180_000);
  assert.equal(speakTimeoutMs('x'.repeat(10_000)), 350_000);
  assert.equal(speakTimeoutMs('x'.repeat(100_000)), 600_000);
});
