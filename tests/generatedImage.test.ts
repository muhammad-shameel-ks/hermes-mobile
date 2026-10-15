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
