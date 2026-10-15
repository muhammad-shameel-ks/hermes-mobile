import assert from 'node:assert/strict';
import { test } from 'node:test';

import { paletteFor } from '../src/files/palette.ts';

test('diff tints are the desktop green and red at 12%, foregrounds mix toward the page', () => {
  const dark = paletteFor({ renderedMode: 'dark' });
  const light = paletteFor({ renderedMode: 'light' });
  assert.equal(light.green, '#1f8a65');
  assert.equal(dark.green, '#55a583');
  assert.equal(light.diffAddBackground, '#1f8a651f');
  assert.equal(dark.diffRemoveBackground, '#e75e781f');
  assert.equal(light.diffAddBorder, light.green);
  assert.notEqual(light.diffAddForeground, dark.diffAddForeground);
});
