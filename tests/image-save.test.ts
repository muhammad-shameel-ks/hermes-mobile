import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveNotice } from '../src/chat/imageFile.ts';

test('saving to the photo library reports success in the desktop wording', () => {
  assert.deepEqual(saveNotice('saved'), { text: 'Image saved', tone: 'success' });
});

test('a refused permission says where to change it', () => {
  const notice = saveNotice('denied');
  assert.equal(notice.tone, 'error');
  assert.match(notice.text, /Settings/);
});

test('a failed write carries the reason when there is one', () => {
  assert.equal(saveNotice({ error: new Error('disk full') }).text, 'Could not save image: disk full');
  assert.equal(saveNotice({ error: 'offline' }).text, 'Could not save image: offline');
  assert.equal(saveNotice({ error: undefined }).text, 'Could not save image');
});
