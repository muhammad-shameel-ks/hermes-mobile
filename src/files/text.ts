/**
 * Fixed-row text layout shared by the source and diff views. Rows are a known
 * height and no line wraps (the views scroll sideways), so a list can window them
 * with `getItemLayout`; the desktop windows the same way, in 200-line chunks.
 */

/** A row wider than this is cut: one minified line would otherwise make a view wider than the GPU draws. */
export const MAX_COLUMNS = 1200;

const TAB = '    ';

/** One line as drawn: tabs expanded, a stray CR dropped, an overlong line clipped with an ellipsis. */
export function displayLine(text: string): string {
  const flat = text.replace(/\r$/, '').replace(/\t/g, TAB);
  return flat.length > MAX_COLUMNS ? `${flat.slice(0, MAX_COLUMNS)}…` : flat;
}

export type TextChunk = { start: number; lines: string[] };

/** Lines grouped `size` at a time; `start` is the zero-based index of the first. */
export function chunkLines<T>(lines: readonly T[], size: number): Array<{ start: number; lines: T[] }> {
  const chunks: Array<{ start: number; lines: T[] }> = [];
  for (let start = 0; start < lines.length; start += size) chunks.push({ start, lines: lines.slice(start, start + size) });
  return chunks;
}

export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(displayLine);
}

export function maxColumns(lines: readonly string[]): number {
  let max = 0;
  for (const line of lines) if (line.length > max) max = line.length;
  return max;
}
