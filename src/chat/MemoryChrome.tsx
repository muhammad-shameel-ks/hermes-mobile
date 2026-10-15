/**
 * The desktop's "legendary" memory chrome (styles.css `.tool-memory-legendary-*`,
 * tool/fallback.tsx and thread/system-message.tsx): a landed `memory` write and a
 * self-improvement review that saved something both wear a gold → purple brain
 * with a soft purple glow, a semibold gradient label and purple-tinted meta.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { GradientText, type GradientStop } from '../ui/GradientText.tsx';
import { useTokens } from '../ui/tokens.ts';
import { ToolIcon } from '../ui/ToolIcon.tsx';

const GLYPH = 14;

/** `linear-gradient(105deg, from 0%, mid 48%, to 100%)` */
export function useMemoryStops(): readonly GradientStop[] {
  const t = useTokens();
  return useMemo(
    () => [
      [0, t.toolMemoryLegendaryFrom],
      [0.48, t.toolMemoryLegendaryMid],
      [1, t.toolMemoryLegendaryTo],
    ],
    [t.toolMemoryLegendaryFrom, t.toolMemoryLegendaryMid, t.toolMemoryLegendaryTo],
  );
}

/** the brain in the legendary icon colour, under `drop-shadow(0 0 0.28rem glow)` */
export function MemoryGlyph({ size = GLYPH }: { size?: number }) {
  const t = useTokens();
  return (
    <View style={[styles.glyph, { shadowColor: t.toolMemoryLegendaryGlow }]}>
      <ToolIcon name="brain" size={size} color={t.toolMemoryLegendaryIcon} />
    </View>
  );
}

export function MemoryTitle({ children, style }: { children: string; style: TextStyle }) {
  const stops = useMemoryStops();
  return (
    <GradientText numberOfLines={1} stops={stops} style={[style, styles.title]}>
      {children}
    </GradientText>
  );
}

/**
 * A self-improvement review note: left-aligned in the reading column like every
 * other scaffold line, the label in the gradient and the detail in the meta purple.
 */
export function ReviewNote({ label, detail }: { label: string; detail: string }) {
  const t = useTokens();
  const text: TextStyle = { fontSize: t.type.tool, lineHeight: t.type.lineHeight };
  return (
    <View style={styles.note} accessible accessibilityRole="text" accessibilityLabel={detail ? `${label}: ${detail}` : label}>
      <View style={[styles.noteGlyph, { height: t.type.lineHeight }]}>
        <MemoryGlyph />
      </View>
      <View style={styles.noteBody}>
        <Text style={text}>
          <MemoryTitle style={text}>{label}</MemoryTitle>
          {detail ? <Text style={{ color: t.toolMemoryLegendaryMeta }}>{`  ${detail}`}</Text> : null}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { shadowOpacity: 1, shadowRadius: 4.5, shadowOffset: { width: 0, height: 0 } },
  title: { fontWeight: '600' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, alignSelf: 'stretch', paddingVertical: 2 },
  noteGlyph: { width: GLYPH, alignItems: 'center', justifyContent: 'center' },
  noteBody: { flex: 1, minWidth: 0 },
});
