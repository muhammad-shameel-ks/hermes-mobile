/**
 * When a fenced block is substantial enough to read as an artifact card instead
 * of an inline code block. Port of the desktop's lib/artifact-detect and the
 * fence heuristics it leans on in lib/markdown-code. Runs per streaming delta on
 * the growing fence, so everything is a bounded scan. Pure.
 */

export type ArtifactKind = 'code' | 'html' | 'svg';

export type ArtifactDetection = {
  kind: ArtifactKind;
  /** the sanitized fence language; empty is possible for html or svg detected by shape */
  language: string;
  /** a human title taken from the content, else a kind or language label */
  title: string;
};

const VALID_LANGUAGE_RE = /^[a-z0-9][a-z0-9+#-]*$/i;
const NON_CODE_FENCE_LANGUAGES = new Set(['', 'text', 'plain', 'plaintext', 'md', 'markdown']);

const COMMON_CODE_LANGUAGES = new Set([
  'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'java', 'javascript', 'js', 'json', 'jsx', 'markdown', 'md', 'php',
  'python', 'py', 'ruby', 'rust', 'rs', 'sh', 'sql', 'swift', 'tsx', 'ts', 'typescript', 'xml', 'yaml', 'yml',
]);

export function sanitizeLanguageTag(tag: string): string {
  const first = tag.trim().split(/\s/, 1)[0] || '';
  return VALID_LANGUAGE_RE.test(first) && first.length <= 16 ? first.toLowerCase() : '';
}

// ─── prose heuristics ────────────────────────────────────────────────────────

const CODE_SIGNAL_RE = [
  /(^|\s)(const|let|var|function|class|import|export|return|if|for|while|switch)\b/gim,
  /=>|==|===|!=|!==|\{|\}|;|<\/?[a-z][^>]*>/gi,
  /^\s*(#include|SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/gim,
];

function codeSignals(body: string) {
  const trimmed = body.trim();
  const markdown = (trimmed.match(/\*\*[^*]+\*\*/g) || []).length + (trimmed.match(/`[^`\n]+`/g) || []).length;
  return {
    bulletLines: (trimmed.match(/^\s*[-*]\s+\S+/gm) || []).length,
    codeSignals: CODE_SIGNAL_RE.reduce((total, pattern) => total + (trimmed.match(pattern)?.length ?? 0), 0),
    hasMarkdown: markdown > 0,
    proseLines: trimmed.split('\n').filter((line) => {
      const text = line.trim();
      return Boolean(text) && /^[A-Za-z0-9"'`*-]/.test(text);
    }).length,
    trimmed,
  };
}

const SENTENCE_PUNCTUATION_RE = /[.!?](?:\s|$)/;
const CONFIG_SEPARATOR_LINE_RE = /^[A-Za-z0-9_][\w.-]*\s*[:=]\s*\S/;
const CONFIG_KEY_RE = /^[A-Za-z0-9_][\w.-]*$/;

function isConfigDirectiveLine(line: string): boolean {
  const trimmed = line.trim();
  if (CONFIG_SEPARATOR_LINE_RE.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  return tokens.length >= 2 && tokens.length <= 3 && CONFIG_KEY_RE.test(tokens[0]);
}

/** structured, config or tabular text rather than wrapped prose: an indented continuation, or mostly `Key value` lines */
export function isLikelyStructuredText(body: string): boolean {
  const lines = body.split('\n').filter((line) => line.trim());
  if (lines.length < 2) return false;
  if (lines.some((line) => /^\s+\S/.test(line))) return true;
  if (lines.some((line) => SENTENCE_PUNCTUATION_RE.test(line.trim()))) return false;
  const configLines = lines.filter(isConfigDirectiveLine).length;
  return configLines >= Math.max(2, Math.ceil(lines.length * 0.6));
}

export function isLikelyProseCodeBlock(language: string | undefined, code: string | undefined): boolean {
  const clean = sanitizeLanguageTag(language || '');
  const signals = codeSignals(code || '');
  if (!signals.trimmed || signals.codeSignals >= 3) return false;
  if (signals.bulletLines >= 1 && (signals.hasMarkdown || signals.proseLines >= 2)) return true;
  if (isLikelyStructuredText(code || '')) return false;
  if (NON_CODE_FENCE_LANGUAGES.has(clean)) return signals.proseLines >= 3 && signals.codeSignals === 0;
  return !COMMON_CODE_LANGUAGES.has(clean) && signals.proseLines >= 2 && signals.codeSignals <= 1;
}

// ─── detection ───────────────────────────────────────────────────────────────

const HTML_DOC_RE = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;
const HTML_TAG_RE = /<[a-z][a-z0-9-]*(\s[^>]*)?>/i;
const HTML_DOC_MIN_CHARS = 160;
const HTML_FRAGMENT_MIN_CHARS = 1200;
const SVG_MIN_CHARS = 2000;
const CODE_MIN_LINES = 48;
const CODE_MIN_CHARS = 3000;

const HTML_LANGUAGES = new Set(['html', 'htm', 'xhtml']);

// fences already owned by a richer renderer, or prose-ish ones, are never artifacts
const NON_ARTIFACT_LANGUAGES = new Set([
  '', 'console', 'diff', 'listing', 'log', 'logs', 'markdown', 'md', 'mermaid', 'output', 'patch', 'plain', 'plaintext',
  'shell-session', 'stdout', 'text', 'txt',
]);

const countLines = (text: string) => {
  let lines = 1;
  let index = text.indexOf('\n');
  while (index !== -1) {
    lines += 1;
    index = text.indexOf('\n', index + 1);
  }
  return lines;
};

const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function titleFromTag(content: string, tag: 'h1' | 'title'): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(content);
  return match ? stripTags(match[1] || '').slice(0, 80) : '';
}

