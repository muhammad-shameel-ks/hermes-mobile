/**
 * The composer's `/` and `@` completion logic, pure: the phone's curated slash
 * registry, trigger detection, and the grouped, filtered rows the sheets render.
 *
 * Ported from the desktop's lib/desktop-slash-commands.ts (the command table and
 * the catalog filters), app/chat/composer/text-utils.ts (`detectTrigger`) and
 * hooks/use-slash-completions.ts / use-at-completions.ts (row shaping). The
 * desktop offers every command the gateway's catalog reports; the phone carries
 * a curated list and takes only skills (and descriptions) from the live catalog.
 */

import type { CommandsCatalogResult, CompletionItem } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { fuzzyScore } from '../../vendor/hermes-shared/src/fuzzy.ts';
import { looksLikeSlashCommand, parseSlashCommand } from '../../vendor/hermes-shared/src/slash.ts';
import { REASONING_EFFORT_VALUES } from '../../vendor/hermes-shared/src/reasoning-effort.ts';

export type SlashArgumentMode = 'mixed' | 'options' | 'text';

/** Opens a picker or surface the chat screen owns; the controller never sees these. */
export type SlashUi = 'model' | 'profile' | 'sessions';

export type SlashAction = 'compress' | 'new' | 'reasoning' | 'status' | 'steer' | 'stop' | 'title';

/**
 * How the phone fulfils a command: `ui` opens something, `action` is a local
 * handler, `exec` runs on the gateway (`slash.exec`, then `command.dispatch`)
 * and renders its text inline.
 */
export type SlashSurface = { kind: 'action'; action: SlashAction } | { kind: 'exec' } | { kind: 'ui'; ui: SlashUi };

export type SlashCommand = {
  /** canonical command, leading slash included */
  name: string;
  description: string;
  /** the registry's category, the sheet's section header */
  group: SlashGroup;
  aliases?: string[];
  surface: SlashSurface;
  argumentMode?: SlashArgumentMode;
  /** finite argument list served without a round trip */
  options?: readonly string[];
  /** exec-routed commands narrowed to these subcommands (the registry's `desktop_subcommands`) */
  subcommands?: readonly string[];
};

export type SlashGroup = 'Session' | 'Configuration' | 'Tools & Skills' | 'Info' | 'User commands' | 'Plugin commands' | 'Skills';

const ui = (name: SlashUi): SlashSurface => ({ kind: 'ui', ui: name });
const action = (name: SlashAction): SlashSurface => ({ kind: 'action', action: name });
const exec: SlashSurface = { kind: 'exec' };

/**
 * The phone's slash list. Descriptions are the registry's own (hermes_cli/
 * commands.py); the desktop's local table supplies the surface and argument
 * mode. Commands the phone drops are listed in `PHONE_DROPPED`.
 */
