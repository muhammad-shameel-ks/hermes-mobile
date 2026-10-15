/**
 * The launch prompt: checks GitHub when the app opens and when it comes back to
 * the foreground (throttled), and offers a newer release in a bottom sheet. The
 * sheet follows the download through to the system installer.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../settings/primitives.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { formatBytes, notesPreview } from './release.ts';
import type { UpdateState } from './store.ts';
import { AUTO_CHECK_ENABLED, updates } from './updater.ts';

const LAUNCH_CHECK_DELAY_MS = 3000;

export function useUpdates(): UpdateState {
  return useSyncExternalStore(updates.subscribe, updates.getSnapshot);
}

export function UpdateProgress({ progress }: { progress: number | null }) {
  const t = useTokens();
  return (
    <View style={[styles.track, { backgroundColor: t.uiBgQuaternary }]}>
      <View style={[styles.fill, { backgroundColor: t.uiAccent, width: `${Math.round((progress ?? 0.05) * 100)}%` }]} />
    </View>
  );
}

export const downloadLabel = (progress: number | null) => (progress === null ? 'Downloading…' : `Downloading… ${Math.round(progress * 100)}%`);

export default function UpdatePrompt() {
  const t = useTokens();
  const state = useUpdates();

  useEffect(() => {
    if (!AUTO_CHECK_ENABLED) return;
    // the first check waits out the launch: the gateway handshake and the first paint come before a release lookup
    const first = setTimeout(() => void updates.check('auto'), LAUNCH_CHECK_DELAY_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void updates.check('auto');
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  const visible = AUTO_CHECK_ENABLED && updates.shouldPrompt();
  const release = 'release' in state ? state.release : null;
  if (!release) return null;

  const notes = notesPreview(release.notes);
  const size = formatBytes(release.apkSize);

  return (
    <Sheet visible={visible} onClose={() => updates.dismiss()}>
      <View style={styles.body}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>Update available</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }}>
          {`Hermes ${release.version} is ready to install. You have ${updates.currentVersion}.`}
        </Text>
        {notes ? (
          <Text style={{ color: t.uiTextSecondary, fontSize: 13, lineHeight: 19, marginTop: 12 }} numberOfLines={8}>
            {notes}
          </Text>
        ) : null}
        {state.kind === 'downloading' ? (
          <View style={styles.progress}>
            <UpdateProgress progress={state.progress} />
            <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 6 }}>{downloadLabel(state.progress)}</Text>
          </View>
        ) : null}
        {state.kind === 'error' ? <Text style={{ color: t.dtDestructive, fontSize: 12, marginTop: 12 }}>{state.message}</Text> : null}
        <View style={styles.buttons}>
          {state.kind === 'ready' ? (
            <ActionButton label="Install" icon="desktop-download" onPress={() => void updates.install()} style={styles.grow} />
          ) : (
            <ActionButton
              label={state.kind === 'error' ? 'Try again' : size ? `Update (${size})` : 'Update'}
              icon="download"
              busy={state.kind === 'downloading'}
              onPress={() => void updates.update()}
              style={styles.grow}
            />
          )}
          <ActionButton label="Later" variant="secondary" onPress={() => updates.dismiss()} />
        </View>
        {state.kind === 'available' ? (
          <ActionButton label="Skip this version" variant="ghost" onPress={() => void updates.skip()} style={styles.skip} />
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4 },
  progress: { marginTop: 14 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 16 },
  grow: { flex: 1 },
  skip: { marginTop: 4 },
});
