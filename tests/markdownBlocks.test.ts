import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lexer } from 'marked';

import { splitMarkdownBlocks, type BlockState, type Lex } from '../src/chat/markdownBlocks.ts';

const lex: Lex = (src) => lexer(src, { gfm: true }) as ReturnType<Lex>;

const tokensOf = (text: string) => JSON.stringify(lex(text.replace(/\r\n|\r/g, '\n')));
const joined = (state: BlockState) => state.blocks.map((block) => block.text).join('');

/** the block-by-block lex of a state: what the renderer's blocks see, concatenated */
const blockTokens = (state: BlockState) => JSON.stringify(state.blocks.flatMap((block) => lex(block.text)));

function check(text: string, state: BlockState, label: string) {
  const normalised = text.replace(/\r\n|\r/g, '\n');
  assert.equal(joined(state), normalised, `${label}: blocks cover the text exactly`);
  if (state.whole) {
    assert.ok(state.blocks.length <= 1, `${label}: whole mode is one block`);
    return;
  }
  assert.equal(blockTokens(state), tokensOf(text), `${label}: independently lexed blocks equal the whole lex`);
}

/** feed `text` the way a stream does, in chunks, checking every intermediate state against a fresh split */
function stream(text: string, chunk: (position: number) => number, label: string) {
  let state: BlockState | null = null;
  for (let end = 0; end < text.length; ) {
    end = Math.min(text.length, end + Math.max(1, chunk(end)));
    const prefix = text.slice(0, end);
    state = splitMarkdownBlocks(prefix, lex, state);
    check(prefix, state, `${label} @${end}`);
    const fresh = splitMarkdownBlocks(prefix, lex);
    assert.deepEqual(
      state.blocks,
      fresh.blocks,
      `${label} @${end}: incremental and from-scratch splits agree\n${JSON.stringify(prefix)}`,
    );
  }
  return state;
}

const CORPUS = [
  '# Title\n\nA paragraph with **bold**, *italic* and `code`.\n\nSecond paragraph\nwraps over two lines.\n\n## Sub\n\ntext',
  '- one\n- two\n- three\n\nAfter the list.\n\n1. first\n2. second\n\n   continued in item\n3. third',
  '- tight\n- list\n\n- now loose\n- again\n\nparagraph',
  '* a\n  * nested a\n    * deeper\n  * nested b\n* b\n\n> quote\n> continues\n\nlazy\n\n> [!NOTE]\n> callout body',
  '```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nbetween\n\n~~~\ntilde\n~~~\n\n````md\n```\ninner\n```\n````\n\nend',
  '```python\nprint("unclosed fence at the end")\n\nstill code',
  '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |\n\nafter table\n\nx | y\n--|--\n5 | 6',
  'Setext heading\n===\n\nAnother\n---\n\n---\n\n***\n\ntext\n- list interrupts',
  '<div>\nraw html\n</div>\n\nparagraph\n\n<details>\n<summary>more</summary>\n\ninside\n\n</details>\n\ntail',
  '    indented code\n\n    still code\n\nparagraph\n\n\ttab code\n\nend',
  'Line one  \nline two with hard break\\\nand backslash break &amp; entity \\* escaped ~~del~~ ![img](a.png) [link](http://u) <http://auto.link>',
  'A <a href="x">link left open\n\nhttp://after.example.com bare\n\n</a> closed\n\nhttp://later.example.com',
  'Use <code>raw code\n\n**bold?** in a raw block\n\n</code> done\n\n**bold** again',
  '<pre>\nkept\n</pre>\n\nafter pre\n\n<kbd>K</kbd> and <script>x</script> end',
  'See [the ref][r] and [r].\n\nMiddle paragraph\n\n[r]: http://example.com "Title"\n\nTail',
  '[r]: http://example.com\n\nLead definition then [r] use\n\nmore',
  'Footnote-ish [^1] text\n\n[^1]: note body',
  'Mixed\r\nline\r\nendings\r\n\r\n- a\r\n- b\r\n\r\n```\r\ncode\r\n```\r\n',
  'MEDIA:/tmp/a.png\n\ntext after\n\n```\nMEDIA:/tmp/in-fence.png\n```',
  '\n\n\nleading blank lines\n\n\n\nmany blank lines\n\n   \n\ntrailing   ',
  '1. one\n1. one again\n10. ten\n\ntext\n\n3. starts at three\n4. four',
  '- [ ] todo\n- [x] done\n\n- a\n\n  para\n\n  ```js\n  in item\n  ```\n- b',
  '> quote\n\n> second quote\n\n> - list in quote\n> - more\n\ntext',
  '[![alt](img.png)](http://link.example.com)\n\n![solo](x.png "title")\n\ntext ![inline](y.png) more',
  '*unclosed emphasis\n\n**unclosed strong\n\n_under_ snake_case_word _x',
  'Line with trailing spaces   \n  \nnext\n\n\\\n\n&nbsp;\n\n# \n\n#hashtag\n\n####### seven',
];

