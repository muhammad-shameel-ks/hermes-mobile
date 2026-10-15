/**
 * The chat root: app bar, transcript and composer for whichever chat is open.
 *
 * assistant-ui's FlatList owns stick-to-bottom (issue "Transcript and composer
 * parity on touch") and a floating pill jumps back to it; our transcript stays
 * the source of truth - the external store runtime only mirrors it, and each
 * row renders our own message by id.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react-native';

import { BotAvatar } from '../bots/BotAvatar.tsx';
import { faceMood } from '../bots/face.ts';
import { BOT_CHAT_EMPTY, type Bot } from '../bots/roster.ts';
import type { LinkState } from '../gateway/link.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import { Wordmark } from '../ui/Wordmark.tsx';
import type { ChatController, ChatEntry, ModelCatalog } from './controller.ts';
import { FOLLOW_UP_PLACEHOLDERS, introBody, NEW_SESSION_PLACEHOLDERS } from './intro.ts';
import { MessageView } from './MessageView.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { modelPillLabel, type ModelSelection } from './models.ts';
import { ScrollToBottomButton } from './ScrollToBottomButton.tsx';
import type { Message } from './transcript.ts';
import { useJumpToBottom } from './useJumpToBottom.tsx';

const SIDE_INSET = 24;
/** the composer dock's top padding: the picker sits on the surface, not the dock */
const COMPOSER_DOCK_TOP = 6;

function convertMessage(message: Message): ThreadMessageLike {
  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n');
  const base = { id: message.id, role: message.role, content: [{ type: 'text' as const, text }] };
  if (message.role !== 'assistant') return base;
  const status: ThreadMessageLike['status'] =
    message.status === 'streaming'
      ? { type: 'running' }
      : message.status === 'error'
        ? { type: 'incomplete', reason: 'error' }
        : message.status === 'interrupted'
          ? { type: 'incomplete', reason: 'cancelled' }
          : { type: 'complete', reason: 'stop' };
  return { ...base, status };
}

type Props = {
  controller: ChatController;
  entry: ChatEntry;
  link: LinkState;
  bot: Bot | null;
  profileLabel: string;
  opening: boolean;
  models: ModelCatalog;
  currentModel: ModelSelection | null;
  personality: string;
  onOpenDrawer: () => void;
  onProfile: () => void;
};

const WORDMARK = 'HERMES AGENT';
const BOT_FACE = 96;
const BOT_FACE_GAP = 16;

