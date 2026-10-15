/**
 * The reaction picker (desktop message-reactions.tsx `ReactionPicker`): the six
 * quick emoji, then "+" for the rest. The desktop's full picker is a searchable
 * emoji grid; on a phone the system emoji keyboard is that grid, so "+" opens a
 * field that takes the first emoji typed or pasted.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Codicon } from '../ui/Codicon.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { firstEmoji, QUICK_REACTIONS } from './actionBar.ts';

export function ReactionSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected?: string;
  /** picking the emoji already chosen retracts it */
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const t = useTokens();
  const [more, setMore] = useState(false);

  const close = () => {
    setMore(false);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close}>
      <View style={styles.row}>
        {QUICK_REACTIONS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={emoji}
            accessibilityState={{ selected: selected === emoji }}
            onPress={() => {
              setMore(false);
              onSelect(emoji);
            }}
            style={[styles.cell, { borderRadius: t.radius.xl }, selected === emoji && { backgroundColor: t.uiControlActiveBackground }]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More emoji"
          accessibilityState={{ expanded: more }}
          onPress={() => setMore((open) => !open)}
          style={[styles.cell, { borderRadius: t.radius.xl }, more && { backgroundColor: t.uiControlActiveBackground }]}
        >
          <Codicon name="add" size={16} color={t.uiTextSecondary} />
        </Pressable>
      </View>
      {more ? (
        <View style={[styles.field, { borderBottomColor: t.uiStrokeSecondary }]}>
          <TextInput
            autoFocus
            value=""
            onChangeText={(text) => {
              const emoji = firstEmoji(text);
              if (emoji) {
                setMore(false);
                onSelect(emoji);
              }
            }}
            placeholder="Type or paste an emoji"
            placeholderTextColor={t.uiTextTertiary}
            selectionColor={t.uiAccent}
            accessibilityLabel="Emoji"
            style={{ color: t.uiTextPrimary, fontSize: 16, paddingVertical: 8 }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 4 },
  cell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22 },
  field: { marginHorizontal: 20, marginTop: 4, marginBottom: 8, borderBottomWidth: 1 },
});
