/**
 * The chat's back handling, first in line: back dismisses the IME before any
 * other back rule (issue "App shell and navigation on a phone", rule 2 and the
 * IME note in "Transcript and composer parity on touch"), then closes the
 * composer's own sheet. The drawer, pickers and pushed screens keep their own
 * rules and only see the press once neither applies.
 *
 * BackHandler runs the newest listener first, so this one re-registers whenever
 * the keyboard shows, focus moves between inputs or `reorderKey` changes (a
 * surface opened over the keyboard), which keeps it the newest.
 */

import { useEffect, useReducer } from 'react';
import { BackHandler } from 'react-native';
import { FocusedInputEvents, KeyboardController } from 'react-native-keyboard-controller';

import { useKeyboardOpen } from './useKeyboardOpen.ts';

export function useImeBack({ sheetOpen = false, closeSheet, reorderKey }: { sheetOpen?: boolean; closeSheet?: () => void; reorderKey?: unknown } = {}) {
  const imeOpen = useKeyboardOpen();
  const [epoch, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!imeOpen) return;
    const sub = FocusedInputEvents.addListener('focusDidSet', () => bump());
    return () => sub.remove();
  }, [imeOpen]);

  useEffect(() => {
    if (!imeOpen && !sheetOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (imeOpen) {
        void KeyboardController.dismiss();
        return true;
      }
      closeSheet?.();
      return true;
    });
    return () => sub.remove();
  }, [imeOpen, sheetOpen, closeSheet, epoch, reorderKey]);
}
