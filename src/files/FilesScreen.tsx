/**
 * The Files surface: one directory under the dashboard's files root. Each folder
 * is its own pushed route, so hardware back climbs a level at a time and leaves
 * the surface from the root. Browse, preview, download, share, upload and new
 * folder; delete, move and rename are deferred (issue "Panes and desktop-only
 * power on a phone"). Copy follows the dashboard's Files page.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { OverlayScreen } from '../app/overlay.tsx';
import { ActionSheet, Sheet, type SheetAction } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { FileGlyph } from './glyphs.tsx';
import { gateway } from './gateway.ts';
import { paletteFor } from './palette.ts';
import { baseName, displayPath, folderNameError, formatBytes, formatModified, joinPath } from './path.ts';
import { createFilesRest, errorMessage, type ManagedFileEntry, type ManagedFilesResponse } from './rest.ts';
import { copyText, downloadToCache, downloadToFolder, shareFile, uploadFile, type UploadSource } from './transfer.ts';
import { mimeFor } from './preview.ts';
import { EmptyState, ErrorBanner, HeaderAction, Loading, useToast } from './ui.tsx';
import { bumpFilesVersion, useFilesVersion } from './version.ts';

export type FilesScreenProps = {
  /** the files root; unknown (undefined) on the root screen, which learns it from its listing */
  root?: string;
  path?: string;
  onClose: () => void;
  onOpenDirectory: (root: string, path: string) => void;
  onOpenFile: (entry: ManagedFileEntry) => void;
};

export default function FilesScreen({ root, path, onClose, onOpenDirectory, onOpenFile }: FilesScreenProps) {
  const t = useTokens();
  const palette = paletteFor(t);
  const rest = useMemo(() => createFilesRest(gateway().api, gateway().profile), []);
  const version = useFilesVersion();
  const toast = useToast();

  const [listing, setListing] = useState<ManagedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSheet, setUploadSheet] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const [rowActions, setRowActions] = useState<ManagedFileEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setListing(await rest.list(path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [rest, path]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const activePath = listing?.path ?? path ?? '';
  const rootPath = root ?? listing?.locked_root ?? listing?.path ?? '';
  const title = root ? baseName(activePath || path || '') || 'Files' : 'Files';

  const upload = async (sources: UploadSource[]) => {
    if (!sources.length || !activePath) return;
    setUploading(true);
    try {
      for (const source of sources) await uploadFile(source, joinPath(activePath, source.name));
      toast.show(`${sources.length} file${sources.length === 1 ? '' : 's'} uploaded`);
      bumpFilesVersion();
    } catch (e) {
      toast.show(`Upload failed: ${errorMessage(e)}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType })));
  };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true });
    if (result.canceled) return;
    await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName || baseName(asset.uri), mimeType: asset.mimeType })));
  };

  const download = async (entry: ManagedFileEntry) => {
    try {
      if (await downloadToFolder({ origin: 'files', path: entry.path })) toast.show('Downloaded');
    } catch (e) {
      toast.show(`Download failed: ${errorMessage(e)}`, 'error');
    }
  };

  const share = async (entry: ManagedFileEntry) => {
    try {
      const file = await downloadToCache({ origin: 'files', path: entry.path, name: entry.name });
      await shareFile(file.uri, entry.mime_type || mimeFor(entry.name), entry.name);
    } catch (e) {
      toast.show(`Share failed: ${errorMessage(e)}`, 'error');
    }
  };

  const actionsFor = (entry: ManagedFileEntry): SheetAction[] =>
    entry.is_directory
      ? [
          { label: 'Open', onPress: () => onOpenDirectory(rootPath, entry.path) },
          { label: 'Copy path', onPress: () => void copyText(entry.path) },
        ]
      : [
          { label: 'Preview', onPress: () => onOpenFile(entry) },
          { label: 'Download', onPress: () => void download(entry) },
          { label: 'Share', onPress: () => void share(entry) },
          { label: 'Copy path', onPress: () => void copyText(entry.path) },
        ];

  const uploadActions: SheetAction[] = [
    { label: 'Files', onPress: () => void pickFiles() },
    { label: 'Photos and videos', onPress: () => void pickPhotos() },
  ];

  const renderRow = ({ item }: { item: ManagedFileEntry }) => {
    const broken = item.broken_link === true;
    const mono = { fontFamily: MONO, fontSize: t.type.base, color: broken ? t.uiTextTertiary : t.uiTextPrimary };
    return (
      <Pressable
        onPress={() => (item.is_directory ? onOpenDirectory(rootPath, item.path) : onOpenFile(item))}
        onLongPress={() => setRowActions(item)}
        delayLongPress={350}
        disabled={broken}
        accessibilityRole="button"
        accessibilityLabel={item.is_directory ? `Open ${item.name}` : item.name}
        accessibilityHint="Long press for more actions"
        style={({ pressed }) => [styles.row, { borderBottomColor: t.uiStrokeQuaternary }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
      >
        <View style={styles.lead}>
          <FileGlyph name={item.is_directory ? 'folder' : broken ? 'warning' : 'file'} size={16} color={item.is_directory ? palette.yellow : broken ? palette.red : t.uiTextTertiary} />
        </View>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={mono}>
            {item.name}
          </Text>
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: 11, marginTop: 2 }}>
            {broken ? 'Broken link' : item.is_directory ? formatModified(item.mtime) : `${formatBytes(item.size)} · ${formatModified(item.mtime)}`}
          </Text>
        </View>
        {!broken ? (
          <Pressable onPress={() => setRowActions(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Actions for ${item.name}`} style={styles.more}>
            <FileGlyph name="ellipsis" size={16} color={t.uiTextTertiary} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  return (
    <OverlayScreen
      title={title}
      onBack={onClose}
      trailing={
        <View style={styles.actions}>
          <HeaderAction icon="refresh" label="Refresh files" onPress={() => void load()} busy={loading && !!listing} />
          <HeaderAction icon="new-folder" label="Create folder" onPress={() => setFolderSheet(true)} disabled={!activePath} />
          <HeaderAction icon="cloud-upload" label="Upload files" onPress={() => setUploadSheet(true)} disabled={!activePath} busy={uploading} />
        </View>
      }
    >
      <View style={[styles.pathBar, { borderBottomColor: t.uiStrokeQuaternary }]}>
        <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.uiTextSecondary, fontFamily: MONO, fontSize: 11 }}>
          {displayPath(activePath) || 'Loading'}
        </Text>
      </View>
      {error ? <ErrorBanner text={error} /> : null}
      {loading && !listing ? (
        <Loading label="Loading files..." />
      ) : (
        <FlatList
          data={listing?.entries ?? []}
          keyExtractor={(entry) => entry.path}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={loading && !!listing} onRefresh={() => void load()} tintColor={t.uiTextTertiary} />}
          ListEmptyComponent={listing ? <EmptyState title="No files" /> : null}
          contentContainerStyle={listing && listing.entries.length === 0 ? styles.emptyList : undefined}
        />
      )}
      {toast.node}

      <ActionSheet visible={rowActions !== null} title={rowActions?.name} actions={rowActions ? actionsFor(rowActions) : []} onClose={() => setRowActions(null)} />
      <ActionSheet visible={uploadSheet} title="Upload" subtitle={displayPath(activePath)} actions={uploadActions} onClose={() => setUploadSheet(false)} />
      <NewFolderSheet
        visible={folderSheet}
        target={displayPath(activePath)}
        onClose={() => setFolderSheet(false)}
        onCreate={async (name) => {
          try {
            await rest.mkdir(joinPath(activePath, name));
            toast.show('Folder created');
            bumpFilesVersion();
            return true;
          } catch (e) {
            toast.show(`Create failed: ${errorMessage(e)}`, 'error');
            return false;
          }
        }}
      />
    </OverlayScreen>
  );
}

