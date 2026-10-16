/**
 * The signed-in app: chat root plus the drawer. Builds the session's credential
 * holder, REST client, socket link and chat controller once per sign-in; the
 * socket follows the app into the background and back (foreground-scoped).
 */

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { refreshCredentials } from '../auth/native-flow.ts';
import { createAuthSession } from '../auth/session.ts';
import { saveCredentials, type SavedConnection } from '../auth/store.ts';
import type { Credentials } from '../auth/tokens.ts';
import { BotFormLauncher, type BotFormLaunch } from '../bots/BotFormLauncher.tsx';
import { botLabel, type Bot } from '../bots/roster.ts';
import { setCardEnv } from '../chat/cards/env.ts';
import { CardEnvBridge } from '../chat/cards/CardEnvBridge.tsx';
import ChatScreen from '../chat/ChatScreen.tsx';
import { shellSlice } from '../chat/chatSlices.ts';
import { ChatController } from '../chat/controller.ts';
import { createMediaResolver } from '../chat/mediaResolver.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';
import Drawer, { type DrawerTab, type SessionsListApi } from '../drawer/Drawer.tsx';
import { useSessionActions } from '../drawer/useSessionActions.tsx';
import { bindGateway } from '../files/gateway.ts';
import { createGatewayApi } from '../gateway/api.ts';
import { gatewaySocketUrl, GatewayLink } from '../gateway/link.ts';
import { createPersistence } from '../store/index.ts';
import { createGroupsApi } from '../groups/api.ts';
import { GroupLauncher, type GroupLaunch } from '../groups/GroupLauncher.tsx';
import { GroupsModel } from '../groups/model.ts';
import { useGroupActions } from '../groups/useGroupActions.tsx';
import ColdBootOverlay from '../screens/ColdBootOverlay.tsx';
import { SettingsProvider } from '../settings/context.tsx';
import { useSeedActiveProfile } from '../settings/useSeedActiveProfile.ts';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { OverlayProvider } from './overlay.tsx';

type Props = {
  connection: SavedConnection;
  credentials: Credentials;
  onSignOut: () => void;
  onReauthRequired: (reason: string) => void;
};

function useController({ connection, credentials, onReauthRequired }: Props) {
  // one controller per sign-in; credentials refresh inside the auth session afterwards
  return useMemo(() => {
    const auth = createAuthSession({
      baseUrl: connection.baseUrl,
      credentials,
      refresh: refreshCredentials,
      persist: (next) => saveCredentials(connection.id, next),
      onReauthRequired,
    });
    const api = createGatewayApi(auth);
    const link = new GatewayLink({
      mintUrl: async () => {
        const { ticket } = await api.post<{ ticket: string }>('/api/auth/ws-ticket');
        return gatewaySocketUrl(connection.baseUrl, ticket);
      },
      onAuthRejected: onReauthRequired,
    });
    setCardEnv({ media: createMediaResolver(auth, api) });
    const controller = new ChatController(link, api, undefined, createPersistence(connection.id));
    bindGateway({ auth, api, profile: () => controller.getSnapshot().profile });
    return controller;
  }, [connection.id]);
}

/**
 * The shell subscribes to the roster, profile, link and notice only. The open chat's transcript, the
 * composer's slices and the drawer's lists each subscribe where they render (`useChatSelector`), so a
 * streamed token re-renders none of this.
 */
