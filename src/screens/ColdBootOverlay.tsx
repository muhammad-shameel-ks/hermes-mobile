/**
 * The overlay over the signed-in app until its first socket opens (desktop
 * gateway-connecting-overlay.tsx + boot-failure-overlay.tsx): the decoded
 * CONNECTING word while the first dial is under way, the failure card when the
 * gateway does not answer or is not supported, and the desktop's exit
 * choreography once the socket opens. After that first open it never returns -
 * later drops are the chat's own reconnect banner.
 */

import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bootFailureCopy } from '../app/boot-state.ts';
import type { LinkState } from '../gateway/link.ts';
import { useTokens } from '../ui/tokens.ts';
import { BOOT_COPY, ConnectingView, FailureCard, useConnectingPhase } from './BootScreens.tsx';

export default function ColdBootOverlay({ link, onRetry, onSignOut }: { link: LinkState; onRetry: () => void; onSignOut: () => void }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const phase = useConnectingPhase(link.kind === 'open');
  if (phase === 'gone') return null;

  if (phase === 'live' && (link.kind === 'waiting' || link.kind === 'unsupported')) {
    const unsupported = link.kind === 'unsupported';
    const copy = unsupported ? null : bootFailureCopy(link.detail);
    return (
      <View style={[styles.fill, { backgroundColor: t.uiChatSurfaceBackground, paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <FailureCard
          icon="debug-disconnect"
          title={unsupported ? BOOT_COPY.unsupportedTitle : BOOT_COPY.connectionLost}
          description={unsupported ? link.detail : BOOT_COPY.connectionLostDetail}
          headline={copy?.headline}
          rawDetail={copy?.rawDetail}
          actions={[
            ...(unsupported ? [] : [{ key: 'retry', label: BOOT_COPY.reconnectNow, icon: 'sync' as const, onPress: onRetry }]),
            { key: 'signout', label: BOOT_COPY.signOut, variant: unsupported ? ('default' as const) : ('secondary' as const), onPress: onSignOut },
          ]}
          hint={unsupported ? BOOT_COPY.unsupportedDetail : undefined}
        />
      </View>
    );
  }

  return <ConnectingView phase={phase} />;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
