/**
 * The device side of attachments: the system photo picker, the camera, the file
 * picker, and reading a picked uri's bytes. Kept apart from attachments.ts so
 * that file stays pure.
 */

import { errorText } from '../gateway/http.ts';
import { fileAttachment, imageAttachment, tooLargeNotice, type ComposerAttachment } from './attachments.ts';

// the native pickers load on first use (`import()` below), not at startup

/** what a picker added, and the one sentence to show when something was refused or failed */
export type PickOutcome = { attachments: ComposerAttachment[]; notice?: string };

const none: PickOutcome = { attachments: [] };

/** drops what is over the phone's size cap, keeping the first refusal as the notice */
function admit(attachments: ComposerAttachment[]): PickOutcome {
  let notice: string | undefined;
  const kept = attachments.filter((attachment) => {
    const refusal = tooLargeNotice(attachment.label, attachment.size);
    if (refusal) notice ??= refusal;
    return !refusal;
  });
  return { attachments: kept, notice };
}

export async function pickPhotos(): Promise<PickOutcome> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true });
    return result.canceled ? none : admit(result.assets.map(imageAttachment));
  } catch (error) {
    return { attachments: [], notice: `Image attach failed: ${errorText(error)}` };
  }
}

export async function takePhoto(): Promise<PickOutcome> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { attachments: [], notice: 'Camera permission was denied.' };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
    return result.canceled ? none : admit(result.assets.map(imageAttachment));
  } catch (error) {
    return { attachments: [], notice: `Image attach failed: ${errorText(error)}` };
  }
}

export async function pickFiles(): Promise<PickOutcome> {
  try {
    const DocumentPicker = await import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    return result.canceled ? none : admit(result.assets.map(fileAttachment));
  } catch (error) {
    return { attachments: [], notice: `Could not attach files: ${errorText(error)}` };
  }
}

export async function readBase64(uri: string): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