export const PHONE_COMMANDS: readonly SlashCommand[] = [
  { name: '/new', group: 'Session', description: 'Start a new session', aliases: ['/reset', '/clear'], surface: action('new') },
  {
    name: '/compress',
    group: 'Session',
    description: 'Compress this conversation context',
    aliases: ['/compact'],
    surface: action('compress'),
    argumentMode: 'text',
  },
  { name: '/stop', group: 'Session', description: 'Stop the active turn and background processes', surface: action('stop') },
  { name: '/title', group: 'Session', description: 'Set a title for the current session', surface: action('title'), argumentMode: 'text' },
  {
    name: '/steer',
    group: 'Session',
    description: 'Inject a message after the next tool call without interrupting',
    aliases: ['/s'],
    surface: action('steer'),
    argumentMode: 'text',
  },
  {
    name: '/goal',
    group: 'Session',
    description: 'Set a standing goal Hermes works on across turns until achieved',
    surface: exec,
    argumentMode: 'mixed',
    options: ['status', 'show', 'pause', 'resume', 'clear'],
  },
  { name: '/subgoal', group: 'Session', description: 'Add or manage extra criteria on the active goal', surface: exec, argumentMode: 'text' },
  { name: '/plan', group: 'Session', description: 'Write a markdown implementation plan without executing anything', surface: exec, argumentMode: 'text' },
  {
    name: '/review',
    group: 'Session',
    description: 'Spawn an independent subagent to review the work just discussed',
    surface: exec,
    argumentMode: 'text',
  },
  { name: '/refine', group: 'Session', description: 'Review this conversation now and save lessons to memory and skills', surface: exec, argumentMode: 'text' },
  { name: '/agents', group: 'Session', description: 'Show active agents and running tasks', aliases: ['/tasks'], surface: exec },
  { name: '/status', group: 'Session', description: 'Show session, model, token, and context info', surface: action('status') },
  { name: '/context', group: 'Session', description: 'Show the context window, usage gauge and compression stats', aliases: ['/ctx'], surface: exec },
  { name: '/resume', group: 'Session', description: 'Resume a saved session', aliases: ['/sessions', '/switch'], surface: ui('sessions') },
  { name: '/model', group: 'Configuration', description: 'Switch the model for this session', surface: ui('model') },
  {
    name: '/reasoning',
    group: 'Configuration',
    description: 'Set the reasoning effort',
    surface: action('reasoning'),
    argumentMode: 'options',
    options: REASONING_EFFORT_VALUES,
  },
  { name: '/personality', group: 'Configuration', description: 'Set a predefined personality', surface: exec, argumentMode: 'options' },
  {
    name: '/skills',
    group: 'Tools & Skills',
    description: 'Review staged skill writes and approval mode',
    surface: exec,
    argumentMode: 'options',
    options: ['pending', 'approve', 'reject', 'diff', 'approval'],
    subcommands: ['pending', 'approve', 'reject', 'diff', 'approval'],
  },
  {
    name: '/memory',
    group: 'Tools & Skills',
    description: 'Review pending memory writes or toggle the approval gate',
    surface: exec,
    argumentMode: 'options',
    options: ['pending', 'approve', 'reject', 'approval'],
  },
  { name: '/learn', group: 'Tools & Skills', description: 'Learn a reusable skill from anything you describe', surface: exec, argumentMode: 'text' },
  { name: '/bundles', group: 'Tools & Skills', description: 'List skill bundles', surface: exec },
  { name: '/profile', group: 'Info', description: 'Switch the active Hermes profile', surface: ui('profile') },
  { name: '/usage', group: 'Info', description: 'Show token usage and rate limits', surface: exec },
  { name: '/whoami', group: 'Info', description: 'Show your slash command access', surface: exec },
  { name: '/version', group: 'Info', description: 'Show Hermes Agent version', aliases: ['/v'], surface: exec },
  { name: '/debug', group: 'Info', description: 'Upload a debug report and get shareable links', surface: exec },
];

/** Why each registry command the desktop offers is absent from the phone list. */
export const PHONE_DROPPED: Readonly<Record<string, string>> = {
  '/branch': 'needs a session-opening path the session actions own',
  '/retry': 'the action bar owns retry (session.rewind)',
  '/undo': 'the action bar owns edit and restore (session.rewind)',
  '/queue': 'the status stack owns the queue',
  '/btw': 'its answer arrives as a btw.complete event the transcript does not render',
  '/bg': 'its result arrives as a background event the transcript does not render',
  '/yolo': 'no indicator for an auto-approve mode on a phone',
  '/wake': 'wake-word listener is desktop-only',
  '/handoff': 'messaging platforms ship with the Messaging surface',
  '/skin': 'appearance settings own skins',
  '/help': 'the sheet is the command list',
  '/browser': 'agent browser control is advanced',
  '/journey': 'the memory graph screen ships later',
  '/pet': 'pets ship later',
  '/hatch': 'pets ship later',
  '/save': 'writes a file on the gateway host',
  '/diff': 'the review surface owns working-tree changes',
  '/loop': 'loop and heartbeat controls are advanced',
  '/heartbeat': 'loop and heartbeat controls are advanced',
  '/approvals': 'approval mode belongs in settings',
  '/rollback': 'filesystem checkpoints are advanced',
  '/tools': 'the capabilities surface owns toolsets',
  '/topup': 'billing is not on the phone',
  '/subscription': 'billing is not on the phone',
};

