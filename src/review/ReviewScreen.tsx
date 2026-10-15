/**
 * The Review surface: a read-only view of a working tree's changes (issue "Panes
 * and desktop-only power on a phone"). Scope row (uncommitted | branch | last
 * turn), the changed files as a tree or a list with their churn, and the branch
 * and base in this header. A file opens its unified diff on its own route. No
 * stage, revert, commit, push or branch controls exist here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { OverlayScreen } from '../app/overlay.tsx';
import { FileGlyph } from '../files/glyphs.tsx';
import { gateway } from '../files/gateway.ts';
import { displayPath, joinPath } from '../files/path.ts';
import { createFilesRest, createReviewRest, errorMessage, type RepoStatus } from '../files/rest.ts';
import { EmptyState, ErrorBanner, HeaderAction, Loading } from '../files/ui.tsx';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { mixPct } from '../ui/color.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { copyText } from '../files/transfer.ts';
import { DiffCount } from './DiffCount.tsx';
import {
  buildReviewFlatList,
  buildReviewTree,
  countAllNodes,
  flattenReviewRows,
  HEAVY_TREE_NODES,
  headerLine,
  isExcludedPath,
  matchReviewFile,
  REVIEW_SCOPES,
  STATUS_GLYPH,
  turnBaseFor,
  type ReviewFile,
  type ReviewRow,
  type ReviewScope,
} from './tree.ts';

export type ReviewTarget = { cwd: string; scope: ReviewScope; base: string | null };

export type ReviewScreenProps = {
  /** the repository; the gateway's default working directory when unknown */
  cwd?: string;
  scope?: ReviewScope;
  /** the last-turn baseline (a commit); the one recorded for `cwd` when absent */
  base?: string | null;
  /** a changed file to open straight away, matched on its path's tail */
  focusPath?: string;
  onClose: () => void;
  onOpenDiff: (file: ReviewFile, target: ReviewTarget) => void;
  onOpenFile: (absolutePath: string, cwd: string) => void;
};

// the reader's last choices, kept for the session like the desktop's persisted atoms
let rememberedScope: ReviewScope = 'uncommitted';
let rememberedTreeMode: 'tree' | 'list' = 'tree';

const INDENT = 12;
const BASE_INSET = 14;

