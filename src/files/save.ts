/**
 * The pure side of saving a gateway file onto the phone: the on-disk name a
 * download gets and how the folder picker's failures are told apart. Free of
 * native imports so it runs under plain node; the byte moving is in transfer.ts.
 */

import { baseName } from './path.ts';

/**
 * The file name a download is stored under: the last segment of `nameOrPath`
 * with anything a file system or a SAF document provider would mangle replaced.
 * The name comes from the path the card or row already knows, never from the
 * response, because the gateway does not promise a `Content-Disposition`.
 */
export function safeFileName(nameOrPath: string): string {
  const name = baseName(nameOrPath).replace(/[^\w.\- ]+/g, '_');
  return /^\.*_?$/.test(name) ? 'file' : name;
}

/**
 * The folder picker was dismissed rather than failed. expo-file-system rejects with
 * `ERR_PICKER_CANCELLED` on Android and `ERR_FILE_PICKING_CANCELLED` on iOS.
 */
export function isPickerCancelled(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && /CANCEL/i.test(code)) return true;
  return typeof message === 'string' && /\bcancel/i.test(message);
}