test('every prefix of the corpus splits into blocks that lex exactly like the whole text', () => {
  for (const [index, doc] of CORPUS.entries()) {
    stream(doc, () => 1, `corpus ${index} by char`);
    stream(doc, (position) => 3 + (position % 7), `corpus ${index} by chunk`);
  }
});

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const FRAGMENTS = [
  'Hello world with **bold** and `code` and a [link](http://u).',
  'wrapped paragraph\nsecond line',
  '# Heading',
  '## Heading two ##',
  'Setext\n===',
  'Setext two\n---',
  '- a\n- b',
  '- a\n\n- b',
  '1. one\n2. two',
  '* x\n  * nested\n  * nested2\n* y',
  '- [ ] todo\n- [x] done',
  '1. a\n\n   para in item\n2. b',
  '- item\n\n      code in item',
  '```ts\ncode\n```',
  '```\nunclosed',
  '~~~\nx\n~~~',
  '````md\n```\ninner\n```\n````',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  'a | b\n--|--\n1 | 2',
  '> quote\n> more',
  '> [!NOTE]\n> hi',
  '> a\nlazy',
  '<div>\nhtml\n</div>',
  '<details>\n<summary>x</summary>\n\ninner\n\n</details>',
  '---',
  '***',
  '    indented code',
  '\ttab code',
  'text <a href="x">open link',
  'close </a> text',
  '<code>unclosed',
  '</code>',
  '<kbd>K</kbd>',
  '<pre>raw',
  '</pre>',
  'http://example.com bare url',
  '<http://auto.link>',
  '[ref]: http://x.com',
  'see [ref]',
  '[a][b]',
  'MEDIA:/tmp/a.png',
  'line one  \nline two',
  '&amp; entity \\* escaped',
  '~~del~~ and ~single~',
  '![img](a.png)',
  '[![i](a.png)](http://u)',
  '*a',
  '**b',
  '_c_ snake_case_word',
  '[link with <b>html</b>](http://u)',
  '<!-- comment -->',
  '<span>inline</span> html',
];
const SEPARATORS = ['\n', '\n\n', '\n\n', '\n\n\n', ' \n', '\n  ', '\n\n    '];

