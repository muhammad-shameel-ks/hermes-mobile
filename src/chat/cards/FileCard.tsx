/**
 * A delivered file the phone cannot play inline (a text file, a PDF, a
 * spreadsheet, an archive): the name and where it lives, with the desktop's two
 * actions - Open preview, which pushes the preview viewer, and Download, which
 * saves the file into a folder the reader picks. A long press copies the path.
 * A web URL has nothing to download from the gateway, so it only opens in the
 * system browser.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { gateway } from '../../files/gateway.ts';
import { linkedPath } from '../../files/path.ts';
import { errorMessage } from '../../files/rest.ts';
import { isWebUrl } from '../../files/preview.ts';
import { downloadToFolder } from '../../files/transfer.ts';
import { Codicon, type CodiconName } from '../../ui/Codicon.tsx';
import { copyText } from '../../ui/clipboard.ts';
import { useTokens } from '../../ui/tokens.ts';
import { filePathFromMediaPath, mediaName } from '../media.ts';
import { cardEnv } from './env.ts';
import { widgetShell } from './widgetShell.ts';

type Status = { text: string; tone: 'neutral' | 'error' } | null;

export function FileCard({ path }: { path: string }) {
  const t = useTokens();
  const [status, setStatus] = useState<Status>(null);
  const [downloading, setDownloading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const web = isWebUrl(path);
  const name = mediaName(path);
  const openPreview = cardEnv().openPreview;

  const serverPath = () => linkedPath(filePathFromMediaPath(path), cardEnv().openCwd?.());

  const flash = (next: NonNullable<Status>, ms = 2500) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus(next);
    timer.current = setTimeout(() => setStatus(null), ms);
  };

  const preview = () => {
    if (web) return openPreview ? openPreview({ kind: 'url', url: path }) : void copyText(path);
    if (!openPreview) return void copyText(path);
    openPreview({ kind: 'file', origin: 'link', path: serverPath(), cwd: cardEnv().openCwd?.() ?? undefined });
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const saved = await downloadToFolder({ origin: 'link', path: serverPath(), profile: gateway().profile() });
      if (saved) flash({ text: 'Downloaded', tone: 'neutral' });
    } catch (e) {
      flash({ text: `Download failed: ${errorMessage(e)}`, tone: 'error' }, 4000);
    } finally {
      setDownloading(false);
    }
  };

  const copy = () => {
    void copyText(path);
    flash({ text: 'Path copied', tone: 'neutral' }, 1500);
  };

  return (
    <View style={[widgetShell(t), styles.card, { maxWidth: 448 }]}>
      <Pressable
        onLongPress={copy}
        delayLongPress={350}
        onPress={preview}
        accessibilityRole="button"
        accessibilityLabel={web ? `Open ${name}` : `Open a preview of ${name}`}
        accessibilityHint="Long press to copy the path"
        style={styles.head}
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
      </Pressable>
      <View style={styles.actions}>
        <Action icon={web ? 'link-external' : 'eye'} label={web ? 'Open' : 'Open preview'} onPress={preview} />
        {web ? null : <Action icon="download" label={downloading ? 'Downloading…' : 'Download'} onPress={() => void download()} disabled={downloading} />}
        {status ? (
          <Text numberOfLines={status.tone === 'error' ? 3 : 1} accessibilityLiveRegion="polite" style={[styles.status, { color: status.tone === 'error' ? t.dtDestructive : t.uiTextTertiary, fontSize: t.type.tool }]}>
            {status.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: CodiconName; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        { borderColor: t.uiStrokeTertiary, borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent', opacity: disabled ? 0.55 : 1 },
      ]}
    >
      <Codicon name={icon} size={13} color={t.uiTextSecondary} />
      <Text style={{ color: t.uiTextSecondary, fontSize: t.type.tool, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginVertical: 6, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
  status: { flexShrink: 1 },
});
