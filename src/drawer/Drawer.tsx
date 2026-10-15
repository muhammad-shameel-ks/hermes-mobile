/**
 * The slide-over drawer (issue "App shell and navigation on a phone"): opened only
 * by the app-bar button, closed by the scrim, back, or picking a row. A SESSIONS |
 * BOTS switch over the two lists, and a footer of chips for the connection, the
 * active profile and signing out.
 */

import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useOverlay } from '../app/overlay.tsx';
import { BotAvatar } from '../bots/BotAvatar.tsx';
import { compactAge, filterBots, type Bot } from '../bots/roster.ts';
import type { ChatSnapshot, SessionInfo } from '../chat/controller.ts';
import { FileGlyph } from '../files/glyphs.tsx';
import { openFiles } from '../files/open.tsx';
import type { LinkState } from '../gateway/link.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';

export type DrawerTab = 'sessions' | 'bots';

type Props = {
  open: boolean;
  onClose: () => void;
  snapshot: ChatSnapshot;
  connectionLabel: string;
  profileLabel: string;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onNewSession: () => void;
  onOpenSession: (session: SessionInfo) => void;
  onOpenBot: (bot: Bot) => void;
  onBotActions: (bot: Bot) => void;
  onNewBot: () => void;
  onProfileChip: () => void;
  onSignOut: () => void;
  loadImage: (name: string) => Promise<string | null>;
};

const DURATION = 220;

export default function Drawer(props: Props) {
  const { open, onClose } = props;
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(Math.round(screenWidth * 0.84), 320);
  const progress = useSharedValue(open ? 1 : 0);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    progress.value = withTiming(open ? 1 : 0, { duration: DURATION, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished && !open) runOnJS(setMounted)(false);
    });
  }, [open, progress]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close drawer" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width,
            backgroundColor: t.uiBgSidebar,
            borderRightColor: t.uiStrokeSecondary,
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 8,
          },
          panelStyle,
        ]}
        accessibilityViewIsModal
      >
        <Segmented t={t} tab={props.tab} onTab={props.onTab} />
        {props.tab === 'sessions' ? <SessionsPane {...props} t={t} /> : <BotsPane {...props} t={t} />}
        <Footer t={t} link={props.snapshot.link} connectionLabel={props.connectionLabel} profileLabel={props.profileLabel} onProfileChip={props.onProfileChip} onSignOut={props.onSignOut} />
      </Animated.View>
    </View>
  );
}

