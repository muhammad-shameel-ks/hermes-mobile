/**
 * The tool-result helpers around the diff parser in src/review/diff.ts: the
 * diff a file-edit tool carried in its result (the desktop's fallback-model
 * `inlineDiffFromResult`), with the display chrome stripped. Pure.
 */

import { stripAnsi } from '../../vendor/hermes-shared/src/ansi.ts';
import { parseObject } from './json.ts';

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

/** the diff a file-edit tool carried in its result (`inline_diff`, else `diff`) */
export function inlineDiffFromResult(result: unknown): string {
  const record = parseObject(result);
  for (const key of ['inline_diff', 'diff']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripInlineDiffChrome(value);
  }
  return '';
}
