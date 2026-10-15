/**
 * The Backend item's popover (desktop app/shell/gateway-menu-panel.tsx): the
 * connection and inference dots, the readiness reason, reconnect and restart, the
 * recent gateway activity and the messaging platforms.
 *
 * It floats above the status row like the desktop's `w-72` popover, in the chat's
 * own tree rather than a Modal so it rides the keyboard; an outside tap or the
 * hardware back closes it. The log tail polls only while the popover is mounted.
 * The desktop's "Open system panel" and "View all logs" have no phone surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { LinkState } from '../gateway/link.ts';
import { mixPct } from '../ui/color.ts';
import { press } from '../ui/haptics.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { COPY, LOG_POLL_MS, LOG_TAIL, logTail, menuRows, platformRows, type DotTone } from './backendHealth.ts';
import type { ChatController } from './controller.ts';
import { StateDot } from './StatusRows.tsx';
import type { GatewayHealthModel } from './useGatewayHealth.ts';

/** desktop `menuClassName: 'w-72'` */
const PANEL_WIDTH = 288;
const EDGE = 8;
const APP_BAR = 56;
const GAP = 4;
const LOG_MAX_HEIGHT = 160;

export type BackendAnchor = { x: number; bottom: number };

export function useBackendMenu(hidden: boolean) {
  const [anchor, setAnchor] = useState<BackendAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  // a menu left open behind a Bot Chat must not reappear when the chat closes
  useEffect(() => {
    if (hidden) setAnchor(null);
  }, [hidden]);
  return { open: anchor !== null && !hidden, anchor, show: setAnchor, close };
}

export function dotColor(t: Tokens, tone: DotTone): string {
  switch (tone) {
    case 'good':
      return t.dtPrimary;
    case 'warn':
      return '#f59e0b';
    case 'bad':
      return t.dtDestructive;
    default:
      return mixPct(t.dtMutedForeground, 0.4, 'transparent');
  }
}

type Props = {
  visible: boolean;
  anchor: BackendAnchor | null;
  controller: ChatController;
  link: LinkState;
  profile: string;
  model: GatewayHealthModel;
  onClose: () => void;
};

export function BackendPopover({ visible, anchor, ...rest }: Props) {
  if (!visible || !anchor) return null;
  return <Panel anchor={anchor} {...rest} />;
}

function useLogLines(controller: ChatController, profile: string): string[] {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await controller.api.get<{ lines?: unknown }>('/api/logs', { file: 'gui', lines: LOG_TAIL, profile });
        if (cancelled || !Array.isArray(result?.lines)) return;
        setLines(logTail(result.lines.filter((line): line is string => typeof line === 'string')));
      } catch {
        // the gateway is unreachable: keep the last tail
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [controller, profile]);
  return lines;
}

