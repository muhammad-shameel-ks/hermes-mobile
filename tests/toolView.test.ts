import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildToolView, clipDetail, splitRunItems, summarizeShellCommand, summarizeToolRun, toolDiff, toolFailed } from '../src/chat/toolView.ts';
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

test('a session search names its query, live and reloaded, and a run of them folds to "Used 2 tools"', () => {
  const first = tool({ id: 'a', name: 'session_search', args: { query: 'Jarvis Stark favourite character' }, result: JSON.stringify({ success: true, results: [1, 2] }) });
  const second = tool({ id: 'b', name: 'session_search', status: 'running', args: { query: 'marvel movies' } });
  const done = buildToolView(first);
  assert.equal(done.title, 'Searched past sessions · “Jarvis Stark favourite character”');
  assert.equal(done.icon, 'search');
  assert.equal(done.countLabel, '2 results');
  assert.equal(buildToolView(second).title, 'Searching past sessions · “marvel movies”');
  assert.equal(buildToolView(tool({ name: 'session_search', context: 'marvel movies' })).title, 'Searched past sessions · “marvel movies”');
  assert.equal(buildToolView(tool({ name: 'session_search' })).title, 'Searched past sessions');
  assert.equal(summarizeToolRun([first, { ...second, status: 'done' }], false), 'Used 2 tools');
});

test('an untitled tool carries what it touched as a subtitle; titled tools do not', () => {
  assert.equal(buildToolView(tool({ name: 'skill_view', context: 'plan-feature' })).subtitle, 'plan-feature');
  assert.equal(buildToolView(tool({ name: 'skill_view', args: { context: 'recall: "x"' }, context: 'x' })).subtitle, 'recall: "x"');
  assert.equal(buildToolView(tool({ name: 'skill_view' })).subtitle, undefined);
  assert.equal(buildToolView(tool({ name: 'read_file', context: 'a.ts', args: { path: '/a.ts' } })).subtitle, undefined);
  assert.equal(buildToolView(tool({ name: 'memory', context: 'note' })).subtitle, undefined);
});

// ─── render cost: a part is parsed once, and a collapsed row never builds its body ──────────────

const countCalls = <T>(target: object, key: string, run: () => T): { value: T; calls: number } => {
  const record = target as Record<string, (...args: unknown[]) => unknown>;
  const original = record[key];
  let calls = 0;
  record[key] = (...args: unknown[]) => {
    calls += 1;
    return original.apply(target, args);
  };
  try {
    return { value: run(), calls };
  } finally {
    record[key] = original;
  }
};

const bigResult = () => JSON.stringify({ success: true, results: Array.from({ length: 2000 }, (_, i) => ({ id: i, title: `row ${i}` })) });

test('a part is built into its view once, however many rows mount or summaries re-render', () => {
  const part = tool({ name: 'web_search', args: { query: 'x' }, result: bigResult() });
  const first = buildToolView(part);
  const { calls } = countCalls(JSON, 'parse', () => {
    for (let i = 0; i < 50; i += 1) {
      assert.equal(buildToolView(part), first);
      summarizeToolRun([part, part], false);
      toolFailed(part);
      toolDiff(part);
    }
  });
  assert.equal(calls, 0);
  assert.equal(buildToolView({ ...part }) === first, false);
});

test('a result is parsed at most once for the whole view', () => {
  const part = tool({ name: 'web_search', args: { query: 'x' }, result: bigResult() });
  const { calls } = countCalls(JSON, 'parse', () => buildToolView(part));
  assert.equal(calls, 1);
});

test('a collapsed row never pretty-prints its result; the detail is built on read', () => {
  const part = tool({ name: 'web_search', args: { query: 'x' }, result: bigResult() });
  const { value: view, calls } = countCalls(JSON, 'stringify', () => {
    const built = buildToolView(part);
    assert.equal(built.hasDetail, true);
    return built;
  });
  assert.equal(calls, 0);
  assert.match(view.detail, /^\{\n {2}"success": true/);
  assert.equal(view.detailPreview, clipDetail(view.detail));
  assert.equal(view.detailPreview, view.detailPreview);
});

test('hasDetail agrees with the detail it stands in for', () => {
  const diff = '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b';
  const cases: Partial<ToolPart>[] = [
    { name: 'terminal', status: 'running' },
    { name: 'terminal', result: '' },
    { name: 'terminal', result: '   ' },
    { name: 'terminal', result: JSON.stringify({ exit_code: 0 }) },
    { name: 'terminal', result: JSON.stringify({ exit_code: 0, output: 'hi' }) },
    { name: 'terminal', result: JSON.stringify({ stderr: 'warn' }) },
    { name: 'terminal', result: JSON.stringify({ exit_code: 3 }) },
    { name: 'read_file', result: JSON.stringify({ content: 'body' }) },
    { name: 'read_file', result: 'File not found: /x' },
    { name: 'web_search', resultText: ' shown ' },
    { name: 'web_search', summary: 'did 3 things' },
    { name: 'web_search', summary: '' },
    { name: 'web_search', result: '[1,2]' },
    { name: 'web_search', result: '{bad' },
    { name: 'patch', result: JSON.stringify({ success: true, diff }) },
    { name: 'patch', result: JSON.stringify({ success: true }) },
    { name: 'execute_code', result: 'Traceback', error: 'NameError' },
  ];
  for (const over of cases) {
    const view = buildToolView(tool(over as Partial<ToolPart> & Pick<ToolPart, 'name'>));
    assert.equal(view.hasDetail, view.detail !== '', JSON.stringify(over));
  }
});

test('clipDetail keeps what a 24-line box shows and stops scanning there', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
  assert.equal(clipDetail(lines(24)), lines(24));
  assert.equal(clipDetail(lines(25)), lines(25));
  // a 26th line exists, so the box still ends in its ellipsis; the lines past it are never handed over
  assert.equal(clipDetail(lines(500)), lines(25));
  assert.equal(clipDetail(''), '');
  assert.equal(clipDetail('x'.repeat(100_000)).length, 8_000);
  assert.equal(clipDetail('a\n'.repeat(10) + 'y'.repeat(100_000)).length, 8_000);
  // a cut never lands inside a surrogate pair
  const emoji = '😀'.repeat(6_000);
  const clipped = clipDetail(emoji);
  assert.equal(clipped.length % 2, 0);
  assert.equal(clipped, emoji.slice(0, clipped.length));
});

test('clipDetail is bounded by the cut, not by the size of the output', () => {
  const huge = 'a line of output\n'.repeat(1_000_000);
  const start = performance.now();
  for (let i = 0; i < 100; i += 1) clipDetail(huge);
  assert.ok(performance.now() - start < 50, 'clipping 17MB a hundred times scans only the head');
});
