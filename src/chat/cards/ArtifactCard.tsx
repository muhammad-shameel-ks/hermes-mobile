/**
 * The transcript stand-in for a fenced block promoted to an artifact (a long
 * file, a full html page, a large graphic): a compact card with an icon, title
 * and kind. The desktop opens it in a right rail; there is no rail on a phone,
 * so it expands in place - a graphic draws natively, code and html show their
 * source - and copies from there. While the fence is still streaming it shows
 * the line count instead of the growing source. No version registry: the
 * Artifacts surface that would hold one is a later phase.
 */

import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Codicon } from '../../ui/Codicon.tsx';
import { DisclosureCaret } from '../../ui/motion.tsx';
import { MONO, useTokens } from '../../ui/tokens.ts';
import { artifactGeneratingLabel, artifactGlyph, artifactLineCount, ARTIFACT_KIND_LABEL, type ArtifactDetection } from '../artifact.ts';
import { copyText } from '../../ui/clipboard.ts';
import { SvgBlock } from './SvgBlock.tsx';
import { widgetShell } from './widgetShell.ts';

const MAX_SOURCE_LINES = 400;

function ArtifactCardImpl({ code, detection, streaming = false }: { code: string; detection: ArtifactDetection; streaming?: boolean }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const trimmed = code.trim();
  const lines = useMemo(() => artifactLineCount(trimmed), [trimmed]);
  const kindLabel = ARTIFACT_KIND_LABEL[detection.kind];
  const title = detection.title.trim() || kindLabel;
  const expanded = open && !streaming;

  return (
    <View style={[widgetShell(t), styles.card]}>
      <Pressable
        disabled={streaming}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded, disabled: streaming }}
        style={styles.head}
      >
        <View style={[styles.icon, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius.md }]}>
          <Codicon name={artifactGlyph(detection)} size={16} color={t.uiTextTertiary} />
        </View>
        <View style={styles.titles}>
          <Text numberOfLines={1} style={{ color: t.uiTextPrimary, opacity: streaming ? 0.55 : 1, fontSize: t.type.text, fontWeight: '500' }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>
            {streaming ? artifactGeneratingLabel(lines) : kindLabel}
          </Text>
        </View>
        {streaming ? null : <DisclosureCaret open={expanded} size={12} color={t.uiTextTertiary} />}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {detection.kind === 'svg' ? <SvgBlock xml={trimmed} /> : <Source text={trimmed} lines={lines} />}
          <Pressable onPress={() => void copyText(trimmed)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Copy content" style={styles.copy}>
            <Codicon name="copy" size={12} color={t.uiTextTertiary} />
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>Copy content</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Source({ text, lines }: { text: string; lines: number }) {
  const t = useTokens();
  const shown = lines > MAX_SOURCE_LINES ? text.split('\n').slice(0, MAX_SOURCE_LINES).join('\n') : text;
  return (
    <View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.code, { color: t.uiTextSecondary, fontSize: t.type.tool, lineHeight: t.type.tool * 1.55 }]}>
          {shown}
        </Text>
      </ScrollView>
      {lines > MAX_SOURCE_LINES ? (
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, marginTop: 6 }}>{`${lines - MAX_SOURCE_LINES} more lines; copy has them all`}</Text>
      ) : null}
    </View>
  );
}

export const ArtifactCard = memo(ArtifactCardImpl);

const styles = StyleSheet.create({
  card: { marginVertical: 6, maxWidth: 448 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0 },
  body: { marginTop: 10, gap: 8 },
  code: { fontFamily: MONO },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
});
