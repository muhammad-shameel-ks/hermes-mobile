/**
 * "Restored your unsent message" strip above the fresh chat's input, shown when
 * a session turned out to be gone and its draft moved here. Desktop
 * app/chat/composer/restored-draft-notice.tsx: it offers, never hijacks - no
 * focus move, no navigation - and Undo only applies while the text is untouched.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DraftStore } from '../store/drafts.ts';
import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { useRestoredDraft } from './useComposerDraft.ts';

export function RestoredDraftNotice({ drafts, profile, liveText }: { drafts: DraftStore; profile: string; liveText: string }) {
  const t = useTokens();
  const restored = useRestoredDraft(drafts);
  if (!restored || restored.profile !== profile) return null;
  const button = { borderRadius: t.radius.md };
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.row,
        { borderRadius: t.radius.lg, borderColor: mixPct(t.uiComposerRing, 0.32, 'transparent'), backgroundColor: mixPct(t.uiAccent, 0.18, 'transparent') },
      ]}
    >
      <Text style={[styles.text, { color: mixPct(t.uiTextTertiary, 0.88, 'transparent') }]}>Restored your unsent message</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => drafts.undoRestored(liveText)}
        style={({ pressed }) => [styles.button, button, pressed && { backgroundColor: t.uiControlHoverBackground }]}
      >
        <Text style={[styles.buttonText, { color: t.uiTextSecondary }]}>Undo</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={drafts.dismissRestored}
        style={({ pressed }) => [styles.button, button, pressed && { backgroundColor: t.uiControlHoverBackground }]}
      >
        <Text style={[styles.buttonText, { color: t.uiTextSecondary }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  text: { flex: 1, fontSize: 11.2 },
  button: { height: 24, minWidth: 24, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 10.9 },
});