function Panel({ anchor, controller, link, profile, model, onClose }: Omit<Props, 'visible' | 'anchor'> & { anchor: BackendAnchor }) {
  const t = useTokens();
  const { width } = useWindowDimensions();
  const [space, setSpace] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const logRef = useRef<ScrollView>(null);
  const logs = useLogLines(controller, profile);
  const rows = menuRows(link, model.inference);
  const platforms = platformRows(model.status);
  const reason = model.inference?.reason;
  const busy = reconnecting || link.kind === 'connecting';

  const refresh = model.refresh;
  // one read per open, whichever callback identity it was handed
  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // an open transport can still be wedged: recovery stays reachable, and re-reads what the pill shows
  const reconnect = () => {
    if (busy) return;
    press();
    setReconnecting(true);
    controller.retryLink();
    void model.refresh().finally(() => setReconnecting(false));
  };

  const restart = () => {
    if (model.health.restarting) return;
    const confirmed = () => {
      press();
      onClose();
      void model.restart();
    };
    if (model.shared) {
      Alert.alert(COPY.sharedGatewayRestartTitle, COPY.sharedGatewayRestartDescription(model.shared.join(', ')), [
        { text: 'Cancel', style: 'cancel' },
        { text: COPY.sharedGatewayRestartConfirm, style: 'destructive', onPress: confirmed },
      ]);
    } else {
      Alert.alert(`${COPY.restartGateway}?`, 'The gateway restarts and the phone reconnects once it is back.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart', style: 'destructive', onPress: confirmed },
      ]);
    }
  };

  const panelWidth = Math.min(PANEL_WIDTH, width - EDGE * 2);
  const left = Math.max(EDGE, Math.min(anchor.x, width - panelWidth - EDGE));
  const bottom = anchor.bottom + GAP;
  const maxHeight = space > 0 ? Math.max(120, space - bottom - APP_BAR) : undefined;
  const sectionBorder = { borderTopColor: t.uiStrokeTertiary };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e) => setSpace(e.nativeEvent.layout.height)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close backend status" />
      <View
        accessibilityViewIsModal
        style={[
          styles.panel,
          { left, bottom, width: panelWidth, maxHeight, backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.lg },
        ]}
      >
        <ScrollView bounces={false} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.statusCol}>
              <View style={styles.statusLine}>
                <StateDot color={dotColor(t, rows.connectionTone)} />
                <Text style={[styles.statusText, { color: t.uiTextPrimary, fontWeight: '500' }]} numberOfLines={1}>
                  {rows.connectionLabel}
                </Text>
              </View>
              <View style={styles.statusLine}>
                <StateDot color={dotColor(t, rows.inferenceTone)} />
                <Text style={[styles.statusText, { color: t.uiTextTertiary }]} numberOfLines={1}>
                  {rows.inferenceLabel}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.reconnectGateway}
                accessibilityState={{ disabled: busy, busy }}
                disabled={busy}
                onPress={reconnect}
                hitSlop={6}
                style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.uiControlHoverBackground }]}
              >
                {busy ? <GlyphSpinner size={14} label={COPY.reconnectGateway} /> : <Codicon name="sync" size={14} color={t.uiTextTertiary} />}
              </Pressable>
              <View style={[styles.divider, { backgroundColor: t.uiStrokeSecondary }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.restartGateway}
                accessibilityState={{ disabled: model.health.restarting }}
                onPress={restart}
                hitSlop={6}
                style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.uiControlHoverBackground }]}
              >
                {({ pressed }) => <PowerIcon color={pressed ? t.dtDestructive : t.uiTextTertiary} />}
              </Pressable>
            </View>
          </View>

          {reason ? (
            <View style={[styles.section, sectionBorder]}>
              <Text style={[styles.reason, { color: t.uiTextTertiary }]} numberOfLines={3}>
                {reason}
              </Text>
            </View>
          ) : null}

          {logs.length > 0 ? (
            <View style={[styles.section, sectionBorder]}>
              <SectionLabel t={t} text={COPY.recentActivity} />
              <ScrollView
                ref={logRef}
                nestedScrollEnabled
                style={styles.log}
                onContentSizeChange={() => logRef.current?.scrollToEnd({ animated: false })}
              >
                <Text selectable style={[styles.logText, { color: t.uiTextTertiary }]}>
                  {logs.join('\n')}
                </Text>
              </ScrollView>
            </View>
          ) : null}

          {platforms.length > 0 ? (
            <View style={[styles.section, sectionBorder]}>
              <SectionLabel t={t} text={COPY.messagingPlatforms} />
              <View style={styles.platforms}>
                {platforms.map((platform) => (
                  <View key={platform.name} style={styles.platform}>
                    <Text style={[styles.platformName, { color: t.uiTextPrimary }]} numberOfLines={1}>
                      {platform.name}
                    </Text>
                    <View style={styles.statusLine}>
                      <StateDot color={dotColor(t, platform.tone)} />
                      <Text style={[styles.platformState, { color: t.uiTextTertiary }]} numberOfLines={1}>
                        {platform.label}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function SectionLabel({ t, text }: { t: Tokens; text: string }) {
  return <Text style={[styles.sectionLabel, { color: mixPct(t.dtMutedForeground, 0.8, 'transparent') }]}>{text.toUpperCase()}</Text>;
}

/** lucide `Power`, the desktop's restart glyph */
function PowerIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2v10" />
      <Path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  statusCol: { flex: 1, minWidth: 0, gap: 4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 11.2, lineHeight: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 16, marginHorizontal: 4 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  reason: { fontSize: 12, lineHeight: 16 },
  sectionLabel: { fontSize: 9.9, fontWeight: '600', letterSpacing: 1.4 },
  log: { marginTop: 6, maxHeight: LOG_MAX_HEIGHT },
  logText: { fontFamily: MONO, fontSize: 11, lineHeight: 16.5 },
  platforms: { marginTop: 6, gap: 4 },
  platform: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  platformName: { flexShrink: 1, fontSize: 12, textTransform: 'capitalize' },
  platformState: { fontSize: 10.56 },
});
