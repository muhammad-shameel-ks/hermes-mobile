import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  void Haptics.selectionAsync().catch(() => {});
}

/** a file link has no door yet (Files lands later): it degrades to copying the path */
export const copyPath = copyText;
