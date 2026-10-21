/**
 * The BOTS tab, the bot roster (apps/desktop/src/plugins/hermes-bots/roster-pane-toolbar.tsx,
 * roster-pane-content.tsx): the "Bots" heading with its add button, the search field, a "Group chats"
 * section when any gateway-hosted rooms exist, the bot rows, and the hidden bots behind a disclosure.
 * No filters menu, mute bell or user-section management in v1 (issues #12, #17).
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { filterBots, type Bot } from '../bots/roster.ts';
import type { ChatController } from '../chat/controller.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';
import { useGroups } from '../groups/hooks.ts';
import type { GroupRow as GroupRowData, GroupsModel } from '../groups/model.ts';
import type { GroupRoom } from '../groups/rooms.ts';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { DisclosureCaret } from '../ui/motion.tsx';
import { tick } from '../ui/haptics.ts';
import { useTokens } from '../ui/tokens.ts';
import { usePullRefresh } from '../ui/usePullRefresh.tsx';
import { BotRow } from './BotRow.tsx';
import { GroupRow } from './GroupRow.tsx';
import { SearchField } from './chrome.tsx';
import type { Activities } from './dotStates.ts';
import { createBotsSlice } from './drawerSlices.ts';
import { updateFolds, useDrawerFolds } from './drawerState.ts';
import { SIDEBAR_INSET } from './rowGeometry.ts';
import { IDLE_ACTIVITY, resolveDotState } from './sessionStatus.ts';

type Props = {
  controller: ChatController;
  groups: GroupsModel;
  onOpenBot: (bot: Bot) => void;
  onBotActions: (bot: Bot) => void;
  onOpenGroup: (room: GroupRoom) => void;
  onGroupActions: (room: GroupRoom) => void;
  onAddPress: () => void;
  onRetryRoster: () => void;
  onRefresh: () => Promise<unknown>;
  loadImage: (name: string) => Promise<string | null>;
};

/** the canonical Bot Chat's status, the very session the row opens, so the dot and the tap never describe different chats */
function botState(activities: Activities, openKey: string, finishedAway: Readonly<Record<string, true>>, bot: Bot) {
  const key = bot.canonicalSessionId;
  return resolveDotState({
    activity: (key ? activities[key] : undefined) ?? IDLE_ACTIVITY,
    unread: key !== null && openKey !== key && finishedAway[key] === true,
    draft: key === null,
  });
}

/** a room matches a query by its name, its members' labels or its preview; search never re-ranks */
function matchesGroup(row: GroupRowData, query: string): boolean {
  if (row.room.name.toLowerCase().includes(query)) return true;
  if (row.preview.toLowerCase().includes(query)) return true;
  return row.room.members.some((member) => member.label.toLowerCase().includes(query));
}

