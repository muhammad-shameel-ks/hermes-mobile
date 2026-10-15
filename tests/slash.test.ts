import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  argumentRows,
  ascendToken,
  catalogSkills,
  descendInsertText,
  detectTrigger,
  formatRefValue,
  gatewayArgumentRows,
  mentionInsertText,
  mentionRows,
  parseSlashLine,
  PHONE_COMMANDS,
  PHONE_DROPPED,
  replaceToken,
  resolveCommand,
  slashRows,
  triggerStaysOpen,
  uiSlash,
} from '../src/chat/slash.ts';
import { keyboardInset, keyboardOpen, KEYBOARD_INSET_MIN_PX } from '../src/chat/keyboard.ts';

const names = (rows: Array<{ text: string }>) => rows.map((row) => row.text);

test('the phone list keeps the four commands the old handler knew and adds /model', () => {
  for (const name of ['/new', '/reset', '/compact', '/compress', '/model']) assert.ok(resolveCommand(name), name);
  assert.equal(resolveCommand('/reset')?.name, '/new');
  assert.equal(resolveCommand('/COMPACT')?.name, '/compress');
  assert.equal(resolveCommand('/nope'), null);
});

test('no command is both carried and dropped, and names are unique', () => {
  const all = PHONE_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  assert.equal(new Set(all).size, all.length);
  for (const dropped of Object.keys(PHONE_DROPPED)) assert.equal(resolveCommand(dropped), null, dropped);
});

test('typed lines split into command and argument the backend\'s way', () => {
  assert.deepEqual(parseSlashLine('/compress focus on the API'), { command: resolveCommand('/compress'), name: 'compress', arg: 'focus on the API' });
  assert.equal(parseSlashLine('/work fix it').command, null);
  assert.equal(uiSlash('/model'), 'model');
  assert.equal(uiSlash('/resume foo'), 'sessions');
  assert.equal(uiSlash('/new'), null);
  assert.equal(uiSlash('/usr/local/bin'), null);
  assert.equal(uiSlash('model'), null);
});

test('a bare slash lists every command grouped, aliases hidden', () => {
  const rows = slashRows({ query: '' });
  assert.equal(rows.length, PHONE_COMMANDS.length);
  assert.ok(!names(rows).includes('/reset'));
  assert.equal(rows[0].group, 'Session');
  assert.equal(rows[0].text, '/new');
});

test('filtering ranks an exact name, then prefixes, then fuzzy hits', () => {
  assert.equal(slashRows({ query: 'mod' })[0].text, '/model');
  assert.equal(slashRows({ query: 'model' })[0].text, '/model');
  assert.deepEqual(names(slashRows({ query: 'comp' })).slice(0, 1), ['/compress']);
  assert.deepEqual(slashRows({ query: 'zzzz' }), []);
});

test('an alias surfaces only when typed exactly', () => {
  assert.ok(names(slashRows({ query: 'reset' })).includes('/new'));
  assert.ok(!names(slashRows({ query: 'rese' })).includes('/new'));
  assert.equal(slashRows({ query: 'reset' })[0].text, '/new');
});

const catalog = {
  pairs: [
    ['/new', 'Start a new session (fresh session ID + history)'],
    ['/compress', 'Compress conversation context (usage: /compress [focus])'],
    ['/diff', 'Show git changes'],
    ['/gif-search', 'Search for GIFs'],
    ['/old-skill', 'Bundled and never used'],
    ['/codex', 'Hands the task to Codex'],
    ['/standup', 'My quick command'],
  ],
  categories: [
    { name: 'Session', pairs: [['/new', 'x'], ['/compress', 'y']] },
    { name: 'Info', pairs: [['/diff', 'z']] },
    { name: 'User commands', pairs: [['/standup', 'My quick command']] },
  ],
  skills: {
    '/gif-search': { usage: 4, origin: 'hub' },
    '/old-skill': { usage: 0, origin: 'bundled' },
    '/codex': { usage: 9, origin: 'local' },
  },
};

