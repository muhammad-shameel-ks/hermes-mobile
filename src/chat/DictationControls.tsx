/**
 * The composer's voice surface: the mic in the controls row (desktop
 * voice-fan.tsx hub), the activity row above the composer while a take runs
 * (voice-activity.tsx `VoiceActivity`), and the same row while a reply is read
 * aloud (`VoicePlaybackActivity`).
 */

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { useLoop } from '../ui/clock.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { MONO, useTokens } from '../ui/tokens.ts';
import type { Dictation } from './dictation.ts';
import { formatClock } from './media.ts';
import { stopReadAloud, useReadAloud } from './readAloud.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

const BAR_WEIGHTS = [0.5, 0.78, 1, 0.78, 0.5];

const LABELS = { idle: 'Voice dictation', recording: 'Stop dictation', transcribing: 'Transcribing dictation' } as const;

export function MicButton({ dictation, disabled }: { dictation: Dictation; disabled: boolean }) {
  const t = useTokens();
  const { status } = dictation;
  const active = status !== 'idle';
  const primary = t.dtPrimarySolid;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LABELS[status]}
      accessibilityState={{ disabled: disabled || status === 'transcribing', busy: status === 'transcribing' }}
      disabled={disabled || status === 'transcribing'}
      onPress={dictation.toggle}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mic,
        { borderRadius: t.radius.full, opacity: disabled ? 0.5 : 1 },
        active && { backgroundColor: mixPct(primary, pressed ? 0.15 : 0.1, 'transparent') },
        !active && pressed && { backgroundColor: t.uiControlHoverBackground },
      ]}
    >
      {status === 'recording' ? (
        <View style={[styles.stopGlyph, { backgroundColor: primary }]} />
      ) : status === 'transcribing' ? (
        <GlyphSpinner size={14} color={primary} style={styles.spinner} />
      ) : (
        <Codicon name="mic" size={19} color={t.uiTextSecondary} />
      )}
    </Pressable>
  );
}

export function DictationActivity({ dictation }: { dictation: Dictation }) {
  const t = useTokens();
  const { status, partial, level, elapsedSeconds } = dictation;
  if (status === 'idle') return null;
  const recording = status === 'recording';
  const primary = t.dtPrimarySolid;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[styles.activity, { borderRadius: t.radius.xl, borderColor: t.uiStrokeSecondary, backgroundColor: t.uiBgSecondary }]}
    >
      <View style={[styles.badge, { backgroundColor: mixPct(primary, recording ? 0.15 : 0.1, 'transparent') }]}>
        {recording ? (
          <Codicon name="mic" size={12} color={primary} />
        ) : (
          <GlyphSpinner size={14} color={primary} style={styles.badgeSpinner} />
        )}
      </View>
      <View style={styles.activityText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary }]}>
          {partial || (recording ? 'Dictating' : 'Transcribing')}
        </Text>
        <Text style={[styles.clock, { color: t.uiTextSecondary, fontFamily: MONO }]}>{formatClock(elapsedSeconds)}</Text>
      </View>
      <View accessible={false} style={styles.bars}>
        {BAR_WEIGHTS.map((weight, index) => {
          const height = recording ? 0.25 + Math.min(0.68, level * weight) : 0.25;
          return <View key={index} style={[styles.bar, { height: `${height * 100}%`, opacity: recording ? 0.8 : 0.45, backgroundColor: t.uiTextPrimary }]} />;
        })}
      </View>
    </View>
  );
}

const WAVE_MS = 1100;
const WAVE_HEIGHT = 16;

/** one bar of the playback waveform: a height that swells and falls a step behind its neighbour, as a transform only */
function WaveBar({ loop, index, color }: { loop: SharedValue<number> | null; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    if (!loop) return { transform: [{ scaleY: 0.5 }] };
    const swell = Math.abs(Math.sin((loop.value + index * 0.17) * Math.PI * 2));
    return { transform: [{ scaleY: 0.3 + 0.7 * swell }] };
  });
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

/**
 * The read-aloud row above the composer (desktop `VoicePlaybackActivity`):
 * "Preparing audio" with a spinner while the provider synthesizes, then
 * "Reading aloud" with a moving waveform, and Stop either way. It subscribes to
 * the playback itself, so the composer does not re-render with it.
 */
export function PlaybackActivity({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const { status } = useReadAloud();
  const reduced = useReducedMotion();
  const speaking = status === 'speaking';
  const loop = useLoop({ durationMs: WAVE_MS }, speaking && !reduced);
  if (status === 'idle') return null;
  const primary = t.dtPrimarySolid;
  return (
    <View style={style}>
      <View
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={[styles.activity, { borderRadius: t.radius.xl, borderColor: mixPct(primary, 0.2, 'transparent'), backgroundColor: mixPct(primary, 0.08, t.uiBgSecondary) }]}
      >
        <View style={[styles.badge, { backgroundColor: mixPct(primary, 0.15, 'transparent') }]}>
          {speaking ? (
            <Codicon name="unmute" size={12} color={primary} />
          ) : (
            <GlyphSpinner size={14} color={primary} style={styles.badgeSpinner} label="Preparing audio" />
          )}
        </View>
        <View style={styles.activityText}>
          <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary }]}>
            {speaking ? 'Reading aloud' : 'Preparing audio…'}
          </Text>
          {speaking ? (
            <View accessible={false} style={styles.wave}>
              {BAR_WEIGHTS.map((_, index) => (
                <WaveBar key={index} loop={reduced ? null : loop} index={index} color={primary} />
              ))}
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop reading aloud"
          onPress={stopReadAloud}
          hitSlop={8}
          style={({ pressed }) => [styles.stop, { borderRadius: t.radius.full }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
        >
          <Codicon name="mute" size={12} color={t.uiTextSecondary} />
          <Text style={{ color: t.uiTextSecondary, fontSize: 12, fontWeight: '500' }}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mic: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 12, height: 12, borderRadius: 3 },
  spinner: { transform: [{ scale: 1 }] },
  // desktop `flex h-8 items-center gap-2 rounded-xl border px-2.5 text-xs`
  activity: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderWidth: 1 },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeSpinner: { transform: [{ scale: 0.6 }] },
  activityText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: '500' },
  clock: { fontSize: 13 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 },
  bar: { width: 2, borderRadius: 1 },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: WAVE_HEIGHT },
  waveBar: { width: 2, height: WAVE_HEIGHT, borderRadius: 1, opacity: 0.8 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 8 },
});
