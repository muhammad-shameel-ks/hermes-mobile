/**
 * The signed-in app: chat root plus the drawer. Builds the session's credential
 * holder, REST client, socket link and chat controller once per sign-in; the
 * socket follows the app into the background and back (foreground-scoped).
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { refreshCredentials } from '../auth/native-flow.ts';
import { createAuthSession } from '../auth/session.ts';
import { saveCredentials, type SavedConnection } from '../auth/store.ts';
import type { Credentials } from '../auth/tokens.ts';
import { forgetAvatar } from '../bots/BotAvatar.tsx';
import BotForm from '../bots/BotForm.tsx';
import { botLabel, type Bot } from '../bots/roster.ts';
import ChatScreen from '../chat/ChatScreen.tsx';
import { ChatController } from '../chat/controller.ts';
import Drawer, { type DrawerTab } from '../drawer/Drawer.tsx';
import { createGatewayApi } from '../gateway/api.ts';
import { gatewaySocketUrl, GatewayLink } from '../gateway/link.ts';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';

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
    return new ChatController(link, api);
  }, [connection.id]);
}

export default function SignedInApp(props: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const controller = useController(props);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>('sessions');
  const [actionsFor, setActionsFor] = useState<Bot | null>(null);
  const [profileSheet, setProfileSheet] = useState(false);
  const [form, setForm] = useState<{ bot: Bot | null } | null>(null);

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

  const allBots = useMemo(() => [...snapshot.roster.visible, ...snapshot.roster.hidden], [snapshot.roster]);
  const entry = snapshot.entries[snapshot.openKey] ?? snapshot.entries.draft;
  const openBot = entry.bot ? (allBots.find((b) => b.name === entry.bot) ?? null) : null;
  const profileBot = allBots.find((b) => b.name === snapshot.profile);
  const profileLabel = profileBot ? profileBot.label : botLabel({ name: snapshot.profile });

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    // refresh on drawer open instead of the desktop's 5 s roster poll (recorded parity deviation)
    void controller.refreshSessions();
    void controller.refreshRoster();
  }, [controller]);

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
      onPress: () => {
        forgetAvatar(bot.name);
        setForm({ bot });
      },
    },
    ...(bot.isDefault ? [] : [{ label: 'Delete', destructive: true, onPress: () => confirmDelete(bot) }]),
  ];

  const profileActions: SheetAction[] = allBots.map((bot) => ({
    label: bot.label,
    detail: bot.name === snapshot.profile ? 'Active' : bot.isDefault ? 'Default' : undefined,
    onPress: () => {
      closeDrawer();
      controller.useProfile(bot.name);
    },
  }));

  return (
    <View style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground, paddingTop: insets.top }]}>
      <ChatScreen
        controller={controller}
        entry={entry}
        link={snapshot.link}
        bot={openBot}
        profileLabel={profileLabel}
        opening={snapshot.openingBot !== null}
        models={snapshot.models}
        currentModel={controller.currentModel()}
        personality={snapshot.personality}
        onOpenDrawer={openDrawer}
        onProfile={() => setProfileSheet(true)}
      />

      {snapshot.notice ? (
        <Notice key={snapshot.notice.at} text={snapshot.notice.text} top={insets.top + 56} onDone={controller.clearNotice} />
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        snapshot={snapshot}
        connectionLabel={props.connection.label}
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
        }}
        onOpenBot={(bot) => {
          closeDrawer();
          void controller.openBot(bot);
        }}
        onBotActions={setActionsFor}
        onNewBot={() => setForm({ bot: null })}
        onProfileChip={() => setProfileSheet(true)}
        onSignOut={props.onSignOut}
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
      <BotForm
        visible={form !== null}
        bot={form?.bot ?? null}
        onClose={() => setForm(null)}
        onSubmit={async (draft) => {
          if (form?.bot) return controller.editBot(form.bot, draft);
          const created = await controller.createBot(draft);
          if (created) closeDrawer();
          return created;
        }}
        loadImage={controller.avatarDataFn}
      />
    </View>
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