/** `PanelEmpty`: a glyph, a title, a line of help */
function PanelEmpty({ icon, title, description, action }: { icon: CodiconName; title?: string; description: string; action?: ReactNode }) {
  const t = useTokens();
  return (
    <View style={styles.empty} accessibilityLiveRegion="polite">
      <Codicon name={icon} size={24} color={t.uiTextQuaternary} />
      {title ? <Text style={{ color: t.dtForeground, fontSize: 16, fontWeight: '500', opacity: 0.9 }}>{title}</Text> : null}
      <Text style={{ color: t.uiTextTertiary, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{description}</Text>
      {action}
    </View>
  );
}

/**
 * The pane subscribes to the roster and the groups itself, so while the drawer shows the Sessions tab
 * (this pane hidden in its `<Activity>`) it holds no subscription and re-renders for nothing.
 */
export const BotsPane = memo(function BotsPane({ controller, groups: model, onOpenBot, onBotActions, onOpenGroup, onGroupActions, onAddPress, onRetryRoster, onRefresh, loadImage }: Props) {
  const t = useTokens();
  const slice = useMemo(createBotsSlice, []);
  const snapshot = useChatSelector(controller, slice, shallowEqual);
  const groups = useGroups(model);
  const { hiddenBotsOpen } = useDrawerFolds();
  const [query, setQuery] = useState('');
  const now = Math.floor(Date.now() / 60_000) * 60;
  const { visible, hidden, loaded, loading, error, openKey, openingBot, finishedAway, activities, selected, thinking } = snapshot;
  const [pulling, setPulling] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const onPull = useCallback(() => {
    setPulling(true);
    void refreshRef.current().finally(() => setPulling(false));
  }, []);
  const pull = usePullRefresh({ refreshing: pulling || loading, onRefresh: onPull });
  const latest = useRef({ onOpenBot, onBotActions, onOpenGroup, onGroupActions });
  latest.current = { onOpenBot, onBotActions, onOpenGroup, onGroupActions };
  const open = useCallback((bot: Bot) => latest.current.onOpenBot(bot), []);
  const actions = useCallback((bot: Bot) => latest.current.onBotActions(bot), []);
  const openGroup = useCallback((room: GroupRoom) => latest.current.onOpenGroup(room), []);
  const groupActions = useCallback((room: GroupRoom) => latest.current.onGroupActions(room), []);
  const trimmed = query.trim();
  const queryLower = trimmed.toLowerCase();
  const shown = useMemo(() => filterBots(visible, query), [visible, query]);
  const shownHidden = useMemo(() => filterBots(hidden, query), [hidden, query]);
  const botsByName = useMemo(() => {
    const map: Record<string, Bot> = {};
    for (const bot of visible) map[bot.name] = bot;
    for (const bot of hidden) map[bot.name] = bot;
    return map;
  }, [visible, hidden]);
  const groupsExist = groups.rows.length > 0;
  const shownGroups = useMemo(() => (queryLower ? groups.rows.filter((row) => matchesGroup(row, queryLower)) : groups.rows), [groups.rows, queryLower]);
  const showGroupsSection = groupsExist && (queryLower === '' || shownGroups.length > 0);
  const gatewayUp = snapshot.link.kind === 'open';
  const empty = visible.length === 0 && hidden.length === 0;
  // every bot hidden and the disclosure closed: the list says so, with the way back (desktop `allBotsHidden`)
  const showAllHidden = visible.length === 0 && hidden.length > 0 && !hiddenBotsOpen && !trimmed;

  // the rows are elements memoised on what they paint: a chat's activity changing re-renders this pane but reuses them whole
  const renderBot = useCallback(
    (bot: Bot) => (
      <BotRow
        key={bot.name}
        bot={bot}
        now={now}
        selected={bot.name === selected}
        opening={bot.name === openingBot}
        thinking={bot.name === thinking}
        state={botState(activities, openKey, finishedAway, bot)}
        onOpen={open}
        onActions={actions}
        loadImage={loadImage}
      />
    ),
    [now, selected, openingBot, thinking, activities, openKey, finishedAway, open, actions, loadImage],
  );
  const shownRows = useMemo(() => shown.map(renderBot), [shown, renderBot]);
  const hiddenRows = useMemo(() => shownHidden.map(renderBot), [shownHidden, renderBot]);

  const renderGroup = useCallback(
    (row: GroupRowData) => <GroupRow key={row.room.id} row={row} now={now} bots={botsByName} onOpen={openGroup} onActions={groupActions} loadImage={loadImage} />,
    [now, botsByName, openGroup, groupActions, loadImage],
  );
  const groupRows = useMemo(() => shownGroups.map(renderGroup), [shownGroups, renderGroup]);

  const noMatch = loaded && trimmed.length > 0 && shown.length === 0 && shownHidden.length === 0 && !(groupsExist && shownGroups.length > 0);
  const searchPlaceholder = groupsExist ? 'Search bots and group chats…' : 'Search bots…';

  return (
    <View style={styles.pane}>
      <View style={styles.heading}>
        <Text style={[styles.headingLabel, { color: t.uiTextQuaternary }]}>Bots</Text>
        <Pressable
          onPress={onAddPress}
          accessibilityRole="button"
          accessibilityLabel="New bot or group chat"
          hitSlop={4}
          style={({ pressed }) => [styles.add, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
        >
          <Codicon name="add" size={18} color={t.uiTextTertiary} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <SearchField value={query} onChange={setQuery} placeholder={searchPlaceholder} rest={0.5} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={pull.refreshControl}
        onScroll={pull.track}
        scrollEventThrottle={16}
      >
        {pull.header}
        {error && !empty ? (
          <View style={[styles.stale, { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]} accessibilityLiveRegion="polite">
            <Text style={{ flex: 1, color: t.uiTextTertiary, fontSize: 13, lineHeight: 18 }}>
              {`Roster refresh failed — showing the last good list.${gatewayUp ? '' : ' Waiting for the gateway to reconnect…'}`}
            </Text>
            <Pressable onPress={onRetryRoster} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: t.uiAccent, fontSize: 13, fontWeight: '600' }}>Retry now</Text>
            </Pressable>
          </View>
        ) : null}

        {empty && !loaded && !error ? <GlyphSpinner size={14} color={t.uiTextTertiary} style={styles.loading} /> : null}

        {error && empty ? (
          <View style={styles.unavailable}>
            <Text style={{ color: t.uiTextTertiary, fontSize: 14, lineHeight: 20 }}>
              {gatewayUp
                ? `Roster unavailable: ${error}. If your gateway predates profiles.list, update Hermes and restart the gateway.`
                : 'Waiting for the gateway connection… (remote gateways can take a few seconds; retries automatically)'}
            </Text>
            <Pressable
              onPress={onRetryRoster}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'], opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: t.uiTextSecondary, fontSize: 14, fontWeight: '500' }}>Retry now</Text>
            </Pressable>
          </View>
        ) : null}

        {showGroupsSection ? (
          <View style={styles.groupSection}>
            <View style={styles.groupHeading}>
              <Text style={[styles.groupLabel, { color: t.uiTextQuaternary }]}>Group chats</Text>
              <Text style={[styles.groupCount, { color: t.uiTextQuaternary }]}>{shownGroups.length}</Text>
            </View>
            <View style={styles.rows}>{groupRows}</View>
          </View>
        ) : null}

        {loaded && !error && empty && !groupsExist ? <PanelEmpty icon="hubot" title="No bots yet" description="Create your first bot." /> : null}
        {noMatch ? <PanelEmpty icon="search" description={`No bots match “${trimmed}”`} /> : null}
        {showAllHidden ? (
          <PanelEmpty
            icon="eye-closed"
            title="All bots are hidden"
            description="They keep working and retain their history."
            action={
              <Pressable
                onPress={() => updateFolds({ hiddenBotsOpen: true })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retry, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'], opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={{ color: t.uiTextSecondary, fontSize: 14, fontWeight: '500' }}>Show hidden bots</Text>
              </Pressable>
            }
          />
        ) : null}

        <View style={styles.rows}>{shownRows}</View>

        {shownHidden.length > 0 && !showAllHidden ? (
          <View style={[styles.hidden, { borderTopColor: t.uiStrokeTertiary }]}>
            {trimmed ? (
              <View style={styles.hiddenToggle}>
                <Codicon name="eye-closed" size={14} color={t.uiTextTertiary} />
                <Text style={[styles.hiddenLabel, { color: t.uiTextTertiary }]}>Hidden</Text>
                <Text style={[styles.hiddenLabel, { color: t.uiTextQuaternary }]}>{shownHidden.length}</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  tick();
                  updateFolds({ hiddenBotsOpen: !hiddenBotsOpen });
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: hiddenBotsOpen }}
                style={({ pressed }) => [styles.hiddenToggle, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
              >
                <DisclosureCaret open={hiddenBotsOpen} size={14} color={t.uiTextTertiary} />
                <Text style={[styles.hiddenLabel, { color: t.uiTextTertiary }]}>Hidden</Text>
                <Text style={[styles.hiddenLabel, { color: t.uiTextQuaternary }]}>{shownHidden.length}</Text>
              </Pressable>
            )}
            {hiddenBotsOpen || trimmed ? <View style={styles.rows}>{hiddenRows}</View> : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  pane: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: SIDEBAR_INSET, paddingRight: 6, paddingTop: 8, paddingBottom: 2 },
  headingLabel: { fontSize: 12, lineHeight: 15, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { paddingHorizontal: SIDEBAR_INSET, paddingBottom: 6 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 6, paddingBottom: 8 },
  rows: { gap: 2 },
  groupSection: { marginBottom: 6 },
  groupHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingLeft: SIDEBAR_INSET - 6, paddingRight: 6, paddingTop: 6, paddingBottom: 4 },
  groupLabel: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  groupCount: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 40 },
  loading: { alignSelf: 'center', marginVertical: 24 },
  unavailable: { gap: 10, paddingHorizontal: 12, paddingVertical: 16 },
  retry: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  stale: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4 },
  hidden: { marginTop: 4, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  hiddenToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10 },
  hiddenLabel: { fontSize: 13, fontWeight: '500' },
});
