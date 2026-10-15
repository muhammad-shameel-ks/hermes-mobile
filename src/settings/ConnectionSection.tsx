/**
 * Settings → Connection (desktop app/settings/gateway-settings.tsx, "Gateway
 * Connection"): the one saved gateway - its label, URL and whether the sign-in
 * holds. The phone offers only OAuth, so the desktop's mode picker and token
 * field have no counterpart; Sign out forgets this phone's tokens.
 */

import { Text } from 'react-native';

import type { LinkState } from '../gateway/link.ts';
import { useTokens } from '../ui/tokens.ts';
import { useSettings } from './context.tsx';
import { ActionButton, DetailRow, ListRow, Pill, SettingsContent, SettingsSection } from './primitives.tsx';

/** desktop `settings.gateway`, with the remote-only copy kept where it still holds */
const COPY = {
  title: 'Gateway Connection',
  remoteUrlTitle: 'Remote URL',
  remoteUrlDesc: 'Base URL for the remote dashboard backend. Path prefixes are supported, for example /hermes.',
  authTitle: 'Authentication',
  signedIn: 'Signed in',
  authSignedInOauth: 'This gateway uses OAuth. You are signed in; the session refreshes automatically.',
  signOut: 'Sign out',
  signOutHint: 'Signing out forgets this phone’s tokens. The gateway keeps its token until it lapses.',
};

export function linkLabel(link: LinkState): { text: string; tone: 'success' | 'muted' | 'destructive' } {
  switch (link.kind) {
    case 'open':
      return { text: 'Connected', tone: 'success' };
    case 'connecting':
      return { text: 'Connecting…', tone: 'muted' };
    case 'waiting':
      return { text: 'Reconnecting…', tone: 'muted' };
    case 'paused':
      return { text: 'Paused', tone: 'muted' };
    case 'unsupported':
    case 'signed-out':
      return { text: 'Offline', tone: 'destructive' };
  }
}

export default function ConnectionSection() {
  const t = useTokens();
  const { connection, snapshot, onSignOut } = useSettings();
  const status = linkLabel(snapshot.link);
  const detail = snapshot.link.kind === 'unsupported' || snapshot.link.kind === 'signed-out' ? snapshot.link.detail : null;

  return (
    <SettingsContent>
      <SettingsSection title={COPY.title} icon="server" aside={<Pill tone={status.tone}>{status.text}</Pill>}>
        <DetailRow label="Name" value={connection.label} />
        <ListRow title={COPY.remoteUrlTitle} description={COPY.remoteUrlDesc} hint={connection.baseUrl} />
        {detail ? <Text style={{ color: t.dtDestructive, fontSize: t.type.caption, marginBottom: 8 }}>{detail}</Text> : null}
      </SettingsSection>
      <SettingsSection title={COPY.authTitle} icon="account" aside={<Pill tone="success">{COPY.signedIn}</Pill>}>
        <ListRow
          title={COPY.signedIn}
          description={COPY.authSignedInOauth}
          hint={COPY.signOutHint}
          action={<ActionButton label={COPY.signOut} variant="secondary" icon="log-in" onPress={onSignOut} />}
        />
      </SettingsSection>
    </SettingsContent>
  );
}
