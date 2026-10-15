import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inlineDiffFromResult, stripInlineDiffChrome } from '../src/chat/inlineDiff.ts';

test('inline diffs come from the result, chrome and escape codes stripped', () => {
  const diff = '┊ review diff\n\u001b[32m@@ -1 +1 @@\u001b[0m\n-a\n+b';
  assert.equal(stripInlineDiffChrome(diff), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult(JSON.stringify({ success: true, diff: '@@ -1 +1 @@\n-a\n+b' })), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult({ inline_diff: '@@ -1 +1 @@\n-a\n+b', diff: 'ignored' }), '@@ -1 +1 @@\n-a\n+b');
  assert.equal(inlineDiffFromResult('not json'), '');
  assert.equal(inlineDiffFromResult(undefined), '');
});
