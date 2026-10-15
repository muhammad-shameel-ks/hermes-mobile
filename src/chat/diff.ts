/**
 * Unified-diff parsing for the transcript's read-only diffs: a port of the
 * desktop's components/chat/diff-lines (header stripping, hunk walking, line
 * numbers from the `@@` headers) and the tool-result helpers around it
 * (fallback-model `inlineDiffFromResult`, `countDiffLineStats`). Pure, so it is
 * tested directly. The Review surface keeps its own parser in src/review.
 */

import { stripAnsi } from '../../vendor/hermes-shared/src/ansi.ts';

export type DiffKind = 'add' | 'context' | 'remove';

export type DiffLine = {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the new file; absent on a removal and on hunk separators */
  newNo?: number;
  /** 1-based line number in the old file; absent on an addition and on hunk separators */
  oldNo?: number;
};

export type DiffStats = { added: number; removed: number };

type Hunk = { oldStart: number; newStart: number; lines: { kind: DiffKind; text: string }[] };

function diffKind(line: string): DiffKind {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove';
  return 'context';
}

/** drop the leading +/-/space gutter so changes read by colour, keeping the rest of the indentation */
function stripMarker(line: string): string {
  if (diffKind(line) !== 'context' || line.startsWith(' ')) return line.slice(1);
  return line;
}

// The git preamble repeats the path the tool row already shows (and reads badly
// for absolute paths: `a//Users/…`), so everything before the first hunk goes.
const HEADER_PREFIXES = ['diff --git', 'index ', '--- ', '+++ ', 'similarity ', 'rename ', 'new file', 'deleted file'];

function isArrowHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('→') && /^\S.*→\s*\S+$/.test(trimmed) && !/^[+\-@]/.test(trimmed);
}

export function stripDiffFileHeaders(diff: string): string {
  const lines = diff.split('\n');
  let start = 0;
  for (; start < lines.length; start += 1) {
    const line = lines[start];
    if (line.startsWith('@@')) break;
    if (line.trim() === '' || isArrowHeader(line) || HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
    break;
  }
  return lines.slice(start).join('\n');
}

function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let active: Hunk | null = null;
  for (const line of stripDiffFileHeaders(diff).split('\n')) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) {
        active = null;
        continue;
      }
      active = { oldStart: Number(match[1]), newStart: Number(match[2]), lines: [] };
      hunks.push(active);
      continue;
    }
    if (!active || line.startsWith('\\')) continue;
    active.lines.push({ kind: diffKind(line), text: stripMarker(line) });
  }
  return hunks;
}

/**
 * Renderable lines: file headers and `@@` rows dropped, a blank context row kept
 * between hunks, markers stripped. Old and new numbers follow each hunk header.
 */
export function parseDiff(diff: string): DiffLine[] {
  const hunks = parseHunks(diff);
  if (hunks.length === 0) {
    return stripDiffFileHeaders(diff)
      .split('\n')
      .map((line) => ({ kind: diffKind(line), text: stripMarker(line) }));
  }

  const out: DiffLine[] = [];
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    if (out.length > 0) out.push({ kind: 'context', text: '' });
    for (const line of hunk.lines) {
      const entry: DiffLine = { kind: line.kind, text: line.text };
      if (line.kind === 'add') {
        entry.newNo = newNo++;
      } else if (line.kind === 'remove') {
        entry.oldNo = oldNo++;
      } else {
        entry.oldNo = oldNo++;
        entry.newNo = newNo++;
      }
      out.push(entry);
    }
  }
  return out;
}

export function countDiffLineStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

export function stripInlineDiffChrome(value: string): string {
  return value
    ? stripAnsi(value)
        .replace(/^\s*┊\s*review diff\s*\n/i, '')
        .trim()
    : '';
}

/** the `.html` file a diff names in its preamble, for an edit whose args and result carry no path */
export function htmlPathFromInlineDiff(value: string): string {
  const cleaned = stripInlineDiffChrome(value);
  for (const match of cleaned.matchAll(/(?:^|\s)(?:[ab]\/)?([^\s]+\.html?)(?=\s|$)/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) return candidate;
  }
  return '';
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** the diff a file-edit tool carried in its result (`inline_diff`, else `diff`) */
export function inlineDiffFromResult(result: unknown): string {
  const record = recordOf(result);
  for (const key of ['inline_diff', 'diff']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripInlineDiffChrome(value);
  }
  return '';
}
