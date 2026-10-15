/**
 * The Capabilities screen (desktop app/capabilities): the drawer's second nav
 * row. Read-only on the phone - it lists what the active profile has installed,
 * from the endpoints the desktop's page reads: skills (`/api/skills`), tools
 * (`/api/tools/toolsets`) and connectors (`/api/mcp/servers`). Toggling, editing
 * and the skills hub stay on the desktop.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen } from '../app/overlay.tsx';
import { errorText } from '../gateway/http.ts';
import { useTokens } from '../ui/tokens.ts';
import {
  categoryFor,
  filterServers,
  filterSkills,
  filterToolsets,
  PROVENANCE_LABEL,
  prettyName,
  serverTarget,
  toolsetLabel,
  visibleToolsetCount,
  type McpServerSummary,
  type SkillInfo,
  type ToolsetInfo,
} from './capabilities.ts';
import { useSettings } from './context.tsx';
import { ActionButton, Pill } from './primitives.tsx';

type Tab = 'skills' | 'toolsets' | 'connectors';

type ListRowItem =
  | { kind: 'skill'; key: string; skill: SkillInfo }
  | { kind: 'toolset'; key: string; toolset: ToolsetInfo }
  | { kind: 'server'; key: string; server: McpServerSummary };

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: T[] };

/** desktop `skills.*` and `connectorsPage.title` */
const COPY = {
  tabs: { skills: 'Skills', toolsets: 'Tools', connectors: 'Connectors' } satisfies Record<Tab, string>,
  searchSkills: 'Search skills...',
  searchToolsets: 'Search tools...',
  searchConnectors: 'Search connectors...',
  loading: 'Loading capabilities...',
  loadFailed: 'Skills failed to load',
  refresh: 'Refresh skills',
  noSkillsTitle: 'No skills found',
  noSkillsDesc: 'Try a broader search or different category.',
  noToolsetsTitle: 'No toolsets found',
  noToolsetsDesc: 'Try a broader search query.',
  noConnectors: 'No connectors configured.',
  noDescription: 'No description.',
  configured: 'Configured',
  needsKeys: 'Needs keys',
  usageCount: (n: number) => `used ${n}×`,
  nothingMatches: (query: string) => `Nothing matches “${query}”.`,
  readOnly: 'Changes to skills, tools and connectors are made on the desktop.',
};

function useList<T>(path: string, pick: (raw: unknown) => T[], profile: string) {
  const { controller } = useSettings();
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    controller.api
      .get<unknown>(path, { profile })
      .then((raw) => live && setState({ kind: 'ready', items: pick(raw) }))
      .catch((error: unknown) => live && setState({ kind: 'error', message: errorText(error) }));
    return () => {
      live = false;
    };
  }, [controller, path, profile, nonce]);
  return [state, useCallback(() => setNonce((n) => n + 1), [])] as const;
}

const asArray = <T,>(raw: unknown): T[] => (Array.isArray(raw) ? (raw as T[]) : []);
const pickSkills = (raw: unknown) => asArray<SkillInfo>(raw);
const pickToolsets = (raw: unknown) => asArray<ToolsetInfo>(raw);
const pickServers = (raw: unknown) => asArray<McpServerSummary>((raw as { servers?: unknown } | null)?.servers);

