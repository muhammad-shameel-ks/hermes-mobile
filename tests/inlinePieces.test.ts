import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertTypeOf } from '../src/chat/alert.ts';
import { detectArtifact, sanitizeLanguageTag } from '../src/chat/artifact.ts';
import { delegateGoals, delegateRowsFromCall, mergeDelegateRows, type SubagentProgress } from '../src/chat/delegate.ts';
import { hostLabel, parseListings, specLine } from '../src/chat/listing.ts';
import { fitSvgToBox, sanitizeSvg, svgAspectRatio } from '../src/chat/svg.ts';

const longCode = (lines: number) => Array.from({ length: lines }, (_, i) => `const value${i} = compute(${i});`).join('\n');

test('a short or non-code fence is not an artifact; a long one titles itself from the content', () => {
  assert.equal(detectArtifact('ts', longCode(10)), null);
  assert.equal(detectArtifact('text', longCode(80)), null);
  assert.equal(detectArtifact('diff', longCode(80)), null);
  assert.deepEqual(detectArtifact('ts', `// server.ts\n${longCode(60)}`), { kind: 'code', language: 'ts', title: 'server.ts' });
  assert.deepEqual(detectArtifact('python', `def main():\n${longCode(60)}`), { kind: 'code', language: 'python', title: 'main' });
});

test('an html document becomes an artifact once it is more than a stub', () => {
  assert.equal(detectArtifact('html', '<p>hi</p>'), null);
  const page = `<!doctype html><html><head><title>Todo app</title></head><body>${'<div>row</div>'.repeat(20)}</body></html>`;
  assert.deepEqual(detectArtifact('html', page), { kind: 'html', language: 'html', title: 'Todo app' });
});

test('only a large standalone svg is promoted; a small one keeps its inline render', () => {
  assert.equal(detectArtifact('svg', '<svg viewBox="0 0 1 1"/>'), null);
  const big = `<svg><title>Chart</title>${'<rect width="1" height="1"/>'.repeat(120)}</svg>`;
  assert.equal(detectArtifact('svg', big)?.title, 'Chart');
});

test('language tags are sanitized', () => {
  assert.equal(sanitizeLanguageTag('TypeScript title="x"'), 'typescript');
  assert.equal(sanitizeLanguageTag('a'.repeat(30)), '');
  assert.equal(sanitizeLanguageTag('<script>'), '');
});

test('svg loses scripts, handlers, links and remote references but keeps internal ones', () => {
  const dirty = [
    '<?xml version="1.0"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onload="steal()">',
    '<script>alert(1)</script>',
    '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>',
    '<a href="https://evil.test"><rect width="10" height="10" fill="url(#g)" onclick="x()"/></a>',
    '<image href="https://evil.test/track.png" width="5" height="5"/>',
    '<image href="data:image/png;base64,AAAA" width="5" height="5"/>',
    '<use href="#g"/>',
    '<circle r="5" style="fill:url(https://evil.test/x)"/>',
    '<foreignObject><div>hi</div></foreignObject>',
    '</svg>',
  ].join('');
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /script|onload|onclick|evil|foreignObject|<a\b|<\?xml/i);
  assert.match(clean, /fill="url\(#g\)"/);
  assert.match(clean, /<use href="#g"\/>/);
  assert.match(clean, /data:image\/png/);
});

test('svg aspect comes from the viewBox, else the root size, and fitting drops the fixed size', () => {
  assert.equal(svgAspectRatio('<svg viewBox="0 0 200 100"></svg>'), 2);
  assert.equal(svgAspectRatio('<svg width="300px" height="100"></svg>'), 3);
  assert.equal(svgAspectRatio('<svg></svg>'), null);
  assert.equal(fitSvgToBox('<svg width="300" height="100"><g/></svg>'), '<svg viewBox="0 0 300 100"><g/></svg>');
  assert.equal(fitSvgToBox('<svg viewBox="0 0 4 2" width="400"><g/></svg>'), '<svg viewBox="0 0 4 2"><g/></svg>');
});

test('listings accept three shapes, drop identity-less rows and keep only https links', () => {
  const one = parseListings(JSON.stringify({ address: '12 Dock St', price: '$3,000/mo', beds: '3', baths: 2.5, size: '2,136 sqft', facts: ['dock'], images: ['https://cdn.test/a.jpg', 'javascript:x'], url: 'https://www.homes.com/x' }));
  assert.equal(one.length, 1);
  assert.equal(specLine(one[0]), '3 bd · 2.5 ba · 2,136 sqft');
  assert.deepEqual(one[0].images, ['https://cdn.test/a.jpg']);
  assert.deepEqual(one[0].links, [{ label: 'homes.com', url: 'https://www.homes.com/x' }]);
  assert.equal(parseListings(JSON.stringify([{ title: 'A' }, { price: 'no address' }, 7])).length, 1);
  assert.equal(parseListings(JSON.stringify({ listings: [{ address: 'B' }] })).length, 1);
  assert.deepEqual(parseListings('{"address":'), []);
  assert.equal(hostLabel('not a url'), 'Listing');
});

test('alert markers pick the kind case-insensitively', () => {
  assert.equal(alertTypeOf('[!NOTE]\nbody'), 'note');
  assert.equal(alertTypeOf('  [!warning] careful'), 'warning');
  assert.equal(alertTypeOf('just a quote'), null);
});

const live = (over: Partial<SubagentProgress> & Pick<SubagentProgress, 'id' | 'goal'>): SubagentProgress => ({
  status: 'running',
  taskIndex: 0,
  stream: [],
  ...over,
});

test('a call reads as running until it answers, then as parked, completed or failed per child', () => {
  const args = { tasks: [{ goal: 'Research A' }, { goal: 'Research B' }] };
  assert.deepEqual(delegateGoals(args), ['Research A', 'Research B']);
  assert.deepEqual(delegateRowsFromCall(args, undefined, 'c1').map((r) => r.status), ['running', 'running']);
  assert.deepEqual(delegateRowsFromCall(args, JSON.stringify({ status: 'dispatched', goals: ['Research A', 'Research B'] }), 'c1').map((r) => r.status), ['dispatched', 'dispatched']);
  const settled = delegateRowsFromCall(args, JSON.stringify({ results: [{ status: 'ok', summary: 'found it', duration_seconds: 12 }, { status: 'timeout' }] }), 'c1');
  assert.deepEqual(settled.map((r) => r.status), ['completed', 'failed']);
  assert.deepEqual(settled[0].activity, ['found it']);
  assert.equal(settled[0].durationSeconds, 12);
});

test('live subagents join by call id, then goal, then order only when the counts agree', () => {
  const rows = delegateRowsFromCall({ tasks: [{ goal: 'A' }, { goal: 'B' }] }, undefined, 'c1');
  const byId = mergeDelegateRows(rows, [live({ id: 'delegate-tool:c1:1', goal: 'zzz', stream: [{ text: 'step' }] })], 'c1');
  assert.equal(byId[1].activity[0], 'step');
  assert.equal(byId[0].status, 'running');
  const byGoal = mergeDelegateRows(rows, [live({ id: 'x', goal: ' b ', status: 'completed', sessionId: 's9' })], 'c1');
  assert.equal(byGoal[1].status, 'completed');
  assert.equal(byGoal[1].sessionId, 's9');
  const mismatched = mergeDelegateRows(rows, [live({ id: 'y', goal: 'other', status: 'failed' })], 'c1');
  assert.deepEqual(mismatched.map((r) => r.status), ['running', 'running']);
});