const CODE_DECLARATION_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|struct|interface|enum|trait|impl|def|fn)\s+([A-Za-z_$][\w$]*)/;

// `// app.py`, `# server.ts`, `<!-- index.html -->` on the first line: the habit models have for naming a file
const FILENAME_COMMENT_RE = /^\s*(?:\/\/|#|--|<!--|\/\*)\s*([\w./-]+\.[a-z0-9]{1,8})\b/i;

function codeTitle(language: string, content: string): string {
  const head = content.slice(0, 2000);
  return FILENAME_COMMENT_RE.exec(head)?.[1] || CODE_DECLARATION_RE.exec(head)?.[1] || language;
}

export function detectArtifact(language: string | undefined, code: string | undefined): ArtifactDetection | null {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return null;
  const clean = sanitizeLanguageTag(language || '');

  if (HTML_LANGUAGES.has(clean)) {
    const isDocument = HTML_DOC_RE.test(trimmed);
    if ((isDocument && trimmed.length >= HTML_DOC_MIN_CHARS) || (!isDocument && trimmed.length >= HTML_FRAGMENT_MIN_CHARS && HTML_TAG_RE.test(trimmed))) {
      return { kind: 'html', language: clean, title: titleFromTag(trimmed, 'title') || titleFromTag(trimmed, 'h1') || 'HTML' };
    }
    return null;
  }

  if (clean === 'svg') {
    // a small svg fence keeps its inline render; only a large standalone graphic becomes a card
    if (trimmed.length >= SVG_MIN_CHARS && /<svg[\s>]/i.test(trimmed)) {
      return { kind: 'svg', language: clean, title: titleFromTag(trimmed, 'title') || 'SVG' };
    }
    return null;
  }

  if (NON_ARTIFACT_LANGUAGES.has(clean)) return null;
  if (trimmed.length < CODE_MIN_CHARS && countLines(trimmed) < CODE_MIN_LINES) return null;
  if (isLikelyProseCodeBlock(clean, trimmed)) return null;
  return { kind: 'code', language: clean, title: codeTitle(clean, trimmed) };
}

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = { code: 'Code', html: 'Interactive page', svg: 'Graphic' };

export const artifactGeneratingLabel = (lines: number) => `Generating… ${lines} lines`;

export const artifactLineCount = (code: string) => countLines(code.trim());

// ─── glyph and file name ─────────────────────────────────────────────────────

export type ArtifactGlyph =
  | 'browser' | 'code' | 'database' | 'diff' | 'globe' | 'graph' | 'json' | 'markdown' | 'package' | 'regex' | 'settings-gear' | 'symbol-color' | 'terminal';

const GLYPH_BY_LANGUAGE: Record<string, ArtifactGlyph> = {
  bash: 'terminal', cmd: 'terminal', console: 'terminal', fish: 'terminal', powershell: 'terminal', ps1: 'terminal', sh: 'terminal', shell: 'terminal', zsh: 'terminal',
  md: 'markdown', markdown: 'markdown',
  json: 'json', json5: 'json',
  ini: 'settings-gear', toml: 'settings-gear', yaml: 'settings-gear', yml: 'settings-gear', dotenv: 'settings-gear', env: 'settings-gear',
  graphql: 'database', gql: 'database', mysql: 'database', postgres: 'database', postgresql: 'database', sql: 'database', sqlite: 'database',
  diff: 'diff', patch: 'diff',
  css: 'symbol-color', less: 'symbol-color', sass: 'symbol-color', scss: 'symbol-color', svg: 'symbol-color',
  regex: 'regex', regexp: 'regex',
  curl: 'globe', http: 'globe',
  docker: 'package', dockerfile: 'package',
  mermaid: 'graph',
};

export function artifactGlyph(detection: ArtifactDetection): ArtifactGlyph {
  if (detection.kind === 'html') return 'browser';
  if (detection.kind === 'svg') return 'symbol-color';
  return GLYPH_BY_LANGUAGE[detection.language] ?? 'code';
}
