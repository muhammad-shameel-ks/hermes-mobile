/**
 * The preview viewer: a full-screen renderer for one file or artifact target
 * (issue "Panes and desktop-only power on a phone"). Text and code show as
 * monospace source, markdown through the transcript's renderer, images natively with pinch and pan,
 * static SVG through react-native-svg, and HTML as source with a share hand-off.
 * No web view: PDF and media get a notice and the share sheet. The binary and
 * large-file gates and their copy are the desktop's `LocalFilePreview`.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { OverlayScreen } from '../app/overlay.tsx';
import { saveImageToLibrary } from '../chat/cards/saveImage.ts';
import { Markdown } from '../chat/Markdown.tsx';
import { DiffView } from '../review/DiffView.tsx';
import { diffRows, fullFileDiffRows } from '../review/diff.ts';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { ZoomableImage } from '../ui/ZoomableImage.tsx';
import { gateway } from './gateway.ts';
import { displayPath, formatPreviewBytes, linkedPath } from './path.ts';
import {
  artifactFileName,
  classifyFile,
  composeArtifactHtml,
  mimeFor,
  TEXT_PREVIEW_MAX_BYTES,
  targetLabel,
  type ArtifactTarget,
  type FileTarget,
} from './preview.ts';
import { createFilesRest, errorMessage } from './rest.ts';
import { SourceView } from './SourceView.tsx';
import { prepareSvg, type PreparedSvg } from './svg.ts';
import { copyText, downloadToCache, shareFile, writeCacheText } from './transfer.ts';
import { EmptyState, HeaderAction, Loading, ModeSwitcher, useToast } from './ui.tsx';

type Mode = 'rendered' | 'source' | 'diff';

const MODE_LABELS: Record<Mode, string> = { source: 'SOURCE', rendered: 'PREVIEW', diff: 'DIFF' };

type Loaded =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; missing: boolean }
  | { kind: 'blocked'; reason: 'binary' | 'large'; size?: number }
  | { kind: 'noinline' }
  | { kind: 'image'; uri: string }
  | { kind: 'text'; text: string; truncated: boolean; svg: PreparedSvg | null; diff: string };

export default function PreviewScreen({ target, onClose }: { target: FileTarget | ArtifactTarget; onClose: () => void }) {
  return target.kind === 'artifact' ? <ArtifactPreview target={target} onClose={onClose} /> : <FilePreview target={target} onClose={onClose} />;
}

function FilePreview({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const t = useTokens();
  const toast = useToast();
  const label = targetLabel(target);
  const cls = classifyFile(target.path);
  const origin = target.origin ?? 'link';
  const path = origin === 'link' ? linkedPath(target.path, target.cwd) : target.path;
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [force, setForce] = useState(false);
  const [userMode, setUserMode] = useState<Mode | null>(null);
  const [svgFailed, setSvgFailed] = useState(false);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let active = true;
    const set = (next: Loaded) => active && setState(next);
    const { api, profile } = gateway();
    const rest = createFilesRest(api, profile);
    const spec = { origin, path, profile: profile(), sessionId: target.sessionId };

    set({ kind: 'loading' });
    (async () => {
      try {
        if (cls === 'pdf' || cls === 'media') return set({ kind: 'noinline' });
        if (cls === 'binary' && !force) return set({ kind: 'blocked', reason: 'binary', size: target.size });
        if (cls === 'image') {
          const file = await downloadToCache({ ...spec, name: label });
          return set({ kind: 'image', uri: file.uri });
        }

        const result = await rest.readText(path);
        if (!force && (result.binary || (result.byteSize ?? 0) > TEXT_PREVIEW_MAX_BYTES)) {
          return set({ kind: 'blocked', reason: result.binary ? 'binary' : 'large', size: result.byteSize });
        }
        const svg = cls === 'svg' && !result.truncated ? prepareSvg(result.text) : null;
        set({ kind: 'text', text: result.text, truncated: result.truncated, svg, diff: '' });

        // best effort: a file with uncommitted changes also offers its diff
        try {
          const root = await rest.gitRoot(path);
          const diff = root ? await rest.fileDiff(root, path) : '';
          if (active && diff.trim()) setState((prev) => (prev.kind === 'text' && prev.text === result.text ? { ...prev, diff } : prev));
        } catch {
          // no diff to offer
        }
      } catch (e) {
        const message = errorMessage(e);
        set({ kind: 'error', message, missing: /\b404\b|not found/i.test(message) });
      }
    })();
    return () => {
      active = false;
    };
  }, [path, target.sessionId, origin, cls, force, label, target.size]);

  const share = async (mimeType?: string, title?: string) => {
    try {
      const file = await downloadToCache({ origin, path, profile: gateway().profile(), sessionId: target.sessionId, name: label });
      await shareFile(file.uri, mimeType ?? mimeFor(label, target.mimeType), title ?? label);
    } catch (e) {
      toast.show(`Share failed: ${errorMessage(e)}`, 'error');
    }
  };

  const saveImage = async (uri: string) => {
    const notice = await saveImageToLibrary(uri);
    toast.show(notice.text, notice.tone);
  };

  const actions: SheetAction[] = [
    ...(state.kind === 'image' ? [{ label: 'Save to Photos', onPress: () => void saveImage(state.uri) }] : []),
    { label: 'Share', onPress: () => void share() },
    ...(cls === 'html' ? [{ label: 'Open in browser', onPress: () => void share('text/html', 'Open in browser') }] : []),
    { label: 'Copy path', onPress: () => void copyText(path) },
  ];

  const body = (() => {
    switch (state.kind) {
      case 'loading':
        return <Loading label="Loading preview" />;
      case 'error':
        return state.missing ? (
          <EmptyState
            tone="warning"
            title="File no longer exists"
            body={`${label} was deleted, moved, or its temporary location was cleared.`}
            primary={{ label: 'Close', onPress: onClose }}
          />
        ) : (
          <EmptyState title="Preview unavailable" body={state.message} primary={{ label: 'Close', onPress: onClose }} />
        );
      case 'blocked':
        return (
          <EmptyState
            tone="warning"
            title={state.reason === 'binary' ? 'This looks like a binary file' : 'This file is large'}
            body={
              state.reason === 'binary'
                ? `Previewing ${label} may show unreadable text.`
                : `${label} is ${formatPreviewBytes(state.size)}. Hermes will only show the first 512 KB.`
            }
            primary={{ label: 'Preview anyway', onPress: () => setForce(true) }}
            secondary={{ label: 'Share', onPress: () => void share() }}
          />
        );
      case 'noinline':
        return (
          <EmptyState
            title="No inline preview"
            body={`${mimeFor(label, target.mimeType)} cannot be previewed here. Share it to open it in another app.`}
            primary={{ label: 'Share', onPress: () => void share() }}
          />
        );
      case 'image':
        return <ZoomableImage uri={state.uri} alt={label} />;
      case 'text':
        return (
          <TextBody
            key={`${path}:${force}`}
            text={state.text}
            truncated={state.truncated}
            diff={state.diff}
            svg={svgFailed ? null : state.svg}
            onSvgError={() => setSvgFailed(true)}
            kind={cls}
            userMode={userMode}
            onMode={setUserMode}
          />
        );
    }
  })();

  return (
    <OverlayScreen title={label} onBack={onClose} trailing={state.kind === 'loading' ? undefined : <HeaderAction icon="export" label="Share and copy" onPress={() => setSheet(true)} />}>
      <View style={[styles.pathBar, { borderBottomColor: t.uiStrokeQuaternary }]}>
        <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.uiTextSecondary, fontFamily: MONO, fontSize: 11 }}>
          {displayPath(path)}
        </Text>
      </View>
      {body}
      {toast.node}
      <ActionSheet visible={sheet} title={label} actions={actions} onClose={() => setSheet(false)} />
    </OverlayScreen>
  );
}

function TextBody({
  text,
  truncated,
  diff,
  svg,
  onSvgError,
  kind,
  userMode,
  onMode,
}: {
  text: string;
  truncated: boolean;
  diff: string;
  svg: PreparedSvg | null;
  onSvgError: () => void;
  kind: ReturnType<typeof classifyFile>;
  userMode: Mode | null;
  onMode: (mode: Mode) => void;
}) {
  const t = useTokens();
  const hasDiff = diff.trim() !== '';
  const markdown = kind === 'markdown';
  // left to right: the most useful view lands first, as the desktop orders them
  const modes: Mode[] = [...(markdown || svg ? (['rendered'] as const) : []), 'source', ...(hasDiff ? (['diff'] as const) : [])];
  const auto: Mode = hasDiff ? 'diff' : markdown || svg ? 'rendered' : 'source';
  const mode = userMode && modes.includes(userMode) ? userMode : auto;
  const rows = useMemo(() => (mode === 'diff' ? (truncated ? diffRows(diff) : fullFileDiffRows(diff, text)) : []), [mode, diff, text, truncated]);

  return (
    <View style={styles.fill}>
      {truncated ? (
        <View style={[styles.truncated, { backgroundColor: t.uiBgTertiary, borderBottomColor: t.uiStrokeTertiary }]}>
          <Text style={{ color: t.uiTextTertiary, fontSize: 11 }}>Showing first 512 KB.</Text>
        </View>
      ) : null}
      <ModeSwitcher modes={modes} active={mode} labels={MODE_LABELS} onSelect={onMode} />
      <View style={styles.fill}>
        {mode === 'rendered' ? (
          svg ? (
            <SvgBody svg={svg} onError={onSvgError} />
          ) : (
            <ScrollView contentContainerStyle={styles.markdown}>
              <Markdown text={text} />
            </ScrollView>
          )
        ) : mode === 'diff' ? (
          <DiffView rows={rows} />
        ) : (
          <SourceView text={text} />
        )}
      </View>
    </View>
  );
}

function SvgBody({ svg, onError }: { svg: PreparedSvg; onError: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.svg}>
      <View style={{ width: '100%', aspectRatio: svg.aspect }}>
        <SvgXml xml={svg.xml} width="100%" height="100%" onError={onError} />
      </View>
    </ScrollView>
  );
}

function ArtifactPreview({ target, onClose }: { target: ArtifactTarget; onClose: () => void }) {
  const toast = useToast();
  const [userMode, setUserMode] = useState<Mode | null>(null);
  const [svgFailed, setSvgFailed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const svg = useMemo(() => (target.artifactKind === 'svg' ? prepareSvg(target.content) : null), [target]);

  const share = async (mimeType: string, content: string, name: string, title: string) => {
    try {
      await shareFile(writeCacheText(name, content).uri, mimeType, title);
    } catch (e) {
      toast.show(`Share failed: ${errorMessage(e)}`, 'error');
    }
  };

  const mime = target.artifactKind === 'html' ? 'text/html' : target.artifactKind === 'svg' ? 'image/svg+xml' : 'text/plain';
  const actions: SheetAction[] = [
    { label: 'Copy content', onPress: () => void copyText(target.content) },
    { label: 'Share file', onPress: () => void share(mime, target.content, artifactFileName(target), target.label) },
    ...(target.artifactKind === 'html'
      ? [{ label: 'Open in browser', onPress: () => void share('text/html', composeArtifactHtml(target.content), artifactFileName(target), 'Open in browser') }]
      : []),
  ];

  const live = svg && !svgFailed ? svg : null;
  const modes: Mode[] = live ? ['rendered', 'source'] : ['source'];
  const mode = userMode && modes.includes(userMode) ? userMode : modes[0];

  return (
    <OverlayScreen title={target.label} onBack={onClose} trailing={<HeaderAction icon="export" label="Share and copy" onPress={() => setSheet(true)} />}>
      <ModeSwitcher modes={modes} active={mode} labels={MODE_LABELS} onSelect={setUserMode} />
      <View style={styles.fill}>{mode === 'rendered' && live ? <SvgBody svg={live} onError={() => setSvgFailed(true)} /> : <SourceView text={target.content} />}</View>
      {toast.node}
      <ActionSheet visible={sheet} title={target.label} actions={actions} onClose={() => setSheet(false)} />
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  markdown: { paddingHorizontal: 16, paddingVertical: 12 },
  svg: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  pathBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  truncated: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
