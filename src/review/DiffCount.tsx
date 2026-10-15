/** desktop `DiffCount`: `+A −B` line churn in the semantic green and red. */

import { StyleSheet, Text, View } from 'react-native';

import { useTokens } from '../ui/tokens.ts';

export function DiffCount({ added, removed, size = 10.24 }: { added: number; removed: number; size?: number }) {
  const t = useTokens();
  if (!added && !removed) return null;
  return (
    <View style={styles.counts}>
      {added > 0 ? <Text style={{ color: t.uiGreen, fontSize: size, fontVariant: ['tabular-nums'] }}>{`+${added}`}</Text> : null}
      {removed > 0 ? <Text style={{ color: t.uiRed, fontSize: size, fontVariant: ['tabular-nums'] }}>{`−${removed}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ counts: { flexDirection: 'row', gap: 4, alignItems: 'center' } });
