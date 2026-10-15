import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addAttachments,
  bubbleText,
  fileAttachment,
  imageAttachment,
  imageUploadName,
  MAX_ATTACHMENT_BYTES,
  promptText,
  sizeLabel,
  stageAttachments,
  tooLargeNotice,
  uriLabel,
  type AttachRpc,
} from '../src/chat/attachments.ts';

const target = { sessionId: 'rt-1', profile: 'default' };

function fakeRpc(handlers: Partial<Record<Parameters<AttachRpc>[0], (params: Record<string, unknown>) => unknown>> = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const rpc: AttachRpc = async (method, params) => {
    calls.push({ method, params });
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected ${method}`);
    return handler(params);
  };
  return { rpc, calls };
}

test('an image goes up as bytes under a name the gateway accepts, and a file as a data url', async () => {
  const { rpc, calls } = fakeRpc({
    'image.attach_bytes': () => ({ attached: true, path: '/images/a.jpg' }),
    'file.attach': () => ({ attached: true, ref_text: '@file:attachments/notes.pdf' }),
  });
  const photo = imageAttachment({ uri: 'file:///cache/ImagePicker/IMG_0001.HEIC', fileName: 'IMG_0001.HEIC', mimeType: 'image/jpeg', fileSize: 10 });
  const notes = fileAttachment({ uri: 'file:///cache/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 20 });
  const staged = await stageAttachments(rpc, target, [photo, notes], async (uri) => `b64:${uriLabel(uri)}`);

  assert.deepEqual(calls, [
    { method: 'image.attach_bytes', params: { session_id: 'rt-1', profile: 'default', content_base64: 'b64:IMG_0001.HEIC', filename: 'IMG_0001.jpg' } },
    { method: 'file.attach', params: { session_id: 'rt-1', profile: 'default', name: 'notes.pdf', data_url: 'data:application/pdf;base64,b64:notes.pdf' } },
  ]);
  assert.deepEqual(staged, { refs: ['@file:attachments/notes.pdf'], imagePaths: ['/images/a.jpg'] });
});

test('a failure part-way detaches the images already queued and rethrows', async () => {
  const { rpc, calls } = fakeRpc({
    'image.attach_bytes': () => ({ attached: true, path: '/images/a.png' }),
    'file.attach': () => ({ attached: false, message: 'disk full' }),
    'image.detach': () => ({ detached: true }),
  });
  const items = [imageAttachment({ uri: 'file:///a.png', mimeType: 'image/png' }), fileAttachment({ uri: 'file:///b.txt', name: 'b.txt' })];
  await assert.rejects(stageAttachments(rpc, target, items, async () => 'QQ=='), /disk full/);
  assert.deepEqual(calls.at(-1), { method: 'image.detach', params: { session_id: 'rt-1', profile: 'default', path: '/images/a.png' } });
});

test('an unreadable or oversized attachment never reaches the gateway', async () => {
  const { rpc, calls } = fakeRpc();
  const empty = fileAttachment({ uri: 'file:///gone.txt', name: 'gone.txt' });
  await assert.rejects(stageAttachments(rpc, target, [empty], async () => ''), /Could not read gone\.txt/);
  const huge = fileAttachment({ uri: 'file:///big.bin', name: 'big.bin', size: MAX_ATTACHMENT_BYTES + 1 });
  await assert.rejects(stageAttachments(rpc, target, [huge], async () => 'QQ=='), /big\.bin is too large to upload to the remote gateway \(max 32 MB\)\./);
  assert.deepEqual(calls, []);
});

test('the prompt leads with the file refs, and an image alone asks the desktop question', () => {
  assert.equal(promptText('summarise', { refs: ['@file:a.pdf', '@file:b.txt'], imagePaths: [] }, false), '@file:a.pdf\n@file:b.txt\n\nsummarise');
  assert.equal(promptText('', { refs: [], imagePaths: ['/i.png'] }, true), 'What do you see in this image?');
  assert.equal(promptText('look', { refs: [], imagePaths: ['/i.png'] }, true), 'look');
});

test('the bubble shows what was typed, else the attachment names', () => {
  const items = [imageAttachment({ uri: 'file:///x/one.png' }), fileAttachment({ uri: 'file:///x/two.pdf', name: 'two.pdf' })];
  assert.equal(bubbleText('hello', items), 'hello');
  assert.equal(bubbleText('', items), 'one.png, two.pdf');
});

test('image upload names trust the mime type over a stale suffix, and go bare when neither is known', () => {
  assert.equal(imageUploadName('IMG_1.HEIC', 'image/jpeg'), 'IMG_1.jpg');
  assert.equal(imageUploadName('shot.png', 'image/png'), 'shot.png');
  assert.equal(imageUploadName('shot.PNG'), 'shot.PNG');
  assert.equal(imageUploadName('photo.heic'), 'photo');
  assert.equal(imageUploadName('photo'), 'photo');
});

test('picking the same attachment twice keeps one chip, in place', () => {
  const a = fileAttachment({ uri: 'file:///a', name: 'a' });
  const b = fileAttachment({ uri: 'file:///b', name: 'b' });
  const again = fileAttachment({ uri: 'file:///a', name: 'a2' });
  assert.deepEqual(
    addAttachments(addAttachments([], [a, b]), [again]).map((x) => x.label),
    ['a2', 'b'],
  );
});

test('labels and sizes read like the desktop chips', () => {
  assert.equal(uriLabel('file:///cache/My%20Photo.jpg'), 'My Photo.jpg');
  assert.equal(sizeLabel(512), '512 B');
  assert.equal(sizeLabel(1536), '1.5 KB');
  assert.equal(sizeLabel(5 * 1024 * 1024), '5.0 MB');
  assert.equal(tooLargeNotice('a', undefined), null);
  assert.equal(tooLargeNotice('a', 10), null);
});
