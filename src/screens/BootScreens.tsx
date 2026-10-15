/**
 * The phone's boot screens (issue "App shell and navigation on a phone": install,
 * onboarding, connecting, boot-failure and re-authentication become distinct
 * screens), ported from the desktop's gateway-connecting-overlay.tsx and
 * boot-failure-overlay.tsx.
 *
 * - connecting: the decoded "CONNECTING" word on the chat surface
 * - unreachable: the failure card - one classified sentence, raw text behind
 *   "Details", Gateway settings and Retry
 * - reauth / signed-out: the failure card's remote-sign-in variant with a
 *   "Sign in again" that runs the native PKCE flow for the saved gateway
 *
 * First-run onboarding stays the connect screen.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { SIGN_IN_FAILURE_COPY } from '../app/boot-state.ts';
import { signIn } from '../auth/native-flow.ts';
import { saveCredentials, type SavedConnection } from '../auth/store.ts';
import type { Credentials } from '../auth/tokens.ts';
import { ActionButton, type ButtonVariant } from '../settings/primitives.tsx';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { DecodeText } from '../ui/DecodeText.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';

/** desktop `en_boot` `boot.failure` / `boot.errors`, adapted where the desktop names a local backend */
export const BOOT_COPY = {
  connecting: 'CONNECTING',
  title: "Hermes couldn't start",
  description: "The gateway didn't answer. Try one of the recovery steps below. Nothing here deletes your chats or settings.",
  details: 'Details',
  retry: 'Retry',
  gatewaySettings: 'Gateway settings',
  remoteFailureHint: 'Check the gateway URL and sign-in under Gateway settings.',
  remoteTitle: 'Remote gateway sign-in required',
  remoteDescription: 'Your remote gateway session has expired. Sign in again to reconnect. Nothing here deletes your chats or settings.',
  signInAgain: 'Sign in again',
  cancel: 'Cancel',
  signedOutTitle: 'Signed out',
  signedOutDescription: (label: string) => `Sign in again to reconnect to ${label}. Your chats and settings are safe.`,
  signedOutHint: 'Signing out only forgets this phone’s tokens; the gateway keeps its token until it lapses.',
  connectionLost: 'Hermes lost its connection',
  connectionLostDetail: 'Still trying to reconnect. If this keeps up, reconnect now or sign out and check the gateway.',
  reconnectNow: 'Reconnect now',
  signOut: 'Sign out',
  unsupportedTitle: 'This gateway is not supported yet',
  unsupportedDetail: 'Sign out to connect to a different gateway.',
};

// ─── connecting ──────────────────────────────────────────────────────────────

export type ConnectingPhase = 'live' | 'text-out' | 'overlay-out' | 'gone';

/** desktop exit choreography (ms): text fades down and out, hold, then the overlay fades */
export const TEXT_OUT_MS = 360;
export const POST_TEXT_HOLD_MS = 300;
export const OVERLAY_OUT_MS = 520;

export function ConnectingView({ phase = 'live' }: { phase?: ConnectingPhase }) {
  const t = useTokens();
  const leaving = phase !== 'live';
  const hidden = phase === 'overlay-out' || phase === 'gone';
  const text = useSharedValue(leaving ? 1 : 0);
  const overlay = useSharedValue(hidden ? 1 : 0);

  useEffect(() => {
    text.value = withTiming(leaving ? 1 : 0, { duration: 300, easing: Easing.out(Easing.cubic) });
    overlay.value = withTiming(hidden ? 1 : 0, { duration: OVERLAY_OUT_MS, easing: Easing.out(Easing.cubic) });
  }, [leaving, hidden, text, overlay]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: 1 - overlay.value }));
  const textStyle = useAnimatedStyle(() => ({ opacity: 1 - text.value, transform: [{ translateY: text.value * 8 }] }));

  return (
    <Animated.View style={[styles.fill, styles.center, { backgroundColor: t.uiChatSurfaceBackground }, overlayStyle]} pointerEvents={hidden ? 'none' : 'auto'} accessibilityViewIsModal>
      <Animated.View style={textStyle}>
        {/* `--theme-primary` on the desktop; the accent is the same hue in the shipped skin */}
        <DecodeText text={BOOT_COPY.connecting} prefix={4} color={t.uiAccent} active={phase === 'live'} loop cursor />
      </Animated.View>
    </Animated.View>
  );
}

