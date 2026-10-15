import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAvatarApi, PET_THUMB_TIMEOUT_MS, rankPets, type AvatarRequest } from '../src/bots/avatarApi.ts';
import {
  avatarColor,
  blobShapeString,
  botAppearance,
  faceFrame,
  faceMood,
  facePose,
  parseBlobShape,
  PRIMARY_AVATAR_COLOR,
  resolveLook,
  settlePose,
} from '../src/bots/face.ts';
import {
  avatarImageError,
  customAvatarPrompt,
  dataUrlBytes,
  editedLook,
  generatedAvatarPrompt,
  isBackfilledFacePng,
  metaOfLook,
  type EditableLook,
} from '../src/bots/look.ts';

const opened: EditableLook = { shape: 'blobatar', color: 'hsl(30, 68%, 58%)', image: null, title: 'Scout' };

test('blob shape strings round-trip the seed lock and the pinned silhouette', () => {
  assert.equal(blobShapeString('', ''), 'blobatar');
  assert.equal(blobShapeString('k3j9', ''), 'blobatar:k3j9');
  assert.equal(blobShapeString('k3j9', 'sun'), 'blobatar:k3j9:sun');
  assert.equal(blobShapeString('', 'sun'), 'blobatar::sun');
  assert.deepEqual(parseBlobShape('blobatar', 'scout'), { seed: 'scout', seedPart: '', kind: '' });
  assert.deepEqual(parseBlobShape('blobatar:k3j9:sun', 'scout'), { seed: 'k3j9', seedPart: 'k3j9', kind: 'sun' });
  assert.deepEqual(parseBlobShape('blobatar::hexagon', 'scout'), { seed: 'scout', seedPart: '', kind: 'hexagon' });
  assert.equal(parseBlobShape('blobatar:k3j9:bogus', 'scout').kind, '', 'an unknown silhouette is ignored');
  assert.equal(parseBlobShape('blobatar', undefined).seed, 'agent');
});

test('a pinned silhouette reaches the blob look as its band centre', () => {
  assert.deepEqual(resolveLook('scout', { shape: 'blobatar:k3j9:sun' }, false), { kind: 'blob', seed: 'k3j9', shapeTrait: 0.965 });
  assert.deepEqual(resolveLook('scout', { shape: 'blobatar' }, false), { kind: 'blob', seed: 'scout', shapeTrait: undefined });
});

test('the editor opens on the primary violet squircle until customised, else the stored or name-derived look', () => {
  assert.deepEqual(botAppearance('default', {}), { shape: 'squircle', color: PRIMARY_AVATAR_COLOR });
  assert.equal(botAppearance('default', { custom: true, shape: 'pill' }).shape, 'pill');
  assert.equal(botAppearance('scout', { color: '#112233' }).color, '#112233');
  assert.match(botAppearance('scout', {}).color ?? '', /^hsl\(\d+, 68%, 58%\)$/);
  assert.equal(avatarColor(null, 'default'), PRIMARY_AVATAR_COLOR);
  assert.equal(avatarColor('#112233', 'scout'), '#112233');
});

test('an unchanged look produces no patch; only touched fields are sent', () => {
  assert.equal(editedLook(opened, { ...opened }), null);
  assert.deepEqual(editedLook(opened, { ...opened, shape: 'blobatar:k3j9' }), { shape: 'blobatar:k3j9', custom: true });
  assert.deepEqual(editedLook(opened, { ...opened, title: '  Scout Two ' }), { title: 'Scout Two' }, 'a rename alone does not mark the look custom');
  assert.deepEqual(editedLook(opened, { ...opened, color: null }), { color: undefined, custom: true });
});

test('an image change carries the data URL and the photo/shape kind', () => {
  const picked = editedLook(opened, { ...opened, image: 'data:image/png;base64,AAAA' });
  assert.deepEqual(picked, { image: 'data:image/png;base64,AAAA', imageKind: 'photo', custom: true });
  assert.deepEqual(metaOfLook(picked!), { imageKind: 'photo', custom: true }, 'the image never rides ui_meta');
  const removed = editedLook({ ...opened, image: 'data:image/png;base64,AAAA' }, { ...opened, image: null });
  assert.deepEqual(removed, { image: null, imageKind: 'shape', custom: true });
});

test('data URL size is the decoded byte count', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,AA=='), 1);
});

test('the roster backfill is recognised by its 160x160 PNG header', () => {
  const png = (w: number, h: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(bytes.buffer).setUint32(16, w);
    new DataView(bytes.buffer).setUint32(20, h);
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  };
  assert.equal(isBackfilledFacePng(png(160, 160)), true);
  assert.equal(isBackfilledFacePng(png(256, 256)), false, 'an upload');
  assert.equal(isBackfilledFacePng(png(96, 104)), false, 'a pet');
  assert.equal(isBackfilledFacePng('data:image/jpeg;base64,AAAA'), false);
  assert.equal(isBackfilledFacePng(null), false);
});

