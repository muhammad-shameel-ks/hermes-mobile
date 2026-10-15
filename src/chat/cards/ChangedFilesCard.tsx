/**
 * "N files changed", closing out the newest settled assistant turn: one row per
 * file the turn edited with its +/-, and a Review action for the read-only
 * review surface. A row opens that file's diff there; without the surface (it
 * lands in the next phase) a row copies the path and the action is absent.
 * Wears the shared widget shell like every other inline panel.
 */

import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { deriveChangedFiles, filesChangedLabel, type ChangedFile } from '../changedFiles.ts';
import type { Part } from '../transcript.ts';
import { copyPath } from './copyPath.ts';
import { cardEnv } from './env.ts';
import { widgetShell } from './widgetShell.ts';

/** the desktop's 9.375rem list box holds about this many rows */
const FOLDED_ROWS = 5;

function ChangedFilesCardImpl({ parts }: { parts: readonly Part[] }) {
  const t = useTokens();
  const files = useMemo(() => deriveChangedFiles(parts), [parts]);
  const [all, setAll] = useState(false);
  const openReview = cardEnv().openReview;

  if (files.length === 0) return null;

  const shown = all ? files : files.slice(0, FOLDED_ROWS);
  const open = (file: ChangedFile) => (openReview ? openReview(file.path) : void copyPath(file.path));

  return (
    <View style={[widgetShell(t), styles.card]}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary, fontSize: t.type.tool }]}>
          {filesChangedLabel(files.length)}
        </Text>
        {openReview ? (
          <Pressable onPress={() => openReview()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Review changes">
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>Review</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.rows}>
        {shown.map((file) => (
          <Pressable
            key={file.path}
            onPress={() => open(file)}
            accessibilityRole="button"
            accessibilityLabel={openReview ? `Review ${file.path}` : `Copy the path ${file.path}`}
            style={({ pressed }) => [styles.row, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
          >
            <Codicon name="file" size={14} color={t.uiTextTertiary} />
            <Text numberOfLines={1} style={[styles.name, { color: t.uiTextSecondary, fontSize: t.type.tool }]}>
              {file.name}
            </Text>
            <View style={styles.counts}>
              {file.added > 0 ? <Text style={[styles.count, { color: t.uiGreen, fontSize: t.type.tool }]}>{`+${file.added}`}</Text> : null}
              {file.removed > 0 ? <Text style={[styles.count, { color: t.uiRed, fontSize: t.type.tool }]}>{`−${file.removed}`}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>
      {files.length > FOLDED_ROWS ? (
        <Pressable onPress={() => setAll((value) => !value)} hitSlop={6} accessibilityRole="button" style={styles.more}>
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>{all ? 'Show fewer' : `Show ${files.length - FOLDED_ROWS} more files`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const ChangedFilesCard = memo(ChangedFilesCardImpl);

const styles = StyleSheet.create({
  card: { marginTop: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  rows: { marginTop: 6, marginHorizontal: -6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 6 },
  name: { flex: 1, minWidth: 0 },
  counts: { flexDirection: 'row', gap: 4 },
  count: { fontVariant: ['tabular-nums'] },
  more: { alignSelf: 'flex-start', paddingTop: 4 },
});
