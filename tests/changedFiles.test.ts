import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveChangedFiles, fileEditBasename, fileEditPath, filesChangedLabel } from '../src/chat/changedFiles.ts';
import type { ToolPart } from '../src/chat/transcript.ts';

const edit = (over: Partial<ToolPart> & Pick<ToolPart, 'name'>): ToolPart => ({
  kind: 'tool',
  id: `${over.name}-${Math.random()}`,
  context: '',
  args: {},
  status: 'done',
  ...over,
});

const diff = (added: number, removed: number) =>
  ['@@ -1 +1 @@', ...Array.from({ length: removed }, (_, i) => `-old${i}`), ...Array.from({ length: added }, (_, i) => `+new${i}`)].join('\n');

test('one row per file, +/- summed across edits, in first-touched order', () => {
  const files = deriveChangedFiles([
    edit({ name: 'patch', args: { path: '/repo/src/a.ts' }, result: JSON.stringify({ diff: diff(2, 1) }) }),
    edit({ name: 'write_file', args: { path: '/repo/b.md' }, result: JSON.stringify({ inline_diff: diff(5, 0) }) }),
    edit({ name: 'patch', args: { path: '/repo/src/a.ts' }, result: JSON.stringify({ diff: diff(1, 3) }) }),
  ]);
  assert.deepEqual(files, [
    { path: '/repo/src/a.ts', name: 'a.ts', added: 3, removed: 4 },
    { path: '/repo/b.md', name: 'b.md', added: 5, removed: 0 },
  ]);
});

test('only landed file edits with a diff count', () => {
  const files = deriveChangedFiles([
    edit({ name: 'patch', args: { path: '/a.ts' }, status: 'running' }),
    edit({ name: 'patch', args: { path: '/b.ts' }, result: JSON.stringify({ success: false, error: 'no match' }) }),
    edit({ name: 'terminal', args: { command: 'ls' }, result: JSON.stringify({ diff: diff(1, 1) }) }),
    { kind: 'text', text: 'done' },
  ]);
  assert.deepEqual(files, []);
});

test('the path falls back to the result, then to an html path in the diff preamble', () => {
  assert.equal(fileEditPath({}, { resolved_path: '/x/y.ts' }), '/x/y.ts');
  assert.equal(fileEditPath({}, { diff: 'a/pages/index.html → b/pages/index.html\n@@ -1 +1 @@\n-a\n+b' }), 'pages/index.html');
  assert.equal(fileEditBasename('C:\\repo\\src\\main.rs'), 'main.rs');
});

test('the card heads itself with a count', () => {
  assert.equal(filesChangedLabel(1), '1 file changed');
  assert.equal(filesChangedLabel(4), '4 files changed');
});
