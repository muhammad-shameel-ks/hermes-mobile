import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildToolView, splitRunItems, summarizeShellCommand, summarizeToolRun } from '../src/chat/toolView.ts';
import type { ToolPart } from '../src/chat/transcript.ts';

const tool = (over: Partial<ToolPart> & Pick<ToolPart, 'name'>): ToolPart => ({
  kind: 'tool',
  id: over.name,
  context: '',
  args: {},
  status: 'done',
  ...over,
});

test('execute_code reads "Ran code from …" with its byte count as trailing meta', () => {
  const view = buildToolView(
    tool({
      name: 'execute_code',
      args: { code: 'from hermes_tools import terminal\nprint(1)' },
      result: JSON.stringify({ status: 'success', output: '1', stdout_bytes_total: 1179 }),
    }),
  );
  assert.equal(view.title, 'Ran code from hermes_tools import terminal + 1 command');
  assert.equal(view.icon, 'terminal');
  assert.equal(view.status, 'success');
  assert.equal(view.countLabel, '1179 stdout_bytes');
});

test('an unknown tool is titled from its name, and a failure turns it into an error row', () => {
  const view = buildToolView(tool({ name: 'message_agent', result: JSON.stringify({ success: false, error: 'agent offline' }) }));
  assert.equal(view.title, 'Message Agent');
  assert.equal(view.status, 'error');
  assert.equal(view.error, 'agent offline');
  assert.equal(view.countLabel, undefined);
});

test('the gateway error flag fails a call whose result says nothing', () => {
  const view = buildToolView(tool({ name: 'execute_code', args: { code: 'x()' }, result: 'Traceback', error: 'NameError: x' }));
  assert.equal(view.status, 'error');
  assert.match(view.detail, /NameError/);
});

test('a running call uses the present tense and no meta', () => {
  const view = buildToolView(tool({ name: 'read_file', status: 'running', args: { path: '/src/app/index.ts' } }));
  assert.equal(view.title, 'Reading index.ts');
  assert.equal(view.status, 'running');
  assert.equal(view.durationLabel, undefined);
});

test('a non-zero exit with output is not a failure', () => {
  const view = buildToolView(tool({ name: 'terminal', args: { command: 'grep x f' }, result: JSON.stringify({ exit_code: 1, output: 'nothing' }) }));
  assert.equal(view.status, 'success');
  assert.equal(view.title, 'Ran grep x f');
});

test('shell plumbing is peeled off the displayed command', () => {
  assert.equal(summarizeShellCommand('cd /repo && npm test 2>&1 | tail -20'), 'npm test');
});

test('runs fold between cards and summarize by category', () => {
  assert.deepEqual(splitRunItems(['read_file', 'terminal', 'patch', 'web_search']), [
    { kind: 'run', start: 0, end: 1 },
    { kind: 'card', index: 2 },
    { kind: 'run', start: 3, end: 3 },
  ]);
  const run = [
    tool({ name: 'read_file', args: { path: 'a.ts' } }),
    tool({ name: 'read_file', args: { path: 'b.ts' } }),
    tool({ name: 'terminal', args: { command: 'ls' } }),
    tool({ name: 'terminal', args: { command: 'pwd' }, result: JSON.stringify({ exit_code: 2 }) }),
  ];
  assert.equal(summarizeToolRun(run, false), 'Explored 2 files, ran 2 commands, 1 tool call failed');
});

test('a file edit carries its diff and counts, and the diff stands in for the raw result', () => {
  const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n same';
  const view = buildToolView(tool({ name: 'patch', args: { path: '/repo/src/a.ts' }, result: JSON.stringify({ success: true, diff }) }));
  assert.equal(view.title, 'a.ts');
  assert.equal(view.inlineDiff, diff);
  assert.deepEqual(view.diffStats, { added: 1, removed: 1 });
  assert.equal(view.detail, '');
  assert.equal(buildToolView(tool({ name: 'patch', args: { path: '/a.ts' }, status: 'running' })).inlineDiff, undefined);
});

test('a row shows the image its call touched, but only an image', () => {
  assert.equal(buildToolView(tool({ name: 'vision_analyze', args: { image_url: 'https://x.test/a.png' }, result: 'a cat' })).imageUrl, 'https://x.test/a.png');
  assert.equal(buildToolView(tool({ name: 'read_file', args: { path: '/repo/README.md' }, result: 'text' })).imageUrl, undefined);
});
