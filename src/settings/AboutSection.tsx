/**
 * Settings → About (desktop app/settings/about-settings.tsx and
 * components/version-details.tsx): the app's version, and the build identity the
 * phone stamps in every gate receipt - the vendored Hermes commit, the gateway
 * contract hash and the live server's version, read from `/api/status`. The
 * update card checks GitHub releases instead of the desktop's updater; uninstall
 * has no phone counterpart.
 */

import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import app from '../../app.json';
import manifest from '../../vendor/hermes-shared/MANIFEST.json';
import { probeGateway } from '../gateway/status.ts';
import UpdatesSection from '../updates/UpdatesSection.tsx';
import { useTokens } from '../ui/tokens.ts';
import { aboutRows, buildIdentity, REPO_COMMIT_URL, shortVersion } from './about.ts';
import { useSettings } from './context.tsx';
import { DetailRow, SettingsContent } from './primitives.tsx';

/** desktop `updates.appName` / `updates.version` */
const APP_NAME = 'Hermes';

export default function AboutSection() {
  const t = useTokens();
  const { connection } = useSettings();
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void probeGateway(connection.baseUrl, { signal: abort.signal }).then((probe) => {
      if ('status' in probe && probe.status.version) setServerVersion(probe.status.version);
    });
    return () => abort.abort();
  }, [connection.baseUrl]);

  const identity = buildIdentity(app.expo.version, manifest, serverVersion);
  const rows = aboutRows(identity);

  return (
    <SettingsContent>
      <View style={styles.hero}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 18, fontWeight: '600', letterSpacing: -0.2 }}>{APP_NAME}</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 4 }}>{`Version ${shortVersion(identity.appVersion)}`}</Text>
      </View>
      <View style={[styles.details, { borderColor: t.uiStrokeSecondary, backgroundColor: t.uiBgCard, borderRadius: t.radius['3xl'] }]}>
        {rows.map((row) => (
          <DetailRow
            key={row.label}
            {...row}
            onPress={row.label === 'Hermes commit' && identity.commit ? () => void Linking.openURL(`${REPO_COMMIT_URL}${identity.commit}`) : undefined}
          />
        ))}
      </View>
      <View style={styles.updates}>
        <UpdatesSection />
      </View>
    </SettingsContent>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 24, paddingBottom: 16 },
  details: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  updates: { marginTop: 24 },
});
