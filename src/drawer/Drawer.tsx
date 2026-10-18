/**
 * The slide-over drawer (issue "App shell and navigation on a phone"): opened by the app-bar button or a
 * right swipe on the chat, closed by the scrim, back, a left swipe, or picking a row. A SESSIONS | BOTS
 * tab strip over the two lists and a footer of chips for the connection, the active profile, Settings
 * and signing out. The lists live in SessionsPane and BotsPane (the latter also showing group chats);
 * the desktop sidebar's geometry in rowGeometry.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Bot } from '../bots/roster.ts';
import { createDrawerSlice } from '../chat/chatSlices.ts';
import type { ChatController, SessionInfo } from '../chat/controller.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';
import { useGroups } from '../groups/hooks.ts';
import type { GroupsModel } from '../groups/model.ts';
import type { GroupRoom } from '../groups/rooms.ts';
import { mixPct } from '../ui/color.ts';
import { tick } from '../ui/haptics.ts';
import { useTokens } from '../ui/tokens.ts';
import { BotsPane } from './BotsPane.tsx';
import { Footer } from './Footer.tsx';
import { SessionsPane, type SessionsListApi } from './SessionsPane.tsx';
import { settleDrawer, useDrawerCloseGesture, useDrawerWidth } from './useDrawerGestures.ts';

export type DrawerTab = 'sessions' | 'bots';
export type { SessionsListApi };

type Props = {
  open: boolean;
  /** 0 shut to 1 open; the chat's open swipe drives it too, so the shell owns it */
  progress: SharedValue<number>;
  onClose: () => void;
  controller: ChatController;
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
  groups: GroupsModel;
  onOpenGroup: (room: GroupRoom) => void;
  onGroupActions: (room: GroupRoom) => void;
  onAdd: () => void;
  onRetryRoster: () => void;
  onRefreshRoster: () => Promise<unknown>;
  onProfileChip: () => void;
  loadImage: (name: string) => Promise<string | null>;
};

const TABS: Array<{ value: DrawerTab; label: string }> = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'bots', label: 'Bots' },
];

export default function Drawer(props: Props) {
  const { open, progress, onClose } = props;
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const width = useDrawerWidth();
  const [mounted, setMounted] = useState(open);
  const closeGesture = useDrawerCloseGesture(progress, open, onClose);

  useEffect(() => {
    if (open) setMounted(true);
    settleDrawer(progress, open);
  }, [open, progress]);

  // a swipe pulls the panel out before `open` flips, so it mounts with the first pixel and goes at the last
  useAnimatedReaction(
    () => progress.value > 0,
    (visible, was) => {
      if (visible !== was) scheduleOnRN(setMounted, visible);
    },
  );

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
    <GestureDetector gesture={closeGesture}>
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
          <DrawerContent {...props} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * The panes and footer, which read the chat snapshot. They mount with the drawer, so the subscription
 * exists only while it is on screen; a closed drawer costs the store nothing per streamed token, and an
 * open one re-renders when a session starts, ends or moves, not with the transcript.
 */
function DrawerContent(props: Props) {
  const slice = useMemo(createDrawerSlice, []);
  const snapshot = useChatSelector(props.controller, slice, shallowEqual);
  // the drawer mounts this only while open, so a closed drawer subscribes to neither store
  const groups = useGroups(props.groups);
  return (
    <>
      {props.tab === 'sessions' ? (
        <SessionsPane
          snapshot={snapshot}
          list={props.list}
          onClose={props.onClose}
          onNewSession={props.onNewSession}
          onOpenSession={props.onOpenSession}
          onSessionActions={props.onSessionActions}
        />
      ) : (
        <BotsPane
          snapshot={snapshot}
          groups={groups}
          onOpenBot={props.onOpenBot}
          onBotActions={props.onBotActions}
          onOpenGroup={props.onOpenGroup}
          onGroupActions={props.onGroupActions}
          onAddPress={props.onAdd}
          onRetryRoster={props.onRetryRoster}
          onRefresh={props.onRefreshRoster}
          loadImage={props.loadImage}
        />
      )}
      <Footer
        link={snapshot.link}
        connectionLabel={props.connectionLabel}
        connectionUrl={props.connectionUrl}
        profileName={snapshot.profile}
        profileLabel={props.profileLabel}
        showProfile={props.tab === 'sessions'}
        onProfileChip={props.onProfileChip}
        onClose={props.onClose}
      />
    </>
  );
}

/**
 * The zone's tab strip (components/ui/pane-tab.tsx `PaneTabStrip`): tabs on the sidebar surface, the
 * active one in the foreground with a 2 px underline in the skin's primary, the label semibold uppercase
 * at the wide tracking. Parity deviation (touch): 48dp, not 28, with a 13pt label.
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
  strip: { flexDirection: 'row', height: 48 },
  tab: { justifyContent: 'center', paddingHorizontal: 20, maxWidth: 192 },
  underline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  tabLabel: { fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
});
