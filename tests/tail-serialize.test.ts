import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Message } from '../src/chat/transcript.ts';
import { WARM_TAIL_FALLBACK_MESSAGES, WARM_TAIL_MAX_BYTES, WARM_TAIL_MESSAGES } from '../src/store/lru.ts';
import { persistable, serializeTail } from '../src/store/sessions.ts';

/** the original whole-array implementation, kept as the oracle */
function reference(messages: readonly Message[]): string | null {
  const settled = persistable(messages);
  if (settled.length === 0) return null;
  for (const count of [WARM_TAIL_MESSAGES, WARM_TAIL_FALLBACK_MESSAGES]) {
    const payload = JSON.stringify(settled.slice(-count));
    if (payload.length <= WARM_TAIL_MAX_BYTES) return payload;
  }
  return null;
}

const message = (id: string, bytes: number): Message => ({ id, role: 'assistant', status: 'complete', parts: [{ kind: 'text', text: 'x'.repeat(bytes) }] }) as Message;

function lcg(seed: number) {
  let state = seed;
  return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

test('the incremental serializer matches the whole-array one across sizes around the caps', () => {
  const random = lcg(7);
  for (let round = 0; round < 400; round += 1) {
    const count = Math.floor(random() * 60);
    const scale = [10, 500, 4_000, 20_000, 60_000][Math.floor(random() * 5)]!;
    const messages = Array.from({ length: count }, (_, i) => message(`m${i}`, Math.floor(random() * scale)));
    assert.equal(serializeTail(messages), reference(messages), `round ${round} (${count} messages, scale ${scale})`);
  }
});

test('it stops at the cap rather than serializing a tail of huge messages', () => {
  const huge = Array.from({ length: 40 }, (_, i) => message(`h${i}`, 400_000));
  assert.equal(serializeTail(huge), null);
  assert.equal(reference(huge), null);
  const mixed = [...Array.from({ length: 30 }, (_, i) => message(`b${i}`, 100_000)), ...Array.from({ length: 8 }, (_, i) => message(`s${i}`, 1_000))];
  assert.equal(serializeTail(mixed), reference(mixed));
  assert.ok(serializeTail(mixed) !== null);
});
