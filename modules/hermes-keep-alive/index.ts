/**
 * Android's background hold: a foreground service that keeps the app, and its
 * gateway socket, running while a turn streams or waits on the reader out of
 * sight, plus the headless task that keeps timers firing meanwhile. Absent on
 * other platforms, where the app is suspended in the background regardless.
 */

import { requireOptionalNativeModule } from 'expo';
import { AppRegistry } from 'react-native';

import type { BackgroundHold } from '../../src/attention/center.ts';

type KeepAliveNative = {
  start(title: string, text: string): boolean;
  stop(): void;
};

/** the native side's TASK_KEY */
const TASK_KEY = 'HermesKeepAlive';

const native = requireOptionalNativeModule<KeepAliveNative>('HermesKeepAlive');

/** settles the running task's promise; the native side finishes the task itself */
let settle: (() => void) | null = null;

if (native) {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => () =>
    new Promise<void>((resolve) => {
      settle = resolve;
    }),
  );
}

export const keepAlive: BackgroundHold | null = native && {
  start: (title, text) => native.start(title, text),
  stop: () => {
    native.stop();
    settle?.();
    settle = null;
  },
};
