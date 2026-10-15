/**
 * How a tool call reads as one transcript line: its title, leading glyph,
 * status and trailing meta, plus the one-line summary a run of calls collapses
 * into. A trimmed port of the desktop's tool row model
 * (apps/desktop/src/components/assistant-ui/tool/fallback-model, run-summary.ts,
 * lib/summarize-command.ts and lib/tool-result-summary.ts) so both surfaces
 * describe the same call in the same words. Pure, so it is tested directly.
 */

import { diffStats, type DiffStats } from '../review/diff.ts';
import { inlineDiffFromResult } from './inlineDiff.ts';
import { isRecord, parseObject, type Json } from './json.ts';
import { toolImageUrl } from './media.ts';
import type { ToolPart } from './transcript.ts';

export type ToolStatus = 'running' | 'success' | 'error' | 'warning' | 'notice';

export type ToolIconName =
  | 'brain'
  | 'edit'
  | 'eye'
  | 'file'
  | 'file-media'
  | 'files'
  | 'globe'
  | 'question'
  | 'search'
  | 'terminal'
  | 'tools'
  | 'watch';

export type ToolView = {
  title: string;
  /** what an untitled tool's call touched (its context or query), shown quietly beside the title */
  subtitle?: string;
  icon?: ToolIconName;
  status: ToolStatus;
  /** e.g. "3 results", "1179 stdout_bytes" */
  countLabel?: string;
  durationLabel?: string;
  /** the error explanation, when the call failed */
  error: string;
  /** the shell command a terminal row ran */
  command?: string;
  /** the body an expanded row shows */
  detail: string;
  /** the unified diff the call's result carried; its row opens on it */
  inlineDiff?: string;
  diffStats?: DiffStats;
  /** an image the row's body shows (a screenshot, an analysed picture) */
  imageUrl?: string;
};

