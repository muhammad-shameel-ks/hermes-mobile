import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toBot, type BotMeta } from '../src/bots/roster.ts';
import { groupBySection, rosterSections } from '../src/bots/sections.ts';

const bot = (name: string, meta: BotMeta = {}) => toBot({ name, path: `/p/${name}`, ui_meta: { 'hermes-bots': meta } }, 0);

test('sections are rebuilt from their members, by name, and need a name to exist', () => {
  const bots = [
    bot('nanox', { sectionId: 'sec-r', sectionName: 'Research team' }),
    bot('scout', { sectionId: 'sec-c', sectionName: 'clients' }),
    bot('ghost', { sectionId: 'sec-x' }),
    bot('pal', { sectionId: null, sectionName: null }),
  ];
  assert.deepEqual(rosterSections(bots), [
    { id: 'sec-c', name: 'clients' },
    { id: 'sec-r', name: 'Research team' },
  ]);
});

test('a section mid-rename takes the name most of its members carry', () => {
  const bots = [
    bot('a', { sectionId: 'sec-r', sectionName: 'Research' }),
    bot('b', { sectionId: 'sec-r', sectionName: 'Research team' }),
    bot('c', { sectionId: 'sec-r', sectionName: 'Research team' }),
  ];
  assert.deepEqual(rosterSections(bots), [{ id: 'sec-r', name: 'Research team' }]);
});

test('every bot lands in exactly one block, in roster order, with Unassigned last', () => {
  const bots = [
    bot('loose-1'),
    bot('nanox', { sectionId: 'sec-r', sectionName: 'Research' }),
    bot('ghost', { sectionId: 'sec-gone', sectionName: 'Gone' }),
    bot('scout', { sectionId: 'sec-r', sectionName: 'Research' }),
  ];
  const blocks = groupBySection(bots, [{ id: 'sec-empty', name: 'Alpha' }, { id: 'sec-r', name: 'Research' }]);
  assert.deepEqual(
    blocks.map((block) => [block.id, block.bots.map((b) => b.name)]),
    [
      ['sec-r', ['nanox', 'scout']],
      [null, ['loose-1', 'ghost']],
    ],
  );
});
