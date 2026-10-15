/**
 * Settings → Safety (desktop app/settings: the `safety` section of SECTIONS in
 * constants.ts, its three child pages in config-subpages.ts, and the
 * `ConfigField` rows). The desktop autosaves a diff of the profile's config over
 * `PUT /api/config`, which deep-merges onto disk; the phone sends the one changed
 * key the same way. Pure helpers only, so the payloads can be tested.
 */

export type ApprovalMode = 'manual' | 'smart' | 'off';

/** desktop ENUM_OPTIONS['approvals.mode'], labelled as `prettyName` does */
export const APPROVAL_MODES: readonly { id: ApprovalMode; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'smart', label: 'Smart' },
  { id: 'off', label: 'Off' },
];

/** `tools/approval_context._normalize_approval_mode`: YAML parses a bare `off` as false */
export function normalizeApprovalMode(raw: unknown): ApprovalMode {
  if (raw === false) return 'off';
  if (typeof raw === 'string') {
    const mode = raw.trim().toLowerCase();
    if (mode === 'manual' || mode === 'smart' || mode === 'off') return mode;
  }
  return 'manual';
}

export type SafetyKey =
  | 'approvals.mode'
  | 'approvals.timeout'
  | 'approvals.mcp_reload_confirm'
  | 'command_allowlist'
  | 'security.redact_secrets'
  | 'security.allow_private_urls'
  | 'checkpoints.enabled';

/** desktop FIELD_LABELS and FIELD_DESCRIPTIONS; the keys the desktop has no description for are described from config_defaults.py */
export const SAFETY_COPY: Record<SafetyKey, { label: string; description: string }> = {
  'approvals.mode': { label: 'Approval Mode', description: 'How Hermes handles commands that need explicit approval.' },
  'approvals.timeout': { label: 'Approval Timeout', description: 'How long approval prompts wait before timing out.' },
  'approvals.mcp_reload_confirm': {
    label: 'Confirm MCP Reloads',
    description: 'Ask before /reload-mcp rebuilds the MCP tool set. A reload invalidates the prompt cache, so the next message re-sends the full input.',
  },
  command_allowlist: {
    label: 'Command Allowlist',
    description: 'Dangerous commands you chose to always allow. Hermes does not ask again for these.',
  },
  'security.redact_secrets': { label: 'Redact Secrets', description: 'Hide detected secrets from model-visible content when possible.' },
  'security.allow_private_urls': {
    label: 'Allow Private URLs',
    description: 'Let tools fetch private and internal addresses (localhost, 192.168.x.x, VPNs).',
  },
  'checkpoints.enabled': { label: 'File Checkpoints', description: 'Create rollback snapshots before file edits.' },
};

/** desktop CONFIG_SUBPAGES.safety, each page with the keys SECTIONS lists for it */
export const SAFETY_GROUPS: readonly { id: 'approvals' | 'privacy' | 'checkpoints'; title: string; keys: readonly SafetyKey[] }[] = [
  { id: 'approvals', title: 'Approvals', keys: ['approvals.mode', 'approvals.timeout', 'approvals.mcp_reload_confirm', 'command_allowlist'] },
  { id: 'privacy', title: 'Privacy & network', keys: ['security.redact_secrets', 'security.allow_private_urls'] },
  { id: 'checkpoints', title: 'Checkpoints', keys: ['checkpoints.enabled'] },
];

/** the server's defaults (hermes_cli/config_defaults.py), used while a key is absent from the config */
export const SAFETY_DEFAULTS = {
  approvalMode: 'manual' as ApprovalMode,
  approvalTimeout: 300,
  mcpReloadConfirm: true,
  allowlist: [] as string[],
  redactSecrets: true,
  allowPrivateUrls: false,
  checkpoints: false,
};

export type SafetyValues = {
  approvalMode: ApprovalMode;
  approvalTimeout: number;
  mcpReloadConfirm: boolean;
  allowlist: string[];
  redactSecrets: boolean;
  allowPrivateUrls: boolean;
  checkpoints: boolean;
};

export type ConfigRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ConfigRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

/** the desktop's `getNested` over a dotted key */
export function readPath(config: ConfigRecord, path: string): unknown {
  let current: unknown = config;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function readAllowlist(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  // the server recovers a legacy bare string the same way
  return typeof raw === 'string' && raw.trim() !== '' ? [raw.trim()] : [];
}

export function readSafety(config: ConfigRecord): SafetyValues {
  const timeout = readPath(config, 'approvals.timeout');
  return {
    approvalMode: normalizeApprovalMode(readPath(config, 'approvals.mode')),
    approvalTimeout: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : SAFETY_DEFAULTS.approvalTimeout,
    mcpReloadConfirm: bool(readPath(config, 'approvals.mcp_reload_confirm'), SAFETY_DEFAULTS.mcpReloadConfirm),
    allowlist: readAllowlist(readPath(config, 'command_allowlist')),
    redactSecrets: bool(readPath(config, 'security.redact_secrets'), SAFETY_DEFAULTS.redactSecrets),
    allowPrivateUrls: bool(readPath(config, 'security.allow_private_urls'), SAFETY_DEFAULTS.allowPrivateUrls),
    checkpoints: bool(readPath(config, 'checkpoints.enabled'), SAFETY_DEFAULTS.checkpoints),
  };
}

/** `setNested` for one key, as the sparse patch the desktop's `diffConfig` would produce */
export function configPatch(path: string, value: unknown): ConfigRecord {
  const parts = path.split('.');
  return parts.reduceRight<unknown>((inner, part) => ({ [part]: inner }), value) as ConfigRecord;
}

/** the body of `PUT /api/config` */
export function saveBody(path: string, value: unknown): { config: ConfigRecord } {
  return { config: configPatch(path, value) };
}

/** a whole number of seconds, or null for anything that is not one */
export function parseTimeout(draft: string): number | null {
  const text = draft.trim();
  if (!/^\d+$/.test(text)) return null;
  const seconds = Number(text);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function allowlistWith(list: readonly string[], entry: string): string[] {
  const next = entry.trim();
  return next === '' || list.includes(next) ? [...list] : [...list, next];
}

export function allowlistWithout(list: readonly string[], entry: string): string[] {
  return list.filter((item) => item !== entry);
}

/** the timeout in words, for the row's value line: `300` → `5 min`, `90` → `1 min 30 s` */
export function describeTimeout(seconds: number): string {
  if (seconds <= 0) return '0 s';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** `display.message_reactions` over `config.set`: the gateway takes the toggle as the word `true` or `false` */
export function reactionsParams(enabled: boolean, profile: string): { key: string; value: string; profile: string } {
  return { key: 'display.message_reactions', value: enabled ? 'true' : 'false', profile };
}
