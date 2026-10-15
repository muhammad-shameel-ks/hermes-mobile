import { useKeyboardState } from 'react-native-keyboard-controller';

import { keyboardOpen } from './keyboard.ts';

/** whether the IME is up, with the 80 px inset floor applied */
export function useKeyboardOpen(): boolean {
  return useKeyboardState((state) => state.isVisible && keyboardOpen(state.height));
}
