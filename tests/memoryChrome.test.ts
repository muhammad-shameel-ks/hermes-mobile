import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseReviewNote, reviewNoteText } from '../src/chat/reviewNote.ts';
import { applyEvent, emptyTranscript } from '../src/chat/transcript.ts';
import { gradientAt, gradientColors } from '../src/ui/gradient.ts';
import { resolveTokens } from '../src/ui/tokens.ts';

test('a review summary loses its emoji and becomes a review note', () => {
  assert.equal(reviewNoteText('💾 Self-improvement review: saved 2 memories'), 'review:Self-improvement review: saved 2 memories');
  assert.equal(reviewNoteText('  💾  '), '');
  assert.deepEqual(parseReviewNote('review:Self-improvement review: saved 2 memories'), {
    label: 'Self-improvement review',
    detail: 'saved 2 memories',
  });
  assert.deepEqual(parseReviewNote('review:Saved to memory'), { label: 'Saved to memory', detail: '' });
  assert.equal(parseReviewNote('Conversation compacted.'), null);
});

test('the review.summary event lands as a persistent system row', () => {
  const next = applyEvent(emptyTranscript(), { type: 'review.summary', payload: { text: '💾 Self-improvement review: saved a memory' } });
  const last = next.messages[next.messages.length - 1];
  assert.equal(last?.role, 'system');
  assert.deepEqual(last?.parts, [{ kind: 'text', text: 'review:Self-improvement review: saved a memory' }]);
  assert.equal(applyEvent(emptyTranscript(), { type: 'review.summary', payload: {} }).messages.length, 0);
});

test('the gradient runs through its stops from first to last character', () => {
  const stops = [
    [0, '#ff0000'],
    [0.5, '#00ff00'],
    [1, '#0000ff'],
  ] as const;
  assert.equal(gradientAt(stops, 0), '#ff0000');
  assert.equal(gradientAt(stops, 0.5), '#00ff00');
  assert.equal(gradientAt(stops, 1), '#0000ff');
  const runs = gradientColors('abcd', stops);
  assert.deepEqual(
    runs.map((r) => r.char),
    ['a', 'b', 'c', 'd'],
  );
  assert.notEqual(runs[0].color, runs[3].color);
});

test('the memory chrome is gold to purple, never the amber warning', () => {
  const t = resolveTokens('dark');
  assert.notEqual(t.toolMemoryLegendaryFrom, t.toolMemoryLegendaryTo);
  assert.notEqual(t.toolMemoryLegendaryIcon, '#fcd34d');
});
