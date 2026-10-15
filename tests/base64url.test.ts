import assert from 'node:assert/strict';
import { test } from 'node:test';

import { base64UrlEncode } from '../src/auth/base64url.ts';

const decode = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('encodes against fixed vectors', () => {
  assert.equal(base64UrlEncode(new Uint8Array([])), '');
  assert.equal(base64UrlEncode(new Uint8Array([0])), 'AA');
  assert.equal(base64UrlEncode(new Uint8Array([255])), '_w');
  assert.equal(base64UrlEncode(new Uint8Array([0, 0, 0])), 'AAAA');
  assert.equal(base64UrlEncode(new Uint8Array([251, 239])), '--8');
});

test('is padding-free base64url', () => {
  const value = base64UrlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
  assert.match(value, /^[A-Za-z0-9_-]+$/);
});

test('round-trips every length remainder', () => {
  for (let length = 0; length <= 8; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => index * 31 + length);
    assert.deepEqual(decode(base64UrlEncode(bytes)), Buffer.from(bytes), `length ${length}`);
  }
});
