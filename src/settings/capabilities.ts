/**
 * The Capabilities screen's pure half (desktop app/capabilities): the installed
 * skills (`GET /api/skills`), the toolsets (`GET /api/tools/toolsets`) and the
 * configured MCP servers (`GET /api/mcp/servers`) the page's Skills, Tools and
 * Connectors tabs list. Read-only on the phone; filtering and ordering match the
 * desktop's skills-data.ts and toolsets-data.ts.
 */

export type SkillInfo = {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  usage?: number;
  provenance?: 'agent' | 'bundled' | 'external' | 'hub';
};

export type ToolsetInfo = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
};

export type McpServerSummary = {
  name: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  tools: string[] | null;
};

/** desktop `skills.provenance`, plus the subtitle badges the row shows */
export const PROVENANCE_LABEL: Record<NonNullable<SkillInfo['provenance']>, string> = {
  agent: 'Learned',
  bundled: 'Built-in',
  hub: 'Hub',
  external: 'External',
};

/** desktop `DESKTOP_HIDDEN_TOOLSETS`: platform-coupled and internal toolsets are not user toggles */
const HIDDEN_TOOLSETS = new Set(['discord', 'discord_admin', 'yuanbao', 'context_engine', 'moa']);

export const isToolsetVisible = (name: string) => !HIDDEN_TOOLSETS.has(name);

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const normalize = (value: string) => value.trim().toLowerCase();
const includes = (haystack: unknown, query: string) => normalize(asText(haystack)).includes(query);

export const categoryFor = (skill: SkillInfo): string => asText(skill.category).trim() || 'general';

/** `data-science` reads as `Data Science` */
export function prettyName(name: string): string {
  return name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const usageOf = (skill: SkillInfo) => (typeof skill.usage === 'number' ? skill.usage : 0);

/** most used first, then A–Z */
export function filterSkills(skills: readonly SkillInfo[], query: string): SkillInfo[] {
  const q = normalize(query);
  return skills
    .filter((s) => !q || includes(s.name, q) || includes(s.description, q) || includes(s.category, q))
    .sort((a, b) => usageOf(b) - usageOf(a) || asText(a.name).localeCompare(asText(b.name)));
}

export function toolsetLabel(toolset: ToolsetInfo): string {
  return asText(toolset.label).trim() || prettyName(asText(toolset.name));
}

const toolNames = (toolset: ToolsetInfo) => (Array.isArray(toolset.tools) ? toolset.tools.map(asText).filter(Boolean) : []);

export function filterToolsets(toolsets: readonly ToolsetInfo[], query: string): ToolsetInfo[] {
  const q = normalize(query);
  return toolsets
    .filter((t) => isToolsetVisible(t.name))
    .filter((t) => !q || includes(t.name, q) || includes(toolsetLabel(t), q) || includes(t.description, q) || toolNames(t).some((n) => includes(n, q)))
    .sort((a, b) => toolsetLabel(a).localeCompare(toolsetLabel(b)));
}

export const visibleToolsetCount = (toolsets: readonly ToolsetInfo[]) => toolsets.filter((t) => isToolsetVisible(t.name)).length;

export function filterServers(servers: readonly McpServerSummary[], query: string): McpServerSummary[] {
  const q = normalize(query);
  return servers
    .filter((s) => !q || includes(s.name, q) || includes(s.transport, q) || includes(s.url, q) || includes(s.command, q))
    .sort((a, b) => asText(a.name).localeCompare(asText(b.name)));
}

/** where a server lives: its URL, or the command that starts it */
export function serverTarget(server: McpServerSummary): string {
  if (server.url) return server.url;
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
}