export default function SignedInApp(props: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const controller = useController(props);
  const { roster, profile, link, notice, openBot: openBotName } = useChatSelector(controller, shellSlice, shallowEqual);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>('sessions');
  const [actionsFor, setActionsFor] = useState<Bot | null>(null);
  const [profileSheet, setProfileSheet] = useState(false);
  const sessionActions = useSessionActions(controller);
  useSeedActiveProfile(controller);
  const openForm = useRef<BotFormLaunch | null>(null);
  const openGroup = useRef<GroupLaunch | null>(null);
  const [addSheet, setAddSheet] = useState(false);
  const groups = useMemo(
    () =>
      new GroupsModel({
        api: createGroupsApi(controller.rpc, () => controller.getSnapshot().profile, Crypto.randomUUID),
        online: () => controller.getSnapshot().link.kind === 'open',
        // the roster's current name for a profile, so a renamed bot is renamed in its rooms too
        labelOf: (profile) => {
          const { visible, hidden } = controller.getSnapshot().roster;
          return [...visible, ...hidden].find((bot) => bot.name === profile)?.label;
        },
        newId: Crypto.randomUUID,
      }),
    [controller],
  );
  const groupActions = useGroupActions(groups, controller, (room) => openGroup.current?.openRoom(room));

  useEffect(() => {
    controller.start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        controller.start();
      } else if (state === 'background') {
        controller.pause();
      }
    });
    return () => {
      sub.remove();
      controller.dispose();
    };
  }, [controller]);

  const allBots = useMemo(() => [...roster.visible, ...roster.hidden], [roster]);
  const openBot = openBotName ? (allBots.find((b) => b.name === openBotName) ?? null) : null;
  const profileBot = allBots.find((b) => b.name === profile);
  const profileLabel = profileBot ? profileBot.label : botLabel({ name: profile });

  const sessionsList = useMemo<SessionsListApi>(
    () => ({
      loadMore: () => void controller.loadMoreSessions(),
      loadMoreMessaging: () => void controller.loadMoreMessaging(),
      refresh: () => controller.refreshSessions(),
      retry: () => void controller.refreshSessions(),
      search: (query) => controller.searchSessions(query),
    }),
    [controller],
  );

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    // refresh on drawer open instead of the desktop's 5 s roster poll (recorded parity deviation);
    // after this tap's render, because refreshRoster notifies every subscriber synchronously
    setTimeout(() => {
      void controller.refreshSessions();
      void controller.refreshRoster();
      void groups.refresh();
    }, 0);
  }, [controller, groups]);
  const openProfileSheet = useCallback(() => setProfileSheet(true), []);

  const confirmDelete = (bot: Bot) => {
    Alert.alert(`Delete ${bot.label}?`, 'This removes the profile, its memory, skills and every session. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void controller.deleteBot(bot) },
    ]);
  };

  const botActions = (bot: Bot): SheetAction[] => [
    {
      label: 'Open',
      onPress: () => {
        closeDrawer();
        void controller.openBot(bot);
      },
    },
    { label: bot.pinned ? 'Unpin' : 'Pin', onPress: () => void controller.setBotFlag(bot, 'pinned', !bot.pinned) },
    { label: bot.hidden ? 'Unhide' : 'Hide', onPress: () => void controller.setBotFlag(bot, 'hidden', !bot.hidden) },
    {
      label: 'Edit',
      onPress: () => openForm.current?.(bot),
    },
    ...(bot.isDefault ? [] : [{ label: 'Delete', destructive: true, onPress: () => confirmDelete(bot) }]),
  ];

  const profileActions: SheetAction[] = allBots.map((bot) => ({
    label: bot.label,
    detail: bot.name === profile ? 'Active' : bot.isDefault ? 'Default' : undefined,
    onPress: () => {
      closeDrawer();
      controller.useProfile(bot.name);
    },
  }));

  const settingsHost = useMemo(
    () => ({ controller, connection: props.connection, onSignOut: props.onSignOut }),
    [controller, props.connection, props.onSignOut],
  );

  return (
    <SettingsProvider value={settingsHost}>
    <OverlayProvider>
      <CardEnvBridge controller={controller} />
      <View style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground, paddingTop: insets.top }]}>
        <ChatScreen controller={controller} bot={openBot} profileLabel={profileLabel} onOpenDrawer={openDrawer} onProfile={openProfileSheet} />

        {notice ? <Notice key={notice.at} text={notice.text} top={insets.top + 56} onDone={controller.clearNotice} /> : null}

        <Drawer
          open={drawerOpen}
          onClose={closeDrawer}
          controller={controller}
          connectionLabel={props.connection.label}
          connectionUrl={props.connection.baseUrl}
          list={sessionsList}
          profileLabel={profileLabel}
          tab={tab}
          onTab={setTab}
          onNewSession={() => {
            closeDrawer();
            controller.newChat();
          }}
          onOpenSession={(session) => {
            closeDrawer();
            controller.openSession(session);
            // opening reads it: the backend's watermark moves so the unread dot does not return
            if (session.unread) void sessionActions.markRead(session);
          }}
          onSessionActions={sessionActions.open}
          onOpenBot={(bot) => {
            closeDrawer();
            void controller.openBot(bot);
          }}
          onBotActions={setActionsFor}
          groups={groups}
          onOpenGroup={(room) => openGroup.current?.openRoom(room)}
          onGroupActions={groupActions.open}
          onAdd={() => setAddSheet(true)}
          onRetryRoster={() => void controller.refreshRoster()}
          onRefreshRoster={() => Promise.all([controller.refreshRoster(), controller.refreshSessions(), groups.refresh()]).then(() => undefined)}
          onProfileChip={openProfileSheet}
          loadImage={controller.avatarDataFn}
        />

        <ActionSheet
          visible={actionsFor !== null}
          title={actionsFor?.label}
          subtitle={actionsFor?.description || undefined}
          actions={actionsFor ? botActions(actionsFor) : []}
          onClose={() => setActionsFor(null)}
        />
        <ActionSheet
          visible={profileSheet}
          title="Active profile"
          subtitle="Scopes the sessions list and new sessions."
          actions={profileActions}
          onClose={() => setProfileSheet(false)}
        />
        <ActionSheet
          visible={addSheet}
          actions={[
            { label: 'New bot', onPress: () => openForm.current?.(null) },
            { label: 'New group chat', onPress: () => openGroup.current?.newGroup() },
          ]}
          onClose={() => setAddSheet(false)}
        />
        <BotFormLauncher controller={controller} launchRef={openForm} onCreated={closeDrawer} />
        <GroupLauncher controller={controller} model={groups} launchRef={openGroup} onNavigate={closeDrawer} />
        {groupActions.element}
        {sessionActions.element}
        <ColdBootOverlay link={link} onRetry={() => controller.retryLink()} onSignOut={props.onSignOut} />
      </View>
    </OverlayProvider>
    </SettingsProvider>
  );
}

function Notice({ text, top, onDone }: { text: string; top: number; onDone: () => void }) {
  const t = useTokens();
  useEffect(() => {
    const timer = setTimeout(onDone, 4500);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.notice, { top, backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={{ color: t.uiTextPrimary, fontSize: 13, lineHeight: 18 }}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