function Segmented({ t, tab, onTab }: { t: Tokens; tab: DrawerTab; onTab: (tab: DrawerTab) => void }) {
  return (
    <View style={[styles.segmented, { borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]} accessibilityRole="tablist">
      {(['sessions', 'bots'] as const).map((value) => {
        const active = value === tab;
        return (
          <Pressable
            key={value}
            onPress={() => onTab(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]}
          >
            <Text style={{ color: active ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.6 }}>
              {value === 'sessions' ? 'SESSIONS' : 'BOTS'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SearchField({ t, value, onChange, placeholder }: { t: Tokens; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={[styles.search, { backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}>
      <Svg width={13} height={13} viewBox="0 0 16 16">
        <Path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm3.6-1.4L14 14" stroke={t.uiTextQuaternary} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      </Svg>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.uiTextQuaternary}
        style={[styles.searchInput, { color: t.uiTextPrimary }]}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

function SectionLabel({ t, children }: { t: Tokens; children: string }) {
  return <Text style={[styles.section, { color: t.uiTextQuaternary }]}>{children}</Text>;
}

function NavRow({ t, label, onPress, icon }: { t: Tokens; label: string; onPress: () => void; icon: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
    >
      <View style={styles.lead}>{icon}</View>
      <Text style={{ color: t.uiTextSecondary, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const sessionTime = (s: SessionInfo) => s.last_active || s.started_at;

function SessionsPane({ t, snapshot, onClose, onNewSession, onOpenSession }: Props & { t: Tokens }) {
  const overlay = useOverlay();
  const [query, setQuery] = useState('');
  const now = Math.floor(Date.now() / 1000);
  const { items, loading, error } = snapshot.sessions;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((s) => `${s.title ?? ''} ${s.preview ?? ''}`.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const pinned = filtered.filter((s) => s.pinned);
  const rest = filtered.filter((s) => !s.pinned);

  const row = (session: SessionInfo) => {
    const active = snapshot.openKey === session.id;
    const running = snapshot.entries[session.id]?.transcript.running === true;
    return (
      <Pressable
        key={session.id}
        onPress={() => onOpenSession(session)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.row,
          { borderRadius: t.radius.md },
          (active || pressed) && { backgroundColor: t.uiRowActiveBackground },
        ]}
      >
        <View style={styles.lead}>
          <View style={[styles.dot, { backgroundColor: running ? t.uiAccent : active ? t.uiTextTertiary : t.uiStrokePrimary }]} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: active ? t.uiTextPrimary : t.uiTextSecondary, fontSize: 13 }}>
          {session.title || session.preview || 'Untitled session'}
        </Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 10, marginLeft: 6 }}>{compactAge(sessionTime(session), now)}</Text>
      </Pressable>
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <NavRow
        t={t}
        label="New session"
        onPress={onNewSession}
        icon={
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Path d="M7 2.5v9M2.5 7h9" stroke={t.uiTextSecondary} strokeWidth={1.5} strokeLinecap="round" />
          </Svg>
        }
      />
      <NavRow
        t={t}
        label="Files"
        onPress={() => {
          onClose();
          openFiles(overlay);
        }}
        icon={<FileGlyph name="folder" size={14} color={t.uiTextSecondary} />}
      />
      <SearchField t={t} value={query} onChange={setQuery} placeholder="Search sessions…" />
      {pinned.length ? <SectionLabel t={t}>PINNED</SectionLabel> : null}
      {pinned.map(row)}
      <SectionLabel t={t}>SESSIONS</SectionLabel>
      {rest.map(row)}
      {!loading && !error && filtered.length === 0 ? (
        <Text style={[styles.emptyText, { color: t.uiTextTertiary }]}>{query ? 'No sessions match.' : 'No sessions yet.'}</Text>
      ) : null}
      {error ? <Text style={[styles.emptyText, { color: t.dtDestructive }]}>{error}</Text> : null}
    </ScrollView>
  );
}

function BotRow({ t, bot, now, selected, onPress, onLongPress, loadImage }: { t: Tokens; bot: Bot; now: number; selected: boolean; onPress: () => void; onLongPress: () => void; loadImage: (name: string) => Promise<string | null> }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityHint="Long press for more actions"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.botRow, { borderRadius: t.radius['2xl'] }, (selected || pressed) && { backgroundColor: t.uiRowActiveBackground }]}
    >
      <View>
        <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={34} loadImage={loadImage} />
        {bot.active ? <View style={[styles.activeDot, { backgroundColor: t.uiSuccess, borderColor: t.uiBgSidebar }]} /> : null}
      </View>
      <View style={styles.botText}>
        <View style={styles.botTitleLine}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.uiTextPrimary, fontSize: 13, fontWeight: '600' }}>
            {bot.label}
          </Text>
          {bot.pinned ? (
            <Svg width={10} height={10} viewBox="0 0 16 16" style={{ marginRight: 4 }}>
              <Path d="M9.5 1.5 14.5 6.5 12 7.3 9 10.3 9.5 13.5 2.5 6.5 5.7 7 8.7 4Z" fill={t.uiTextQuaternary} />
            </Svg>
          ) : null}
          <Text style={{ color: t.uiTextTertiary, fontSize: 10 }}>{compactAge(bot.lastActive, now)}</Text>
        </View>
        <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }}>
          {bot.preview || bot.description || 'No messages yet'}
        </Text>
      </View>
    </Pressable>
  );
}

function BotsPane({ t, snapshot, onOpenBot, onBotActions, onNewBot, loadImage }: Props & { t: Tokens }) {
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const now = Math.floor(Date.now() / 1000);
  const { visible, hidden, loaded, error } = snapshot.roster;
  const shown = filterBots(visible, query);
  const shownHidden = filterBots(hidden, query);
  const selectedBot = snapshot.entries[snapshot.openKey]?.isBotChat ? snapshot.entries[snapshot.openKey]?.bot : null;

  const renderBot = (bot: Bot) => (
    <BotRow
      key={bot.name}
      t={t}
      bot={bot}
      now={now}
      selected={bot.name === selectedBot}
      onPress={() => onOpenBot(bot)}
      onLongPress={() => onBotActions(bot)}
      loadImage={loadImage}
    />
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.botsHeader}>
        <View style={{ flex: 1 }}>
          <SearchField t={t} value={query} onChange={setQuery} placeholder="Search bots…" />
        </View>
        <Pressable
          onPress={onNewBot}
          accessibilityRole="button"
          accessibilityLabel="New bot"
          hitSlop={6}
          style={({ pressed }) => [styles.plus, { backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }, pressed && { opacity: 0.6 }]}
        >
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Path d="M7 2.5v9M2.5 7h9" stroke={t.uiTextSecondary} strokeWidth={1.6} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
      {shown.map(renderBot)}
      {loaded && visible.length === 0 && hidden.length === 0 ? (
        <View style={styles.rosterEmpty}>
          <Text style={{ color: t.uiTextSecondary, fontSize: 13, fontWeight: '600' }}>No bots yet</Text>
          <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 4 }}>Create your first bot.</Text>
        </View>
      ) : null}
      {loaded && query && shown.length === 0 && shownHidden.length === 0 ? (
        <Text style={[styles.emptyText, { color: t.uiTextTertiary }]}>No bots match.</Text>
      ) : null}
      {shownHidden.length ? (
        <>
          <Pressable
            onPress={() => setShowHidden((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            style={styles.hiddenToggle}
          >
            <Text style={{ color: t.uiTextTertiary, fontSize: 11, width: 12 }}>{showHidden ? '▾' : '▸'}</Text>
            <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>{`Show hidden bots (${shownHidden.length})`}</Text>
          </Pressable>
          {showHidden ? shownHidden.map(renderBot) : null}
        </>
      ) : null}
      {error ? <Text style={[styles.emptyText, { color: t.dtDestructive }]}>{error}</Text> : null}
    </ScrollView>
  );
}

function Footer({ t, link, connectionLabel, profileLabel, onProfileChip, onSignOut }: { t: Tokens; link: LinkState; connectionLabel: string; profileLabel: string; onProfileChip: () => void; onSignOut: () => void }) {
  const healthy = link.kind === 'open';
  const chip = [styles.chip, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'] }];
  return (
    <View style={[styles.footer, { borderTopColor: t.uiStrokeQuaternary }]}>
      <View style={chip} accessibilityLabel={`Gateway ${connectionLabel}, ${healthy ? 'connected' : 'not connected'}`}>
        <View style={[styles.dot, { backgroundColor: healthy ? t.uiSuccess : link.kind === 'connecting' ? t.uiTextTertiary : t.dtDestructive }]} />
        <Text numberOfLines={1} style={[styles.chipText, { color: t.uiTextSecondary, fontFamily: MONO, maxWidth: 120 }]}>
          {connectionLabel}
        </Text>
      </View>
      <Pressable onPress={onProfileChip} accessibilityRole="button" accessibilityLabel={`Active profile ${profileLabel}`} style={({ pressed }) => [...chip, pressed && { opacity: 0.6 }]}>
        <Text numberOfLines={1} style={[styles.chipText, { color: t.uiTextSecondary, maxWidth: 90 }]}>
          {profileLabel}
        </Text>
      </Pressable>
      <Pressable onPress={onSignOut} accessibilityRole="button" style={({ pressed }) => [...chip, pressed && { opacity: 0.6 }]}>
        <Text style={[styles.chipText, { color: t.uiTextTertiary }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  segmented: { flexDirection: 'row', marginHorizontal: 10, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, padding: 2 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 30 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 8, paddingBottom: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 34, marginVertical: 6 },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 6 },
  section: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, marginTop: 12, marginBottom: 4, marginLeft: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 8, gap: 6, marginBottom: 1 },
  lead: { width: 14, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  emptyText: { fontSize: 12, marginHorizontal: 8, marginTop: 8 },
  botsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plus: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 1 },
  activeDot: { position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  botText: { flex: 1, minWidth: 0 },
  botTitleLine: { flexDirection: 'row', alignItems: 'center' },
  rosterEmpty: { alignItems: 'center', paddingVertical: 24 },
  hiddenToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 8, marginTop: 8 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28 },
  chipText: { fontSize: 11 },
});
