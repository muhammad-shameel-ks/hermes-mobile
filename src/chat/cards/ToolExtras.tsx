/**
 * The pieces a tool row's body and header gain from the cards: the inline diff
 * a file edit carries (open by default, the desktop's `defaultOpen`), the image
 * a tool like `vision_analyze` shows, and the +/- counts beside a file edit's
 * title. MessageView's ToolRow mounts these; everything else stays its own.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MONO, useTokens } from '../../ui/tokens.ts';
import type { ToolView } from '../toolView.ts';
import { DiffView } from './DiffView.tsx';
import { MediaImage } from './MediaImage.tsx';

/** tailwind emerald-600 / 400 and rose-600 / 400, the colours the desktop's file-edit counts use */
const COUNT_COLORS = {
  add: { light: '#059669', dark: '#34d399' },
  remove: { light: '#e11d48', dark: '#fb7185' },
} as const;

export const ToolDiffStats = memo(function ToolDiffStats({ view }: { view: ToolView }) {
  const t = useTokens();
  const stats = view.diffStats;
  if (view.status === 'running' || !stats || (stats.added === 0 && stats.removed === 0)) return null;
  return (
    <View style={styles.stats}>
      {stats.added > 0 ? <Text style={[styles.count, { color: COUNT_COLORS.add[t.renderedMode] }]}>{`+${stats.added}`}</Text> : null}
      {stats.removed > 0 ? <Text style={[styles.count, { color: COUNT_COLORS.remove[t.renderedMode] }]}>{`−${stats.removed}`}</Text> : null}
    </View>
  );
});

export const ToolExtras = memo(function ToolExtras({ view }: { view: ToolView }) {
  const t = useTokens();
  if (!view.imageUrl && !view.inlineDiff) return null;
  return (
    <>
      {view.imageUrl ? (
        <View style={[styles.image, { borderColor: t.uiStrokeTertiary }]}>
          <MediaImage src={view.imageUrl} alt="Tool output" />
        </View>
      ) : null}
      {view.inlineDiff ? (
        <View style={styles.bleed}>
          <DiffView diff={view.inlineDiff} />
        </View>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 4 },
  // the tool body pads 6; tints and borders run flush to the card's edges (desktop `-mx-1.5 -mt-1.5 -mb-1.5`)
  bleed: { marginHorizontal: -6, marginTop: -6, marginBottom: -6 },
  count: { fontFamily: MONO, fontSize: 10, fontVariant: ['tabular-nums'] },
  // desktop `max-w-72 overflow-hidden rounded-[0.25rem] border`
  image: { maxWidth: 288, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 8 },
});