export function ConnectingScreen() {
  return <ConnectingView />;
}

/** the exit choreography around a connecting view that is dismissed when `connected` turns true */
export function useConnectingPhase(connected: boolean): ConnectingPhase {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<ConnectingPhase>('live');
  useEffect(() => {
    if (phase === 'live' && connected) setPhase(reduced ? 'gone' : 'text-out');
  }, [phase, connected, reduced]);
  useEffect(() => {
    if (phase === 'text-out') {
      const id = setTimeout(() => setPhase('overlay-out'), TEXT_OUT_MS + POST_TEXT_HOLD_MS);
      return () => clearTimeout(id);
    }
    if (phase === 'overlay-out') {
      const id = setTimeout(() => setPhase('gone'), OVERLAY_OUT_MS);
      return () => clearTimeout(id);
    }
  }, [phase]);
  return phase;
}

// ─── failure card ────────────────────────────────────────────────────────────

export type FailureAction = { key: string; label: string; onPress: () => void; variant?: ButtonVariant; icon?: CodiconName; busy?: boolean };

export function FailureCard({
  icon = 'warning',
  title,
  description,
  headline,
  rawDetail,
  actions,
  hint,
  footer,
}: {
  icon?: CodiconName;
  title: string;
  description: string;
  /** the one classified sentence in the red box */
  headline?: string | null;
  rawDetail?: string | null;
  actions: FailureAction[];
  hint?: string;
  footer?: ReactNode;
}) {
  const t = useTokens();
  const [showDetails, setShowDetails] = useState(false);
  const busy = actions.some((action) => action.busy);
  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.center, styles.cardScroll]} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { backgroundColor: t.uiChatBubbleBackground, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.xl }]}>
        <View style={styles.cardHead}>
          <Codicon name={icon} size={20} color={t.dtDestructive} style={styles.cardIcon} />
          <View style={styles.cardHeadText}>
            <Text accessibilityRole="header" style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 }}>
              {title}
            </Text>
            <Text style={{ color: t.uiTextTertiary, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{description}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          {headline ? (
            <View
              style={[
                styles.problem,
                { borderColor: mixPct(t.dtDestructive, 0.3, 'transparent'), backgroundColor: mixPct(t.dtDestructive, 0.1, 'transparent'), borderRadius: t.radius['2xl'] },
              ]}
              accessibilityRole="alert"
            >
              <Text style={{ color: t.dtDestructive, fontSize: 12, lineHeight: 18 }}>{headline}</Text>
              {rawDetail ? (
                <>
                  <Pressable onPress={() => setShowDetails((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }} hitSlop={8} style={styles.detailsToggle}>
                    <Text style={{ color: t.uiTextTertiary, fontSize: 12, fontWeight: '500' }}>{`${showDetails ? '▾' : '▸'} ${BOOT_COPY.details}`}</Text>
                  </Pressable>
                  {showDetails ? (
                    <ScrollView style={styles.rawBox} nestedScrollEnabled>
                      <Text selectable style={{ color: t.uiTextTertiary, fontFamily: MONO, fontSize: 11, lineHeight: 17 }}>
                        {rawDetail}
                      </Text>
                    </ScrollView>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            {actions.map((action) => (
              <ActionButton key={action.key} label={action.label} icon={action.icon} variant={action.variant} busy={action.busy} disabled={busy && !action.busy} onPress={action.onPress} />
            ))}
          </View>
          {hint ? <Text style={{ color: t.uiTextTertiary, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
          {footer}
        </View>
      </View>
    </ScrollView>
  );
}

// ─── unreachable ─────────────────────────────────────────────────────────────

export function UnreachableScreen({
  headline,
  detail,
  onRetry,
  onGatewaySettings,
}: {
  headline: string;
  detail: string | null;
  onRetry: () => void;
  onGatewaySettings: () => void;
}) {
  const t = useTokens();
  const [retrying, setRetrying] = useState(false);
  return (
    <View style={[styles.flex, { backgroundColor: t.uiChatSurfaceBackground }]}>
      <FailureCard
        icon="debug-disconnect"
        title={BOOT_COPY.title}
        description={BOOT_COPY.description}
        headline={headline}
        rawDetail={detail}
        hint={BOOT_COPY.remoteFailureHint}
        actions={[
          { key: 'settings', label: BOOT_COPY.gatewaySettings, onPress: onGatewaySettings },
          {
            key: 'retry',
            label: BOOT_COPY.retry,
            icon: 'sync',
            variant: 'secondary',
            busy: retrying,
            onPress: () => {
              setRetrying(true);
              onRetry();
            },
          },
        ]}
      />
    </View>
  );
}

// ─── sign in again ───────────────────────────────────────────────────────────

/** Re-authentication (the gateway refused the session) or signed out (the person left, or the phone holds no credential). */
export function SignInAgainScreen({
  variant,
  connection,
  reason,
  onSignedIn,
  onGatewaySettings,
}: {
  variant: 'reauth' | 'signed-out';
  connection: SavedConnection;
  reason?: string;
  onSignedIn: (credentials: Credentials) => void;
  onGatewaySettings: () => void;
}) {
  const t = useTokens();
  const [signing, setSigning] = useState(false);
  const [failure, setFailure] = useState<{ headline: string; detail: string | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    if (signing) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setFailure(null);
    setSigning(true);
    const result = await signIn(connection.baseUrl, controller.signal);
    abortRef.current = null;
    if (result.kind === 'failed') {
      setSigning(false);
      if (result.reason !== 'cancelled') setFailure({ headline: SIGN_IN_FAILURE_COPY[result.reason], detail: result.detail || null });
      return;
    }
    await saveCredentials(connection.id, result.credentials);
    onSignedIn(result.credentials);
  };

  const reauth = variant === 'reauth';
  return (
    <View style={[styles.flex, { backgroundColor: t.uiChatSurfaceBackground }]}>
      <FailureCard
        icon={reauth ? 'warning' : 'log-in'}
        title={reauth ? BOOT_COPY.remoteTitle : BOOT_COPY.signedOutTitle}
        description={reauth ? BOOT_COPY.remoteDescription : BOOT_COPY.signedOutDescription(connection.label)}
        headline={failure?.headline ?? (reauth ? reason : null)}
        rawDetail={failure?.detail ?? null}
        hint={reauth ? undefined : BOOT_COPY.signedOutHint}
        actions={[
          { key: 'signin', label: BOOT_COPY.signInAgain, icon: 'log-in', busy: signing, onPress: () => void start() },
          signing
            ? { key: 'cancel', label: BOOT_COPY.cancel, variant: 'ghost', onPress: () => abortRef.current?.abort() }
            : { key: 'settings', label: BOOT_COPY.gatewaySettings, variant: 'secondary', onPress: onGatewaySettings },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  cardScroll: { flexGrow: 1, padding: 24 },
  card: { width: '100%', maxWidth: 640, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  cardIcon: { marginTop: 2 },
  cardHeadText: { flex: 1, minWidth: 0 },
  cardBody: { gap: 16, padding: 20, paddingTop: 0 },
  problem: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12 },
  detailsToggle: { marginTop: 8, alignSelf: 'flex-start' },
  rawBox: { marginTop: 4, maxHeight: 128 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