test('generation prompts follow the desktop wording', () => {
  assert.equal(
    customAvatarPrompt(' a fox '),
    'a fox. Avatar for an AI agent: centered, bold flat vector style, solid color background, no text.',
  );
  assert.equal(
    generatedAvatarPrompt('scout', 'Scout', 'Finds things'),
    'Cute minimal robot avatar for an AI agent named "Scout — Finds things". Friendly simple mascot face, bold flat vector style, solid color background, centered, no text.',
  );
  assert.match(generatedAvatarPrompt('scout'), /named "scout"\./);
});

test('moods: a running turn thinks, a live worker works, otherwise idle', () => {
  assert.equal(faceMood(true, true), 'think');
  assert.equal(faceMood(false, true), 'work');
  assert.equal(faceMood(false, false), 'idle');
});

test('idle stays small and blinks briefly every 3.2 s; working poses lean and show the dots', () => {
  const rest = facePose('idle', 0);
  assert.equal(rest.turn, 0);
  assert.equal(rest.d0 + rest.d1 + rest.d2, 0);
  assert.equal(facePose('idle', 3.1).blink, true);
  assert.equal(facePose('idle', 1).blink, false);
  assert.equal(facePose('work', 1.3).blink, true);
  const thinking = facePose('think', 0);
  assert.ok(thinking.turn < -10, 'thinking turns away');
  assert.ok(thinking.d0 >= 0.2 && thinking.d0 <= 1);
});

test('a mood change blends from the last pose over 0.4 s with a quadratic ease out', () => {
  const idle = settlePose(null, 'idle', facePose('idle', 5), 5);
  assert.deepEqual(idle.pose, facePose('idle', 5), 'the first paint is fully at the target');
  const start = settlePose(idle, 'think', facePose('think', 6), 6);
  assert.deepEqual(start.pose.turn, facePose('idle', 5).turn, 'no jump at the moment of the change');
  const mid = settlePose(start, 'think', facePose('think', 6.2), 6.2);
  const target = facePose('think', 6.2);
  const from = facePose('idle', 5);
  assert.ok(Math.abs(mid.pose.turn - (from.turn + (target.turn - from.turn) * 0.75)) < 1e-9, 'half the time is 75% of the way');
  const done = settlePose(mid, 'think', facePose('think', 7), 7);
  assert.deepEqual(done.pose, facePose('think', 7));
});

test('the frame at rest is the plain body with eyes on the eye line; blinking swaps eyes for a line', () => {
  const frame = faceFrame('circle', facePose('idle', 0));
  assert.match(frame.body, /^M[\d. L-]+Z$/);
  assert.equal(frame.eyeY, 17.2);
  assert.equal(frame.eyeL, 15.4);
  assert.equal(frame.open, 1);
  assert.equal(frame.shutOpacity, 0);
  assert.equal(frame.hlL, 14.8);
  const blink = faceFrame('circle', { ...facePose('idle', 0), blink: true });
  assert.equal(blink.open, 0);
  assert.equal(blink.shutOpacity, 1);
  assert.equal(blink.shut, 'M12.8 17.2 L18 17.2 M22 17.2 L27.2 17.2');
});

test('the cloud keeps its fixed body and lower eye line while the eyes still move', () => {
  const frame = faceFrame('cloud', { ...facePose('idle', 0), gazeX: 2, gazeY: -1 });
  assert.match(frame.body, /^M11 32 a7\.5/);
  assert.equal(frame.eyeY, 21);
  assert.equal(frame.eyeL, 17.4);
});

test('a tilted, turned head squeezes the body horizontally', () => {
  const width = (body: string) => {
    const xs = [...body.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
    return Math.max(...xs) - Math.min(...xs);
  };
  const front = faceFrame('circle', facePose('idle', 0));
  const turned = faceFrame('circle', { ...facePose('idle', 0), turn: 90 });
  assert.ok(width(turned.body) < width(front.body) * 0.8);
});

function fakeRequest(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown>; timeoutMs?: number }> = [];
  const request = (async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
    calls.push({ method, params, timeoutMs });
    return handlers[method](params);
  }) as unknown as AvatarRequest;
  return { request, calls };
}

test('the image probe caches true but rechecks a false answer each time Generate is entered', async () => {
  let available = false;
  const { request, calls } = fakeRequest({ 'image.generate': () => ({ available }) });
  const api = createAvatarApi(request, () => 'scout');
  assert.equal(await api.probeImagen(), false);
  assert.equal(await api.probeImagen(), false, 'no recheck without asking');
  assert.equal(calls.length, 1);
  available = true;
  assert.equal(await api.probeImagen(true), true);
  assert.equal(await api.probeImagen(true), true, 'true is sticky');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, { probe: true });
});

