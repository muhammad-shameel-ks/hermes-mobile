import * as Clipboard from 'expo-clipboard';

import { tick } from './haptics.ts';

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  tick();
}