function firstStringField(record: Json, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function compactPreview(value: string, max = 72): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ─── titles ──────────────────────────────────────────────────────────────────

type Meta = { done: string; pending: string; icon?: ToolIconName };

const TOOL_META: Record<string, Meta> = {
  browser_click: { done: 'Clicked page element', pending: 'Clicking page element', icon: 'globe' },
  browser_fill: { done: 'Filled form field', pending: 'Filling form field', icon: 'globe' },
  browser_navigate: { done: 'Opened page', pending: 'Opening page', icon: 'globe' },
  browser_snapshot: { done: 'Captured page snapshot', pending: 'Capturing page snapshot', icon: 'globe' },
  browser_take_screenshot: { done: 'Captured screenshot', pending: 'Capturing screenshot', icon: 'file-media' },
  browser_type: { done: 'Typed on page', pending: 'Typing on page', icon: 'globe' },
  clarify: { done: 'Asked a question', pending: 'Asking a question', icon: 'question' },
  cronjob: { done: 'Cron job', pending: 'Scheduling cron job', icon: 'watch' },
  edit_file: { done: 'Edited file', pending: 'Editing file', icon: 'edit' },
  execute_code: { done: 'Ran code', pending: 'Scripting', icon: 'terminal' },
  image_generate: { done: 'Generated image', pending: 'Generating image', icon: 'file-media' },
  list_files: { done: 'Listed files', pending: 'Listing files', icon: 'files' },
  memory: { done: 'Saved to memory', pending: 'Saving to memory', icon: 'brain' },
  patch: { done: 'Patched file', pending: 'Patching file', icon: 'edit' },
  read_file: { done: 'Read file', pending: 'Reading file', icon: 'file' },
  search_files: { done: 'Searched files', pending: 'Searching files', icon: 'search' },
  session_search: { done: 'Searched past sessions', pending: 'Searching past sessions', icon: 'search' },
  session_search_recall: { done: 'Searched session history', pending: 'Searching session history', icon: 'search' },
  terminal: { done: 'Ran command', pending: 'Running command', icon: 'terminal' },
  todo: { done: 'Updated todos', pending: 'Updating todos', icon: 'tools' },
  vision_analyze: { done: 'Analyzed image', pending: 'Analyzing image', icon: 'eye' },
  web_extract: { done: 'Read webpage', pending: 'Reading webpage', icon: 'globe' },
  web_search: { done: 'Searched web', pending: 'Searching web', icon: 'search' },
  write_file: { done: 'Edited file', pending: 'Editing file', icon: 'edit' },
};

const PREFIXES: { prefix: string; label: string }[] = [
  { prefix: 'browser_', label: 'Browser' },
  { prefix: 'web_', label: 'Web' },
];

function toolMeta(name: string): Meta {
  const known = TOOL_META[name];
  if (known) return known;
  const action = name.replace(/^browser_/, '').replace(/^web_/, '').split('_').filter(Boolean).map(capitalize).join(' ') || name;
  const prefix = PREFIXES.find((p) => name.startsWith(p.prefix));
  if (prefix) {
    return { done: `${prefix.label} ${action}`, pending: `Running ${prefix.label.toLowerCase()} ${action.toLowerCase()}`, icon: 'globe' };
  }
  return { done: action, pending: `Running ${action.toLowerCase()}` };
}

const FILE_EDIT_TOOLS = new Set(['edit_file', 'patch', 'write_file']);
export const isFileEditTool = (name: string) => FILE_EDIT_TOOLS.has(name);

/** tools that are the point of the turn and never fold into a run's summary */
const CARD_TOOLS = new Set(['clarify', 'delegate_task', 'image_generate', 'manage_catalog', 'manage_connections', 'set_theme', 'setup_beat']);
export const isCardTool = (name: string) => CARD_TOOLS.has(name) || isFileEditTool(name);

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

const URL_PATTERN = /https?:\/\/[^\s'"<>)\]]+/i;

function findFirstUrl(...sources: unknown[]): string {
  for (const source of sources) {
    if (typeof source === 'string') {
      const match = source.match(URL_PATTERN);
      if (match) return match[0];
    } else if (source && typeof source === 'object') {
      for (const value of Object.values(source as Json)) {
        const found = findFirstUrl(value);
        if (found) return found;
      }
    }
  }
  return '';
}

function hostnameOf(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname && url.pathname !== '/' ? url.pathname : ''}`;
  } catch {
    return value;
  }
}

/** the real command, preferring the argument over the gateway's summarized preview */
function shellCommand(args: Json): string {
  return firstStringField(args, ['command', 'code']) || firstStringField(args, ['context', 'preview']);
}

/** drop a leading word that repeats the verb about to be prefixed ("Running Running grep") */
function withoutLeadingAction(value: string, action: string): string {
  const text = value.trimStart();
  const boundary = text.search(/\s/);
  if (boundary < 0) return value;
  return text.slice(0, boundary).toLowerCase() === action.toLowerCase() ? text.slice(boundary + 1).trimStart() : value;
}

function browserExecStepLabel(code: string, maxChars = 80): string {
  const first = code.trim().split('\n', 1)[0]?.trim() ?? '';
  if (!first.startsWith('#')) return '';
  const label = first.replace(/^#+/, '').trim();
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
}

function readFileTarget(args: Json): string {
  const inherited = firstStringField(args, ['context', 'preview']);
  if (inherited) return inherited;
  const path = firstStringField(args, ['path', 'file', 'filepath', 'file_path']);
  if (!path) return '';
  const offset = typeof args.offset === 'number' ? args.offset : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  const lines = offset !== undefined && offset > 0 ? (limit === undefined || limit <= 1 ? `L${offset}` : `L${offset}-${offset + limit - 1}`) : '';
  return [basename(path), lines].filter(Boolean).join(' ');
}

function dynamicTitle(tool: ToolPart, args: Json, result: Json, failed: boolean): string {
  const pending = tool.status === 'running';
  const verb = (gerund: string, past: string) => (pending ? gerund : past);

  switch (tool.name) {
    case 'web_extract': {
      const url = findFirstUrl(args, result);
      return url ? `${verb('Reading', 'Read')} ${hostnameOf(url)}` : '';
    }
    case 'browser_navigate': {
      const url = findFirstUrl(args, result);
      if (!url) return '';
      return `${failed ? 'Failed to open' : verb('Opening', 'Opened')} ${hostnameOf(url)}`;
    }
    case 'web_search': {
      const query = firstStringField(args, ['search_term', 'query', 'context']);
      return query ? `${verb('Searching', 'Searched')} “${compactPreview(query, 48)}”` : '';
    }
    case 'session_search': {
      const query = firstStringField(args, ['query']) || tool.context;
      const base = pending ? 'Searching past sessions' : 'Searched past sessions';
      return query ? `${base} · “${compactPreview(query, 48)}”` : '';
    }
    case 'read_file': {
      const target = readFileTarget(args);
      return target ? `${verb('Reading', 'Read')} ${target}` : '';
    }
    case 'terminal':
    case 'execute_code': {
      const command = shellCommand(args);
      if (!command) return '';
      const action = tool.name === 'execute_code' ? verb('Scripting', 'Ran code') : verb('Running', 'Ran');
      return `${action} ${withoutLeadingAction(compactPreview(summarizeShellCommand(command), 160), action)}`;
    }
    case 'browser_exec':
      return browserExecStepLabel(firstStringField(args, ['code']));
    default: {
      if (isFileEditTool(tool.name)) {
        const path = firstStringField(args, ['path', 'file_path', 'file', 'filepath']) || firstStringField(result, ['path', 'file_path']);
        return path ? basename(path) : '';
      }
      return '';
    }
  }
}

// ─── shell command summary (lib/summarize-command.ts) ────────────────────────

const SILENT_HEADS = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'source', '.', 'true', 'false', ':']);
const PIPE_TAIL_HEADS = new Set(['head', 'tail', 'wc', 'sort', 'uniq']);
const commandBase = (head: string) => head.split('/').pop() || head;

function splitWords(segment: string): string[] {
  const words: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      buf += ch;
      if (ch === quote && segment[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) words.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) words.push(buf);
  return words;
}

function stripPipeTail(segment: string): string {
  const words = splitWords(segment);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === '|' && PIPE_TAIL_HEADS.has(commandBase(words[i + 1] ?? ''))) break;
    out.push(words[i]);
  }
  return out.join(' ').trim();
}

function splitCompoundCommand(input: string): string[] {
  const segments: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      buf += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    const op = input.startsWith('&&', i) || input.startsWith('||', i) ? input.slice(i, i + 2) : ch === ';' || ch === '\n' ? ch : '';
    if (op) {
      segments.push(buf);
      buf = '';
      i += op.length - 1;
      continue;
    }
    buf += ch;
  }
  segments.push(buf);
  return segments.map((segment) => stripPipeTail(segment.trim())).filter(Boolean);
}

function headWord(segment: string): string {
  const tokens = splitWords(segment);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[index])) index += 1;
  return commandBase(tokens[index] ?? '');
}

function cleanSegment(segment: string): string {
  const words = splitWords(segment);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (/^\d*(?:>>?|<)$/.test(word)) {
      i += 1;
      continue;
    }
    if (/^\d*(?:>&|<&)\d+$/.test(word)) continue;
    out.push(word);
  }
  return out.join(' ').trim();
}

function isBoundaryEcho(segment: string): boolean {
  const words = splitWords(segment);
  if (commandBase(words[0] ?? '') !== 'echo') return false;
  return /-{2,}|_exit=|(?:^|\s|=)\$[?{]|PIPESTATUS/.test(words.slice(1).join(' '));
}

/** the "main" command of a wrapped one, for display only */
export function summarizeShellCommand(raw: string): string {
  const original = (raw ?? '').trim();
  if (!original) return '';
  const segments = splitCompoundCommand(original);
  if (segments.length <= 1) return cleanSegment(original) || original;
  const core = segments.map(cleanSegment).filter((segment) => segment && !SILENT_HEADS.has(headWord(segment)) && !isBoundaryEcho(segment));
  if (core.length === 0) return original;
  if (core.length === 1) return core[0];
  return `${core[0]} + ${core.length - 1} ${core.length === 2 ? 'command' : 'commands'}`;
}

// ─── status (lib/tool-result-summary.ts) ─────────────────────────────────────

const ERROR_KEYS = ['error', 'errors', 'failure', 'exception'] as const;
const ERROR_MSG_KEYS = ['message', 'reason', 'detail'] as const;
const WRAPPER_KEYS = ['data', 'result', 'output', 'response', 'payload'] as const;
const NON_ERROR_TEXT = new Set(['', '0', 'false', 'none', 'null', 'nil', 'ok', 'success', 'n/a', 'na']);

function tryJson(value: string): unknown {
  const text = value.trim();
  if (!text) return '';
  if (!/^[{[]|^"/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

const norm = (value: unknown): unknown => (typeof value === 'string' ? tryJson(value) : value);

function clip(value: string, maxChars = 700, maxLines = 12): string {
  const text = value.trim();
  const lines = text.split('\n');
  let out = lines.slice(0, maxLines).join('\n');
  const clipped = lines.length > maxLines || out.length > maxChars;
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trimEnd();
  return clipped && !out.endsWith('…') ? `${out}…` : out;
}

function hasMeaningfulErrorValue(value: unknown): boolean {
  const v = norm(value);
  if (v == null) return false;
  if (typeof v === 'string') return !NON_ERROR_TEXT.has(v.trim().toLowerCase());
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.some(hasMeaningfulErrorValue);
  if (isRecord(v)) return Object.keys(v).length > 0;
  return true;
}

function hasErrorSignal(record: Json): boolean {
  const status = typeof record.status === 'string' ? record.status : '';
  return (
    record.success === false ||
    record.ok === false ||
    /^(error|failed|failure|fatal|exception)$/i.test(status.trim()) ||
    ERROR_KEYS.some((key) => hasMeaningfulErrorValue(record[key]))
  );
}

function valueErrorText(value: unknown): string {
  const v = norm(value);
  if (typeof v === 'string') return hasMeaningfulErrorValue(v) ? clip(v) : '';
  if (Array.isArray(v)) return clip(v.map(valueErrorText).filter(Boolean).slice(0, 3).join('; '));
  if (isRecord(v)) {
    const direct = firstStringField(v, ERROR_MSG_KEYS);
    if (direct) return clip(direct);
  }
  return '';
}

function findNestedError(value: unknown, depth: number, seen: Set<unknown>, failed = false): string {
  if (depth > 5) return '';
  const v = norm(value);
  if (!v || typeof v !== 'object' || seen.has(v)) return '';
  seen.add(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const nested = findNestedError(item, depth + 1, seen, failed);
      if (nested) return nested;
    }
    return '';
  }
  const record = v as Json;
  if (record.success === true || record.ok === true) return '';
  for (const key of ERROR_KEYS) {
    if (!hasMeaningfulErrorValue(record[key])) continue;
    const text = valueErrorText(record[key]);
    if (text) return text;
  }
  if (hasErrorSignal(record)) {
    const direct = firstStringField(record, ERROR_MSG_KEYS);
    if (direct) return clip(direct);
  }
  const declared = failed || hasErrorSignal(record);
  const nestedKeys: readonly string[] = declared ? [...ERROR_KEYS, ...WRAPPER_KEYS, 'details'] : ERROR_KEYS;
  for (const key of nestedKeys) {
    const nested = findNestedError(record[key], depth + 1, seen, declared);
    if (nested) return nested;
  }
  return '';
}

function toolErrorText(tool: ToolPart, result: Json): string {
  const extracted = findNestedError(tool.result, 0, new Set());
  if (tool.error) return extracted || tool.error;
  if (extracted) return extracted;
  if (result.success === false || result.ok === false) {
    return firstStringField(result, ['message', 'reason', 'detail']) || 'Tool returned success=false.';
  }
  if (typeof result.status === 'string' && /^(error|failed|failure|fatal|exception)$/i.test(result.status.trim())) {
    return firstStringField(result, ['message', 'reason', 'detail']) || `Tool returned status "${result.status}".`;
  }
  // a non-zero exit with output is grep/diff doing their job, not a failure
  const exit = typeof result.exit_code === 'number' ? result.exit_code : null;
  if (exit !== null && exit !== 0) {
    return firstStringField(result, ['output', 'stdout', 'stderr', 'output_preview']) ? '' : `Command failed with exit code ${exit}.`;
  }
  return '';
}

function toolStatus(tool: ToolPart, result: Json): { status: ToolStatus; error: string } {
  if (tool.status === 'running') return { status: 'running', error: '' };
  if (result.success === true || result.ok === true) return { status: 'success', error: '' };
  const error = toolErrorText(tool, result);
  if (!error) return { status: 'success', error: '' };
  if (tool.name === 'read_file' && /^File not found:/i.test(error)) return { status: 'notice', error };
  if (tool.name === 'terminal' && error === 'Command failed with exit code 1.') return { status: 'notice', error };
  return { status: tool.name === 'memory' ? 'warning' : 'error', error };
}

export const toolFailed = (tool: ToolPart) => {
  const { status } = toolStatus(tool, parseObject(tool.result));
  return status === 'error' || status === 'warning';
};

// ─── trailing meta ───────────────────────────────────────────────────────────

const COUNT_FIELD_NOUNS: [string, string][] = [
  ['count', ''], ['total', ''], ['result_count', 'result'], ['results_count', 'result'], ['num_results', 'result'],
  ['match_count', 'match'], ['matches_count', 'match'], ['file_count', 'file'], ['files_count', 'file'],
  ['item_count', 'item'], ['items_count', 'item'], ['search_count', 'search'], ['searches_count', 'search'],
  ['source_count', 'source'], ['sources_count', 'source'], ['document_count', 'document'], ['documents_count', 'document'],
  ['updated', 'item'], ['added', 'item'], ['removed', 'item'], ['deleted', 'item'], ['created', 'item'],
  ['changed', 'item'], ['processed', 'item'], ['steps', 'step'],
];
const COUNT_ARRAY_NOUNS: [string, string][] = [
  ['results', 'result'], ['items', 'item'], ['matches', 'match'], ['files', 'file'], ['documents', 'document'], ['sources', 'source'], ['rows', 'row'],
];
const COUNT_EXCLUDED_KEYS = new Set(['duration_s', 'exit_code', 'status_code']);
const DEFAULT_NOUN: Record<string, string> = {
  browser_snapshot: 'item', list_files: 'file', search_files: 'result', session_search: 'result', session_search_recall: 'result', todo: 'todo', todo_list: 'todo', web_search: 'result',
};

type Metric = { count: number; noun: string };

function singularize(noun: string): string {
  const n = noun.trim().toLowerCase();
  if (!n) return '';
  if (n.endsWith('ies') && n.length > 3) return `${n.slice(0, -3)}y`;
  if (/(xes|zes|ches|shes|sses)$/.test(n) && n.length > 3) return n.slice(0, -2);
  if (n.endsWith('s') && n.length > 2 && !n.endsWith('ss')) return n.slice(0, -1);
  return n;
}

function pluralize(noun: string, count: number): string {
  if (count === 1) return noun;
  if (noun === 'search') return 'searches';
  if (noun.endsWith('y') && noun.length > 1 && !/[aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length > 0 ? value.length : null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const metric = (count: number, noun: string): Metric => ({ count, noun: singularize(noun) || 'item' });

function countFromRecord(record: Json, fallback: string): Metric | null {
  for (const [key, noun] of COUNT_FIELD_NOUNS) {
    const count = typeof record[key] === 'boolean' ? null : countOf(record[key]);
    if (count !== null) return metric(count, noun || fallback);
  }
  for (const [key, noun] of COUNT_ARRAY_NOUNS) {
    const count = Array.isArray(record[key]) ? countOf(record[key]) : null;
    if (count !== null) return metric(count, noun);
  }
  for (const [key, value] of Object.entries(record)) {
    if (COUNT_EXCLUDED_KEYS.has(key) || !/_count$|_total$/i.test(key)) continue;
    const count = countOf(value);
    if (count === null) continue;
    const stripped = key.toLowerCase().replace(/_(count|total)$/i, '').replace(/^num_/, '');
    return metric(count, singularize(stripped) || fallback);
  }
  return null;
}

function countFromText(text: string, fallback: string): Metric | null {
  const match =
    text.match(/\b(\d+)\s+(results?|items?|files?|matches?|documents?|sources?|searches?|steps?|rows?)\b/i) ||
    text.match(/\b(?:did|found|returned|listed|searched|matched|updated|created|deleted|processed)\s+(\d+)\b/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? metric(Math.round(n), match[2] ? singularize(match[2]) : fallback) : null;
}

function resultCount(tool: ToolPart, result: Json): Metric | null {
  if (tool.result === undefined) return null;
  const fallback = DEFAULT_NOUN[tool.name] || 'item';
  if (tool.name === 'memory') {
    const entries = countOf(result.entry_count);
    if (entries !== null) return metric(entries, 'entry');
  }
  const direct = countFromRecord(result, fallback);
  if (direct) return tool.name === 'web_search' ? metric(direct.count, 'result') : direct;
  for (const key of WRAPPER_KEYS) {
    if (isRecord(result[key])) {
      const nested = countFromRecord(result[key] as Json, fallback);
      if (nested) return nested;
      break;
    }
  }
  const summary = firstStringField(result, ['summary', 'message', 'detail']) || tool.summary || '';
  return countFromText(summary, fallback);
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rem = whole % 60;
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

// ─── the row ─────────────────────────────────────────────────────────────────

function prettyResult(tool: ToolPart, result: Json): string {
  if (tool.resultText?.trim()) return tool.resultText.trim();
  if (tool.name === 'terminal' || tool.name === 'execute_code') {
    const streams = [firstStringField(result, ['output', 'stdout']), firstStringField(result, ['stderr'])].filter(Boolean);
    if (streams.length) return streams.join('\n\n');
  }
  if (tool.name === 'read_file') {
    const content = firstStringField(result, ['content']);
    if (content) return content;
  }
  const raw = typeof tool.result === 'string' ? tool.result.trim() : '';
  if (!raw) return tool.summary ?? '';
  const parsed = tryJson(raw);
  return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : raw;
}

export function buildToolView(tool: ToolPart): ToolView {
  const args = tool.args;
  const result = parseObject(tool.result);
  const meta = toolMeta(tool.name);
  const { status, error } = toolStatus(tool, result);
  const pending = status === 'running';
  const dynamic = dynamicTitle(tool, args, result, status === 'error');
  const title = dynamic || (pending ? meta.pending : meta.done);
  const touched = dynamic || tool.name in TOOL_META ? '' : compactPreview(firstStringField(args, ['context', 'preview']) || tool.context);
  const count = status === 'error' ? null : resultCount(tool, result);
  const seconds = typeof result.duration_s === 'number' ? result.duration_s : tool.durationS;
  const body = pending ? '' : prettyResult(tool, result);
  const inlineDiff = pending ? '' : inlineDiffFromResult(result);
  // a diff stands in for the raw result dump, as on the desktop
  const detail = inlineDiff ? '' : error ? [error, body].filter((value, index, list) => value && list.indexOf(value) === index).join('\n\n') : body;

  return {
    title,
    subtitle: touched && touched !== title ? touched : undefined,
    icon: meta.icon,
    status,
    countLabel: count ? `${count.count} ${pluralize(count.noun, count.count)}` : undefined,
    durationLabel: !pending && seconds !== undefined && !isFileEditTool(tool.name) ? formatDurationSeconds(seconds) || undefined : undefined,
    error,
    command: tool.name === 'terminal' ? shellCommand(args) || undefined : undefined,
    detail,
    inlineDiff: inlineDiff || undefined,
    diffStats: inlineDiff && isFileEditTool(tool.name) ? diffStats(inlineDiff) : undefined,
    imageUrl: pending ? undefined : toolImageUrl(args, result) || undefined,
  };
}

// ─── runs (run-summary.ts) ───────────────────────────────────────────────────

export type RunItem = { kind: 'run'; start: number; end: number } | { kind: 'card'; index: number };

/** split consecutive tool calls into the cards that stay on screen and the runs between them */
export function splitRunItems(names: readonly string[]): RunItem[] {
  const items: RunItem[] = [];
  let run: Extract<RunItem, { kind: 'run' }> | null = null;
  names.forEach((name, index) => {
    if (isCardTool(name)) {
      run = null;
      items.push({ kind: 'card', index });
    } else if (run) {
      run.end = index;
    } else {
      run = { kind: 'run', start: index, end: index };
      items.push(run);
    }
  });
  return items;
}

type Category = 'analyze' | 'browse' | 'delegate' | 'edit' | 'explore' | 'interact' | 'other' | 'read' | 'run' | 'search';

const CATEGORY_ORDER: readonly Category[] = ['edit', 'explore', 'search', 'read', 'browse', 'interact', 'analyze', 'run', 'delegate', 'other'];

const CATEGORY_COPY: Record<Category, { noun: [string, string]; past: string; present: string }> = {
  analyze: { noun: ['image', 'images'], past: 'Analyzed', present: 'Analyzing' },
  browse: { noun: ['page', 'pages'], past: 'Opened', present: 'Opening' },
  delegate: { noun: ['task', 'tasks'], past: 'Delegated', present: 'Delegating' },
  edit: { noun: ['file', 'files'], past: 'Edited', present: 'Editing' },
  explore: { noun: ['file', 'files'], past: 'Explored', present: 'Exploring' },
  interact: { noun: ['browser action', 'browser actions'], past: 'Performed', present: 'Performing' },
  other: { noun: ['tool', 'tools'], past: 'Used', present: 'Using' },
  read: { noun: ['page', 'pages'], past: 'Read', present: 'Reading' },
  run: { noun: ['command', 'commands'], past: 'Ran', present: 'Running' },
  search: { noun: ['query', 'queries'], past: 'Searched', present: 'Searching' },
};

const TOOL_CATEGORY: Record<string, Category> = {
  browser_navigate: 'browse',
  delegate_task: 'delegate',
  execute_code: 'run',
  list_files: 'explore',
  read_file: 'explore',
  search_files: 'explore',
  session_search_recall: 'search',
  terminal: 'run',
  vision_analyze: 'analyze',
  web_extract: 'read',
  web_search: 'search',
};

function category(name: string): Category {
  if (isFileEditTool(name)) return 'edit';
  return TOOL_CATEGORY[name] ?? (name.startsWith('browser_') ? 'interact' : 'other');
}

/** desktop `toolPresentVerb`: what the tail row calls a call whose arguments are still streaming */
export function toolPresentVerb(name: string): string {
  if (name === 'skill_view') return 'Loading skill';
  return CATEGORY_COPY[category(name)].present;
}

function unitCount(tool: ToolPart): number {
  if (tool.name !== 'web_extract') return 1;
  const urls = tool.args.urls;
  return Array.isArray(urls) && urls.length > 0 ? urls.length : 1;
}

function runTarget(tool: ToolPart): string {
  const args = tool.args;
  const kind = category(tool.name);
  if (kind === 'run') return summarizeShellCommand(firstStringField(args, ['command', 'code']));
  if (kind === 'search') {
    const query = firstStringField(args, ['query', 'search_term']);
    return query ? `“${compactPreview(query, 48)}”` : '';
  }
  if (kind === 'read' || kind === 'browse') return hostnameOf(findFirstUrl(args));
  const path = firstStringField(args, ['path', 'file', 'filepath']);
  return path ? basename(path) : firstStringField(args, ['query', 'url']);
}

function clause(kind: Category, tools: ToolPart[], live: boolean): string {
  const copy = CATEGORY_COPY[kind];
  const verb = live ? copy.present : copy.past;
  const count = tools.reduce((sum, tool) => sum + unitCount(tool), 0);
  const target = count === 1 && kind !== 'interact' ? runTarget(tools[0]) : '';
  if (target && (live || kind !== 'run')) return `${verb} ${target}`;
  return `${verb} ${count} ${copy.noun[count === 1 ? 0 : 1]}`;
}

/** "Explored 3 files, ran 5 commands": the one line a run of calls collapses into */
export function summarizeToolRun(tools: readonly ToolPart[], live: boolean): string {
  const narrating = live ? (tools.find((tool) => tool.status === 'running') ?? tools[tools.length - 1]) : undefined;
  const liveCategory = narrating ? category(narrating.name) : null;
  const byCategory = new Map<Category, ToolPart[]>();
  for (const tool of tools) {
    const kind = category(tool.name);
    byCategory.set(kind, [...(byCategory.get(kind) ?? []), tool]);
  }
  const clauses = CATEGORY_ORDER.flatMap((kind) => {
    const group = byCategory.get(kind);
    return group ? [clause(kind, group, kind === liveCategory)] : [];
  });
  const failed = tools.filter(toolFailed).length;
  if (failed) clauses.push(`${failed} tool call${failed === 1 ? '' : 's'} failed`);
  return clauses.map((text, index) => (index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))).join(', ');
}
