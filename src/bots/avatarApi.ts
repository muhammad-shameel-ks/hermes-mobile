/**
 * The gateway calls behind the avatar picker's Generate and Pet tabs, ported
 * from apps/desktop/src/plugins/hermes-bots/avatar-image.ts and pet.tsx: the
 * image-backend probe, `image.generate` bounded at 90 s, the petdex gallery and
 * the server-cropped `pet.thumb` frames behind a small LRU.
 */

import type {
  ImageGenerateResult,
  PetGalleryResult,
  PetThumbResult,
} from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';

/** room for provider variance without letting the screen wait for minutes */
export const IMAGE_GENERATE_TIMEOUT_MS = 90_000;
/** five pages of 24; past that a revisit pays the RPC again */
const PET_THUMB_CACHE_MAX = 120;
/** a hung gateway call must not park a pending promise in the cache forever */
export const PET_THUMB_TIMEOUT_MS = 15_000;
const GALLERY_STALE_MS = 300_000;

export type AvatarRequest = {
  (method: 'image.generate', params: { prompt?: string; aspect_ratio?: string; probe?: boolean }, timeoutMs?: number): Promise<ImageGenerateResult>;
  (method: 'pet.gallery', params: { profile?: string }, timeoutMs?: number): Promise<PetGalleryResult>;
  (method: 'pet.thumb', params: { profile?: string; slug: string; url?: string }, timeoutMs?: number): Promise<PetThumbResult>;
};

export type PetEntry = PetGalleryResult['pets'] extends Array<infer E> | undefined ? E : never;

export type AvatarApi = {
  /** true is sticky; a false answer is re-probed each time the Generate tab is entered */
  probeImagen: (recheck?: boolean) => Promise<boolean>;
  /** a data URL, or the backend's URL when the gateway could not inline it */
  generate: (prompt: string) => Promise<string>;
  petGallery: () => Promise<PetEntry[]>;
  petThumb: (slug: string, spriteUrl?: string | null) => Promise<string | null>;
};

export function createAvatarApi(request: AvatarRequest, profile: () => string, now: () => number = Date.now): AvatarApi {
  let imagen: boolean | null = null;
  let probing: Promise<boolean> | null = null;
  let gallery: { at: number; pets: Promise<PetEntry[]> } | null = null;
  const thumbs = new Map<string, Promise<string | null>>();

  const probeImagen = (recheck = false) => {
    if (recheck && imagen === false) imagen = null;
    if (imagen !== null) return Promise.resolve(imagen);
    if (probing) return probing;
    probing = request('image.generate', { probe: true })
      .then((res) => Boolean(res?.available))
      .catch(() => false)
      .then((available) => {
        imagen = available;
        probing = null;
        return available;
      });
    return probing;
  };

  const generate = async (prompt: string) => {
    // remote image backends routinely take 40-60 s, past the socket's generic deadline
    const res = await request('image.generate', { prompt, aspect_ratio: 'square' }, IMAGE_GENERATE_TIMEOUT_MS);
    if (!res?.success) throw new Error(res?.error || 'generation failed');
    const image = res.image_data || res.image;
    if (!image) throw new Error('generation failed');
    return image;
  };

  const petGallery = () => {
    if (gallery && now() - gallery.at < GALLERY_STALE_MS) return gallery.pets;
    const pets = request('pet.gallery', { profile: profile() }).then((res) => res?.pets ?? []);
    gallery = { at: now(), pets };
    // a failed fetch must not be served for five minutes
    pets.catch(() => {
      if (gallery?.pets === pets) gallery = null;
    });
    return pets;
  };

  const petThumb = (slug: string, spriteUrl?: string | null) => {
    if (!slug) return Promise.resolve(null);
    const hit = thumbs.get(slug);
    if (hit) {
      // refresh recency
      thumbs.delete(slug);
      thumbs.set(slug, hit);
      return hit;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PET_THUMB_TIMEOUT_MS);
    });
    const pending: Promise<string | null> = Promise.race([
      request('pet.thumb', { profile: profile(), slug, url: spriteUrl || '' })
        .then((res) => (res?.ok && res.dataUri ? res.dataUri : null))
        .catch(() => null),
      deadline,
    ]).then((icon) => {
      clearTimeout(timer);
      // a transient failure must not poison the tile for the rest of the session
      if (!icon && thumbs.get(slug) === pending) thumbs.delete(slug);
      return icon;
    });
    thumbs.set(slug, pending);
    if (thumbs.size > PET_THUMB_CACHE_MAX) thumbs.delete(thumbs.keys().next().value as string);
    return pending;
  };

  return { probeImagen, generate, petGallery, petThumb };
}
