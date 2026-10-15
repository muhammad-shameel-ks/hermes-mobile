/**
 * A messaging platform's chip (apps/desktop/src/components/ui/avatar-chip.tsx): the platform's colour at
 * 16% behind its monogram. Parity deviation: the desktop paints each brand's own glyph where its owner
 * publishes one; the phone carries only the monogram, which is the desktop's own fallback.
 */

import { StyleSheet, Text, View } from 'react-native';

import { mixPct, normalizeHex } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { platformColor } from './sessionSources.ts';

export function PlatformChip({ sourceId, label }: { sourceId: string; label: string }) {
  const t = useTokens();
  const brand = normalizeHex(platformColor(sourceId));
  const color = brand ?? t.uiTextTertiary;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.chip, { borderRadius: 4, backgroundColor: brand ? mixPct(brand, 0.16, 'transparent') : t.uiBgTertiary }]}
    >
      <Text allowFontScaling={false} style={[styles.letter, { color }]}>
        {Array.from(label.trim())[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
});
