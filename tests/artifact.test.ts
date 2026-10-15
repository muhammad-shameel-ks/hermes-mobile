import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectArtifact, isLikelyProseCodeBlock, isLikelyStructuredText, sanitizeLanguageTag } from '../src/chat/artifact.ts';

// the implementation before the early exit on code signals, kept as the oracle for the optimised one
const CODE_SIGNAL_RE = [
  /(^|\s)(const|let|var|function|class|import|export|return|if|for|while|switch)\b/gim,
  /=>|==|===|!=|!==|\{|\}|;|<\/?[a-z][^>]*>/gi,
  /^\s*(#include|SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/gim,
];
const NON_CODE_FENCE_LANGUAGES = new Set(['', 'text', 'plain', 'plaintext', 'md', 'markdown']);
const COMMON_CODE_LANGUAGES = new Set([
  'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'java', 'javascript', 'js', 'json', 'jsx', 'markdown', 'md', 'php',
  'python', 'py', 'ruby', 'rust', 'rs', 'sh', 'sql', 'swift', 'tsx', 'ts', 'typescript', 'xml', 'yaml', 'yml',
]);

function referenceSignals(body: string) {
  const trimmed = body.trim();
  const markdown = (trimmed.match(/\*\*[^*]+\*\*/g) || []).length + (trimmed.match(/`[^`\n]+`/g) || []).length;
  return {
    bulletLines: (trimmed.match(/^\s*[-*]\s+\S+/gm) || []).length,
    codeSignals: CODE_SIGNAL_RE.reduce((total, pattern) => total + (trimmed.match(pattern)?.length ?? 0), 0),
    hasMarkdown: markdown > 0,
    proseLines: trimmed.split('\n').filter((line) => {
      const text = line.trim();
      return Boolean(text) && /^[A-Za-z0-9"'`*-]/.test(text);
    }).length,
    trimmed,
  };
}

function referenceIsProse(language: string | undefined, code: string | undefined): boolean {
  const clean = sanitizeLanguageTag(language || '');
  const signals = referenceSignals(code || '');
  if (!signals.trimmed || signals.codeSignals >= 3) return false;
  if (signals.bulletLines >= 1 && (signals.hasMarkdown || signals.proseLines >= 2)) return true;
  if (isLikelyStructuredText(code || '')) return false;
  if (NON_CODE_FENCE_LANGUAGES.has(clean)) return signals.proseLines >= 3 && signals.codeSignals === 0;
  return !COMMON_CODE_LANGUAGES.has(clean) && signals.proseLines >= 2 && signals.codeSignals <= 1;
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const LINES = [
  'const value = compute(1, 2);',
  'function run() { return 1; }',
  'import { x } from "y";',
  'if (a === b) {',
  '}',
  'SELECT * FROM table;',
  '#include <stdio.h>',
  '<div class="a">text</div>',
  'The quick brown fox jumps over the lazy dog.',
  'Another plain sentence without any code in it',
  '- a bullet with **bold** text',
  '* another bullet',
  'Use `inline code` here',
  'key: value',
  'name = other',
  '  indented continuation',
  '',
  '   ',
  'x => x + 1',
  'let',
  '```',
];
const LANGUAGES = [undefined, '', 'ts', 'text', 'md', 'python', 'unknownlang', 'html', 'yaml', 'sh', 'weird tag with spaces'];

test('the early exit on code signals changes no answer', () => {
  const next = rng(0xa11ce);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  for (let sample = 0; sample < 4000; sample++) {
    const lines = Array.from({ length: Math.floor(next() * 14) }, () => pick(LINES));
    const code = lines.join(next() < 0.9 ? '\n' : '\r\n');
    const language = pick(LANGUAGES);
    assert.equal(isLikelyProseCodeBlock(language, code), referenceIsProse(language, code), `${language} ${JSON.stringify(code)}`);
  }
  assert.equal(isLikelyProseCodeBlock('ts', undefined), false);
  assert.equal(isLikelyProseCodeBlock('ts', '   \n  '), false);
});

test('a large fence is an artifact only when it reads as code', () => {
  const code = Array.from({ length: 60 }, (_, index) => `const value${index} = compute(${index});`).join('\n');
  assert.deepEqual(detectArtifact('ts', code), { kind: 'code', language: 'ts', title: 'ts' });
  assert.equal(detectArtifact('ts', code.slice(0, 200)), null);
  const prose = Array.from({ length: 60 }, (_, index) => `- Point number ${index} of the **plan**`).join('\n');
  assert.equal(detectArtifact('ts', prose), null);
  assert.equal(detectArtifact('text', code), null);
  assert.equal(detectArtifact('html', `<!doctype html><html><head><title>Hi</title></head><body>${'x'.repeat(200)}</body></html>`)?.title, 'Hi');
});

test('counting signals only until three are found leaves no regex state behind', () => {
  // each pattern is a shared global regex; the early exit must not leave a stale lastIndex behind
  const code = Array.from({ length: 400 }, (_, index) => `const value${index} = compute(${index});`).join('\n');
  for (let end = 3000; end <= code.length; end += 997) {
    assert.equal(isLikelyProseCodeBlock('ts', code.slice(0, end)), false);
    assert.equal(detectArtifact('ts', code.slice(0, end))?.kind, 'code');
  }
});