/** registry `desktop=` reasons that hide a command the live catalog marks unavailable */
const UNAVAILABLE_REASONS = new Set(['advanced', 'composer-voice', 'messaging', 'settings', 'terminal']);

const normalize = (value: string) => value.trim().toLowerCase();

const commandText = (value: string) => (value.startsWith('/') ? value : `/${value}`);

const ALIASES = new Map<string, SlashCommand>(PHONE_COMMANDS.flatMap((command) => (command.aliases ?? []).map((alias) => [alias, command] as const)));
const BY_NAME = new Map<string, SlashCommand>(PHONE_COMMANDS.map((command) => [command.name, command]));

/** the phone command a typed name or alias resolves to, or null for a skill or an unknown name */
export function resolveCommand(name: string): SlashCommand | null {
  const key = normalize(commandText(name.trim().split(/\s+/, 1)[0] ?? ''));
  return BY_NAME.get(key) ?? ALIASES.get(key) ?? null;
}

/** a typed line as `{ command, name, arg }`; `command` is null for skills and unknown names */
export function parseSlashLine(text: string): { command: SlashCommand | null; name: string; arg: string } {
  const { name, arg } = parseSlashCommand(text);
  return { command: name ? resolveCommand(name) : null, name, arg };
}

/** the picker a sent line opens (`/model`, `/resume`, `/profile`), or null when the controller runs it */
export function uiSlash(text: string): SlashUi | null {
  if (!looksLikeSlashCommand(text.trim())) return null;
  const surface = parseSlashLine(text.trim()).command?.surface;
  return surface?.kind === 'ui' ? surface.ui : null;
}

// ─── triggers ────────────────────────────────────────────────────────────────

export type TriggerKind = '/' | '@';

export type DirectiveScope = 'file' | 'folder' | 'url' | 'image' | 'tool' | 'git';

export const DIRECTIVE_SCOPES: readonly DirectiveScope[] = ['file', 'folder', 'url', 'image', 'tool', 'git'];

export type Trigger = {
  kind: TriggerKind;
  /** a `/` typed mid-message: a skill reference in prose, never a command */
  inline?: boolean;
  query: string;
  scope?: DirectiveScope;
  /** characters of the text before the caret that the pick replaces */
  tokenLength: number;
  /** `query` minus the `scope:` prefix */
  value: string;
};

const AT_SCOPE_RE = new RegExp(`^(${DIRECTIVE_SCOPES.join('|')}):(.*)$`);
const AT_TRIGGER_RE = /(?:^|[\s\uFFFC])(@)([^\s@\uFFFC]*)$/;
const SLASH_COMMAND_TRIGGER_RE = /^(\/)((?:[a-zA-Z][\w-]*(?:\s+\S*)*)?)$/;
const SLASH_INLINE_TRIGGER_RE = /[\s\uFFFC](\/)([a-zA-Z][\w-]*)?$/;

/** desktop text-utils.ts `detectTrigger`, minus the emoji trigger: run against the text before the caret */
export function detectTrigger(textBefore: string): Trigger | null {
  const inline = SLASH_INLINE_TRIGGER_RE.exec(textBefore);
  if (inline) {
    const query = inline[2] ?? '';
    return { inline: true, kind: '/', query, tokenLength: 1 + query.length, value: query };
  }
  const command = SLASH_COMMAND_TRIGGER_RE.exec(textBefore);
  if (command) return { kind: '/', query: command[2], tokenLength: 1 + command[2].length, value: command[2] };
  const at = AT_TRIGGER_RE.exec(textBefore);
  if (at) {
    const query = at[2];
    const scoped = AT_SCOPE_RE.exec(query);
    return {
      kind: '@',
      query,
      ...(scoped ? { scope: scoped[1] as DirectiveScope } : {}),
      tokenLength: 1 + query.length,
      value: scoped ? (scoped[2] ?? '') : query,
    };
  }
  return null;
}

/** a `/` query is at its argument stage once it is past the command name */
export const slashArgStage = (query: string) => query.includes(' ');

/** `personality x` → `/personality` */
export const slashCommandToken = (query: string) => `/${query.split(/\s+/, 1)[0]?.toLowerCase() ?? ''}`;

