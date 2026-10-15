/**
 * The "N files changed" card's data: a turn's file-edit tool calls folded into
 * one row per file. Port of the desktop's thread/changed-files.ts. Pure.
 */

import { htmlPathFromInlineDiff } from './inlineDiff.ts';
import { isFileEditTool, toolDiff, toolResultRecord } from './toolView.ts';
import type { Part, ToolPart } from './transcript.ts';

export type ChangedFile = {
  added: number;
  removed: number;
  /** basename, for the row label */
  name: string;
  /** the path as the tool reported it */
  path: string;
};

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function fileEditPath(args: Record<string, unknown>, result: Record<string, unknown>): string {
  return (
    firstString(args, ['path', 'file', 'filepath']) ||
    firstString(result, ['path', 'file', 'filepath', 'resolved_path']) ||
    htmlPathFromInlineDiff(firstString(result, ['inline_diff', 'diff']))
  );
}

export function fileEditBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

/** one row per file in first-touched order, +/- summed across edits; only landed edits with a diff count */
export function deriveChangedFiles(parts: readonly Part[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const part of parts) {
    if (part.kind !== 'tool' || !isFileEditTool(part.name)) continue;
    const tool: ToolPart = part;
    const { diff, stats } = toolDiff(tool);
    if (!diff || !stats) continue;
    const path = fileEditPath(tool.args, toolResultRecord(tool));
    if (!path) continue;
    const existing = byPath.get(path);
    if (existing) {
      existing.added += stats.added;
      existing.removed += stats.removed;
    } else {
      byPath.set(path, { added: stats.added, name: fileEditBasename(path), path, removed: stats.removed });
    }
  }
  return [...byPath.values()];
}

/** how the card heads itself ("1 file changed", "3 files changed") */
export const filesChangedLabel = (count: number) => (count === 1 ? '1 file changed' : `${count} files changed`);
