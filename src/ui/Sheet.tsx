/**
 * Bottom sheets: a list of actions, and a container for short forms. Sheets are
 * for pickers and confirms only (issue "App shell and navigation on a phone").
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTokens } from './tokens.ts';

export type SheetAction = { label: string; onPress: () => void; destructive?: boolean; detail?: string };

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.uiBgElevated,
              borderColor: t.uiStrokeSecondary,
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: t.uiStrokePrimary }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const t = useTokens();
  return (
    <Sheet visible={visible} onClose={onClose}>
      {title ? (
        <View style={styles.header}>
          <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => {
            onClose();
            action.onPress();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.uiRowActiveBackground }]}
        >
          <Text style={{ color: action.destructive ? t.dtDestructive : t.uiTextPrimary, fontSize: 15 }}>{action.label}</Text>
          {action.detail ? <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>{action.detail}</Text> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 20 },
});
