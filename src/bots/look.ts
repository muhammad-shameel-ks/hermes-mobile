/**
 * What the avatar editor changes and how it is saved, ported from
 * apps/desktop/src/plugins/hermes-bots/edit-profile-look.ts and avatar-image.ts:
 * only fields the user touched go into the patch, an image is a data URL that
 * lives in the profile's asset store (never in `ui_meta`), and a face-copy PNG
 * the desktop backfills is not a picture.
 */

import type { BotMeta } from './roster.ts';

/** what the editor shows for a bot's look, as opened and as submitted */
export type EditableLook = { shape: string; color: string | null; image: string | null; title: string };

/** a `ui_meta` patch plus the image the asset store takes; `image: null` clears it */
export type LookPatch = BotMeta & { image?: string | null };

/** `profiles.set_asset` takes PNG/JPEG/WebP up to 2 MB */
export const AVATAR_MAX_BYTES = 2_000_000;

/** the desktop's `normalizeAvatarImage`: a 256 px square PNG */
export const AVATAR_EDGE = 256;

/** the centred square the desktop crops before scaling to AVATAR_EDGE */
export function avatarCrop(width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  const side = Math.floor(Math.min(width, height));
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}

/** untouched fields stay out of the patch: a value seeded minutes ago is not an edit, and sending it would revert a newer write elsewhere */
export function editedLook(opened: EditableLook, current: EditableLook): LookPatch | null {
  const patch: LookPatch = {};
  if (current.shape !== opened.shape) patch.shape = current.shape;
  if (current.color !== opened.color) patch.color = current.color ?? undefined;
  if (current.image !== opened.image) {
    patch.image = current.image;
    patch.imageKind = current.image ? 'photo' : 'shape';
  }
  if (Object.keys(patch).length > 0) patch.custom = true;
  if (current.title.trim() !== opened.title.trim()) patch.title = current.title.trim();
  return Object.keys(patch).length > 0 ? patch : null;
}

/** the `ui_meta` half of a look patch */
export function metaOfLook(patch: LookPatch): BotMeta {
  const { image: _image, ...meta } = patch;
  return meta;
}

/** decoded size of a base64 data URL */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** `avatar-image.ts` `isBackfilledFacePng`: the roster backfill rasterises the live face at 160x160; pets are 96x104 and uploads 256 */
export function isBackfilledFacePng(dataUrl: string | null | undefined): boolean {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return false;
  try {
    // 24 bytes carry the PNG signature, IHDR length and tag, then width and height
    const bin = atob(dataUrl.slice(prefix.length, prefix.length + 32));
    if (bin.length < 24) return false;
    const be32 = (at: number) => ((bin.charCodeAt(at) << 24) | (bin.charCodeAt(at + 1) << 16) | (bin.charCodeAt(at + 2) << 8) | bin.charCodeAt(at + 3)) >>> 0;
    return be32(16) === 160 && be32(20) === 160;
  } catch {
    return false;
  }
}

const AVATAR_SUFFIX = 'bold flat vector style, solid color background, centered, no text.';

/** the prompt for the user's own description */
export function customAvatarPrompt(description: string): string {
  return `${description.trim()}. Avatar for an AI agent: centered, bold flat vector style, solid color background, no text.`;
}

/** the prompt when the description is left blank: from the name, title and description */
export function generatedAvatarPrompt(bot: string, title?: string, description?: string): string {
  const who = [title || bot, description].filter(Boolean).join(' — ');
  return `Cute minimal robot avatar for an AI agent named "${who}". Friendly simple mascot face, ${AVATAR_SUFFIX}`;
}

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** why the asset store would refuse this data URL, or null when it takes it */
export function avatarImageError(dataUrl: string): string | null {
  const type = /^data:([^;,]+);base64,/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (!type || !AVATAR_TYPES.includes(type)) return 'Use a PNG, JPEG or WebP image.';
  if (dataUrlBytes(dataUrl) > AVATAR_MAX_BYTES) return 'Image too large (max 2MB).';
  return null;
}