function NewFolderSheet({ visible, target, onClose, onCreate }: { visible: boolean; target: string; onClose: () => void; onCreate: (name: string) => Promise<boolean> }) {
  const t = useTokens();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = name ? folderNameError(name) : null;

  useEffect(() => {
    if (!visible) setName('');
  }, [visible]);

  const submit = async () => {
    if (busy || folderNameError(name)) return;
    setBusy(true);
    const ok = await onCreate(name.trim());
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose}>
      <View style={styles.sheetHeader}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>Create folder</Text>
        <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }}>{`Target: ${target || 'Loading'}`}</Text>
      </View>
      <View style={styles.sheetBody}>
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void submit()}
          editable={!busy}
          placeholder="Folder name"
          placeholderTextColor={t.uiTextQuaternary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Folder name"
          style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
        {problem ? <Text style={{ color: t.dtDestructive, fontSize: 12, marginTop: 6 }}>{problem}</Text> : null}
        <View style={styles.sheetButtons}>
          <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: t.uiStrokePrimary, borderRadius: t.radius['3xl'] }]}>
            <Text style={{ color: t.uiTextPrimary, fontSize: 13 }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void submit()}
            disabled={busy || !name.trim() || problem !== null}
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: t.dtPrimarySolid, borderColor: t.dtPrimarySolid, borderRadius: t.radius['3xl'], opacity: busy || !name.trim() || problem ? 0.5 : 1 }]}
          >
            <Text style={{ color: t.dtPrimarySolidForeground, fontSize: 13, fontWeight: '600' }}>Create</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
  pathBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 16, paddingRight: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  lead: { width: 24, alignItems: 'flex-start' },
  rowText: { flex: 1, minWidth: 0, paddingVertical: 8 },
  more: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyList: { flexGrow: 1 },
  sheetHeader: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 8 },
  input: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  sheetButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  button: { paddingHorizontal: 16, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth },
});
