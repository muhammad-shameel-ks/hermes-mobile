import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeRemaining, isStale, parseTokenPayload, type Credentials } from '../src/auth/tokens.ts';

const credentials = (expiresAt: number): Credentials => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresAt,
  provider: 'basic',
  userId: 'hermes-mobile',
});

test('staleness leaves a 60 second skew', () => {
  const now = 1_000;
  assert.equal(isStale(credentials(1_061), now), false);
  assert.equal(isStale(credentials(1_060), now), true);
  assert.equal(isStale(credentials(900), now), true);
});

test('parses the gateway payload and tolerates unknown fields', () => {
  const parsed = parseTokenPayload(
    JSON.stringify({
      access_token: 'a',
      refresh_token: 'r',
      token_type: 'Bearer',
      expires_at: 1791000000,
      provider: 'basic',
      user_id: 'hermes-mobile',
      scope: 'unknown-to-us',
    }),
  );
  assert.deepEqual(parsed, {
    accessToken: 'a',
    refreshToken: 'r',
    tokenType: 'Bearer',
    expiresAt: 1791000000,
    provider: 'basic',
    userId: 'hermes-mobile',
  });
});

test('rejects payloads without an access token', () => {
  assert.equal(parseTokenPayload('not json'), null);
  assert.equal(parseTokenPayload(JSON.stringify({ refresh_token: 'r' })), null);
  assert.equal(parseTokenPayload(JSON.stringify({ access_token: '' })), null);
});

test('describes the remaining lifetime', () => {
  assert.equal(describeRemaining(1_000, 1_000), 'expired');
  assert.equal(describeRemaining(1_030, 1_000), 'under a minute');
  assert.equal(describeRemaining(1_180, 1_000), '3 m');
  assert.equal(describeRemaining(1_000 + 3600 * 12, 1_000), '12 h');
  assert.equal(describeRemaining(1_000 + 3600 * 11 + 59 * 60, 1_000), '11 h 59 m');
  assert.equal(describeRemaining(1_000 + 86400 * 30, 1_000), '30 d');
});
