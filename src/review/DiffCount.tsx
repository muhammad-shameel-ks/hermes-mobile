/** desktop `DiffCount`: `+A −B` line churn in the palette green and red. */

import { StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../files/palette.ts';

export function DiffCount({ added, removed, palette, size = 10.24 }: { added: number; removed: number; palette: Palette; size?: number }) {
  if (!added && !removed) return null;
  return (
    <View style={styles.counts}>
      {added > 0 ? <Text style={{ color: palette.green, fontSize: size, fontVariant: ['tabular-nums'] }}>{`+${added}`}</Text> : null}
      {removed > 0 ? <Text style={{ color: palette.red, fontSize: size, fontVariant: ['tabular-nums'] }}>{`−${removed}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ counts: { flexDirection: 'row', gap: 4, alignItems: 'center' } });
