/**
 * The connect screen: one gateway address, validated as it is typed.
 *
 * Type an address -> a pause in typing -> GET /api/status -> a gateway that
 * advertises native_pkce gets the Sign in button. There is no "Check" step.
 * Anything else is an explicit state: not a Hermes gateway, no auth gate, an
 * unsupported flow list, or unreachable. There is no password form, by decision.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import { signIn, type SignInFailure } from '../auth/native-flow.ts';
import { createConnectionId, saveConnection, saveCredentials, type SavedConnection } from '../auth/store.ts';
import type { Credentials } from '../auth/tokens.ts';
import type { GatewayAddress } from '../gateway/address.ts';
import { createAutoProbe, type AutoProbe, type AutoProbeState } from '../gateway/auto-probe.ts';
import { probeGateway, type GatewayProbe, type GatewayStatus } from '../gateway/status.ts';
import { theme } from '../ui/theme.ts';

type Problem = { title: string; detail?: string; hint?: string; retryable: boolean };

type FieldState =
  | { kind: 'empty' }
  | { kind: 'waiting' }
  | { kind: 'checking'; address: GatewayAddress }
  | { kind: 'ready'; address: GatewayAddress; status: GatewayStatus }
  | { kind: 'invalid'; reason: string }
  | { kind: 'problem'; address: GatewayAddress; problem: Problem };

const failureCopy: Record<SignInFailure, string> = {
  'callback-port-busy': 'The redirect port is busy',
  'state-mismatch': 'The gateway answered with a mismatched state',
  'exchange-failed': 'The gateway rejected the authorization code',
  'grant-timeout': 'The browser never returned a code',
  cancelled: 'Sign-in cancelled',
  unreachable: 'The gateway stopped answering',
  unexpected: 'Sign-in failed',
};

function describeProblem(probe: Exclude<GatewayProbe, { kind: 'ok' }>): Problem {
  switch (probe.kind) {
    case 'no-auth-gate':
      return {
        title: 'This gateway has no sign-in gate, so there is nothing to sign in to.',
        detail: `auth_required: false · auth_flows: ${probe.status.authFlows.join(', ') || 'none'}`,
        hint: 'Run the gateway with dashboard auth configured.',
        retryable: true,
      };
    case 'unsupported':
      return {
        title: 'This gateway does not offer native PKCE sign-in.',
        detail: `auth_flows: ${probe.status.authFlows.join(', ') || 'none'}`,
        hint: 'The phone signs in through the browser only; enable a provider that advertises native_pkce.',
        retryable: true,
      };
    case 'not-hermes':
      return {
        title: 'No Hermes gateway answered at this address.',
        detail: probe.detail,
        hint: 'Check the host and port, including the scheme.',
        retryable: false,
      };
    case 'http-error':
      return { title: `The gateway answered ${probe.httpStatus}.`, detail: probe.detail || undefined, retryable: true };
    case 'timeout':
      return { title: 'The gateway did not answer in time.', hint: 'Check that this device can reach it.', retryable: true };
    case 'unreachable':
      return { title: 'Could not reach the gateway.', detail: probe.detail, hint: 'Check the host and port.', retryable: true };
  }
}

function toView(state: AutoProbeState): FieldState {
  switch (state.kind) {
    case 'idle':
      return { kind: 'empty' };
    case 'pending':
      return { kind: 'waiting' };
    case 'invalid':
      return { kind: 'invalid', reason: state.reason };
    case 'probing':
      return { kind: 'checking', address: state.address };
    case 'probed':
      return state.probe.kind === 'ok'
        ? { kind: 'ready', address: state.address, status: state.probe.status }
        : { kind: 'problem', address: state.address, problem: describeProblem(state.probe) };
  }
}

const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));

export type ConnectScreenProps = {
  initialAddress: string;
  notice: string | null;
  existing: SavedConnection | null;
  onSignedIn: (connection: SavedConnection, credentials: Credentials, status: GatewayStatus) => void;
};

export default function ConnectScreen({ initialAddress, notice, existing, onSignedIn }: ConnectScreenProps) {
  const [address, setAddress] = useState(initialAddress);
  const [view, setView] = useState<FieldState>({ kind: 'empty' });
  const [focused, setFocused] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<{ title: string; detail: string } | null>(null);
  const autoRef = useRef<AutoProbe | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const auto = createAutoProbe({
      probe: (baseUrl, signal) => probeGateway(baseUrl, { signal }),
      onChange: (state) => {
        const next = toView(state);
        setView((previous) => {
          if (previous.kind !== next.kind) animateNext();
          return next;
        });
      },
    });
    autoRef.current = auto;
    if (initialAddress.trim() !== '') auto.input(initialAddress, { immediate: true });
    return () => {
      auto.dispose();
      autoRef.current = null;
      abortRef.current?.abort();
    };
    // The screen is re-keyed on initialAddress, so the first value is the only one.
  }, []);

  const onChangeText = (text: string) => {
    setAddress(text);
    if (signError) setSignError(null);
    autoRef.current?.input(text);
  };

  const signInToGateway = async () => {
    if (view.kind !== 'ready' || signing) return;
    const { address: target, status } = view;
    const controller = new AbortController();
    abortRef.current = controller;
    setSignError(null);
    setSigning(true);
    const result = await signIn(target.baseUrl, controller.signal);
    abortRef.current = null;
    setSigning(false);
    if (result.kind === 'failed') {
      if (result.reason !== 'cancelled') {
        animateNext();
        setSignError({ title: failureCopy[result.reason], detail: result.detail });
      }
      return;
    }
    const connection: SavedConnection = {
      id: existing && existing.baseUrl === target.baseUrl ? existing.id : createConnectionId(),
      label: target.label,
      baseUrl: target.baseUrl,
      authMode: 'oauth',
    };
    await saveConnection(connection);
    await saveCredentials(connection.id, result.credentials);
    onSignedIn(connection, result.credentials, status);
  };

  const onSubmit = () => {
    if (view.kind === 'ready') void signInToGateway();
    else autoRef.current?.input(address, { immediate: true });
  };

  const tone = view.kind === 'ready' ? 'good' : view.kind === 'invalid' || view.kind === 'problem' ? 'bad' : 'neutral';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.wordmark} accessibilityRole="header">
              Hermes
            </Text>
            <Text style={styles.subtitle}>Connect to your gateway to sign in.</Text>
          </View>

          {notice ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label} nativeID="gateway-address-label">
              Gateway address
            </Text>
            <View
              style={[
                styles.inputShell,
                focused && styles.inputFocused,
                tone === 'good' && styles.inputGood,
                tone === 'bad' && styles.inputBad,
                signing && styles.disabled,
              ]}
            >
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={onChangeText}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                editable={!signing}
                placeholder="192.168.1.20:9119"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType={view.kind === 'ready' ? 'go' : 'done'}
                onSubmitEditing={onSubmit}
                selectionColor={theme.text}
                accessibilityLabel="Gateway address"
                accessibilityLabelledBy="gateway-address-label"
              />
              <FieldIndicator view={view} />
            </View>

            <StatusLine view={view} />
          </View>

          {view.kind === 'ready' ? <ReadyCard address={view.address} status={view.status} /> : null}

          {view.kind === 'problem' ? (
            <ProblemCard problem={view.problem} onRetry={() => autoRef.current?.retry()} />
          ) : null}

          {view.kind === 'ready' ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: signing, busy: signing }}
                accessibilityHint="Opens the browser to finish signing in"
                onPress={() => void signInToGateway()}
                disabled={signing}
                style={({ pressed }) => [styles.primary, signing && styles.primaryBusy, pressed && styles.pressed]}
              >
                {signing ? (
                  <View style={styles.inline}>
                    <ActivityIndicator size="small" color={theme.primaryText} />
                    <Text style={styles.primaryText}>Waiting for the browser…</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryText}>Sign in</Text>
                )}
              </Pressable>

              {signing ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => abortRef.current?.abort()}
                  hitSlop={8}
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                >
                  <Text style={styles.textButtonText}>Cancel</Text>
                </Pressable>
              ) : (
                <Text style={styles.caption}>Your browser opens to finish signing in, then returns here.</Text>
              )}
            </View>
          ) : null}

          {signError ? (
            <View style={[styles.card, styles.problemCard]} accessibilityRole="alert">
              <Text style={styles.problemTitle}>{signError.title}</Text>
              {signError.detail ? <Text style={styles.detail}>{signError.detail}</Text> : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldIndicator({ view }: { view: FieldState }) {
  if (view.kind === 'checking') {
    return (
      <View style={styles.indicator} accessibilityLabel="Checking gateway">
        <ActivityIndicator size="small" color={theme.muted} />
      </View>
    );
  }
  if (view.kind === 'ready') {
    return (
      <View style={[styles.indicator, styles.badge, styles.badgeGood]} accessibilityLabel="Gateway found">
        <Text style={[styles.badgeGlyph, styles.badgeGlyphGood]}>✓</Text>
      </View>
    );
  }
  if (view.kind === 'invalid' || view.kind === 'problem') {
    return (
      <View style={[styles.indicator, styles.badge, styles.badgeBad]} accessibilityLabel="Problem with this address">
        <Text style={[styles.badgeGlyph, styles.badgeGlyphBad]}>!</Text>
      </View>
    );
  }
  return null;
}

function StatusLine({ view }: { view: FieldState }) {
  let text: string;
  let style: TextStyle = styles.statusMuted;
  switch (view.kind) {
    case 'empty':
    case 'waiting':
      text = 'Host and port. A bare host uses https, or http on a private network.';
      break;
    case 'checking':
      text = `Checking ${view.address.baseUrl}…`;
      break;
    case 'ready':
      text = 'Gateway found. You can sign in.';
      style = styles.statusGood;
      break;
    case 'invalid':
      text = view.reason;
      style = styles.statusBad;
      break;
    case 'problem':
      text = `Checked ${view.address.baseUrl}`;
      break;
  }
  return (
    <Text style={[styles.status, style]} accessibilityLiveRegion="polite" numberOfLines={2}>
      {text}
    </Text>
  );
}

function ReadyCard({ address, status }: { address: GatewayAddress; status: GatewayStatus }) {
  return (
    <View style={styles.card}>
      <Row label="endpoint" value={address.baseUrl} />
      <Row label="version" value={status.version ?? 'unknown'} />
      {status.authProviders.length > 0 ? <Row label="provider" value={status.authProviders.join(', ')} /> : null}
    </View>
  );
}

function ProblemCard({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  return (
    <View style={[styles.card, styles.problemCard]} accessibilityRole="alert">
      <Text style={styles.problemTitle}>{problem.title}</Text>
      {problem.detail ? (
        <Text style={styles.detail} numberOfLines={3}>
          {problem.detail}
        </Text>
      ) : null}
      {problem.hint ? <Text style={styles.hint}>{problem.hint}</Text> : null}
      {problem.retryable ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  content: { gap: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { gap: 6, marginBottom: 8 },
  wordmark: { color: theme.text, fontSize: 32, fontWeight: '700', fontFamily: theme.font },
  subtitle: { color: theme.muted, fontSize: 14, fontFamily: theme.font, lineHeight: 20 },
  notice: {
    borderLeftWidth: 2,
    borderLeftColor: theme.muted,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  noticeText: { color: theme.text, fontSize: 13, fontFamily: theme.font, lineHeight: 18 },
  field: { gap: 8 },
  label: { color: theme.muted, fontSize: 12, fontFamily: theme.font, letterSpacing: 0.3 },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    backgroundColor: theme.surface,
    minHeight: 50,
    paddingRight: 12,
  },
  inputFocused: { borderColor: theme.muted },
  inputGood: { borderColor: theme.success },
  inputBad: { borderColor: theme.danger },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontFamily: theme.font,
    fontSize: 16,
  },
  indicator: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 11, borderWidth: 1 },
  badgeGood: { borderColor: theme.success },
  badgeBad: { borderColor: theme.danger },
  badgeGlyph: { fontSize: 12, fontWeight: '700', fontFamily: theme.font, lineHeight: 14 },
  badgeGlyphGood: { color: theme.success },
  badgeGlyphBad: { color: theme.danger },
  status: { fontSize: 12, fontFamily: theme.font, lineHeight: 17, minHeight: 34 },
  statusMuted: { color: theme.muted },
  statusGood: { color: theme.success },
  statusBad: { color: theme.danger },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  problemCard: { borderColor: theme.danger },
  problemTitle: { color: theme.danger, fontSize: 14, fontWeight: '700', fontFamily: theme.font, lineHeight: 19 },
  detail: { color: theme.text, fontSize: 12, fontFamily: theme.font, lineHeight: 17 },
  hint: { color: theme.muted, fontSize: 12, fontFamily: theme.font, lineHeight: 17 },
  retry: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  retryText: { color: theme.text, fontSize: 13, fontFamily: theme.font },
  actions: { gap: 12, marginTop: 4 },
  primary: {
    backgroundColor: theme.primarySurface,
    borderRadius: 10,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBusy: { opacity: 0.6 },
  primaryText: { color: theme.primaryText, fontSize: 16, fontWeight: '700', fontFamily: theme.font },
  textButton: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  textButtonText: { color: theme.text, fontSize: 14, fontFamily: theme.font },
  caption: { color: theme.muted, fontSize: 12, fontFamily: theme.font, textAlign: 'center', lineHeight: 17 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowLabel: { color: theme.muted, fontSize: 12, fontFamily: theme.font, minWidth: 76 },
  rowValue: { color: theme.text, fontSize: 12, fontFamily: theme.font, flexShrink: 1 },
});
