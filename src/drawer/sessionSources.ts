/**
 * Which sessions are local and which belong to an external messaging platform, and how a platform
 * reads (apps/desktop/src/lib/session-source.ts, app/messaging/platform-icon.tsx).
 */

const SOURCE_LABELS: Record<string, string> = {
  acp: 'ACP',
  api_server: 'API',
  bluebubbles: 'iMessage',
  cli: 'CLI',
  codex: 'Codex',
  desktop: 'Desktop',
  discord: 'Discord',
  email: 'Email',
  gateway: 'Gateway',
  kanban: 'Kanban',
  local: 'Local',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  oneshot: 'One-shot',
  photon: 'Photon',
  qqbot: 'QQ',
  signal: 'Signal',
  slack: 'Slack',
  sms: 'SMS',
  telegram: 'Telegram',
  tui: 'TUI',
  webhook: 'Webhook',
  weixin: 'WeChat',
  whatsapp: 'WhatsApp',
  yuanbao: 'Yuanbao',
};

const SOURCE_ALIASES: Record<string, string[]> = {
  bluebubbles: ['apple messages', 'imessage'],
  photon: ['imessage', 'messages'],
  cli: ['terminal'],
  desktop: ['app', 'gui'],
  local: ['machine'],
  qqbot: ['qq'],
  telegram: ['tg'],
  tui: ['terminal'],
  weixin: ['wechat'],
  whatsapp: ['wa'],
};

/** sources that run on the machine rather than on a messaging platform (desktop `LOCAL_SESSION_SOURCE_IDS`) */
export const LOCAL_SESSION_SOURCE_IDS = ['acp', 'cli', 'codex', 'desktop', 'gateway', 'kanban', 'local', 'oneshot', 'tui'];

/** the external platforms that each get their own section (desktop `MESSAGING_SESSION_SOURCE_IDS`) */
export const MESSAGING_SESSION_SOURCE_IDS = [
  'telegram',
  'discord',
  'slack',
  'mattermost',
  'matrix',
  'signal',
  'whatsapp',
  'bluebubbles',
  'photon',
  'homeassistant',
  'email',
  'sms',
  'webhook',
  'api_server',
  'weixin',
  'wecom',
  'qqbot',
  'yuanbao',
  'dingtalk',
  'feishu',
];

/** desktop `SIDEBAR_EXCLUDED_SOURCES`: the recents list is local-only; cron, kanban, one-shot and tool runs are not conversations */
export const RECENTS_EXCLUDED_SOURCES = ['acp', 'cron', 'kanban', 'oneshot', 'subagent', 'tool', ...MESSAGING_SESSION_SOURCE_IDS];

/** desktop `MESSAGING_EXCLUDED_SOURCES`: the messaging slice is the inverse of the recents one */
export const MESSAGING_EXCLUDED_SOURCES = ['cron', ...LOCAL_SESSION_SOURCE_IDS];

const MESSAGING_IDS = new Set(MESSAGING_SESSION_SOURCE_IDS);

export const normalizeSessionSource = (source: string | null | undefined): string | null => (source ?? '').trim().toLowerCase() || null;

export const isMessagingSource = (source: string | null | undefined) => {
  const id = normalizeSessionSource(source);
  return id !== null && MESSAGING_IDS.has(id);
};

export function sessionSourceLabel(source: string | null | undefined): string | null {
  const id = normalizeSessionSource(source);
  if (!id) return null;
  return SOURCE_LABELS[id] || id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sessionSourceSearchTerms(source: string | null | undefined): string[] {
  const id = normalizeSessionSource(source);
  if (!id) return [];
  return [id, sessionSourceLabel(id) ?? '', ...(SOURCE_ALIASES[id] ?? [])].filter(Boolean);
}

/** each platform's brand colour, for the monogram chip (the desktop's own fallback where it has no mark) */
const PLATFORM_COLORS: Record<string, string> = {
  telegram: '#26A5E4',
  discord: '#5865F2',
  slack: '#4A154B',
  mattermost: '#0058CC',
  matrix: '#000000',
  signal: '#3A76F0',
  whatsapp: '#25D366',
  bluebubbles: '#0BD318',
  photon: '#6366F1',
  homeassistant: '#18BCF2',
  email: '#EA4335',
  sms: '#F43F5E',
  webhook: '#71717A',
  api_server: '#64748B',
  weixin: '#07C160',
  qqbot: '#EB1923',
  yuanbao: '#FB7299',
};

export const platformColor = (id: string): string | null => PLATFORM_COLORS[id] ?? null;
