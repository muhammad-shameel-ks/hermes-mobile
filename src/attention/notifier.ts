/**
 * Attention notifications through the system: posted while the app is away,
 * taken down when their request closes. They carry no actions on purpose - an
 * approval is answered in its chat, where the whole command and its context
 * are on screen - so a tap only opens that chat.
 */

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import type { Attention, AttentionTarget } from './attention.ts';
import type { AttentionNotifier } from './center.ts';

const CHANNEL = 'attention';
/** marks the notifications this file posts, so a tap on any other is not mistaken for one */
const ORIGIN = 'hermes.attention';

let prepared: Promise<void> | null = null;

/** the channel, the in-app presentation rule and the permission; once per process */
export function prepareNotifications(): Promise<void> {
  prepared ??= (async () => {
    // the banner speaks while the app is open, the system while it is away. The app's own state decides,
    // not the module's: the system still counts the app in front for a moment after it leaves, which is
    // exactly when the requests it walked away from are posted
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        const away = AppState.currentState !== 'active';
        return { shouldShowBanner: away, shouldShowList: away, shouldPlaySound: away, shouldSetBadge: false };
      },
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Needs your input',
        description: 'When Hermes waits on you for an approval, an answer or a password.',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) await Notifications.requestPermissionsAsync();
  })().catch(() => undefined);
  return prepared;
}

export const systemNotifier: AttentionNotifier = {
  post(item: Attention) {
    void Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: {
        title: `${item.headline} · ${item.chat}`,
        body: item.detail || undefined,
        data: { origin: ORIGIN, target: item.target },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    }).catch(() => undefined);
  },
  dismiss(id: string) {
    void Notifications.dismissNotificationAsync(id).catch(() => undefined);
  },
};

function targetOf(response: Notifications.NotificationResponse | null): AttentionTarget | null {
  const data = response?.notification.request.content.data as { origin?: unknown; target?: Partial<AttentionTarget> } | undefined;
  const target = data?.origin === ORIGIN ? data.target : undefined;
  if (typeof target?.key !== 'string' || typeof target.profile !== 'string') return null;
  return {
    key: target.key,
    profile: target.profile,
    title: typeof target.title === 'string' ? target.title : null,
    bot: typeof target.bot === 'string' ? target.bot : null,
  };
}

/** taps on attention notifications, the one that launched the app included, each delivered once */
export function onAttentionOpened(open: (target: AttentionTarget) => void): () => void {
  let handled: string | null = null;
  const take = (response: Notifications.NotificationResponse | null) => {
    const target = targetOf(response);
    if (!response || !target) return;
    const stamp = `${response.notification.request.identifier}:${response.notification.date}`;
    if (stamp === handled) return;
    handled = stamp;
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    open(target);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(take);
  void Notifications.getLastNotificationResponseAsync().then(take, () => undefined);
  return () => subscription.remove();
}
