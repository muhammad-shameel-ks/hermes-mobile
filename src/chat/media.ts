/**
 * Media paths and `MEDIA:` delivery tags: a port of the desktop's lib/media and
 * the `renderMediaTags` half of lib/chat-messages/parts. A tag names a file the
 * gateway holds; here it splits the reply's markdown into text and media
 * segments instead of becoming a `#media:` link, because a player or image is a
 * block, not inline text. Pure, so it is tested directly.
 */

export type MediaKind = 'audio' | 'image' | 'video' | 'file';

const MEDIA_BY_EXT: Record<string, { kind: MediaKind; mime: string }> = {
  avi: { kind: 'video', mime: 'video/x-msvideo' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  flac: { kind: 'audio', mime: 'audio/flac' },
  gif: { kind: 'image', mime: 'image/gif' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  opus: { kind: 'audio', mime: 'audio/ogg; codecs=opus' },
  png: { kind: 'image', mime: 'image/png' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  webm: { kind: 'video', mime: 'video/webm' },
  webp: { kind: 'image', mime: 'image/webp' },
};

function extensionOf(path: string): string | undefined {
  return path.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
}

export function mediaKind(path: string): MediaKind {
  const ext = extensionOf(path);
  return (ext && MEDIA_BY_EXT[ext]?.kind) || 'file';
}

export function mediaMime(path: string): string {
  const ext = extensionOf(path);
  return (ext && MEDIA_BY_EXT[ext]?.mime) || 'application/octet-stream';
}

export function mediaName(path: string): string {
  // `C:\Users\…` parses as a URL with scheme `c:`; a drive letter is a path, not a scheme
  if (!/^[A-Za-z]:[\\/]/.test(path) && /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    const withoutQuery = path.split(/[?#]/, 1)[0] ?? path;
    const last = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/*[^/]*/i, '').split('/').filter(Boolean).pop();
    if (last) return last;
  }
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/** `0:07`, `12:30`: the audio panel's elapsed and total, the dictation bar's recording time */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function mediaDisplayLabel(path: string): string {
  const kind = mediaKind(path);
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${mediaName(path)}`;
}

/** an http(s) or data URL the device can load itself */
export function isInlineMediaSrc(path: string): boolean {
  return /^(?:https?|data):/i.test(path);
}

/** a path on the gateway's disk: `file:`, absolute, `~/` or a drive letter */
export function isFileMediaPath(path: string): boolean {
  return /^(?:file:|\/|~\/|[a-z]:[\\/]|\\\\)/i.test(path);
}

export function filePathFromMediaPath(path: string): string {
  if (!path.startsWith('file:')) return path;
  try {
    return decodeURIComponent(path.replace(/^file:\/\//, '').split(/[?#]/, 1)[0] ?? '');
  } catch {
    return path.replace(/^file:\/\//, '');
  }
}

export function mediaPathFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#media:')) return null;
  try {
    return decodeURIComponent(href.slice('#media:'.length));
  } catch {
    return null;
  }
}

/** the image a tool row shows in its body: a data URL, a remote image URL or a gateway image path */
export function toolImageUrl(args: Record<string, unknown>, result: Record<string, unknown>): string {
  const first = (record: Record<string, unknown>, keys: readonly string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const candidate = first(result, ['image_url', 'url', 'path', 'image_path']) || first(args, ['image_url', 'url', 'path']);
  if (!candidate) return '';
  const dataImage = candidate.toLowerCase().startsWith('data:image/');
  const remoteImage = /^https?:\/\//i.test(candidate) && /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(candidate);
  const localImage = isFileMediaPath(candidate) && mediaKind(candidate) === 'image';
  return dataImage || remoteImage || localImage ? candidate : '';
}

// ─── MEDIA: tags ─────────────────────────────────────────────────────────────

/** mirrors the gateway's MEDIA_DELIVERY_EXTS so both sides agree on which paths are deliverables */
const MEDIA_DELIVERY_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp',
  'mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac',
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'epub',
  'xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'kmz', 'kml', 'geojson', 'gpx', 'pptx', 'ppt', 'odp', 'key',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa', 'html', 'htm',
];

const EXT_ALTERNATION = [...MEDIA_DELIVERY_EXTS].sort((a, b) => b.length - a.length).join('|');

// an anchored path may hold interior spaces; its end is pinned to a known deliverable extension
const PATH_ANCHORED = `(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${EXT_ALTERNATION})(?=[\\s\`"'*_,;:)\\]}]|MEDIA:|$)`;

// bare-word fallback for relative paths and unknown extensions
const PATH_BARE = '[^\\s`"]+';
const TRAILING_PUNCTUATION = '.,;:!?';

const TAG_PATTERN = `[\`"']?MEDIA:\\s*(\`[^\`\\n]+\`|"[^"\\n]+"|'[^'\\n]+'|${PATH_ANCHORED}|${PATH_BARE})[\`"']?`;

/** a path separator, or a dot with content after it; anything else is prose, not a deliverable */
function isPlausiblePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || /\.[^.]/.test(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote && quote === trimmed.at(-1) && ['"', "'", '`'].includes(quote)) return trimmed.slice(1, -1);
  const last = trimmed.at(-1);
  return last === '`' || last === '"' ? trimmed.slice(0, -1) : trimmed;
}

/** `open MEDIA:/tmp/a.pdf.` captures `/tmp/a.pdf.`; the period belongs to the sentence */
function splitTrailingPunctuation(value: string): { path: string; punctuation: string } {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(value[end - 1] ?? '')) {
    if (!isPlausiblePath(value.slice(0, end - 1))) break;
    end -= 1;
  }
  return { path: value.slice(0, end), punctuation: value.slice(end) };
}

export type MediaSegment = { kind: 'text'; text: string } | { kind: 'media'; path: string };

const FENCE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)/g;

function splitTags(text: string): MediaSegment[] {
  const out: MediaSegment[] = [];
  const tag = new RegExp(TAG_PATTERN, 'g');
  let cursor = 0;
  let pending = '';
  for (const match of text.matchAll(tag)) {
    const raw = (match[1] ?? '').trim();
    const quote = raw[0];
    const quoted = Boolean(quote) && quote === raw.at(-1) && ['"', "'", '`'].includes(quote);
    const { path, punctuation } = quoted ? { path: unquote(raw), punctuation: '' } : splitTrailingPunctuation(unquote(raw));
    if (!isPlausiblePath(path)) continue;
    const start = match.index ?? 0;
    pending += text.slice(cursor, start);
    if (pending) out.push({ kind: 'text', text: pending });
    out.push({ kind: 'media', path });
    pending = punctuation;
    cursor = start + match[0].length;
  }
  pending += text.slice(cursor);
  if (pending) out.push({ kind: 'text', text: pending });
  return out;
}

/** the reply's text and the files its `MEDIA:` tags deliver, in order; fenced code is left alone */
export function splitMediaTags(text: string): MediaSegment[] {
  if (!text.includes('MEDIA:')) return [{ kind: 'text', text }];
  const out: MediaSegment[] = [];
  let cursor = 0;
  const push = (segments: MediaSegment[]) => {
    for (const segment of segments) {
      const last = out[out.length - 1];
      if (segment.kind === 'text' && last?.kind === 'text') last.text += segment.text;
      else out.push(segment);
    }
  };
  for (const fence of text.matchAll(FENCE_RE)) {
    const start = fence.index ?? 0;
    push(splitTags(text.slice(cursor, start)));
    push([{ kind: 'text', text: fence[0] }]);
    cursor = start + fence[0].length;
  }
  push(splitTags(text.slice(cursor)));
  return out;
}
