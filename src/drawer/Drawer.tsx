/**
 * The slide-over drawer (issue "App shell and navigation on a phone"): opened only by the app-bar
 * button, closed by the scrim, back, or picking a row. A SESSIONS | BOTS tab strip over the two lists
 * and a footer of chips for the connection, the active profile, Settings and signing out. The lists
 * live in SessionsPane and BotsPane; the desktop sidebar's geometry in rowGeometry.ts.
 */

import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Bot } from '../bots/roster.ts';
import type { ChatSnapshot, SessionInfo } from '../chat/controller.ts';
import { mixPct } from '../ui/color.ts';
import { tick } from '../ui/haptics.ts';
import { useTokens } from '../ui/tokens.ts';
import { BotsPane } from './BotsPane.tsx';
import { Footer } from './Footer.tsx';
import { SessionsPane, type SessionsListApi } from './SessionsPane.tsx';

export type DrawerTab = 'sessions' | 'bots';
export type { SessionsListApi };

type Props = {
  open: boolean;
  onClose: () => void;
  snapshot: ChatSnapshot;
  connectionLabel: string;
  /** the connection's base URL, which picks its glyph */
  connectionUrl: string;
  profileLabel: string;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  list: SessionsListApi;
  onNewSession: () => void;
  onOpenSession: (session: SessionInfo) => void;
  onSessionActions: (session: SessionInfo) => void;
  onOpenBot: (bot: Bot) => void;
  onBotActions: (bot: Bot) => void;
  onNewBot: () => void;
  onRetryRoster: () => void;
  onProfileChip: () => void;
  onSignOut: () => void;
  loadImage: (name: string) => Promise<string | null>;
};

const DURATION = 220;
const TABS: Array<{ value: DrawerTab; label: string }> = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'bots', label: 'Bots' },
];

export default function Drawer(props: Props) {
  const { open, onClose } = props;
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(Math.round(screenWidth * 0.84), 320);
  const progress = useSharedValue(open ? 1 : 0);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    progress.value = withTiming(open ? 1 : 0, { duration: DURATION, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished && !open) runOnJS(setMounted)(false);
    });
  }, [open, progress]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));

  if (!mounted) return null;

  // `--sidebar-edge-border`: the foreground at 7.5% (12% dark), the sidebar's one edge line
  const edge = mixPct(t.uiBase, t.renderedMode === 'dark' ? 0.12 : 0.075, 'transparent');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close drawer" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          { width, backgroundColor: t.uiBgSidebar, borderRightColor: edge, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 4 },
          panelStyle,
        ]}
        accessibilityViewIsModal
      >
        <TabStrip tab={props.tab} onTab={props.onTab} />
        {props.tab === 'sessions' ? (
          <SessionsPane
            snapshot={props.snapshot}
            list={props.list}
            onClose={onClose}
            onNewSession={props.onNewSession}
            onOpenSession={props.onOpenSession}
            onSessionActions={props.onSessionActions}
          />
        ) : (
          <BotsPane
            snapshot={props.snapshot}
            onOpenBot={props.onOpenBot}
            onBotActions={props.onBotActions}
            onNewBot={props.onNewBot}
            onRetryRoster={props.onRetryRoster}
            loadImage={props.loadImage}
          />
        )}
        <Footer
          link={props.snapshot.link}
          connectionLabel={props.connectionLabel}
          connectionUrl={props.connectionUrl}
          profileName={props.snapshot.profile}
          profileLabel={props.profileLabel}
          onProfileChip={props.onProfileChip}
          onSignOut={props.onSignOut}
          onClose={onClose}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The zone's tab strip (components/ui/pane-tab.tsx `PaneTabStrip`): tabs on the sidebar surface, the
 * active one in the foreground with a 2 px underline in the skin's primary, the label 0.6875rem medium
 * uppercase at the wide tracking. Parity deviation (touch): 40dp, not 28.
 */
function TabStrip({ tab, onTab }: { tab: DrawerTab; onTab: (tab: DrawerTab) => void }) {
  const t = useTokens();
  return (
    <View style={styles.strip} accessibilityRole="tablist">
      {TABS.map(({ value, label }, index) => {
        const active = value === tab;
        return (
          <Pressable
            key={value}
            onPress={() => {
              if (!active) tick();
              onTab(value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.tab,
              index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.uiStrokeQuaternary },
              pressed && !active && { backgroundColor: t.uiControlHoverBackground },
            ]}
          >
            <Text style={[styles.tabLabel, { color: active ? t.dtForeground : t.uiTextTertiary }]}>{label}</Text>
            {active ? <View pointerEvents="none" style={[styles.underline, { backgroundColor: t.uiAccentSecondary }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  strip: { flexDirection: 'row', height: 40 },
  tab: { justifyContent: 'center', paddingHorizontal: 16, maxWidth: 192 },
  underline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.55, textTransform: 'uppercase' },
});