export default function ReviewScreen({ cwd: givenCwd, scope: givenScope, base: givenBase, focusPath, onClose, onOpenDiff, onOpenFile }: ReviewScreenProps) {
  const t = useTokens();
  const { api, profile } = gateway();
  const files = useMemo(() => createFilesRest(api, profile), [api, profile]);
  const review = useMemo(() => createReviewRest(api), [api]);

  const [scope, setScopeState] = useState<ReviewScope>(givenScope ?? rememberedScope);
  const [treeMode, setTreeModeState] = useState(rememberedTreeMode);
  const [cwd, setCwd] = useState<string | null>(givenCwd?.trim() || null);
  const [status, setStatus] = useState<RepoStatus | undefined>(undefined);
  const [list, setList] = useState<{ files: ReviewFile[]; base: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [actions, setActions] = useState<ReviewFile | null>(null);
  const seq = useRef(0);
  const focused = useRef(false);

  const setScope = (next: ReviewScope) => {
    rememberedScope = next;
    setScopeState(next);
  };
  const toggleTreeMode = () => {
    rememberedTreeMode = treeMode === 'tree' ? 'list' : 'tree';
    setTreeModeState(rememberedTreeMode);
  };

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const dir = cwd ?? (await files.defaultCwd()).cwd;
      const base = givenBase ?? turnBaseFor(dir);
      const [repo, result] = await Promise.all([review.status(dir), review.list(dir, scope, base)]);
      if (mine !== seq.current) return;
      setCwd(dir);
      setStatus(repo);
      setList({ files: result.files.filter((file) => !isExcludedPath(file.path)), base: result.base });
    } catch (e) {
      if (mine !== seq.current) return;
      setList(null);
      setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [cwd, files, review, scope, givenBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const effectiveBase = givenBase ?? (cwd ? turnBaseFor(cwd) : null);
  const target = (dir: string): ReviewTarget => ({ cwd: dir, scope, base: effectiveBase });

  useEffect(() => {
    if (focused.current || !focusPath || !list || !cwd) return;
    focused.current = true;
    const match = matchReviewFile(list.files, focusPath);
    if (match) onOpenDiff(match, target(cwd));
  }, [list]);

  const tree = useMemo(() => (list ? (treeMode === 'tree' ? buildReviewTree(list.files) : buildReviewFlatList(list.files)) : []), [list, treeMode]);
  const heavy = useMemo(() => countAllNodes(tree) > HEAVY_TREE_NODES, [tree]);
  const rows = useMemo(() => flattenReviewRows(tree, (id) => open[id] ?? !heavy), [tree, open, heavy]);

  const hasFiles = (list?.files.length ?? 0) > 0;

  const rowActions = (file: ReviewFile): SheetAction[] => [
    { label: 'Open changes', onPress: () => cwd && onOpenDiff(file, target(cwd)) },
    { label: 'Open file', onPress: () => cwd && onOpenFile(joinPath(cwd, file.path), cwd) },
    { label: 'Copy path', onPress: () => void copyText(cwd ? joinPath(cwd, file.path) : file.path) },
  ];

  const renderRow = ({ item }: { item: ReviewRow }) => {
    const { node, depth } = item;
    const indent = depth * INDENT + BASE_INSET;
    if (node.isDir) {
      const isOpen = open[node.id] ?? !heavy;
      return (
        <Pressable
          onPress={() => setOpen((prev) => ({ ...prev, [node.id]: !isOpen }))}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          style={({ pressed }) => [styles.row, { paddingLeft: indent }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
        >
          <FileGlyph name={isOpen ? 'folder-opened' : 'folder'} size={14} color={t.uiTextTertiary} />
          <Text numberOfLines={1} style={[styles.name, { color: t.uiTextSecondary }]}>
            {node.name}
          </Text>
          {!isOpen ? <DiffCount added={node.added} removed={node.removed} /> : null}
        </Pressable>
      );
    }
    const file = node.file!;
    const glyph = STATUS_GLYPH[file.status] ?? STATUS_GLYPH.M;
    const tint = glyph.tone === 'green' ? t.uiGreen : glyph.tone === 'red' ? t.uiRed : glyph.tone === 'yellow' ? t.uiStatusModified : glyph.tone === 'blue' ? t.uiStatusRenamed : t.uiTextQuaternary;
    return (
      <Pressable
        onPress={() => cwd && onOpenDiff(file, target(cwd))}
        onLongPress={() => setActions(file)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={file.path}
        accessibilityHint="Long press for more actions"
        style={({ pressed }) => [styles.row, { paddingLeft: indent }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
      >
        <FileGlyph name={glyph.icon} size={14} color={tint} />
        <View style={styles.fileText}>
          <Text numberOfLines={1} style={[styles.name, { color: t.uiTextSecondary, flexShrink: 0, maxWidth: '100%' }]}>
            {node.name}
          </Text>
          {node.dir ? (
            <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.uiTextTertiary, fontSize: 11, flexShrink: 1, marginLeft: 6 }}>
              {node.dir}
            </Text>
          ) : null}
        </View>
        <DiffCount added={node.added} removed={node.removed} />
        {file.staged ? <View accessibilityLabel="Staged" style={[styles.staged, { backgroundColor: mixPct(t.uiGreen, 0.7, 'transparent') }]} /> : null}
      </Pressable>
    );
  };

  const subtitle = headerLine(status, scope, list?.base ?? effectiveBase);

  return (
    <OverlayScreen
      title="Review"
      onBack={onClose}
      trailing={
        <View style={styles.actions}>
          <HeaderAction icon={treeMode === 'tree' ? 'list-flat' : 'list-tree'} label={treeMode === 'tree' ? 'View as list' : 'View as tree'} onPress={toggleTreeMode} disabled={!hasFiles} />
          <HeaderAction icon="refresh" label="Refresh" onPress={() => void load()} busy={loading && !!list} />
        </View>
      }
    >
      <View style={[styles.info, { borderBottomColor: t.uiStrokeQuaternary }]}>
        <FileGlyph name="git-branch" size={13} color={t.uiTextTertiary} />
        <Text numberOfLines={1} style={{ flex: 1, color: t.uiTextSecondary, fontFamily: MONO, fontSize: 11 }}>
          {subtitle || displayPath(cwd) || 'Loading'}
        </Text>
      </View>
      <ScopeRow t={t} scope={scope} onSelect={setScope} />
      {error ? <ErrorBanner text={error} /> : null}
      {loading && !list ? (
        <Loading label="Loading changes" />
      ) : status === null ? (
        <EmptyState title="Not a git repository" body={displayPath(cwd)} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.node.id}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={loading && !!list} onRefresh={() => void load()} tintColor={t.uiTextTertiary} />}
          ListEmptyComponent={
            list ? <EmptyState title="No diffs" body={scope === 'lastTurn' && !effectiveBase ? 'The last turn has no starting point yet.' : undefined} /> : null
          }
          contentContainerStyle={hasFiles ? { paddingVertical: 4 } : styles.emptyList}
        />
      )}
      <ActionSheet visible={actions !== null} title={actions ? displayPath(actions.path) : undefined} actions={actions ? rowActions(actions) : []} onClose={() => setActions(null)} />
    </OverlayScreen>
  );
}

/** desktop `ReviewScopeRow`: a tinted track with a raised pill on the active scope. */
function ScopeRow({ t, scope, onSelect }: { t: Tokens; scope: ReviewScope; onSelect: (scope: ReviewScope) => void }) {
  return (
    <View style={styles.scopeWrap}>
      <View style={[styles.track, { backgroundColor: t.uiBgTertiary }]} accessibilityRole="tablist">
        {REVIEW_SCOPES.map(({ id, label }) => {
          const active = id === scope;
          return (
            <Pressable
              key={id}
              onPress={() => onSelect(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segment, active && { backgroundColor: t.dtBackground }]}
            >
              <Text numberOfLines={1} style={{ color: active ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 11, fontWeight: '500' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  scopeWrap: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  track: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 5 },
  segment: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingRight: 12 },
  name: { fontSize: 12, flexShrink: 1 },
  fileText: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline' },
  staged: { width: 6, height: 6, borderRadius: 3 },
  emptyList: { flexGrow: 1 },
});