test('skills are the catalog\'s uncategorized pairs, ranked by use with never-used bundled ones pruned while browsing', () => {
  assert.deepEqual(names(catalogSkills(catalog, { browsing: true })), ['/codex', '/gif-search']);
  assert.deepEqual(names(catalogSkills(catalog, { browsing: false })), ['/codex', '/gif-search', '/old-skill']);
  assert.deepEqual(catalogSkills(null, { browsing: true }), []);
});

test('rows merge commands, user commands and skills; mid-message only skills', () => {
  const rows = slashRows({ query: '', catalog });
  assert.ok(rows.some((row) => row.group === 'User commands' && row.text === '/standup'));
  assert.equal(rows.at(-1)?.group, 'Skills');
  assert.ok(!names(rows).includes('/diff'), 'a registry command the phone drops never reads as a skill');
  assert.deepEqual(names(slashRows({ query: '', inline: true, catalog })), ['/codex', '/gif-search']);
  assert.equal(slashRows({ query: 'new', catalog })[0].meta.startsWith('Start a new session'), true);
  assert.match(slashRows({ query: 'compress', catalog })[0].meta, /\(usage: \/compress \[focus\]\)$/);
});

test('a command the catalog marks unavailable is hidden unless the phone narrows it to subcommands', () => {
  const hiding = { commands: { '/usage': { desktop: 'terminal' }, '/skills': { desktop: 'advanced' } } };
  assert.ok(!names(slashRows({ query: 'usage', catalog: hiding })).includes('/usage'));
  assert.ok(names(slashRows({ query: 'skills', catalog: hiding })).includes('/skills'));
});

test('argument rows come from the command\'s own options', () => {
  assert.deepEqual(names(argumentRows('reasoning h')), ['/reasoning high']);
  assert.ok(names(argumentRows('reasoning ')).includes('/reasoning none'));
  assert.deepEqual(argumentRows('compress x'), []);
  assert.deepEqual(names(argumentRows('skills ap')), ['/skills approve', '/skills approval']);
});

test('gateway argument items become full tokens and respect a subcommand allowlist', () => {
  const rows = gatewayArgumentRows('/personality alic', [{ text: 'alice', meta: 'Helpful' }], 13);
  assert.deepEqual(names(rows), ['/personality alice']);
  assert.equal(rows[0].group, 'Options');
  assert.deepEqual(names(gatewayArgumentRows('/skills ', [{ text: 'install' }, { text: 'pending' }], 8)), ['/skills pending']);
});

test('triggers: a leading slash is a command, a mid-message slash a skill reference', () => {
  assert.deepEqual(detectTrigger('/'), { kind: '/', query: '', tokenLength: 1, value: '' });
  assert.deepEqual(detectTrigger('/mod'), { kind: '/', query: 'mod', tokenLength: 4, value: 'mod' });
  assert.deepEqual(detectTrigger('please /cle'), { inline: true, kind: '/', query: 'cle', tokenLength: 4, value: 'cle' });
  assert.equal(detectTrigger('src/foo'), null);
  assert.equal(detectTrigger('/usr/local'), null);
  assert.equal(detectTrigger('plain text'), null);
  assert.equal(detectTrigger('1/2'), null);
});

test('triggers: @ tokens stop at whitespace and carry their scope', () => {
  assert.deepEqual(detectTrigger('look at @'), { kind: '@', query: '', tokenLength: 1, value: '' });
  assert.deepEqual(detectTrigger('@file:src/ma'), { kind: '@', query: 'file:src/ma', scope: 'file', tokenLength: 12, value: 'src/ma' });
  assert.deepEqual(detectTrigger('a @./src/'), { kind: '@', query: './src/', tokenLength: 7, value: './src/' });
  assert.equal(detectTrigger('me@example.com'), null);
  assert.equal(detectTrigger('@diff done'), null);
});

test('the sheet stays open past a command name only for options and mixed arguments', () => {
  const open = (text: string) => {
    const trigger = detectTrigger(text);
    return trigger !== null && triggerStaysOpen(trigger);
  };
  assert.equal(open('/comp'), true);
  assert.equal(open('/reasoning h'), true);
  assert.equal(open('/goal pa'), true);
  assert.equal(open('/compress focus on tests'), false);
  assert.equal(open('/new '), false);
  assert.equal(open('/work x'), false);
});