/**
 * Whether the sheet stays open for this trigger: a text-only command has no
 * completions once its prose begins, while `options` and `mixed` commands keep
 * suggesting their arguments.
 */
export function triggerStaysOpen(trigger: Trigger): boolean {
  if (trigger.kind !== '/' || trigger.inline || !slashArgStage(trigger.query)) return true;
  const mode = resolveCommand(slashCommandToken(trigger.query))?.argumentMode ?? null;
  return mode === 'options' || mode === 'mixed';
}

/** the composer's text with the token before the caret replaced by `insert`, verbatim except a trailing space is dropped before existing whitespace */
export function replaceToken(text: string, caret: number, tokenLength: number, insert: string): { text: string; caret: number } {
  const start = Math.max(0, caret - tokenLength);
  const rest = text.slice(caret);
  const spaced = /^\s/.test(rest) ? insert.trimEnd() : insert;
  return { text: `${text.slice(0, start)}${spaced}${rest}`, caret: start + spaced.length };
}

// ─── slash rows ──────────────────────────────────────────────────────────────

export type SlashRow = {
  /** what picking the row inserts, leading slash included */
  text: string;
  display: string;
  meta: string;
  group: string;
  /** the phone command behind the row; null for skills and argument rows */
  command: SlashCommand | null;
};

export type SkillRow = { text: string; meta: string; usage: number; bundled: boolean; group?: string };

/**
 * Skill commands from the live catalog: pairs the backend appended without a
 * category (it categorizes registry commands and tacks skills on after), or the
 * `skills` map's keys on a catalog that never categorized. Browsing ranks by use
 * and drops never-used bundled skills; a typed query hides nothing.
 */
export function catalogSkills(catalog: CommandsCatalogResult | null | undefined, { browsing }: { browsing: boolean }): SkillRow[] {
  if (!catalog) return [];
  const pairs = (catalog.pairs ?? []).filter((pair): pair is [string, string] => typeof pair[0] === 'string');
  const categorized = new Set((catalog.categories ?? []).flatMap((section) => (section.pairs ?? []).map((pair) => normalize(pair[0]))));
  const known = (name: string) => BY_NAME.has(name) || ALIASES.has(name);
  const mapped = catalog.skills ?? {};
  const rows: SkillRow[] = [];
  for (const [command, meta] of pairs) {
    const name = normalize(commandText(command));
    if (known(name)) continue;
    const entry = mapped[name] ?? mapped[command];
    const isSkill = catalog.categories?.length ? !categorized.has(name) : entry !== undefined;
    if (!isSkill) continue;
    rows.push({ text: commandText(command), meta: meta ?? '', usage: entry?.usage ?? 0, bundled: entry?.origin === 'bundled' });
  }
  const kept = browsing && catalog.skills ? rows.filter((row) => !row.bundled || row.usage > 0) : rows;
  return kept.sort((a, b) => b.usage - a.usage || a.text.localeCompare(b.text));
}

const EXTENSION_GROUPS = ['User commands', 'Plugin commands'] as const;

/** the user's quick commands and plugin commands: the catalog categorizes them, and the phone's list has no row for them */
export function catalogExtensions(catalog: CommandsCatalogResult | null | undefined): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const section of catalog?.categories ?? []) {
    if (!(EXTENSION_GROUPS as readonly string[]).includes(section.name)) continue;
    for (const pair of section.pairs ?? []) {
      if (typeof pair[0] === 'string') rows.push({ text: commandText(pair[0]), meta: pair[1] ?? '', usage: 0, bundled: false, group: section.name });
    }
  }
  return rows;
}

/** commands the catalog marks unavailable on a desktop-class surface stay out of the list */
function hiddenByCatalog(command: SlashCommand, catalog: CommandsCatalogResult | null | undefined): boolean {
  if (command.subcommands) return false;
  const canonical = catalog?.canon?.[command.name] ?? command.name;
  const reason = catalog?.commands?.[canonical]?.desktop;
  return typeof reason === 'string' && UNAVAILABLE_REASONS.has(reason);
}

