import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hslToHex, profileColorSoft, profileInitial } from '../src/drawer/profileGlyph.ts';

test('an hsl colour converts to hex', () => {
  assert.equal(hslToHex('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(hslToHex('hsl(120, 100%, 25%)'), '#008000');
  assert.equal(hslToHex('#336699'), '#336699');
  assert.equal(hslToHex('nope'), null);
});

test('a soft tint keeps the colour and only moves alpha', () => {
  assert.equal(profileColorSoft('hsl(0, 100%, 50%)', 22), '#ff000038');
  assert.equal(profileColorSoft('garbage'), 'transparent');
});

test('the initial is the first letter, number or emoji, uppercased', () => {
  assert.equal(profileInitial('  work'), 'W');
  assert.equal(profileInitial('-- 9lives'), '9');
  assert.equal(profileInitial('🦊 fox'), '🦊');
  assert.equal(profileInitial('---'), '?');
});
