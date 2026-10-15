import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitizeTextForSpeech, splitForSpeech } from '../src/chat/speechText.ts';

test('code fences are silence and the colon that led into one closes', () => {
  assert.equal(sanitizeTextForSpeech('Here is code:\n```ts\nconst x = 1\n```\nDone.'), 'Here is code. Done.');
  assert.equal(sanitizeTextForSpeech('One line added to the regex list:\n```ts\nconst x = 1\n```\nBye.'), 'One line added to the regex list. Bye.');
  assert.equal(sanitizeTextForSpeech('The regex list:'), 'The regex list.');
});

test('inline code, links, strike and emphasis read as their words', () => {
  assert.equal(sanitizeTextForSpeech('Use `git status` after the change.'), 'Use git status after the change.');
  assert.equal(sanitizeTextForSpeech('This ~~is~~ old.'), 'This is old.');
  assert.equal(sanitizeTextForSpeech('Read [the docs](https://example.com/docs) first.'), 'Read the docs first.');
  assert.equal(sanitizeTextForSpeech('## Heading\n\nBody text.'), 'Heading. Body text.');
});

test('URLs and MEDIA tokens are silence, not placeholder words', () => {
  assert.equal(sanitizeTextForSpeech('See https://example.com/a-huge-page for details'), 'See for details');
  assert.equal(sanitizeTextForSpeech('The files are below.\nMEDIA:/Users/ricardo/Documents/inference-server-shopping-list.xlsx\nBye.'), 'The files are below. Bye.');
  assert.equal(sanitizeTextForSpeech('See MEDIA:/tmp/report-2026-q3.xlsx. Then reply.'), 'See. Then reply.');
  assert.equal(sanitizeTextForSpeech('The file is below: MEDIA:/tmp/x.py'), 'The file is below.');
});

test('a table reads its header and none of its rows', () => {
  const table = `Here is the quick takeaway: the totals remain unchanged.

| Item | Value | Notes |
| --- | ---: | --- |
| Example A | 10 | first row |
| Example B | 20 | second row |

Full detail stays visible on screen.`;
  assert.equal(
    sanitizeTextForSpeech(table),
    'Here is the quick takeaway: the totals remain unchanged. Item, Value, Notes. Full detail stays visible on screen.',
  );
  assert.equal(sanitizeTextForSpeech('Before.\n\n|   |   |\n| --- | --- |\n| a | b |\n\nAfter.'), 'Before. After.');
  assert.equal(sanitizeTextForSpeech('Before the table.\n\n> | Item | Value |\n> | --- | ---: |\n> | Example A | 10 |\n\nAfter the table.'), 'Before the table. Item, Value. After the table.');
  assert.equal(sanitizeTextForSpeech('Use the summary first | keep the table on screen when it matters.'), 'Use the summary first | keep the table on screen when it matters.');
});

test('a non-English reply gets no English words injected', () => {
  const spoken = sanitizeTextForSpeech('对比如下：\n\n| 模型 | 价格 |\n| --- | ---: |\n| 甲 | 10 |\n\n代码：\n```py\nprint(1)\n```\n详情见 https://example.com/docs');
  assert.ok(spoken.includes('模型, 价格'));
  assert.doesNotMatch(spoken, /[A-Za-z]/);
});

test('paragraph breaks do not double the punctuation', () => {
  assert.equal(sanitizeTextForSpeech('First sentence.\n\nSecond sentence.'), 'First sentence. Second sentence.');
  assert.equal(sanitizeTextForSpeech('**First sentence.**\n\nSecond sentence.'), 'First sentence. Second sentence.');
  assert.equal(sanitizeTextForSpeech('(First sentence.)\n\nSecond sentence.'), '(First sentence.) Second sentence.');
});

// the shared corpus both desktop and gateway normalizers must agree on (tests/fixtures/identifier_speech_corpus.json)
const IDENTIFIER_TOKENS: Array<[string, string[], string[]]> = [
  ['Saved peyton-sample-20260922.wav and peyton-sample-20260922.ogg.', ['peyton', '20260922', '.wav', '.ogg'], ['Saved', 'and']],
  ['The digest is sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 for the file.', ['e3b0c442', '7852b855', 'sha256:'], ['The digest is', 'for the file']],
  ['Commit 73688014f78 landed.', ['73688014f78'], ['Commit', 'landed']],
  ['Trace id 550e8400-e29b-41d4-a716-446655440000 appears once.', ['550e8400', '446655440000'], ['Trace id', 'appears once']],
  ['Model meta-llama/Llama-3.3-70B-Instruct is large.', ['meta-llama/Llama-3.3-70B-Instruct', '70B'], ['Model', 'is large']],
  ['Config at ~/.config/hermes/config.yaml was read.', ['config.yaml', '~/.config'], ['Config at', 'was read']],
  ['Version v2.1.0-beta.3 shipped.', ['v2.1.0-beta.3'], ['Version', 'shipped']],
];
const PASS_THROUGH_TOKENS: Array<[string, string[]]> = [
  ['The samples played cleanly, so listen again.', ['The samples played cleanly, so listen again']],
  ['Use git status after the change.', ['Use git status after the change']],
  ['Email me at user@example.com.', ['user@example.com']],
  ['COVID-19 and well-known facts stay.', ['COVID-19', 'well-known']],
  ['Due 2026/06/02 and status N/A here.', ['2026/06/02', 'N/A']],
  ['The final score was 3:2.', ['3:2']],
];

test('identifier-dense tokens are silence while the prose around them survives', () => {
  for (const [text, mustNotContain, mustContain] of IDENTIFIER_TOKENS) {
    const spoken = sanitizeTextForSpeech(text);
    for (const needle of mustNotContain) assert.ok(!spoken.includes(needle), `${needle} leaked from ${text}`);
    for (const needle of mustContain) assert.ok(spoken.includes(needle), `${needle} lost from ${text}`);
  }
});

test('ordinary speech passes through the identifier pass untouched', () => {
  for (const [text, mustContain] of PASS_THROUGH_TOKENS) {
    const spoken = sanitizeTextForSpeech(text);
    for (const needle of mustContain) assert.ok(spoken.includes(needle), `${needle} lost from ${text}`);
  }
});

test('splitForSpeech keeps a short text whole and cuts a long one at sentence ends', () => {
  assert.deepEqual(splitForSpeech('  Short reply.  ', 100), ['Short reply.']);
  assert.deepEqual(splitForSpeech('', 100), []);
  assert.deepEqual(splitForSpeech('One two three. Four five six. Seven eight nine.', 20), ['One two three.', 'Four five six.', 'Seven eight nine.']);
});

test('splitForSpeech falls back to a space, then a hard cut, and never exceeds the cap', () => {
  assert.deepEqual(splitForSpeech('alpha beta gamma delta', 11), ['alpha beta', 'gamma delta']);
  assert.deepEqual(splitForSpeech('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} ends here.`).join(' ');
  for (const piece of splitForSpeech(long, 120)) assert.ok(piece.length <= 120);
  assert.equal(splitForSpeech(long, 120).join(' '), long);
});