test('picking replaces the token before the caret and spaces only when needed', () => {
  assert.deepEqual(replaceToken('/mod', 4, 4, '/model '), { text: '/model ', caret: 7 });
  assert.deepEqual(replaceToken('look at @sr', 11, 3, '@file:src/main.ts '), { text: 'look at @file:src/main.ts ', caret: 26 });
  assert.deepEqual(replaceToken('see @sr now', 7, 3, '@file:a.ts '), { text: 'see @file:a.ts now', caret: 14 });
  assert.deepEqual(replaceToken('@', 1, 1, ''), { text: '', caret: 0 });
});

test('@ rows classify the gateway\'s text the way the desktop does', () => {
  const rows = mentionRows(
    [
      { text: '@file:src/main.tsx', meta: 'file' },
      { text: '@folder:apps/desktop/' },
      { text: '@diff', display: '@diff', meta: 'Working tree' },
      { text: '@scout' },
      { text: '@scout' },
      { text: '@file:', meta: 'Attach a file reference' },
    ],
    '',
  );
  assert.equal(rows.length, 5, 'a handle offered twice lists once');
  assert.deepEqual([rows[0].kind, rows[0].display, rows[0].starter, rows[0].folder], ['file', 'main.tsx', false, false]);
  assert.deepEqual([rows[1].kind, rows[1].display, rows[1].folder], ['folder', 'desktop', true]);
  assert.equal(rows[2].kind, 'diff');
  assert.equal(rows[3].kind, 'simple');
  assert.equal(rows[4].starter, true);
});

test('an empty gateway answer falls back to the @kind: starters', () => {
  assert.equal(mentionRows([], '').length, 6);
  assert.deepEqual(mentionRows([], 'fo').map((row) => row.raw), ['@folder:']);
  assert.deepEqual(mentionRows([], 'zz'), []);
});

test('picked references serialize as @kind:value, quoting awkward values', () => {
  const [file, folder, diff, scout] = mentionRows([{ text: '@file:src/a b.ts' }, { text: '@folder:apps/x/' }, { text: '@diff' }, { text: '@scout' }], '');
  assert.equal(mentionInsertText(file), '@file:`src/a b.ts`');
  assert.equal(mentionInsertText(folder), '@folder:apps/x/');
  assert.equal(mentionInsertText(diff), '@diff');
  assert.equal(mentionInsertText(scout), '@scout');
  assert.equal(formatRefValue('plain/path.ts'), 'plain/path.ts');
  assert.equal(formatRefValue('has`tick and space'), '"has`tick and space"');
});

test('walking into a folder carries the scope, and the breadcrumb climbs one segment at a time', () => {
  const [folder] = mentionRows([{ text: '@folder:apps/desktop' }], '');
  assert.equal(descendInsertText(folder, undefined), '@apps/desktop/');
  assert.equal(descendInsertText(folder, 'folder'), '@folder:apps/desktop/');
  assert.equal(ascendToken(detectTrigger('@folder:apps/desktop/')!), '@folder:apps/');
  assert.equal(ascendToken(detectTrigger('@folder:apps/')!), '@folder:');
  assert.equal(ascendToken(detectTrigger('@folder:')!), '@');
  assert.equal(ascendToken(detectTrigger('@apps/desktop/')!), '@apps/');
});

test('insets under 80 px are no keyboard', () => {
  assert.equal(KEYBOARD_INSET_MIN_PX, 80);
  assert.equal(keyboardInset(79), 0);
  assert.equal(keyboardInset(80), 80);
  assert.equal(keyboardInset(312.4), 312);
  assert.equal(keyboardInset(Number.NaN), 0);
  assert.equal(keyboardInset(undefined), 0);
  assert.equal(keyboardOpen(48), false);
  assert.equal(keyboardOpen(291), true);
});
