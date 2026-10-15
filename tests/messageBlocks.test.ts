import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generatedImageEchoSources } from '../src/chat/generatedImage.ts';
import { blocks, echoSources, sameList } from '../src/chat/messageBlocks.ts';
import type { Part, ToolPart } from '../src/chat/transcript.ts';

const tool = (id: string, over: Partial<ToolPart> = {}): ToolPart => ({ kind: 'tool', id, name: 'terminal', context: '', args: {}, status: 'done', ...over });

test('consecutive tool parts share a block and blank text is dropped', () => {
  const a = tool('a');
  const b = tool('b');
  const c = tool('c');
  const reasoning: Part = { kind: 'reasoning', text: 'hmm' };
  const text: Part = { kind: 'text', text: 'answer' };
  const out = blocks([reasoning, { kind: 'text', text: ' \n\t' }, a, b, text, c]);
  assert.deepEqual(
    out.map((block) => block.kind),
    ['reasoning', 'tools', 'text', 'tools'],
  );
  assert.equal(out[0], reasoning);
  assert.equal(out[2], text);
  assert.deepEqual(out[1].kind === 'tools' && out[1].tools, [a, b]);
});

test('blocks are built once per parts array, and an unrelated delta leaves earlier parts identical', () => {
  const a = tool('a');
  const parts: Part[] = [a, { kind: 'text', text: 'hi' }];
  assert.equal(blocks(parts), blocks(parts));
  // what a delta does: a new array whose untouched parts are the same objects
  const next: Part[] = [parts[0], { kind: 'text', text: 'hi there' }];
  const before = blocks(parts);
  const after = blocks(next);
  assert.notEqual(after, before);
  const tools = (list: ReturnType<typeof blocks>) => (list[0].kind === 'tools' ? list[0].tools : []);
  assert.notEqual(tools(after), tools(before));
  assert.ok(sameList(tools(after), tools(before)), 'a tools block is compared part by part, so it is not re-rendered');
});

test('sameList compares by reference', () => {
  const a = tool('a');
  assert.ok(sameList([a], [a]));
  assert.ok(!sameList([a], [{ ...a }]));
  assert.ok(!sameList([a], [a, a]));
  assert.ok(sameList([], []));
});

test('echo sources match the generated-image module and parse each image result once', () => {
  const image = tool('i', { name: 'image_generate', result: JSON.stringify({ success: true, image: '/tmp/a.png', host_image: '/host/a.png' }) });
  const failed = tool('f', { name: 'image_generate', result: JSON.stringify({ success: false, image: '/tmp/b.png' }) });
  const other = tool('o', { result: JSON.stringify({ image: '/tmp/c.png' }) });
  const parts: Part[] = [image, failed, other, { kind: 'text', text: 'x' }];
  assert.deepEqual(echoSources(parts), generatedImageEchoSources(parts));
  assert.deepEqual(echoSources([]), []);

  const original = JSON.parse;
  let calls = 0;
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    calls += 1;
    return original(...args);
  }) as typeof JSON.parse;
  try {
    for (let i = 0; i < 20; i += 1) echoSources(parts);
  } finally {
    JSON.parse = original;
  }
  assert.equal(calls, 0);
});

test('a message with no image has one shared empty echo list', () => {
  assert.equal(echoSources([tool('a')]), echoSources([]));
});

test('grouping a long turn is linear: a delta rebuilds in well under a millisecond per hundred parts', () => {
  const parts: Part[] = Array.from({ length: 2_000 }, (_, i) => (i % 3 ? tool(`t${i}`) : { kind: 'text' as const, text: `paragraph ${i}` }));
  const start = performance.now();
  for (let i = 0; i < 50; i += 1) blocks([...parts, { kind: 'text', text: `delta ${i}` }]);
  assert.ok(performance.now() - start < 500);
});
