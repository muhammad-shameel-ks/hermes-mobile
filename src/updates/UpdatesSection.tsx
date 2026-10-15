/**
 * Settings → About → Updates: check GitHub on demand and install a newer
 * release from here. Shares the launch prompt's store, so a download started in
 * either place shows its progress in both.
 */

import { Linking, Text, View } from 'react-native';

import { ActionButton, ListRow, SettingsSection } from '../settings/primitives.tsx';
import { useTokens } from '../ui/tokens.ts';
import { formatBytes, notesPreview } from './release.ts';
import type { UpdateState } from './store.ts';
import { downloadLabel, UpdateProgress, useUpdates } from './UpdatePrompt.tsx';
import { UPDATES_SUPPORTED, updates } from './updater.ts';

function describe(state: UpdateState, current: string): string {
  switch (state.kind) {
    case 'idle':
      return `You have ${current}.`;
    case 'checking':
      return 'Checking GitHub for a newer release…';
    case 'current':
      return `You're on the latest version (${current}).`;
    case 'available':
      return `Hermes ${state.release.version} is available. You have ${current}.`;
    case 'downloading':
      return downloadLabel(state.progress);
    case 'ready':
      return `Hermes ${state.release.version} is downloaded. Install it to finish updating.`;
    case 'error':
      return state.message;
  }
}

export default function UpdatesSection() {
  const t = useTokens();
  const state = useUpdates();
  if (!UPDATES_SUPPORTED) return null;

  const release = 'release' in state ? state.release : null;
  const notes = release ? notesPreview(release.notes) : '';
  const size = release ? formatBytes(release.apkSize) : '';

  const action =
    state.kind === 'available' || (state.kind === 'error' && release) ? (
      <>
        <ActionButton label={size ? `Update (${size})` : 'Update'} icon="download" onPress={() => void updates.update()} />
        {release?.pageUrl ? <ActionButton label="Release notes" variant="ghost" icon="link-external" onPress={() => void Linking.openURL(release.pageUrl)} /> : null}
      </>
    ) : state.kind === 'downloading' ? (
      <ActionButton label="Downloading" busy onPress={() => undefined} />
    ) : state.kind === 'ready' ? (
      <ActionButton label="Install" icon="desktop-download" onPress={() => void updates.install()} />
    ) : (
      <ActionButton label="Check for updates" variant="secondary" icon="sync" busy={state.kind === 'checking'} onPress={() => void updates.check('manual')} />
    );

  return (
    <SettingsSection title="Updates" icon="cloud">
      <ListRow
        title="App updates"
        description={
          <Text style={{ color: state.kind === 'error' ? t.dtDestructive : t.uiTextTertiary }}>{describe(state, updates.currentVersion)}</Text>
        }
        action={action}
      />
      {state.kind === 'downloading' ? (
        <View style={{ marginBottom: 8 }}>
          <UpdateProgress progress={state.progress} />
        </View>
      ) : null}
      {notes && state.kind !== 'downloading' ? (
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }}>{notes}</Text>
      ) : null}
    </SettingsSection>
  );
}
