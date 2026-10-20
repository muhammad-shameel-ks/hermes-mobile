/**
 * What read-aloud speaks: a reply's markdown reduced to plain prose. A port of
 * the desktop's lib/speech-text.ts `sanitizeTextForSpeech`, which tracks the
 * gateway's tools/tts_text_normalize.py token for token - keep them in lockstep.
 * Anything unspeakable becomes silence, never a placeholder word, because the
 * reply may be in any language.
 */

const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|[\u{FE0F}\u{200D}]|[\u{E0020}-\u{E007F}])+/gu;

const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const PARAGRAPH_BREAK_RE = /[ \t]*\n{2,}[ \t]*/g;
const PUNCTUATED_PARAGRAPH_BREAK_RE = /([.!?])([*_~`>"'’”)}\]]*)[ \t]*\n{2,}[ \t]*/g;
const SOFT_BREAK_RE = /[ \t]*\n[ \t]*/g;

// A file-link token ("MEDIA:/path/to/report.xlsx") renders as a chip on screen;
// spoken, its hyphenated slug makes voices loop. It is silence, but a
// sentence-final period/comma after it is kept ("see MEDIA:/x.py. Then").
const MEDIA_PATH_RE = /[ \t]*MEDIA:\S+?(?=[.,;:!?)\]]*(?:\s|$))/g;
const LINE_FINAL_COLON_RE = /:\s*$/gm;

const THINKING_PREFIX_RE =
  /^\s*(?:\([^)\n]{1,48}\)\s*)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i;

const URL_RE = /\bhttps?:\/\/\S+/gi;

// Identifier-dense tokens (filenames, hashes, UUIDs, dense model/version ids and
// paths) are read character by character, which makes clean audio sound corrupt.
const FILENAME_EXT_RE =
  /[\w.-]{0,60}\.(?:wav|ogg|mp3|flac|m4a|aac|py|pyc|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|toml|md|mdx|txt|csv|xlsx|xls|pdf|png|jpg|jpeg|gif|webp|svg|log|sql|sh|bash|zsh|rs|go|java|rb|php|html|css|lock|tar|gz|zip|db|sqlite|sqlite3|onnx|pt|bin|env|ini|conf|cfg|xml)\b/i;

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const HASH_PREFIX_HEX_RE = /\b(?:sha(?:-?256|-?512|-?1|3)?|blake2[ab]?|md5|crc32?)[:\s]+[0-9a-fA-F]{7,64}/gi;
const HEX_RUN_RE = /[0-9a-fA-F]{7,64}/;
const IDENTIFIER_TOKEN_RE = /[A-Za-z0-9_./~@-]+/g;
const DATE_TOKEN_RE = /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/;

function isDenseIdentifier(token: string): boolean {
  // email addresses, dates ("2026-09-28", "2026/06/02")
  if (token.includes('@') || DATE_TOKEN_RE.test(token)) return false;
  // filesystem paths
  if (/^(?:~\/|\.\.?\/|\/)/.test(token)) return true;
  // paths and dense model ids ("meta-llama/Llama-3.3-70B-Instruct")
  if (token.includes('/') && (FILENAME_EXT_RE.test(token) || /\d/.test(token))) return true;
  if (FILENAME_EXT_RE.test(token) || UUID_RE.test(token)) return true;
  // hex-hash runs ("73688014f78"); digit-free runs ("defaced") are words and stay
  if (HEX_RUN_RE.test(token) && /\d/.test(token)) return true;
  if (!/\d/.test(token)) return false;
  const seps = ['_', '.', '/'].filter((char) => token.includes(char)).length;
  const hyphens = (token.match(/-/g) ?? []).length;
  // v2.1.0-beta.3, Llama-3.3-70B, dated filename slugs
  if (seps >= 2 || hyphens >= 2) return true;
  return token.includes('/') || (hyphens >= 1 && seps >= 1);
}

function pruneIdentifierTokens(text: string): string {
  return text.replace(HASH_PREFIX_HEX_RE, ' ').replace(IDENTIFIER_TOKEN_RE, (token) => (isDenseIdentifier(token) ? ' ' : token));
}

const MARKDOWN_TABLE_DELIMITER_CELL_RE = /^:?-{3,}:?$/;

type MarkdownTableRow = { blockquoteDepth: number; cells: string[] };

function isUnescapedPipe(row: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && row[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

function splitMarkdownTableCells(row: string): string[] {
  const cells: string[] = [];
  let cellStart = 0;
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '|' && isUnescapedPipe(row, index)) {
      cells.push(row.slice(cellStart, index).trim());
      cellStart = index + 1;
    }
  }
  cells.push(row.slice(cellStart).trim());
  return cells;
}

function parseMarkdownTableRow(line: string): MarkdownTableRow | null {
  let row = line;
  let blockquoteDepth = 0;
  for (;;) {
    const indentation = row.match(/^[ \t]*/)?.[0] ?? '';
    if (indentation.includes('\t') || indentation.length > 3) return null;
    row = row.slice(indentation.length);
    if (!row.startsWith('>')) break;
    blockquoteDepth += 1;
    row = row.slice(1);
    if (row.startsWith(' ')) row = row.slice(1);
  }
  row = row.trimEnd();
  const pipeIndexes = [...row.matchAll(/\|/g)].map((match) => match.index).filter((index) => isUnescapedPipe(row, index));
  if (pipeIndexes.length === 0) return null;
  const hasLeadingPipe = pipeIndexes[0] === 0;
  const hasTrailingPipe = pipeIndexes.at(-1) === row.length - 1;
  if (hasLeadingPipe) row = row.slice(1);
  if (hasTrailingPipe) row = row.slice(0, -1);
  const cells = splitMarkdownTableCells(row);
  if (cells.length < 2 && !(hasLeadingPipe && hasTrailingPipe && cells.length === 1)) return null;
  return { blockquoteDepth, cells };
}

// The header row is spoken in place of the table ("Model, Price, Context."): the
// listener learns a table is on screen and what it compares, in the reply's own
// language, without the body read cell by cell. An empty header stays silent.
function speakableTableHeader(cells: string[]): string {
  const header = cells
    .map((cell) => cell.replace(/\\\|/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
  return header && !/[.!?:]$/.test(header) ? `${header}.` : header;
}

function summarizeMarkdownTables(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tableLines = new Set<number>();
  const headers = new Map<number, string>();
  let index = 1;
  while (index < lines.length) {
    const delimiterRow = parseMarkdownTableRow(lines[index]);
    const headerRow = parseMarkdownTableRow(lines[index - 1]);
    if (
      !delimiterRow ||
      !headerRow ||
      !delimiterRow.cells.every((cell) => MARKDOWN_TABLE_DELIMITER_CELL_RE.test(cell)) ||
      headerRow.cells.length !== delimiterRow.cells.length ||
      headerRow.blockquoteDepth !== delimiterRow.blockquoteDepth
    ) {
      index += 1;
      continue;
    }
    tableLines.add(index - 1);
    tableLines.add(index);
    headers.set(index - 1, speakableTableHeader(headerRow.cells));
    let rowIndex = index + 1;
    for (; rowIndex < lines.length; rowIndex += 1) {
      const bodyRow = parseMarkdownTableRow(lines[rowIndex]);
      if (!bodyRow || bodyRow.blockquoteDepth !== delimiterRow.blockquoteDepth) break;
      tableLines.add(rowIndex);
    }
    index = rowIndex;
  }
  return lines
    .flatMap((line, at) => {
      if (!tableLines.has(at)) return [line];
      const header = headers.get(at);
      return header ? [header] : [];
    })
    .join('\n');
}

function normalizeLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(PUNCTUATED_PARAGRAPH_BREAK_RE, '$1$2 ')
    .replace(PARAGRAPH_BREAK_RE, '. ')
    .replace(SOFT_BREAK_RE, ' ');
}

export function sanitizeTextForSpeech(text: string): string {
  // Tables first: their right-align marker is a trailing colon (":-"), and
  // closing colons before the table detector runs would mangle it.
  const withoutTables = summarizeMarkdownTables(String(text));

  // Close line-final colons BEFORE newlines are flattened: "the regex list:"
  // followed by a code block would otherwise keep its colon and the voice hangs on it.
  const pre = withoutTables.replace(LINE_FINAL_COLON_RE, '.');

  // Identifier-dense tokens run after code fences, inline code and links are
  // consumed, and after URLs and MEDIA: tokens, which own themselves.
  const withoutIdentifiers = pruneIdentifierTokens(
    normalizeLineBreaks(pre)
      .replace(FENCED_CODE_RE, '')
      .replace(THINKING_PREFIX_RE, ' ')
      .replace(MARKDOWN_LINK_RE, '$1')
      .replace(INLINE_CODE_RE, '$1')
      .replace(URL_RE, '')
      .replace(MEDIA_PATH_RE, '')
      .replace(EMOJI_RE, ' '),
  );

  return withoutIdentifiers
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/:\s*$/, '.') // colon orphaned when its link/code was stripped
    .replace(/\s+/g, ' ')
    .trim();
}

const SENTENCE_END_RE = /[.!?…。！？]+["'”’)\]]*\s+/g;

/**
 * Pieces of at most `max` characters for an engine with an input cap
 * (`Speech.maxSpeechInputLength`): cut after sentence ends, falling back to the
 * last space and finally to a hard cut for a run with neither.
 */
export function splitForSpeech(text: string, max: number): string[] {
  const input = text.trim();
  if (input === '') return [];
  if (max <= 0 || input.length <= max) return [input];
  const pieces: string[] = [];
  let rest = input;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    SENTENCE_END_RE.lastIndex = 0;
    for (let match = SENTENCE_END_RE.exec(window); match; match = SENTENCE_END_RE.exec(window)) {
      const end = match.index + match[0].length;
      if (end <= max + 1) cut = end;
    }
    if (cut <= 0) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/**
 * desktop api/system.ts `audioSpeakRequestTimeoutMs`: synthesis blocks until the
 * provider answers (a local engine may load a model first), so the budget scales
 * at 35 ms a character from a 180 s floor to a 600 s cap.
 */
export function speakTimeoutMs(text: string): number {
  return Math.min(600_000, Math.max(180_000, Math.ceil(text.length * 35)));
}
