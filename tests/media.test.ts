import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  filePathFromMediaPath,
  formatClock,
  isFileMediaPath,
  mediaDisplayLabel,
  mediaKind,
  mediaName,
  mediaPathFromMarkdownHref,
  splitMediaTags,
  toolImageUrl,
} from '../src/chat/media.ts';

test('media kind and name come from the extension and the last path segment', () => {
  assert.equal(mediaKind('/tmp/a.PNG'), 'image');
  assert.equal(mediaKind('https://cdn.example/clip.mp4?sig=1'), 'video');
  assert.equal(mediaKind('/tmp/song.m4a'), 'audio');
  assert.equal(mediaKind('/tmp/report.pdf'), 'file');
  assert.equal(mediaName('/home/me/My Photos/a b.png'), 'a b.png');
  assert.equal(mediaName('https://cdn.example/x/y.png?s=1'), 'y.png');
  assert.equal(mediaName('C:\\Users\\me\\a.png'), 'a.png');
  assert.equal(mediaDisplayLabel('/tmp/clip.mp4'), 'Video: clip.mp4');
});

test('gateway paths are told from loadable URLs', () => {
  assert.equal(isFileMediaPath('/tmp/a.png'), true);
  assert.equal(isFileMediaPath('~/a.png'), true);
  assert.equal(isFileMediaPath('C:\\a.png'), true);
  assert.equal(isFileMediaPath('https://x/a.png'), false);
  assert.equal(filePathFromMediaPath('file:///tmp/a%20b.png'), '/tmp/a b.png');
  assert.equal(mediaPathFromMarkdownHref(`#media:${encodeURIComponent('/tmp/a b.png')}`), '/tmp/a b.png');
  assert.equal(mediaPathFromMarkdownHref('#other'), null);
});

test('a MEDIA tag on its own line becomes a media segment between the text around it', () => {
  assert.deepEqual(splitMediaTags('Here you go:\nMEDIA:/tmp/out/chart.png\nAnything else?'), [
    { kind: 'text', text: 'Here you go:\n' },
    { kind: 'media', path: '/tmp/out/chart.png' },
    { kind: 'text', text: '\nAnything else?' },
  ]);
});

test('an anchored path may hold spaces and the sentence punctuation after a bare tag stays prose', () => {
  assert.deepEqual(splitMediaTags('MEDIA:/tmp/my report final.pdf'), [{ kind: 'media', path: '/tmp/my report final.pdf' }]);
  assert.deepEqual(splitMediaTags('open MEDIA:/tmp/a.pdf.'), [
    { kind: 'text', text: 'open ' },
    { kind: 'media', path: '/tmp/a.pdf' },
    { kind: 'text', text: '.' },
  ]);
  assert.deepEqual(splitMediaTags("MEDIA:'/tmp/stop!.md'"), [{ kind: 'media', path: '/tmp/stop!.md' }]);
});

test('a capture that cannot name a file stays prose, and so does a tag inside a code fence', () => {
  assert.deepEqual(splitMediaTags('the MEDIA: tag is explained here'), [{ kind: 'text', text: 'the MEDIA: tag is explained here' }]);
  const fenced = 'Use it like:\n```\nMEDIA:/tmp/a.png\n```\nbye';
  assert.deepEqual(splitMediaTags(fenced), [{ kind: 'text', text: fenced }]);
  assert.deepEqual(splitMediaTags('no tags'), [{ kind: 'text', text: 'no tags' }]);
});

test('two tags in one reply both split out', () => {
  const segments = splitMediaTags('MEDIA:/a/one.png\nMEDIA:/a/two.mp4');
  assert.deepEqual(
    segments.filter((s) => s.kind === 'media'),
    [
      { kind: 'media', path: '/a/one.png' },
      { kind: 'media', path: '/a/two.mp4' },
    ],
  );
});

test('a tool row shows an image only for a data URL, a remote image URL or a gateway image path', () => {
  assert.equal(toolImageUrl({}, { image_url: 'data:image/png;base64,AAAA' }), 'data:image/png;base64,AAAA');
  assert.equal(toolImageUrl({ url: 'https://x.test/a.webp' }, {}), 'https://x.test/a.webp');
  assert.equal(toolImageUrl({ path: '/tmp/shot.png' }, {}), '/tmp/shot.png');
  assert.equal(toolImageUrl({ url: 'https://x.test/page' }, {}), '');
  assert.equal(toolImageUrl({ path: '/tmp/notes.txt' }, {}), '');
});

test('the byte-budget cache evicts the oldest entries and refuses what can never fit', async () => {
  const { createByteBudgetCache } = await import('../src/chat/mediaResolver.ts');
  const cache = createByteBudgetCache<string>(10, (value) => value.length);
  cache.set('a', '1234');
  cache.set('b', '1234');
  assert.equal(cache.get('a'), '1234');
  cache.set('c', '1234');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), '1234');
  assert.equal(cache.bytes, 8);
  cache.set('huge', '0123456789ab');
  assert.equal(cache.get('huge'), undefined);
  cache.set('a', '12');
  assert.equal(cache.bytes, 6);
});

test('a saved image always gets an extension a file manager can open', async () => {
  const { dataUrlParts, decodeBase64, downloadFilename } = await import('../src/chat/imageFile.ts');
  assert.equal(downloadFilename('https://cdn.example/a/b/art.webp?sig=1'), 'art.webp');
  assert.equal(downloadFilename('https://fal.media/files/9f8e7d6c', 'image/jpeg'), '9f8e7d6c.jpg');
  assert.equal(downloadFilename('https://fal.media/files/9f8e7d6c'), '9f8e7d6c.png');
  assert.equal(downloadFilename('data:image/gif;base64,R0lGOD'), 'image.gif');
  assert.deepEqual(dataUrlParts('data:image/png;base64,AAEC'), { mime: 'image/png', base64: 'AAEC' });
  assert.equal(dataUrlParts('https://x/a.png'), null);
  assert.deepEqual([...decodeBase64('AAEC')], [0, 1, 2]);
});

test('the audio clock reads minutes and zero-padded seconds', () => {
  assert.equal(formatClock(7.9), '0:07');
  assert.equal(formatClock(750), '12:30');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatClock(-3), '0:00');
});
