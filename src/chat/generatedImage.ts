/**
 * What an `image_generate` result says about its image: which path to show, how
 * big it decoded, and which echoes of it the reply's prose must drop so the
 * image shows once, in the tool slot. Port of the desktop's
 * lib/generated-images. Pure.
 */

import type { Part } from './transcript.ts';

const DISPLAY_KEYS = ['host_image', 'image'] as const;
const ECHO_KEYS = ['host_image', 'image', 'agent_visible_image'] as const;

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringFields(record: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.map((key) => record[key]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

const HASH_MEDIA = /#media:/i;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the source to display for a completed result; the host path wins because the gateway can deliver it */
export function generatedImageFromResult(result: unknown): string | null {
  const record = recordOf(result);
  if (!record || record.success === false) return null;
  return stringFields(record, DISPLAY_KEYS)[0] ?? null;
}

/** decoded geometry (`pixel_size`); the requested size and the aspect ratio are never intrinsic metadata */
export function generatedImageDimensionsFromResult(result: unknown): { width: number; height: number } | undefined {
  const record = recordOf(result);
  const match = typeof record?.pixel_size === 'string' ? /^(\d+)x(\d+)$/.exec(record.pixel_size) : null;
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

/** every path or URL a generated image might appear as in prose */
export function generatedImageEchoSources(parts: readonly Part[]): string[] {
  const sources: string[] = [];
  for (const part of parts) {
    if (part.kind !== 'tool' || part.name !== 'image_generate') continue;
    const record = recordOf(part.result);
    if (record && record.success !== false) sources.push(...stringFields(record, ECHO_KEYS));
  }
  return unique(sources);
}

type EchoPatterns = { tag: RegExp; image: RegExp; link: RegExp; bare: RegExp };
const patternCache = new Map<string, EchoPatterns>();
const PATTERN_CACHE_SIZE = 64;

/** compiled once per source: the reply is stripped again on every streamed delta */
function echoPatterns(source: string): EchoPatterns {
  let patterns = patternCache.get(source);
  if (!patterns) {
    const escaped = regexEscape(source);
    patterns = {
      // the desktop strips the `#media:` link a tag was already rewritten to; here the tag itself is still in the text
      tag: new RegExp(String.raw`[\`"']?MEDIA:\s*[\`"']?${escaped}[\`"']?(?=$|[\s)\]}]|[.,!?](?:\s|$))`, 'g'),
      // the lookahead stops a prefix over-match: a link to `/tmp/a.png.bak` survives source `/tmp/a.png`
      image: new RegExp(String.raw`!\[[^\]\n]*\]\(\s*<?${escaped}>?(?=$|[\s)\\])[^)\n]*\)`, 'g'),
      link: new RegExp(String.raw`\[[^\]\n]*\]\(\s*#media:${regexEscape(encodeURIComponent(source))}\s*\)`, 'gi'),
      // `(` and `)` are excluded from the boundary classes so a link destination is not corrupted into `[label]()`
      bare: new RegExp(String.raw`(^|[\s[{])<?${escaped}>?(?=$|[\s\]}.,!?])`, 'g'),
    };
    if (patternCache.size >= PATTERN_CACHE_SIZE) patternCache.clear();
    patternCache.set(source, patterns);
  }
  return patterns;
}

/**
 * Strip a generated image out of prose: embedded images and media links whose
 * source matches, and bare occurrences of the path. Other files, such as a
 * separate `MEDIA:` delivery, are never touched.
 */
export function stripGeneratedImageEchoes(text: string, sources: readonly string[]): string {
  if (!text || sources.length === 0) return text;
  let next = text;
  for (const source of unique([...sources])) {
    const patterns = echoPatterns(source);
    // three of the four patterns hold the source verbatim and the fourth a `#media:` link, so most replies skip the scans
    if (next.includes(source)) {
      next = next.replace(patterns.tag, '');
      next = next.replace(patterns.image, '');
    }
    if (HASH_MEDIA.test(next)) next = next.replace(patterns.link, '');
    if (next.includes(source)) next = next.replace(patterns.bare, '$1');
  }
  return next;
}
