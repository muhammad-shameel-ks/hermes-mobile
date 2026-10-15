/**
 * A delivered file the phone cannot open (a PDF, a spreadsheet, an archive): the
 * name and where it lives, tap to copy the path. The desktop opens a preview
 * rail here; until the Files surface lands the card degrades to copy-path.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { mediaName } from '../media.ts';
import { copyText } from '../../ui/clipboard.ts';
import { widgetShell } from './widgetShell.ts';

export function FileCard({ path }: { path: string }) {
  const t = useTokens();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const name = mediaName(path);
  const onPress = () => {
    void copyText(path);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Copy the path of ${name}`}
      style={[widgetShell(t), styles.row, { maxWidth: 448 }]}
    >
      <View style={[styles.icon, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius.md }]}>
        <Codicon name="file" size={16} color={t.uiTextTertiary} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>
          {name}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>
          {path}
        </Text>
      </View>
      <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, fontWeight: '500' }}>{copied ? 'Copied' : 'Copy path'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
});
