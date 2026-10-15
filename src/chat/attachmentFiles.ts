/**
 * The device side of attachments: the system photo picker, the camera, the file
 * picker, and reading a picked uri's bytes. Kept apart from attachments.ts so
 * that file stays pure.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { errorText } from '../gateway/http.ts';
import { fileAttachment, imageAttachment, tooLargeNotice, type ComposerAttachment } from './attachments.ts';

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
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true });
    return result.canceled ? none : admit(result.assets.map(imageAttachment));
  } catch (error) {
    return { attachments: [], notice: `Image attach failed: ${errorText(error)}` };
  }
}

export async function takePhoto(): Promise<PickOutcome> {
  try {
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
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    return result.canceled ? none : admit(result.assets.map(fileAttachment));
  } catch (error) {
    return { attachments: [], notice: `Could not attach files: ${errorText(error)}` };
  }
}

export function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
