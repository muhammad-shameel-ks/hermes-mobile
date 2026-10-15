/**
 * What the preview viewer is asked to show, and how a file is classified. The
 * desktop's `PreviewTarget` kinds (artifact / file / url) and its previewKinds,
 * minus the ones that need a web view: a `url` hands off to the system browser,
 * HTML shows source, and there is no live page.
 */

import { baseName } from './path.ts';

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export type ArtifactKind = 'code' | 'html' | 'svg';

export type FileTarget = {
  kind: 'file';
  /** an absolute server path; a relative one is joined onto `cwd` */
  path: string;
  label?: string;
  /** `files` sits under the files root; `link` is a transcript link read singly through /api/fs */
  origin?: 'files' | 'link';
  cwd?: string;
  sessionId?: string;
  /** known size in bytes, when the caller has it */
  size?: number;
  mimeType?: string;
};

export type ArtifactTarget = {
  kind: 'artifact';
  label: string;
  content: string;
  artifactKind: ArtifactKind;
  language?: string;
};

export type UrlTarget = { kind: 'url'; url: string };

export type PreviewTarget = FileTarget | ArtifactTarget | UrlTarget;

export type FileClass = 'image' | 'svg' | 'markdown' | 'html' | 'pdf' | 'media' | 'binary' | 'text';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic']);
const MEDIA = new Set(['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'webm', 'mkv', 'avi']);
const BINARY = new Set([
  '7z', 'a', 'apk', 'bin', 'class', 'dll', 'dmg', 'doc', 'docx', 'dylib', 'exe', 'gz', 'iso', 'jar', 'o', 'odt', 'pptx', 'pyc',
  'so', 'sqlite', 'sqlite3', 'db', 'tar', 'tgz', 'woff', 'woff2', 'ttf', 'otf', 'xls', 'xlsx', 'xz', 'zip', 'bz2', 'rar',
]);

export function extension(name: string): string {
  const leaf = baseName(name);
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
}

export function classifyFile(name: string): FileClass {
  const ext = extension(name);
  if (IMAGE.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (MEDIA.has(ext)) return 'media';
  if (BINARY.has(ext)) return 'binary';
  return 'text';
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
};

export function mimeFor(name: string, fallback?: string | null): string {
  return MIME[extension(name)] ?? (fallback || 'application/octet-stream');
}

export const targetLabel = (target: FileTarget): string => target.label || baseName(target.path);

/** `http(s)` targets only: anything else is not a page the system browser can take. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** A fragment gets a document shell; a full document passes through (desktop `composeArtifactHtml`). */
export function composeArtifactHtml(content: string): string {
  if (/<html[\s>]|<!doctype\s+html/i.test(content)) return content;
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>',
    content,
    '</body></html>',
  ].join('\n');
}

const DOWNLOAD_EXTENSION_BY_LANGUAGE: Record<string, string> = {
  bash: '.sh', c: '.c', cpp: '.cpp', csharp: '.cs', css: '.css', go: '.go', htm: '.html', html: '.html', java: '.java',
  javascript: '.js', js: '.js', json: '.json', jsx: '.jsx', kotlin: '.kt', php: '.php', py: '.py', python: '.py', rb: '.rb',
  rs: '.rs', ruby: '.rb', rust: '.rs', sh: '.sh', sql: '.sql', svg: '.svg', swift: '.swift', toml: '.toml', ts: '.ts',
  tsx: '.tsx', typescript: '.ts', xhtml: '.html', xml: '.xml', yaml: '.yaml', yml: '.yaml',
};

/** desktop `artifactDownloadName`. */
export function artifactFileName(target: ArtifactTarget): string {
  const base =
    target.label
      .replace(/[^\p{L}\p{N}._ -]+/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'artifact';
  if (/\.[a-z0-9]{1,8}$/i.test(base)) return base;
  const ext = target.artifactKind === 'html' ? '.html' : target.artifactKind === 'svg' ? '.svg' : DOWNLOAD_EXTENSION_BY_LANGUAGE[target.language ?? ''] || '.txt';
  return `${base}${ext}`;
}