test('randomised markdown streams split consistently at every step', () => {
  const next = rng(0x5eed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  for (let doc = 0; doc < 120; doc++) {
    const parts = 3 + Math.floor(next() * 7);
    let text = '';
    for (let index = 0; index < parts; index++) text += pick(FRAGMENTS) + pick(SEPARATORS);
    if (next() < 0.5) text = text.trimEnd();
    stream(text, () => 1 + Math.floor(next() * 12), `fuzz ${doc}`);
  }
});

test('a boundary is only trusted after a blank line and once the next block has a finished line', () => {
  // each of these prefixes lexes into two tokens, and a later character merges them back into one
  for (const [text, grown] of [
    ['>b\n-', '>b\n--'],
    ['m\n2. \n-', 'm\n2. \n-a'],
    ['l\n<div\n', 'l\n<div\n-'],
    ['1. x\n\n2', '1. x\n\n2.'],
  ]) {
    const early = splitMarkdownBlocks(text, lex);
    assert.equal(early.blocks.length, 1, JSON.stringify(text));
    check(grown, splitMarkdownBlocks(grown, lex, early), JSON.stringify(grown));
  }
  assert.equal(splitMarkdownBlocks('one\ntwo\n- three\n', lex).blocks.length, 1);
});

const ALPHABET = [
  '\n', '\n', '\n\n', '\n\n', ' ', '  ', '   ', '    ', '\t', '-', '- ', '* ', '+ ', '1.', '1. ', '2) ', '>', '> ', '#', '## ', '`',
  '```', '```js\n', '~~~', '|', ' | ', '---', '--|--', '===', 'a', 'b c', 'word', '<div>', '</div>', '<a href=x>', '</a>', '<code>',
  '</code>', '<pre>', '</pre>', '[x]', '[x]:', '(u)', '[l](u)', '**', '*', '_', '~~', '<!--', '-->', '![i](a)', 'http://u.co', '\\',
  '&amp;', '[ ] ', '[x] ',
];

test('random streams of markdown punctuation split consistently at every step', () => {
  const next = rng(0xc0ffee);
  for (let doc = 0; doc < 1000; doc++) {
    let text = '';
    for (let index = 10 + Math.floor(next() * 50); index > 0; index--) text += ALPHABET[Math.floor(next() * ALPHABET.length)];
    stream(text, () => 1 + Math.floor(next() * 6), `alphabet ${doc}`);
  }
});

test('definitions anywhere in the text fall back to one block so earlier links resolve', () => {
  const text = 'See [x] here.\n\nMiddle\n\n[x]: http://example.com\n';
  const state = splitMarkdownBlocks(text, lex);
  assert.equal(state.whole, true);
  assert.deepEqual(state.blocks, [{ text, fenced: false }]);
  const before = splitMarkdownBlocks('See [x] here.\n\nMiddle\n\n', lex);
  assert.equal(before.whole, false);
  assert.equal(before.blocks.length, 2);
});

test('an unclosed inline tag keeps the blocks after it in one lexing context', () => {
  const state = splitMarkdownBlocks('first\n\n<a href="x">open\n\nsecond\n\nthird', lex);
  assert.deepEqual(
    state.blocks.map((block) => block.text),
    ['first\n\n', '<a href="x">open\n\nsecond\n\nthird'],
  );
});

test('a sealed block keeps its identity while later blocks stream in', () => {
  let state = splitMarkdownBlocks('para one\n\npara tw', lex);
  assert.equal(state.blocks.length, 1, 'a block that starts on the unfinished line seals nothing before it');
  state = splitMarkdownBlocks('para one\n\npara two\n', lex, state);
  const sealed = state.blocks[0];
  assert.deepEqual(sealed, { text: 'para one\n\n', fenced: false });
  assert.equal(state.blocks.length, 2);
  for (const text of ['para one\n\npara two\n\nthree', 'para one\n\npara two\n\nthree and more\n', 'para one\n\npara two\n\nthree and more\n\nfour\n']) {
    state = splitMarkdownBlocks(text, lex, state);
    assert.equal(state.blocks[0], sealed);
  }
  assert.equal(state.blocks.length, 4);
});

test('only the open block is lexed per delta, so the work does not grow with the reply', () => {
  let longest = 0;
  const counting: Lex = (src) => {
    longest = Math.max(longest, src.length);
    return lex(src);
  };
  const paragraph = 'A paragraph of some length with **bold** and `code` in it, enough to matter.\n\n';
  let text = '';
  let state: BlockState | null = null;
  for (let index = 0; index < 400; index++) {
    for (const word of ['alpha ', 'beta ', 'gamma']) {
      text += word;
      state = splitMarkdownBlocks(text, counting, state);
    }
    text += '\n\n';
    state = splitMarkdownBlocks(text, counting, state);
    text += paragraph;
    state = splitMarkdownBlocks(text, counting, state);
  }
  assert.ok(text.length > 30_000);
  assert.ok(longest < 400, `the lexer only ever saw the open block, saw ${longest} chars`);
  assert.equal(state?.blocks.length, 800);
});

test('an unchanged or shrunk text is handled without stale state', () => {
  const a = splitMarkdownBlocks('one\n\ntwo\n\nthree', lex);
  assert.equal(splitMarkdownBlocks('one\n\ntwo\n\nthree', lex, a), a);
  const edited = splitMarkdownBlocks('one\n\nTWO\n\nthree', lex, a);
  assert.deepEqual(edited.blocks, splitMarkdownBlocks('one\n\nTWO\n\nthree', lex).blocks);
  const shrunk = splitMarkdownBlocks('one', lex, a);
  assert.deepEqual(shrunk.blocks, [{ text: 'one', fenced: false, tokens: [...lex('one')] }]);
});

test('the open block carries its own lex, so the renderer never lexes it again', () => {
  for (const [n, text] of CORPUS.entries()) {
    let state: BlockState | null = null;
    for (let end = 1; end <= text.length; end += 3) {
      state = splitMarkdownBlocks(text.slice(0, end), lex, state);
      const open = state.blocks[state.blocks.length - 1];
      if (state.whole) {
        assert.equal(open?.tokens, undefined, `corpus ${n} @${end}: the whole-text fallback lexes itself`);
        continue;
      }
      assert.deepEqual(open.tokens, [...lex(open.text)], `corpus ${n} @${end}: the carried tokens are the open block's own lex`);
      // only the open block carries tokens: sealed blocks keep nothing alive
      assert.ok(state.blocks.slice(0, -1).every((block) => block.tokens === undefined));
    }
  }
});

test('fenced is true only for blocks that can reach the streaming-sensitive code path', () => {
  const state = splitMarkdownBlocks('plain\n\n```listing\n[]\n```\n\n~~~\nx\n~~~\n\nend\n', lex);
  assert.deepEqual(
    state.blocks.map((block) => block.fenced),
    [false, true, true, false],
  );
});
