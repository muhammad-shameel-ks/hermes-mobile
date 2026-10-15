/**
 * Splits a growing reply's markdown into top-level blocks so a streaming delta
 * re-lexes and re-renders only the open block at the tail instead of the whole
 * reply. A block is sealed once a later block follows it; the sealed blocks are
 * lexed independently and must produce exactly the tokens the whole text would
 * (tests/markdownBlocks.test.ts pins that, prefix by prefix, against marked).
 *
 * Two kinds of lexer state reach across blocks, and both fall back safely:
 * - reference definitions (`[x]: url`) resolve links in every block, before and
 *   after them, so the reply renders as one block while any exist;
 * - an unclosed inline `<a>`, `<code>`, `<pre>`, `<kbd>` or `<script>` tag
 *   changes how the following blocks lex, so a block is never sealed while one
 *   is open.
 * Pure: the lexer is injected, so nothing here imports React Native.
 */

export type MarkdownBlock = { text: string; fenced: boolean };

/** `committed` and `prefix` are the memo; the rest is derived from the text alone */
export type BlockState = {
  src: string;
  prefix: string;
  committed: readonly MarkdownBlock[];
  blocks: readonly MarkdownBlock[];
  whole: boolean;
};

type LexToken = {
  type: string;
  raw: string;
  tokens?: LexToken[];
  items?: LexToken[];
  /** a table's header cells; a cell's own `header` is a boolean */
  header?: LexToken[] | boolean;
  rows?: LexToken[][];
  inLink?: boolean;
  inRawBlock?: boolean;
};
type LexResult = LexToken[] & { links?: Record<string, unknown> };
export type Lex = (src: string) => LexResult;

const FENCE_HINT = /```|~~~/;
const LINE_ENDINGS = /\r\n|\r/g;

type InlineState = { inLink: boolean; inRawBlock: boolean };

/** follows the lexer's inline `<a>`/`<code>` state through a token's subtree in document order */
function scanInlineState(tokens: readonly LexToken[], state: InlineState): void {
  for (const token of tokens) {
    if (token.type === 'html' && token.inLink !== undefined) {
      state.inLink = token.inLink;
      state.inRawBlock = token.inRawBlock === true;
    }
    if (token.tokens) scanInlineState(token.tokens, state);
    if (token.items) scanInlineState(token.items, state);
    if (Array.isArray(token.header)) scanInlineState(token.header, state);
    if (token.rows) for (const row of token.rows) scanInlineState(row, state);
  }
}

function hasReferenceDefinitions(tokens: LexResult): boolean {
  if (!tokens.links) return false;
  for (const _ in tokens.links) return true;
  return false;
}

/** whether the line ending just before `offset` is blank */
function followsBlankLine(text: string, offset: number): boolean {
  if (text.charCodeAt(offset - 1) !== 10) return false;
  for (let index = offset - 2; index >= 0; index--) {
    const code = text.charCodeAt(index);
    if (code === 10) return true;
    if (code !== 32 && code !== 9) return false;
  }
  return false;
}

function wholeText(src: string, prefix: string, committed: readonly MarkdownBlock[]): BlockState {
  const blocks = src ? [{ text: src, fenced: FENCE_HINT.test(src) }] : [];
  return { src, prefix, committed, blocks, whole: true };
}

/**
 * The blocks of `text`, reusing `prev` when `text` only grew past it. The result
 * depends on `text` alone; `prev` only saves work.
 */
export function splitMarkdownBlocks(text: string, lex: Lex, prev?: BlockState | null): BlockState {
  const src = text.includes('\r') ? text.replace(LINE_ENDINGS, '\n') : text;
  if (prev && prev.src === src) return prev;

  let prefix = '';
  let committed: readonly MarkdownBlock[] = [];
  if (prev && prev.prefix.length <= src.length && src.startsWith(prev.prefix)) {
    prefix = prev.prefix;
    committed = prev.committed;
  }

  const tail = src.slice(prefix.length);
  const tokens = lex(tail);
  if (hasReferenceDefinitions(tokens)) return wholeText(src, prefix, committed);

  let lastContent = -1;
  for (let index = tokens.length - 1; index >= 0; index--) {
    if (tokens[index].type !== 'space') {
      lastContent = index;
      break;
    }
  }

  // A cut sits before a content token, after a blank line, with no inline tag left open. The blank line matters:
  // marked decides where a paragraph ends by looking ahead (a table delimiter row or a setext underline further on
  // can swallow the lines before it), and nothing looks ahead across a blank line. The token must also start on a
  // finished line: on the last, unfinished one it can still change what it is (`2` then `2.`) and pull the block
  // before it along. Blank lines stay with the block before the cut.
  const unfinishedLine = tail.lastIndexOf('\n') + 1;
  const cuts: number[] = [];
  const state: InlineState = { inLink: false, inRawBlock: false };
  let offset = 0;
  for (let index = 0; index < lastContent; index++) {
    const raw = tokens[index].raw;
    if (!tail.startsWith(raw, offset)) return wholeText(src, prefix, committed);
    offset += raw.length;
    scanInlineState([tokens[index]], state);
    if (
      !state.inLink &&
      !state.inRawBlock &&
      tokens[index + 1].type !== 'space' &&
      offset < unfinishedLine &&
      followsBlankLine(tail, offset)
    ) {
      cuts.push(offset);
    }
  }

  if (cuts.length > 0) {
    const sealed: MarkdownBlock[] = [];
    let from = 0;
    for (const cut of cuts) {
      const blockText = tail.slice(from, cut);
      sealed.push({ text: blockText, fenced: FENCE_HINT.test(blockText) });
      from = cut;
    }
    committed = committed.concat(sealed);
    prefix += tail.slice(0, from);
  }

  const open = src.slice(prefix.length);
  const blocks = open ? committed.concat({ text: open, fenced: FENCE_HINT.test(open) }) : committed;
  return { src, prefix, committed, blocks, whole: false };
}
