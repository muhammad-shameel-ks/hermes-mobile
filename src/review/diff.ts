/**
 * The unified-diff parser the Review surface, the Files DIFF view and the
 * transcript's inline diffs share. The rows follow the desktop's
 * `components/chat/diff-lines.tsx`: git's file header is dropped, hunks are
 * separated by one blank row, the `+/-` gutter is stripped so a change reads by
 * its tint, and line numbers come from each `@@ -a,b +c,d @@` header. Pure, so
 * it is tested directly.
 */

export type DiffKind = 'add' | 'context' | 'remove';

export type DiffLine = {
  kind: DiffKind;
  text: string;
  /** 1-based line in the old / new file; absent on the other side of an add or remove, and on separators */
  oldNo?: number;
  newNo?: number;
};

export type DiffStats = { added: number; removed: number };

export type DiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: Array<{ kind: DiffKind; text: string }>;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseHunks(diff: string): DiffHunk[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();

  const hunks: DiffHunk[] = [];
  let active: DiffHunk | null = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      active = match ? { header: line, oldStart: Number(match[1]), newStart: Number(match[2]), lines: [] } : null;
      if (active) hunks.push(active);
      continue;
    }
    if (line.startsWith('diff --git ')) {
      active = null;
      continue;
    }
    if (!active || line.startsWith('\\')) continue;
    if (line.startsWith('+')) active.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) active.lines.push({ kind: 'remove', text: line.slice(1) });
    else active.lines.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return hunks;
}

/** git's answer for a file it will not diff as text. */
export function isBinaryDiff(diff: string): boolean {
  return /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff);
}

/** Renderable rows: every hunk's lines with numbers, a blank context row between hunks. */
export function diffRows(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const hunk of parseHunks(diff)) {
    if (out.length) out.push({ kind: 'context', text: '' });
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === 'add') out.push({ kind: 'add', text: line.text, newNo: newNo++ });
      else if (line.kind === 'remove') out.push({ kind: 'remove', text: line.text, oldNo: oldNo++ });
      else out.push({ kind: 'context', text: line.text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

// A tool's edit diff can come without hunk headers; each line then reads by its own
// marker. The git preamble repeats the path the tool row already shows (and reads
// badly for absolute paths: `a//Users/…`), so everything before the first hunk goes.
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

function looseKind(line: string): DiffKind {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove';
  return 'context';
}

/** `diffRows` for a payload that may carry no hunk headers: those fall back to colouring each line */
export function inlineDiffRows(diff: string): DiffLine[] {
  if (parseHunks(diff).length > 0) return diffRows(diff);
  return stripDiffFileHeaders(diff)
    .split('\n')
    .map((line) => {
      const kind = looseKind(line);
      return { kind, text: kind !== 'context' || line.startsWith(' ') ? line.slice(1) : line };
    });
}

/**
 * The preview's DIFF view: every line of the current file with its real number,
 * the hunks only marking rows as added and slotting the removed rows in between,
 * so SOURCE and DIFF share one line map even when git sends compact hunks.
 */
export function fullFileDiffRows(diff: string, fullText: string): DiffLine[] {
  const hunks = parseHunks(diff);
  const fullLines = fullText.split('\n');
  if (hunks.length === 0) return fullLines.map((text, index) => ({ kind: 'context', text, newNo: index + 1, oldNo: index + 1 }));

  const added = new Set<number>();
  const oldNoByNewNo = new Map<number, number>();
  const removalsByNewNo = new Map<number, DiffLine[]>();
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        added.add(newNo);
        newNo += 1;
      } else if (line.kind === 'remove') {
        const anchor = Math.max(1, Math.min(newNo, fullLines.length + 1));
        const bucket = removalsByNewNo.get(anchor) ?? [];
        bucket.push({ kind: 'remove', text: line.text, oldNo });
        removalsByNewNo.set(anchor, bucket);
        oldNo += 1;
      } else {
        oldNoByNewNo.set(newNo, oldNo);
        oldNo += 1;
        newNo += 1;
      }
    }
  }

  const out: DiffLine[] = [];
  for (let index = 0; index < fullLines.length; index += 1) {
    const newNo = index + 1;
    const removals = removalsByNewNo.get(newNo);
    if (removals) out.push(...removals);
    out.push({ kind: added.has(newNo) ? 'add' : 'context', text: fullLines[index] ?? '', newNo, oldNo: oldNoByNewNo.get(newNo) });
  }
  const trailing = removalsByNewNo.get(fullLines.length + 1);
  if (trailing) out.push(...trailing);
  return out;
}

export function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  const hunks = parseHunks(diff);
  if (hunks.length === 0) {
    for (const line of diff.split('\n')) {
      const kind = looseKind(line);
      if (kind === 'add') added += 1;
      else if (kind === 'remove') removed += 1;
    }
    return { added, removed };
  }
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') added += 1;
      else if (line.kind === 'remove') removed += 1;
    }
  }
  return { added, removed };
}

/** Digits the number gutter needs for the largest line number among `rows`. */
export function gutterDigits(rows: readonly DiffLine[]): number {
  let max = 0;
  for (const row of rows) max = Math.max(max, row.oldNo ?? 0, row.newNo ?? 0);
  return Math.max(2, String(max).length);
}

export type OverviewRun = { kind: 'add' | 'remove'; startPct: number; sizePct: number };

/** Consecutive same-kind changed rows as runs placed by line fraction: the ticks of the overview ruler. */
export function overviewRuns(rows: readonly DiffLine[]): OverviewRun[] {
  const total = rows.length || 1;
  const runs: OverviewRun[] = [];
  for (let i = 0; i < rows.length; ) {
    const kind = rows[i].kind;
    if (kind === 'context') {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && rows[j].kind === kind) j += 1;
    runs.push({ kind, startPct: (i / total) * 100, sizePct: ((j - i) / total) * 100 });
    i = j;
  }
  return runs;
}