test('generation is bounded at 90 s, prefers the inlined data URL and surfaces the backend error', async () => {
  let reply: Record<string, unknown> = { success: true, image: 'https://x/y.png', image_data: 'data:image/png;base64,AAAA' };
  const { request, calls } = fakeRequest({ 'image.generate': () => reply });
  const api = createAvatarApi(request, () => 'scout');
  assert.equal(await api.generate('a fox'), 'data:image/png;base64,AAAA');
  assert.deepEqual(calls[0], { method: 'image.generate', params: { prompt: 'a fox', aspect_ratio: 'square' }, timeoutMs: 90_000 });
  reply = { success: true, image: 'https://x/y.png' };
  assert.equal(await api.generate('a fox'), 'https://x/y.png');
  reply = { success: false, error: 'quota exceeded' };
  await assert.rejects(api.generate('a fox'), /quota exceeded/);
  reply = { success: false };
  await assert.rejects(api.generate('a fox'), /generation failed/);
});

test('pet thumbs are cached per slug, but a failure is never cached', async () => {
  let ok = false;
  const { request, calls } = fakeRequest({ 'pet.thumb': (p) => ({ ok, slug: p.slug, dataUri: ok ? 'data:image/png;base64,BBBB' : null }) });
  const api = createAvatarApi(request, () => 'scout');
  assert.equal(await api.petThumb('fox', 'https://cdn/fox.webp'), null);
  ok = true;
  assert.equal(await api.petThumb('fox', 'https://cdn/fox.webp'), 'data:image/png;base64,BBBB');
  assert.equal(await api.petThumb('fox'), 'data:image/png;base64,BBBB');
  assert.equal(calls.length, 2, 'the success is served from cache');
  assert.deepEqual(calls[0].params, { profile: 'scout', slug: 'fox', url: 'https://cdn/fox.webp' });
  assert.equal(await api.petThumb(''), null);
});

test('a hung pet thumb resolves null at the deadline and is retried next time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { request, calls } = fakeRequest({ 'pet.thumb': () => new Promise(() => undefined) });
  const api = createAvatarApi(request, () => 'scout');
  const first = api.petThumb('fox');
  t.mock.timers.tick(PET_THUMB_TIMEOUT_MS);
  assert.equal(await first, null);
  void api.petThumb('fox');
  assert.equal(calls.length, 2);
});

test('the gallery is fetched once per five minutes and a failed fetch is not remembered', async () => {
  let clock = 0;
  let fail = true;
  const { request, calls } = fakeRequest({
    'pet.gallery': () => {
      if (fail) throw new Error('offline');
      return { enabled: true, pets: [{ slug: 'fox', displayName: 'Fox', installed: true }] };
    },
  });
  const api = createAvatarApi(request, () => 'scout', () => clock);
  await assert.rejects(api.petGallery(), /offline/);
  fail = false;
  assert.equal((await api.petGallery()).length, 1);
  await api.petGallery();
  assert.equal(calls.length, 2);
  clock = 300_001;
  await api.petGallery();
  assert.equal(calls.length, 3);
});

test('the asset store takes PNG, JPEG and WebP up to 2 MB', () => {
  const big = `data:image/jpeg;base64,${'A'.repeat(2_700_000)}`;
  assert.equal(avatarImageError('data:image/png;base64,AAAA'), null);
  assert.equal(avatarImageError('data:image/webp;base64,AAAA'), null);
  assert.match(avatarImageError('data:image/gif;base64,AAAA') ?? '', /PNG, JPEG or WebP/);
  assert.match(avatarImageError('https://x/y.png') ?? '', /PNG, JPEG or WebP/);
  assert.match(avatarImageError(big) ?? '', /too large/);
});

test('pets rank installed, then curated, then the rest, and search matches name or slug', () => {
  const pets = [
    { slug: 'zed', displayName: 'Zed', installed: false },
    { slug: 'cur', displayName: 'Curated Cat', installed: false, curated: true },
    { slug: 'mine', displayName: 'Mine', installed: true },
    { slug: 'plain', displayName: 'Plain', installed: false },
  ];
  assert.deepEqual(rankPets(pets, '').map((p) => p.slug), ['mine', 'cur', 'zed', 'plain']);
  assert.deepEqual(rankPets(pets, ' CAT ').map((p) => p.slug), ['cur']);
  assert.deepEqual(rankPets(pets, 'plain').map((p) => p.slug), ['plain']);
  assert.deepEqual(rankPets(pets, 'nope'), []);
});
