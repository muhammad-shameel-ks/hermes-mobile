/**
 * The bot roster, derived from `profiles.list` rows exactly as the desktop's
 * hermes-bots plugin derives it (apps/desktop/src/plugins/hermes-bots/:
 * labels.ts, data.ts, row-helpers.ts, roster-pane-derivation.ts, avatar.tsx).
 *
 * A bot is a profile; its look and its pinned/hidden flags live server-side in
 * `ui_meta["hermes-bots"]`, so they follow the profile across machines. Order is
 * pinned first, then the newest of (created, last activity in any session,
 * the hidden Bot Chat included).
 */

import type { ProfileRow } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';

export const BOT_META_NAMESPACE = 'hermes-bots';
/** The canonical chat's identity: a title on the bot's profile, never a stored pointer. */
export const BOT_CHAT_TITLE = 'Bot Chat';
export const BOT_KICKOFF = 'Hey, tell me about yourself!';
export const BOT_CHAT_EMPTY = 'Say something to get started.';
/** desktop `ACTIVE_WINDOW_S`: a bot whose newest session moved within this is shown as active */
const ACTIVE_WINDOW_S = 90;
const WORKER_WINDOW_S = 150;

export type BotMeta = {
  title?: string;
  shape?: string;
  color?: string;
  custom?: boolean;
  imageKind?: 'photo' | 'shape';
  created?: number;
  pinned?: boolean;
  hidden?: boolean;
  description?: string;
};

export type Bot = {
  name: string;
  label: string;
  description: string;
  isDefault: boolean;
  meta: BotMeta;
  pinned: boolean;
  hidden: boolean;
  hasAvatar: boolean;
  /** cleaned one-line preview of the newest message */
  preview: string;
  /** epoch seconds of the newest activity, Bot Chat included */
  lastActive: number;
  /** ms; the recency sort key */
  activity: number;
  active: boolean;
  /** a live worker session (kanban, background task): the face reads as working */
  working: boolean;
  canonicalSessionId: string | null;
  row: ProfileRow;
};

export function readBotMeta(row: Pick<ProfileRow, 'ui_meta'>): BotMeta {
  const raw = row.ui_meta?.[BOT_META_NAMESPACE];
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BotMeta) : {};
}

export const isDefaultProfile = (name: string) => name.trim().toLowerCase() === 'default';

const titleCase = (value: string) => value.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());

/** labels.ts precedence: Bot Mode title, profile display name, "Hermes" for default, title-cased name */
export function botLabel(row: Pick<ProfileRow, 'name' | 'display_name' | 'ui_meta'>): string {
  const title = readBotMeta(row).title?.trim();
  if (title) return title;
  if (typeof row.display_name === 'string' && row.display_name.trim()) return row.display_name.trim();
  if (isDefaultProfile(row.name)) return 'Hermes';
  return titleCase(row.name);
}

const A2A_PREFIX_RE = /^Message from (?:agent '[^']+'|🤖[^:]+):\s*/i;

/** labels.ts `stripPreviewMarkdown`, after the bot-to-bot delivery prefix is dropped */
export function cleanPreview(text: unknown): string {
  return String(text || '')
    .replace(A2A_PREFIX_RE, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** data.ts `botActivitySession`: the newer of the Bot Chat and the newest visible session */
function activitySession(row: ProfileRow) {
  const canonical = row.canonical_session ?? null;
  const last = row.last_session ?? null;
  if (!canonical || !last) return canonical ?? last;
  return (canonical.last_active ?? 0) >= (last.last_active ?? 0) ? canonical : last;
}

export function toBot(row: ProfileRow, nowSeconds: number): Bot {
  const meta = readBotMeta(row);
  const session = activitySession(row);
  const lastActive = session?.last_active ?? 0;
  const previewSource = row.canonical_session?.preview || row.last_session?.preview || '';
  const worker = row.worker_session?.last_active ?? 0;
  return {
    name: row.name,
    label: botLabel(row),
    description: (row.description ?? meta.description ?? '').trim(),
    isDefault: row.is_default === true || isDefaultProfile(row.name),
    meta,
    pinned: meta.pinned === true,
    hidden: meta.hidden === true,
    hasAvatar: row.has_avatar === true,
    preview: cleanPreview(previewSource),
    lastActive,
    activity: Math.max(meta.created ?? 0, lastActive * 1000),
    active: (lastActive > 0 && nowSeconds - lastActive < ACTIVE_WINDOW_S) || (worker > 0 && nowSeconds - worker < WORKER_WINDOW_S),
    working: worker > 0 && nowSeconds - worker < WORKER_WINDOW_S,
    canonicalSessionId: row.canonical_session ? row.canonical_session.resolved_id || row.canonical_session.id : null,
    row,
  };
}

export type Roster = { visible: Bot[]; hidden: Bot[] };

/** roster-pane-derivation.ts `sortRosterBots`, then hidden bots split off behind the disclosure */
export function buildRoster(rows: ProfileRow[], nowSeconds: number): Roster {
  const bots = rows
    .map((row) => toBot(row, nowSeconds))
    .sort((a, b) => (a.pinned === b.pinned ? b.activity - a.activity : a.pinned ? -1 : 1));
  return { visible: bots.filter((bot) => !bot.hidden), hidden: bots.filter((bot) => bot.hidden) };
}

/** search never re-ranks: it only filters the sorted roster */
export function filterBots(bots: Bot[], query: string): Bot[] {
  const q = query.trim().toLowerCase();
  if (!q) return bots;
  return bots.filter((bot) => [bot.label, bot.name, bot.description, bot.preview].some((field) => field.toLowerCase().includes(q)));
}

/** coarseElapsed + the roster's compact labels: now, 5m, 3h, 2d */
export function compactAge(epochSeconds: number, nowSeconds: number): string {
  if (!epochSeconds) return '';
  const delta = Math.max(0, nowSeconds - epochSeconds);
  if (delta < 60) return 'now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

/** A Bot Chat row from `session.list {title}`: accept the canonical lineage, nothing else (canonical-chat.ts). */
export function isBotChatRow(row: { title?: string; root_title?: string | null }): boolean {
  if (row.root_title) return row.root_title === BOT_CHAT_TITLE;
  return row.title === BOT_CHAT_TITLE;
}

function slugify(value: string, max = 64): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/** labels.ts `slugifyProfileName`: a display name to a profile name, accents folded, other letters kept as `-u<hex>-` */
export function slugifyProfileName(value: string): string {
  const folded = value
    .normalize('NFC')
    .replace(/[\p{L}\p{N}]/gu, (ch) => {
      const base = ch.normalize('NFKD').replace(/\p{M}+/gu, '');
      return /^[a-zA-Z0-9]+$/.test(base) ? base : `-u${ch.codePointAt(0)!.toString(16)}-`;
    })
    .replace(/-+/g, '-');
  const slug = slugify(folded, Infinity);
  if (slug.length <= 64) return slug;
  const cut = slug.slice(0, 64);
  const boundary = slug[64] === '-' ? 64 : cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '');
}
