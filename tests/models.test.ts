import assert from 'node:assert/strict';
import { test } from 'node:test';

import { introBody } from '../src/chat/intro.ts';
import { buildModelGroups, modelDisplayParts, modelPillLabel } from '../src/chat/models.ts';

test('model ids split into the desktop display name and variant tag', () => {
  assert.deepEqual(modelDisplayParts('deepseek-v4.1-flash'), { name: 'DeepSeek V4.1', tag: 'Flash' });
  assert.deepEqual(modelDisplayParts('google/gemini-3-pro-preview'), { name: 'Gemini 3 Pro', tag: 'Preview' });
  assert.deepEqual(modelDisplayParts('claude-haiku-4-5-20251001'), { name: 'Haiku 4.5', tag: '' });
  assert.deepEqual(modelDisplayParts('qwen3-235b-a22b-instruct-Q4_K_M'), { name: 'Qwen3 235B A22B', tag: 'Q4' });
  assert.equal(modelPillLabel('gpt-5.5-fast'), 'GPT-5.5 · Fast');
});

test('groups put favorites first, mark the current row and filter by search', () => {
  const providers = [
    { slug: 'google', name: 'Google', models: ['gemini-3-flash-preview', 'gemini-3-pro-preview'] },
    { slug: 'opencode-go', name: 'OpenCode Go', models: ['deepseek-v4.1-flash'], usage: { accounts: [{ id: 'x', state: 'ready' as const }] } },
  ];
  const groups = buildModelGroups(providers, {
    favorites: ['google::gemini-3-pro-preview'],
    current: { model: 'deepseek-v4.1-flash', provider: 'opencode-go' },
  });
  assert.deepEqual(
    groups.map((g) => [g.label, g.detail, g.rows.length]),
    [
      ['Favorites', null, 1],
      ['Google', null, 2],
      ['OpenCode Go', '1 account', 1],
    ],
  );
  assert.equal(groups[2].rows[0].current, true);
  assert.equal(groups[1].rows[1].favorite, true);

  const searched = buildModelGroups(providers, { favorites: [], current: null, query: 'deep flash' });
  assert.deepEqual(searched.map((g) => g.rows.map((r) => r.name)), [['DeepSeek V4.1']]);
});

test('intro copy follows the personality, with the custom fallback for unknown names', () => {
  assert.match(introBody('', 0), /Ask a question/);
  assert.equal(introBody('none', 0), introBody('', 0));
  assert.equal(introBody('Pirate', 1), introBody('pirate', 1));
  assert.equal(introBody('my-voice', 1), "Bring the context or the stuck part. I'll adapt to your configured personality.");
  assert.equal(introBody('my-voice', 4), "Give me the context and I'll answer in My Voice mode.");
});