/** the catalog's own wording for a command, when it has one; the usage hint rides along */
function describe(command: SlashCommand, catalog: CommandsCatalogResult | null | undefined): string {
  const live = (catalog?.pairs ?? []).find((pair) => normalize(commandText(pair[0] ?? '')) === command.name)?.[1];
  const usage = typeof live === 'string' ? /\s+\(usage:\s+(.+)\)$/s.exec(live)?.[0] : '';
  return `${command.description}${usage ?? ''}`;
}

function score(name: string, query: string): number | null {
  if (!query) return 0;
  const bare = name.replace(/^\//, '').toLowerCase();
  if (bare === query) return 1000;
  if (bare.startsWith(query)) return 500 - bare.length;
  return fuzzyScore(bare, query)?.score ?? null;
}

/**
 * The rows for a command-name query. An alias shows only on an exact typed
 * match (`/reset`), so the list is not cluttered with duplicates; mid-message
 * only skills are offered, since a built-in acts on the app and means nothing
 * inside prose.
 */
export function slashRows(options: { query: string; inline?: boolean; catalog?: CommandsCatalogResult | null }): SlashRow[] {
  const query = options.query.trim().toLowerCase();
  const catalog = options.catalog ?? null;
  const rows: Array<{ row: SlashRow; rank: number }> = [];

  if (!options.inline) {
    for (const command of PHONE_COMMANDS) {
      if (hiddenByCatalog(command, catalog)) continue;
      const aliasHit = (command.aliases ?? []).some((alias) => alias.slice(1) === query);
      const rank = aliasHit ? 900 : score(command.name, query);
      if (rank === null) continue;
      rows.push({
        row: { text: command.name, display: command.name, meta: describe(command, catalog), group: command.group, command },
        rank,
      });
    }
  }

  const extensions = options.inline ? [] : catalogExtensions(catalog);
  for (const skill of [...extensions, ...catalogSkills(catalog, { browsing: !query })]) {
    const rank = score(skill.text, query);
    if (rank === null) continue;
    rows.push({
      row: { text: skill.text, display: skill.text, meta: skill.meta, group: skill.group ?? 'Skills', command: null },
      rank: rank + Math.min(skill.usage, 50) / 100,
    });
  }

  const order = (group: string) => ['Session', 'Configuration', 'Tools & Skills', 'Info', 'User commands', 'Plugin commands', 'Skills'].indexOf(group);
  // browsing keeps the registry's order within a group; a query ranks by match
  return rows
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => order(a.row.group) - order(b.row.group) || (query ? b.rank - a.rank : 0) || a.index - b.index)
    .map((entry) => entry.row);
}

/** the argument rows for a `/command arg` query: the command's finite options, filtered by what is typed */
export function argumentRows(query: string): SlashRow[] {
  const command = resolveCommand(slashCommandToken(query));
  if (!command?.options) return [];
  const typed = query.replace(/^\S+\s+/, '').trim().toLowerCase();
  const name = command.name;
  return command.options
    .filter((option) => !typed || option.toLowerCase().startsWith(typed))
    .map((option) => ({ text: `${name} ${option}`, display: `${name} ${option}`, meta: '', group: 'Options', command: null }));
}

/**
 * Rows from the gateway's `complete.slash` for an argument stage that has no
 * static list. Items carry just the argument stub, so each is rewritten into the
 * full `/command arg` token; `replace_from` is the column the stub replaces from.
 */
export function gatewayArgumentRows(text: string, items: readonly CompletionItem[], replaceFrom: number | null | undefined): SlashRow[] {
  const from = typeof replaceFrom === 'number' ? replaceFrom : 1;
  const prefix = from > 1 ? text.slice(0, from) : '';
  const allowed = resolveCommand(slashCommandToken(text.slice(1)))?.subcommands;
  return items
    .filter((item) => typeof item.text === 'string')
    .filter((item) => !allowed || allowed.includes(item.text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''))
    .map((item) => {
      const full = `${prefix}${item.text}`;
      return { text: full, display: full, meta: typeof item.meta === 'string' ? item.meta : '', group: 'Options', command: null };
    });
}

// ─── @ rows ──────────────────────────────────────────────────────────────────

