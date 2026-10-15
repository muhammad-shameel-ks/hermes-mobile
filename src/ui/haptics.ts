import * as Haptics from 'expo-haptics';

const quiet = (run: Promise<void>) => void run.catch(() => undefined);

/** the light tick for a toggle, a pick or a copy */
export const tick = () => quiet(Haptics.selectionAsync());

/** a light impact for a primary press */
export const press = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** desktop `triggerHaptic('submit' | 'cancel')`, on the device's notification feedback */
export const outcome = (kind: 'submit' | 'cancel') =>
  quiet(Haptics.notificationAsync(kind === 'cancel' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success));