export default function ChatScreen({
  controller,
  entry,
  link,
  bot,
  profileLabel,
  opening,
  models,
  currentModel,
  personality,
  onOpenDrawer,
  onProfile,
}: Props) {
  const t = useTokens();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dock, setDock] = useState({ top: 0, height: 0 });
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const { messages, running } = entry.transcript;

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const onNew = useCallback(
    async (append: AppendMessage) => {
      const text = append.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
      await controller.send(text);
    },
    [controller],
  );
  const runtime = useExternalStoreRuntime({ messages, isRunning: running, convertMessage, onNew });
  const jump = useJumpToBottom(entry.key, messages);

  const title = entry.isBotChat && bot ? bot.label : entry.title || (entry.key === 'draft' ? 'New session' : 'Untitled session');
  // the registry's "Bot Chat" title is plumbing, not chrome: a bot's app bar is its face and name
  const subtitle = entry.isBotChat ? null : profileLabel;
  const avatar =
    entry.isBotChat && bot ? (
      <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={28} loadImage={controller.avatarDataFn} mood={faceMood(running, bot.working)} />
    ) : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground }]}>
      <View style={styles.root}>
        <AppBar t={t} title={title} subtitle={subtitle} avatar={avatar} onOpenDrawer={onOpenDrawer} onNewChat={() => controller.newChat()} />
        <LinkBanner link={link} onRetry={() => controller.retryLink()} />

        <AssistantRuntimeProvider runtime={runtime}>
          <View style={styles.body}>
            {messages.length === 0 ? (
              <EmptyState t={t} entry={entry} bot={bot} opening={opening} personality={personality} loadImage={controller.avatarDataFn} />
            ) : (
              <View style={styles.list}>
                <ThreadPrimitive.MessagesFlatList
                  ref={jump.listRef}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  keyboardDismissMode="interactive"
                  keyboardShouldPersistTaps="handled"
                  CellRendererComponent={jump.Cell}
                  onScroll={jump.onScroll}
                  onScrollBeginDrag={jump.onDrag}
                  onContentSizeChange={jump.onContentSize}
                >
                  {({ message }) => {
                    const ours = byId.get(message.id);
                    return ours ? (
                      <View style={styles.row}>
                        <MessageView message={ours} />
                      </View>
                    ) : null;
                  }}
                </ThreadPrimitive.MessagesFlatList>
                <ScrollToBottomButton visible={jump.visible} count={jump.count} onPress={jump.toBottom} />
              </View>
            )}
            {running ? <RunStatus t={t} status={entry.transcript.status} /> : null}
          </View>
        </AssistantRuntimeProvider>

        <View
          onLayout={(e) => {
            const { y, height } = e.nativeEvent.layout;
            setDock({ top: y, height });
          }}
        >
          <Composer
            t={t}
            running={running}
            disabled={link.kind !== 'open' || entry.loading}
            botLabel={entry.isBotChat && bot ? bot.label : null}
            followUp={messages.length > 0}
            modelLabel={modelPillLabel(currentModel?.model)}
            onSend={(text) => void controller.send(text)}
            onStop={() => void controller.stop()}
            onAttach={() => controller.notify('Attachments are not on the phone yet.')}
            onModelPicker={() => {
              setPickerOpen(true);
              if (!models.providers.length || models.error) void controller.refreshModels();
            }}
          />
          <StatusRow t={t} link={link} profileLabel={profileLabel} onProfile={onProfile} />
        </View>

        <ModelPicker
          visible={pickerOpen}
          bottom={dock.height - COMPOSER_DOCK_TOP}
          available={dock.top - 56}
          catalog={models}
          current={currentModel}
          onClose={closePicker}
          onRefresh={() => void controller.refreshModels(true)}
          onSelect={(selection, options) => controller.selectModel(selection, options)}
          onEffort={(effort) => void controller.setEffort(effort)}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

function AppBar({
  t,
  title,
  subtitle,
  avatar,
  onOpenDrawer,
  onNewChat,
}: {
  t: Tokens;
  title: string;
  subtitle: string | null;
  avatar: ReactNode;
  onOpenDrawer: () => void;
  onNewChat: () => void;
}) {
  const stroke = t.uiTextSecondary;
  return (
    <View style={[styles.appBar, { borderBottomColor: t.uiStrokeQuaternary }]}>
      <IconButton label="Open sessions and bots" onPress={onOpenDrawer}>
        <Svg width={20} height={20} viewBox="0 0 20 20">
          <Path d="M3 5.5h14M3 10h14M3 14.5h9" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </IconButton>
      <View style={styles.titleBlock}>
        <View style={styles.titleLine}>
          {avatar}
          <Text numberOfLines={1} style={{ flexShrink: 1, color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: 11 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <IconButton label="New session" onPress={onNewChat}>
        <Svg width={20} height={20} viewBox="0 0 20 20">
          <Path
            d="M10.5 3.5H5.2A1.7 1.7 0 0 0 3.5 5.2v9.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V9.5M14.6 3.1a1.4 1.4 0 0 1 2 2L10 11.7l-2.6.6.6-2.6 6.6-6.6Z"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </IconButton>
    </View>
  );
}

function LinkBanner({ link, onRetry }: { link: LinkState; onRetry: () => void }) {
  const t = useTokens();
  if (link.kind === 'open' || link.kind === 'paused' || link.kind === 'signed-out') return null;
  const text =
    link.kind === 'connecting'
      ? 'Connecting to the gateway…'
      : link.kind === 'waiting'
        ? 'Connection lost. Reconnecting…'
        : link.detail;
  return (
    <View style={[styles.banner, { backgroundColor: t.uiBgSecondary, borderBottomColor: t.uiStrokeQuaternary }]}>
      {link.kind === 'connecting' ? <ActivityIndicator size="small" color={t.uiTextTertiary} /> : null}
      <Text style={{ color: t.uiTextSecondary, fontSize: 12, flex: 1 }} numberOfLines={2}>
        {text}
      </Text>
      {link.kind === 'waiting' ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: t.uiAccent, fontSize: 12, fontWeight: '600' }}>Retry now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyState({
  t,
  entry,
  bot,
  opening,
  personality,
  loadImage,
}: {
  t: Tokens;
  entry: ChatEntry;
  bot: Bot | null;
  opening: boolean;
  personality: string;
  loadImage: (name: string) => Promise<string | null>;
}) {
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  if (opening || entry.loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={t.uiTextTertiary} />
      </View>
    );
  }
  if (entry.error) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: t.dtDestructive, fontSize: 13, textAlign: 'center' }}>Could not load this session.</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 12, textAlign: 'center', marginTop: 6 }}>{entry.error}</Text>
      </View>
    );
  }
  if (entry.isBotChat && bot) {
    // desktop chat-empty.tsx: the face, then the Wordmark carrying the bot's name over the prompt, lifted so the name sits on the centre line
    return (
      <View style={styles.empty}>
        <View style={styles.botIntro}>
          <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={BOT_FACE} loadImage={loadImage} />
          <View style={styles.botWordmark}>
            <Wordmark text={bot.label} />
          </View>
          <Text style={[styles.introBody, { color: t.uiTextTertiary }]}>{BOT_CHAT_EMPTY}</Text>
        </View>
      </View>
    );
  }
  // desktop components/chat/intro.tsx: the Wordmark over one rotating body line
  return (
    <View style={[styles.empty, styles.intro]}>
      <Wordmark text={WORDMARK} style={styles.wordmark} />
      <Text style={[styles.introBody, { color: t.uiTextTertiary }]}>{introBody(personality, seed)}</Text>
    </View>
  );
}

