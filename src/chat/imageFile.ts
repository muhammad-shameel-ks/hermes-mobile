/**
 * Naming and decoding for saving an image out of the transcript: the file a
 * share sheet is handed. Port of the desktop's use-image-download naming. Pure.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
};

const KNOWN_IMAGE_EXTENSION_RE = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

export function imageFilename(src?: string): string {
  if (!src || /^data:/i.test(src)) return 'image';
  const path = src.split(/[?#]/, 1)[0] ?? '';
  return path.split(/[\\/]/).filter(Boolean).pop() || 'image';
}

/**
 * A generated image's URL often ends in an extensionless content hash; without
 * an extension the saved file will not open from a file manager, so one is
 * derived from its MIME type.
 */
export function downloadFilename(src: string, mimeType?: string): string {
  const mime = (mimeType || /^data:([^;,]+)/i.exec(src)?.[1] || '').trim().toLowerCase();
  const base = imageFilename(src);
  if (KNOWN_IMAGE_EXTENSION_RE.test(base)) return base;
  return `${base}${MIME_EXTENSIONS[mime] || '.png'}`;
}

export function dataUrlParts(src: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(src);
  return match ? { mime: match[1] || 'application/octet-stream', base64: match[2] } : null;
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type SaveOutcome = 'saved' | 'denied' | { error: unknown };
export type SaveNotice = { text: string; tone: 'success' | 'error' };

/** the notice after saving to the photo library: the desktop's "Image saved", and why a save did not happen */
export function saveNotice(outcome: SaveOutcome): SaveNotice {
  if (outcome === 'saved') return { text: 'Image saved', tone: 'success' };
  if (outcome === 'denied') return { text: 'Allow Hermes to add photos in Settings to save images.', tone: 'error' };
  const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? '');
  return { text: message ? `Could not save image: ${message}` : 'Could not save image', tone: 'error' };
}
