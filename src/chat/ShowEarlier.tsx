/**
 * The pill at the top of the transcript that pages older history in. Desktop
 * components/assistant-ui/thread/list.tsx: a full-radius, composer-filled,
 * hairline-bordered `text-xs` button, centred above the first row.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '../ui/tokens.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

export function ShowEarlier({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  const t = useTokens();
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.full },
          pressed && { backgroundColor: t.uiControlHoverBackground },
        ]}
      >
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>Show earlier messages</Text>
        {loading ? <GlyphSpinner size={14} color={t.uiTextTertiary} style={styles.spinner} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  spinner: { marginLeft: 6, transform: [{ scale: 0.7 }] },
});