export type MentionKind = DirectiveScope | 'diff' | 'staged' | 'simple';

export type MentionRow = {
  /** the gateway's `text`: `@file:src/main.tsx`, `@diff`, `@folder:` */
  raw: string;
  kind: MentionKind;
  /** the value after `@kind:`, empty for a starter or a simple reference */
  value: string;
  display: string;
  meta: string;
  /** a starter (`@file:`) opens its scope rather than committing */
  starter: boolean;
  /** a folder row descends on tap */
  folder: boolean;
};

const KIND_RE = /^@(file|folder|url|image|tool|git):(.*)$/;

const STARTER_META: Record<DirectiveScope, string> = {
  file: 'Attach a file reference',
  folder: 'Attach a folder reference',
  url: 'Attach a URL reference',
  image: 'Attach an image reference',
  tool: 'Attach a tool reference',
  git: 'Attach git context',
};

/** the desktop's `@kind:` starters, offered when the gateway has nothing to list */
export function starterRows(query: string): MentionRow[] {
  const q = normalize(query);
  return DIRECTIVE_SCOPES.filter((kind) => !q || kind.startsWith(q)).map((kind) => ({
    raw: `@${kind}:`,
    kind,
    value: '',
    display: `@${kind}:`,
    meta: STARTER_META[kind],
    starter: true,
    folder: false,
  }));
}

/** a path's chip label: the last segment, or the whole value for a url (desktop `refChipLabel`, close enough for a row) */
export function refLabel(kind: string, value: string): string {
  if (kind === 'url') return value;
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || value;
}

/** one `complete.path` item as a row */
export function mentionRow(item: CompletionItem): MentionRow {
  const raw = item.text;
  const match = KIND_RE.exec(raw);
  if (match) {
    const kind = match[1] as DirectiveScope;
    const value = match[2];
    return {
      raw,
      kind,
      value,
      display: value ? refLabel(kind, value) : (item.display ?? `@${kind}:`),
      meta: typeof item.meta === 'string' ? item.meta : '',
      starter: !value,
      folder: kind === 'folder' && Boolean(value),
    };
  }
  const kind: MentionKind = raw.startsWith('@diff') ? 'diff' : raw.startsWith('@staged') ? 'staged' : 'simple';
  return { raw, kind, value: '', display: item.display ?? raw, meta: typeof item.meta === 'string' ? item.meta : '', starter: false, folder: false };
}

/** the same handle offered twice (gateway and a contributed row) lists once */
export function mentionRows(items: readonly CompletionItem[], query: string): MentionRow[] {
  const rows = items.filter((item) => typeof item.text === 'string').map(mentionRow);
  if (rows.length === 0) return starterRows(query);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = normalize(row.raw);
    if (!/^@[^:\s]+$/.test(key)) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function needsQuoting(value: string): boolean {
  return /[\s()[\]{}<>"'`]/.test(value);
}

/** desktop directive-text.ts `formatRefValue` */
export function formatRefValue(value: string): string {
  if (!needsQuoting(value)) return value;
  if (!value.includes('`')) return `\`${value}\``;
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return value;
}

/** what picking a row writes into the composer: desktop `hermesDirectiveFormatter.serialize` */
export function mentionInsertText(row: MentionRow): string {
  if (row.starter || !row.value) return row.raw;
  if (!row.raw.includes(':')) return row.raw;
  return `@${row.kind}:${formatRefValue(row.value)}`;
}

/** tapping a folder walks into it: the token retyped as the bare path, as typing it by hand would */
export function descendInsertText(row: MentionRow, scope: DirectiveScope | undefined): string {
  const path = row.value.endsWith('/') ? row.value : `${row.value}/`;
  return `@${scope ? `${scope}:` : ''}${path}`;
}

/** the breadcrumb's parent token: drops the last path segment, then the scope itself */
export function ascendToken(trigger: Trigger): string {
  const scope = trigger.scope ? `${trigger.scope}:` : '';
  if (!trigger.value.includes('/') && !scope) return '@';
  const trimmed = trigger.value.replace(/\/$/, '');
  const parent = trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
  return `@${trigger.value ? `${scope}${parent}` : ''}`;
}