export default function CapabilitiesScreen({ onBack }: { onBack: () => void }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { snapshot } = useSettings();
  const [tab, setTab] = useState<Tab>('skills');
  const [query, setQuery] = useState('');
  const [skills, reloadSkills] = useList('/api/skills', pickSkills, snapshot.profile);
  const [toolsets, reloadToolsets] = useList('/api/tools/toolsets', pickToolsets, snapshot.profile);
  const [servers, reloadServers] = useList('/api/mcp/servers', pickServers, snapshot.profile);

  const active = tab === 'skills' ? skills : tab === 'toolsets' ? toolsets : servers;
  const reload = tab === 'skills' ? reloadSkills : tab === 'toolsets' ? reloadToolsets : reloadServers;
  const counts: Record<Tab, number | null> = {
    skills: skills.kind === 'ready' ? skills.items.length : null,
    toolsets: toolsets.kind === 'ready' ? visibleToolsetCount(toolsets.items) : null,
    connectors: servers.kind === 'ready' ? servers.items.length : null,
  };

  const rows = useMemo((): ListRowItem[] => {
    if (active.kind !== 'ready') return [];
    if (tab === 'skills') return filterSkills(skills.kind === 'ready' ? skills.items : [], query).map((s) => ({ kind: 'skill', key: `s:${s.name}`, skill: s }));
    if (tab === 'toolsets') return filterToolsets(toolsets.kind === 'ready' ? toolsets.items : [], query).map((s) => ({ kind: 'toolset', key: `t:${s.name}`, toolset: s }));
    return filterServers(servers.kind === 'ready' ? servers.items : [], query).map((s) => ({ kind: 'server', key: `m:${s.name}`, server: s }));
  }, [active.kind, tab, query, skills, toolsets, servers]);

  const placeholder = tab === 'skills' ? COPY.searchSkills : tab === 'toolsets' ? COPY.searchToolsets : COPY.searchConnectors;

  return (
    <OverlayScreen title="Capabilities" onBack={onBack}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(Object.keys(COPY.tabs) as Tab[]).map((value) => {
          const selected = value === tab;
          return (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.tab, selected && { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]}
            >
              <Text style={{ color: selected ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 13, fontWeight: '500' }}>{COPY.tabs[value]}</Text>
              {counts[value] !== null ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11 }}>{counts[value]}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        placeholderTextColor={t.uiTextQuaternary}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        accessibilityLabel={placeholder}
        style={[styles.search, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
      />
      {active.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={t.uiTextTertiary} />
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginTop: 8 }}>{COPY.loading}</Text>
        </View>
      ) : active.kind === 'error' ? (
        <View style={styles.center}>
          <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>{COPY.loadFailed}</Text>
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginVertical: 8, textAlign: 'center' }}>{active.message}</Text>
          <ActionButton label={COPY.refresh} icon="sync" variant="secondary" onPress={reload} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>
                {tab === 'skills' ? COPY.noSkillsTitle : tab === 'toolsets' ? COPY.noToolsetsTitle : COPY.noConnectors}
              </Text>
              <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginTop: 4, textAlign: 'center' }}>
                {query ? COPY.nothingMatches(query) : tab === 'skills' ? COPY.noSkillsDesc : tab === 'toolsets' ? COPY.noToolsetsDesc : ''}
              </Text>
            </View>
          }
          ListFooterComponent={rows.length ? <Text style={[styles.footer, { color: t.uiTextQuaternary }]}>{COPY.readOnly}</Text> : null}
          renderItem={({ item }) =>
            item.kind === 'skill' ? <SkillRow skill={item.skill} /> : item.kind === 'toolset' ? <ToolsetRow toolset={item.toolset} /> : <ServerRow server={item.server} />
          }
        />
      )}
    </OverlayScreen>
  );
}

function Row({ title, subtitle, badge, description, trailing }: { title: string; subtitle?: string; badge?: string; description?: string; trailing?: React.ReactNode }) {
  const t = useTokens();
  return (
    <View style={[styles.row, { borderBottomColor: t.uiStrokeQuaternary }]}>
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>
            {title}
          </Text>
          {badge ? <Pill>{badge}</Pill> : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
        {description ? (
          <Text numberOfLines={2} style={{ color: t.uiTextSecondary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight, marginTop: 4 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  const provenance = skill.provenance && skill.provenance !== 'bundled' ? PROVENANCE_LABEL[skill.provenance] : undefined;
  const usage = typeof skill.usage === 'number' && skill.usage > 0 ? ` · ${COPY.usageCount(skill.usage)}` : '';
  return (
    <Row
      title={skill.name}
      badge={provenance}
      subtitle={`${prettyName(categoryFor(skill))}${usage}`}
      description={skill.description || COPY.noDescription}
      trailing={skill.enabled ? null : <Pill>Off</Pill>}
    />
  );
}

function ToolsetRow({ toolset }: { toolset: ToolsetInfo }) {
  return (
    <Row
      title={toolsetLabel(toolset)}
      subtitle={toolset.configured ? COPY.configured : COPY.needsKeys}
      description={toolset.description || COPY.noDescription}
      trailing={toolset.enabled ? <Pill tone="success">On</Pill> : <Pill>Off</Pill>}
    />
  );
}

function ServerRow({ server }: { server: McpServerSummary }) {
  const tools = server.tools?.length ?? 0;
  return (
    <Row
      title={server.name}
      subtitle={`${server.transport}${tools ? ` · ${tools} ${tools === 1 ? 'tool' : 'tools'}` : ''}`}
      description={serverTarget(server)}
      trailing={server.enabled ? <Pill tone="success">On</Pill> : <Pill>Off</Pill>}
    />
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingTop: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 36 },
  search: { fontSize: 14, paddingHorizontal: 12, minHeight: 40, marginHorizontal: 12, marginVertical: 8 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: { fontSize: 11, textAlign: 'center', paddingVertical: 16 },
});
