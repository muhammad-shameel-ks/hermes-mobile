import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isRecord, parseObject } from '../src/chat/json.ts';

// the implementation before the shape check, kept as the oracle
function referenceParse(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

test('an object passes through and JSON text parses to one', () => {
  const object = { a: 1 };
  assert.equal(parseObject(object), object);
  assert.deepEqual(parseObject('{"a":{"b":[1,2]}}'), { a: { b: [1, 2] } });
  assert.deepEqual(parseObject('  \n\t{"a":1}\r\n '), { a: 1 });
  assert.deepEqual(parseObject('{}'), {});
});

test('anything else, including a partial stream, is an empty object', () => {
  for (const value of [undefined, null, 1, true, [], [1], '', '  ', '[1]', '"x"', '1', 'null', 'x{"a":1}', '{"a":', '{"a":1', '{"a":1}x', '{', '}', '{"a":1}}{', '\u00a0{"a":1}']) {
    assert.deepEqual(parseObject(value), referenceParse(value), String(value));
  }
  assert.deepEqual(parseObject('{"a":'), {});
});

test('every prefix and mangling of a JSON object answers as the unguarded parse did', () => {
  const text = ' {"command":"ls -la","nested":{"list":[1,2,{"x":"y"}],"s":"a}b"}} ';
  for (let end = 0; end <= text.length; end++) {
    assert.deepEqual(parseObject(text.slice(0, end)), referenceParse(text.slice(0, end)), JSON.stringify(text.slice(0, end)));
    assert.deepEqual(parseObject(text.slice(end)), referenceParse(text.slice(end)), JSON.stringify(text.slice(end)));
  }
});
