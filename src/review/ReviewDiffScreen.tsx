/**
 * One changed file's unified diff, on its own route. The header line carries the
 * path, its churn and whether it is staged; the body is the windowed row view
 * with line numbers from the hunk headers. Copy is the desktop's.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OverlayScreen } from '../app/overlay.tsx';
import { gateway } from '../files/gateway.ts';
import { paletteFor } from '../files/palette.ts';
import { baseName, displayPath, joinPath } from '../files/path.ts';
import { createReviewRest, errorMessage } from '../files/rest.ts';
import { copyText } from '../files/transfer.ts';
import { EmptyState, ErrorBanner, HeaderAction, Loading } from '../files/ui.tsx';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { DiffView } from './DiffView.tsx';
import { diffRows, isBinaryDiff } from './diff.ts';
import { DiffCount } from './DiffCount.tsx';
import type { ReviewTarget } from './ReviewScreen.tsx';
import type { ReviewFile } from './tree.ts';

export default function ReviewDiffScreen({
  file,
  target,
  onClose,
  onOpenFile,
}: {
  file: ReviewFile;
  target: ReviewTarget;
  onClose: () => void;
  onOpenFile: (absolutePath: string, cwd: string) => void;
}) {
  const t = useTokens();
  const palette = paletteFor(t);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let active = true;
    setDiff(null);
    setError(null);
    createReviewRest(gateway().api)
      .diff(target.cwd, file.path, target.scope, target.base, file.staged)
      .then((text) => active && setDiff(text))
      .catch((e) => active && (setError(errorMessage(e)), setDiff('')));
    return () => {
      active = false;
    };
  }, [file.path, file.staged, target.cwd, target.scope, target.base]);

  const rows = useMemo(() => (diff ? diffRows(diff) : []), [diff]);
  const absolute = joinPath(target.cwd, file.path);
  const actions: SheetAction[] = [
    { label: 'Open file', onPress: () => onOpenFile(absolute, target.cwd) },
    { label: 'Copy path', onPress: () => void copyText(absolute) },
  ];

  return (
    <OverlayScreen title={baseName(file.path)} onBack={onClose} trailing={<HeaderAction icon="ellipsis" label="File actions" onPress={() => setSheet(true)} />}>
      <View style={[styles.info, { borderBottomColor: t.uiStrokeSecondary }]}>
        <Text numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: t.uiTextSecondary, fontFamily: MONO, fontSize: 10.56 }}>
          {displayPath(file.path)}
        </Text>
        <DiffCount added={file.added} removed={file.removed} palette={palette} size={10.24} />
        {file.staged ? <Text style={{ color: palette.green, fontSize: 10 }}>Staged</Text> : null}
      </View>
      {error ? <ErrorBanner text={error} /> : null}
      {diff === null ? (
        <Loading label="Loading diff" />
      ) : rows.length ? (
        <DiffView rows={rows} />
      ) : (
        <EmptyState title={diff && isBinaryDiff(diff) ? 'Binary files differ' : 'No diff to show'} />
      )}
      <ActionSheet visible={sheet} title={displayPath(file.path)} actions={actions} onClose={() => setSheet(false)} />
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