function RunStatus({ t, status }: { t: Tokens; status: string | null }) {
  return (
    <View style={styles.runStatus} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={t.uiTextTertiary} style={{ transform: [{ scale: 0.75 }] }} />
      <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }} numberOfLines={1}>
        {status || 'Working…'}
      </Text>
    </View>
  );
}

function Composer({
  t,
  running,
  disabled,
  botLabel,
  followUp,
  modelLabel,
  onSend,
  onStop,
  onAttach,
  onModelPicker,
}: {
  t: Tokens;
  running: boolean;
  disabled: boolean;
  botLabel: string | null;
  followUp: boolean;
  modelLabel: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: () => void;
  onModelPicker: () => void;
}) {
  const [text, setText] = useState('');
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const canSend = text.trim() !== '' && !disabled;
  const showStop = running && text.trim() === '';
  const placeholders = followUp ? FOLLOW_UP_PLACEHOLDERS : NEW_SESSION_PLACEHOLDERS;
  const placeholder = running ? 'Steer the running turn…' : botLabel ? `Message ${botLabel}` : placeholders[seed % placeholders.length];
  const primaryActive = showStop || canSend;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.composerDock}>
      <View
        style={[styles.composer, { backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['2xl'] }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add context"
          onPress={onAttach}
          hitSlop={8}
          style={({ pressed }) => [styles.ghostButton, styles.menuCell, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
        >
          <Codicon name="add" size={14} color={t.uiTextTertiary} />
        </Pressable>
        <View style={styles.inputCell}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            style={[styles.input, { color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.text * 1.5 }]}
            selectionColor={t.uiAccent}
            accessibilityLabel="Message"
            accessibilityHint={placeholder}
          />
          {/* desktop composer-rich-input::before: the hint is one clipped line out of flow, so it never grows the box */}
          {text === '' ? (
            <Text
              pointerEvents="none"
              numberOfLines={1}
              accessible={false}
              style={[styles.placeholder, { color: t.uiTextTertiary, fontSize: t.type.text, lineHeight: t.type.text * 1.5 }]}
            >
              {placeholder}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Model: ${modelLabel}`}
          onPress={onModelPicker}
          hitSlop={6}
          style={({ pressed }) => [styles.modelPill, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
        >
          <Text style={[styles.modelPillText, { color: t.uiTextTertiary }]} numberOfLines={1}>
            {modelLabel}
          </Text>
          <Codicon name="chevron-down" size={10} color={t.uiTextTertiary} style={{ opacity: 0.5 }} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showStop ? 'Stop' : running ? 'Steer' : 'Send'}
          disabled={!primaryActive}
          onPress={showStop ? onStop : submit}
          hitSlop={6}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: t.dtForeground, opacity: primaryActive ? (pressed ? 0.9 : 1) : 0.3 },
          ]}
        >
          {showStop ? (
            <View style={[styles.stopGlyph, { backgroundColor: t.dtBackground }]} />
          ) : (
            <Codicon name="arrow-up" size={14} color={t.dtBackground} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** desktop app/shell/statusbar-controls.tsx, trimmed to what the phone has: the profile and the backend link */
function StatusRow({ t, link, profileLabel, onProfile }: { t: Tokens; link: LinkState; profileLabel: string; onProfile: () => void }) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const backendColor =
    link.kind === 'open' ? t.uiTextTertiary : link.kind === 'unsupported' || link.kind === 'signed-out' ? t.dtDestructive : '#d97706';
  const backendDetail = link.kind === 'open' ? null : link.kind === 'connecting' ? 'connecting' : link.kind === 'waiting' ? 'reconnecting' : link.kind === 'paused' ? 'paused' : 'offline';
  return (
    <View style={[styles.statusRow, { paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 4) }]}>
      <Pressable
        onPress={onProfile}
        accessibilityRole="button"
        accessibilityLabel={`Profile: ${profileLabel}`}
        style={({ pressed }) => [styles.statusItem, pressed && { backgroundColor: t.uiControlHoverBackground }]}
      >
        <Codicon name="account" size={12} color={t.uiTextTertiary} />
        <Text style={[styles.statusText, { color: t.uiTextTertiary, maxWidth: 160 }]} numberOfLines={1}>
          {profileLabel}
        </Text>
        <Codicon name="chevron-down" size={14} color={t.uiTextTertiary} style={{ opacity: 0.6 }} />
      </Pressable>
      <View style={styles.statusItem} accessibilityLabel={`Backend ${backendDetail ?? 'ready'}`}>
        <Codicon name="pulse" size={12} color={backendColor} />
        <Text style={[styles.statusText, { color: backendColor }]}>Backend</Text>
        {backendDetail ? <Text style={[styles.statusText, { color: t.uiTextQuaternary }]}>{backendDetail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingTop: 16, paddingBottom: 8 },
  row: { paddingHorizontal: SIDE_INSET, paddingVertical: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 48 },
  intro: { paddingHorizontal: SIDE_INSET, paddingBottom: 24 },
  wordmark: { marginHorizontal: 8, marginBottom: 4 },
  botIntro: { alignSelf: 'stretch', alignItems: 'center', transform: [{ translateY: -(BOT_FACE + BOT_FACE_GAP) / 2 }] },
  botWordmark: { width: '80%', paddingHorizontal: 8, marginTop: BOT_FACE_GAP, marginBottom: 4 },
  // desktop `[data-slot='aui_intro'] p:last-child`: 0.875rem, leading 1.45, tracking-tight
  introBody: { maxWidth: 544, fontSize: 14, lineHeight: 14 * 1.45, letterSpacing: -0.35, textAlign: 'center' },
  runStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SIDE_INSET - 6, paddingBottom: 4 },
  // desktop composer tokens: control 24, primary 26, gap 4, surface padding 8 × 5, input 26–150
  composerDock: { paddingHorizontal: 16, paddingTop: COMPOSER_DOCK_TOP, paddingBottom: 6 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  ghostButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  menuCell: { alignSelf: 'flex-start', marginTop: 3 },
  inputCell: { flex: 1, justifyContent: 'center' },
  placeholder: { position: 'absolute', top: 4, left: 0, right: 4 },
  input: { minHeight: 26, maxHeight: 150, paddingTop: 4, paddingBottom: 4, paddingLeft: 0, paddingRight: 4, textAlignVertical: 'top' },
  modelPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, maxWidth: 150, flexShrink: 1 },
  modelPillText: { fontSize: 12, flexShrink: 1 },
  primaryButton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 10, height: 10, borderRadius: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, minHeight: 20 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 6 },
  statusText: { fontSize: 11 },
});
