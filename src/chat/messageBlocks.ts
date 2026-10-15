/**
 * How an assistant message's parts group into the blocks MessageView renders, and the equality
 * checks that let a block skip re-rendering when a stream delta touched a different one. Pure.
 *
 * Parts are reference-stable across deltas (a delta replaces only the part it extended), so a
 * block's props can be compared part by part instead of by value.
 */

import { generatedImageEchoSources } from './generatedImage.ts';
import type { Part, ToolPart } from './transcript.ts';

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; tools: ToolPart[] };

const NON_BLANK = /\S/;

/** consecutive tool parts become one block, so a run of calls reads as one row */
function buildBlocks(parts: readonly Part[]): Block[] {
  const out: Block[] = [];
  for (const part of parts) {
    if (part.kind === 'tool') {
      const last = out[out.length - 1];
      if (last?.kind === 'tools') last.tools.push(part);
      else out.push({ kind: 'tools', tools: [part] });
    } else if (NON_BLANK.test(part.text)) {
      out.push(part);
    }
  }
  return out;
}

const blockCache = new WeakMap<readonly Part[], Block[]>();

/** `buildBlocks`, once per parts array: a re-render that changed nothing about the parts reuses the blocks */
export function blocks(parts: readonly Part[]): Block[] {
  let hit = blockCache.get(parts);
  if (!hit) {
    hit = buildBlocks(parts);
    blockCache.set(parts, hit);
  }
  return hit;
}

const toolEchoes = new WeakMap<ToolPart, readonly string[]>();
const NO_ECHOES: readonly string[] = [];

/** `generatedImageEchoSources` without re-parsing every image result on every delta */
export function echoSources(parts: readonly Part[]): readonly string[] {
  let out: string[] | null = null;
  for (const part of parts) {
    if (part.kind !== 'tool' || part.name !== 'image_generate') continue;
    let sources = toolEchoes.get(part);
    if (!sources) {
      sources = generatedImageEchoSources([part]);
      toolEchoes.set(part, sources);
    }
    if (sources.length) out = out ? out.concat(sources) : [...sources];
  }
  return out ? [...new Set(out)] : NO_ECHOES;
}

export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
