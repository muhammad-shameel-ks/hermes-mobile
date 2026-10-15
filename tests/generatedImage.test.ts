import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  generatedImageDimensionsFromResult,
  generatedImageEchoSources,
  generatedImageFromResult,
  stripGeneratedImageEchoes,
} from '../src/chat/generatedImage.ts';
import type { ToolPart } from '../src/chat/transcript.ts';

const generate = (result: unknown): ToolPart => ({
  kind: 'tool',
  id: 'g',
  name: 'image_generate',
  context: '',
  args: {},
  status: 'done',
  result: typeof result === 'string' ? result : JSON.stringify(result),
});

test('the host path is the display source, and a failed generation has none', () => {
  assert.equal(generatedImageFromResult(JSON.stringify({ success: true, host_image: '/h/a.png', image: '/s/a.png' })), '/h/a.png');
  assert.equal(generatedImageFromResult({ image: 'https://cdn.example/x.png' }), 'https://cdn.example/x.png');
  assert.equal(generatedImageFromResult({ success: false, image: '/s/a.png' }), null);
  assert.equal(generatedImageFromResult('not json'), null);
});

test('only decoded pixel_size counts as intrinsic geometry', () => {
  assert.deepEqual(generatedImageDimensionsFromResult({ pixel_size: '1024x768' }), { width: 1024, height: 768 });
  assert.equal(generatedImageDimensionsFromResult({ size: '1024x768', aspect_ratio: 'landscape' }), undefined);
  assert.equal(generatedImageDimensionsFromResult({ pixel_size: '0x10' }), undefined);
});

test('echo sources cover every path variant of a successful generation', () => {
  const sources = generatedImageEchoSources([
    generate({ host_image: '/h/a.png', image: '/s/a.png', agent_visible_image: '/v/a.png' }),
    generate({ success: false, image: '/s/b.png' }),
    { kind: 'text', text: 'hi' },
  ]);
  assert.deepEqual(sources, ['/h/a.png', '/s/a.png', '/v/a.png']);
});

test('prose drops the generated image but keeps other files and longer paths', () => {
  const sources = ['/tmp/a.png'];
  assert.equal(stripGeneratedImageEchoes('Done!\n\n![art](/tmp/a.png)\n\nEnjoy', sources), 'Done!\n\n\n\nEnjoy');
  assert.equal(stripGeneratedImageEchoes('MEDIA:/tmp/a.png\nlook', sources), '\nlook');
  assert.equal(stripGeneratedImageEchoes('saved to /tmp/a.png.', sources), 'saved to .');
  assert.equal(stripGeneratedImageEchoes('also MEDIA:/tmp/a.png.bak', sources), 'also MEDIA:/tmp/a.png.bak');
  assert.equal(stripGeneratedImageEchoes('[x](/tmp/a.png.bak)', sources), '[x](/tmp/a.png.bak)');
  assert.equal(stripGeneratedImageEchoes('untouched', []), 'untouched');
});

// the implementation before the substring pre-checks and the pattern cache, kept as the oracle
function referenceStrip(text: string, sources: readonly string[]): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!text || sources.length === 0) return text;
  let next = text;
  for (const source of [...new Set(sources.filter(Boolean))]) {
    const escaped = escape(source);
    next = next.replace(new RegExp(String.raw`[\`"']?MEDIA:\s*[\`"']?${escaped}[\`"']?(?=$|[\s)\]}]|[.,!?](?:\s|$))`, 'g'), '');
    next = next.replace(new RegExp(String.raw`!\[[^\]\n]*\]\(\s*<?${escaped}>?(?=$|[\s)\\])[^)\n]*\)`, 'g'), '');
    next = next.replace(new RegExp(String.raw`\[[^\]\n]*\]\(\s*#media:${escape(encodeURIComponent(source))}\s*\)`, 'gi'), '');
    next = next.replace(new RegExp(String.raw`(^|[\s[{])<?${escaped}>?(?=$|[\s\]}.,!?])`, 'g'), '$1');
  }
  return next;
}

test('the fast paths strip exactly what the unconditional scans did', () => {
  const sources = ['/tmp/a.png', '/Users/me/My Pictures/b (1).png', 'https://cdn.example/x.png?a=1&b=2', 'C:\\img\\c.png'];
  const pieces = [
    'Done! ',
    ...sources,
    ...sources.map((source) => `MEDIA:${source}`),
    ...sources.map((source) => `![art](${source})`),
    ...sources.map((source) => `[open](#media:${encodeURIComponent(source)})`),
    ...sources.map((source) => `[open](#MEDIA:${encodeURIComponent(source).toLowerCase()})`),
    ...sources.map((source) => `\`${source}\``),
    '/tmp/a.png.bak',
    '[x](/tmp/a.png.bak)',
    'MEDIA:/tmp/other.pdf',
    '\n',
    '\n\n',
    ' ',
    '.',
  ];
  let state = 0x1234;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 1500; sample++) {
    let text = '';
    for (let index = Math.floor(next() * 10); index > 0; index--) text += pieces[Math.floor(next() * pieces.length)];
    const chosen = sources.filter(() => next() < 0.5);
    assert.equal(stripGeneratedImageEchoes(text, chosen), referenceStrip(text, chosen), JSON.stringify({ text, chosen }));
  }
});

test('a reply that never mentions the image is returned as it came', () => {
  const text = 'A long reply about something else entirely.\n\n'.repeat(50);
  assert.equal(stripGeneratedImageEchoes(text, ['/tmp/a.png']), text);
});
