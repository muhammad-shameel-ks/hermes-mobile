/**
 * The composer's dictation surface: the mic in the controls row (desktop
 * voice-fan.tsx hub) and the activity row above the composer while a take runs
 * (voice-activity.tsx `VoiceActivity`).
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { MONO, useTokens } from '../ui/tokens.ts';
import type { Dictation } from './dictation.ts';
import { formatElapsed } from './dictationText.ts';

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
      hitSlop={8}
      style={({ pressed }) => [
        styles.mic,
        { borderRadius: active ? t.radius.full : t.radius.md, opacity: disabled ? 0.5 : 1 },
        active && { backgroundColor: mixPct(primary, pressed ? 0.15 : 0.1, 'transparent') },
        !active && pressed && { backgroundColor: t.uiControlHoverBackground },
      ]}
    >
      {status === 'recording' ? (
        <View style={[styles.stopGlyph, { backgroundColor: primary }]} />
      ) : status === 'transcribing' ? (
        <ActivityIndicator size="small" color={primary} style={styles.spinner} />
      ) : (
        <Codicon name="mic" size={14} color={t.uiTextTertiary} />
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
          <ActivityIndicator size="small" color={primary} style={styles.badgeSpinner} />
        )}
      </View>
      <View style={styles.activityText}>
        <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary }]}>
          {partial || (recording ? 'Dictating' : 'Transcribing')}
        </Text>
        <Text style={[styles.clock, { color: t.uiTextSecondary, fontFamily: MONO }]}>{formatElapsed(elapsedSeconds)}</Text>
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

const styles = StyleSheet.create({
  mic: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 10, height: 10, borderRadius: 2 },
  spinner: { transform: [{ scale: 0.75 }] },
  // desktop `flex h-8 items-center gap-2 rounded-xl border px-2.5 text-xs`
  activity: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderWidth: 1 },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeSpinner: { transform: [{ scale: 0.6 }] },
  activityText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  title: { flexShrink: 1, fontSize: 12, fontWeight: '500' },
  clock: { fontSize: 11 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 },
  bar: { width: 2, borderRadius: 1 },
});
