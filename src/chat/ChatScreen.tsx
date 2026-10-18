/**
 * The chat root: app bar, transcript and composer for whichever chat is open.
 *
 * assistant-ui's FlatList owns stick-to-bottom (issue "Transcript and composer
 * parity on touch") and a floating pill jumps back to it; our transcript stays
 * the source of truth - the external store runtime only mirrors it, and each
 * row renders our own message by id (TranscriptPane).
 *
 * This screen never reads the open transcript: it subscribes to the chat's
 * coarse state (`chatMeta`) and the chrome's slices, so it stays still while a
 * turn streams and only the TranscriptPane re-renders per token.
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { KeyboardPaddedView } from '../ui/KeyboardPaddedView.tsx';
import Svg, { Path } from 'react-native-svg';
import { BotAvatar } from '../bots/BotAvatar.tsx';
import { faceMood } from '../bots/face.ts';
import type { Bot } from '../bots/roster.ts';
import type { LinkState } from '../gateway/link.ts';
import type { DraftStore } from '../store/drafts.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import { AttachMenu, AttachmentChips } from './AttachmentChips.tsx';
import { BackendPopover, useBackendMenu } from './BackendPopover.tsx';
import { ChatStatusRow } from './ChatStatusRow.tsx';
import { ATTACH_WHILE_RUNNING, type ComposerAttachment } from './attachments.ts';
import { chatEnv, chatMeta, sameModel } from './chatSlices.ts';
import { DRAFT_KEY, type ChatController } from './controller.ts';
import { ComposerSheets } from './ComposerSheets.tsx';
import { useDictation } from './dictation.ts';
import { DictationActivity, MicButton } from './DictationControls.tsx';
import { FOLLOW_UP_PLACEHOLDERS, NEW_SESSION_PLACEHOLDERS } from './intro.ts';
import { EditBanner, MessageActionsProvider, useEditingText, useMessageChrome, type MessageEdit } from './messageChrome.tsx';
import { ModelPicker, type ModelPickerView } from './ModelPicker.tsx';
import { effortPillLabel, modelPillLabel, type ModelSelection } from './models.ts';
import { RestoredDraftNotice } from './RestoredDraftNotice.tsx';
import { shallowEqual } from './selector.ts';
import { uiSlash, type SlashUi } from './slash.ts';
import { StackIcon } from './StatusRows.tsx';
import { StatusStack } from './StatusStack.tsx';
import { TranscriptPane } from './TranscriptPane.tsx';
import { useAttachments } from './useAttachments.ts';
import { useComposerDraft } from './useComposerDraft.ts';
import { useComposerTriggers, type ComposerSheet } from './useComposerTriggers.ts';
import { useImeBack } from './useImeBack.ts';
import { useChatSelector } from './useChatSelector.ts';
import { useGatewayHealth } from './useGatewayHealth.ts';

/** the composer dock's top padding: the picker sits on the surface, not the dock */
const COMPOSER_DOCK_TOP = 6;

type Props = {
  controller: ChatController;
  bot: Bot | null;
  profileLabel: string;
  onOpenDrawer: () => void;
  onProfile: () => void;
};

const selectCurrentModel = (controller: ChatController) => () => controller.currentModel();

function ChatScreen({ controller, bot, profileLabel, onOpenDrawer, onProfile }: Props) {
  const t = useTokens();
  const meta = useChatSelector(controller, chatMeta, shallowEqual);
  const { link, models, personality, defaultEffort, reactionsEnabled, openingBot } = useChatSelector(controller, chatEnv, shallowEqual);
  const currentModelOf = useMemo(() => selectCurrentModel(controller), [controller]);
  const currentModel = useChatSelector(controller, currentModelOf, sameModel);
  const { running } = meta;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dock, setDock] = useState({ top: 0, height: 0 });
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [sheet, setSheet] = useState<ComposerSheet | null>(null);
  const gateway = useGatewayHealth(controller, link, meta.profile, !meta.isBotChat);
  const backendMenu = useBackendMenu(meta.isBotChat);
  useImeBack({ sheetOpen: sheet !== null, closeSheet: sheet?.dismiss, reorderKey: pickerOpen ? 'picker' : backendMenu.open ? 'backend' : null });
  const sheetScope = useMemo(() => ({ request: controller.request, sessionId: meta.runtimeId, profile: meta.profile }), [controller, meta.runtimeId, meta.profile]);
  const [pickerView, setPickerView] = useState<ModelPickerView>('models');
  const openPicker = useCallback(
    (view: ModelPickerView = 'models') => {
      setPickerView(view);
      setPickerOpen(true);
      if (!models.providers.length || models.error) void controller.refreshModels();
    },
    [controller, models.providers.length, models.error],
  );
  const openUi = useCallback(
    (ui: SlashUi) => {
      if (ui === 'model') return openPicker();
      Keyboard.dismiss();
      if (ui === 'sessions') onOpenDrawer();
      else onProfile();
    },
    [openPicker, onOpenDrawer, onProfile],
  );
  const notify = useCallback((text: string) => controller.notify(text), [controller]);
  const chrome = useMessageChrome(controller, meta.key, reactionsEnabled);
  const newChat = useCallback(() => controller.newChat(), [controller]);
  const retryLink = useCallback(() => controller.retryLink(), [controller]);
  const onDockLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setDock((previous) => (previous.top === y && previous.height === height ? previous : { top: y, height }));
  }, []);
  const onQueue = useCallback((text: string) => controller.queueMessage(text), [controller]);
  const onSend = useCallback(
    (text: string, attachments: ComposerAttachment[]) => {
      const ui = attachments.length === 0 ? uiSlash(text) : null;
      if (ui) openUi(ui);
      else void controller.send(text, attachments);
    },
    [controller, openUi],
  );
  const onStop = useCallback(() => void controller.stop(), [controller]);
  const onModelPicker = useCallback(() => openPicker('models'), [openPicker]);
  const onEffortPicker = useCallback(() => openPicker('effort'), [openPicker]);
  const onRefreshModels = useCallback(() => void controller.refreshModels(true), [controller]);
  const onSelectModel = useCallback(
    (selection: ModelSelection, options?: { confirm?: boolean }) => controller.selectModel(selection, options),
    [controller],
  );
  const onEffort = useCallback((effort: string) => void controller.setEffort(effort), [controller]);

  const title = meta.isBotChat && bot ? bot.label : meta.title || (meta.key === 'draft' ? 'New session' : 'Untitled session');
  // the registry's "Bot Chat" title is plumbing, not chrome: a bot's app bar is its face and name
  const subtitle = meta.isBotChat ? null : profileLabel;
  const avatar = useMemo(
    () =>
      meta.isBotChat && bot ? (
        <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={28} loadImage={controller.avatarDataFn} mood={faceMood(running, bot.working)} />
      ) : null,
    [meta.isBotChat, bot, controller, running],
  );

  return (
    <KeyboardPaddedView style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground }]}>
      <View style={styles.root}>
        <AppBar t={t} title={title} subtitle={subtitle} avatar={avatar} onOpenDrawer={onOpenDrawer} onNewChat={newChat} />
        <LinkBanner link={link} onRetry={retryLink} />

        <MessageActionsProvider value={chrome.actions}>
          <TranscriptPane controller={controller} meta={meta} bot={bot} opening={openingBot !== null} personality={personality} />
        </MessageActionsProvider>

        <StatusStack controller={controller} busy={running} />

        <View onLayout={onDockLayout}>
          <Composer
            t={t}
            drafts={controller.drafts}
            profile={meta.profile}
            session={meta.key}
            running={running}
            disabled={link.kind !== 'open' || meta.loading}
            botLabel={meta.isBotChat && bot ? bot.label : null}
            followUp={meta.hasMessages}
            edit={chrome.edit}
            modelLabel={modelPillLabel(currentModel?.model)}
            effortLabel={effortPillLabel(models.providers, currentModel)}
            onSheet={setSheet}
            onQueue={onQueue}
            onSend={onSend}
            onStop={onStop}
            onNotice={notify}
            onModelPicker={onModelPicker}
            onEffortPicker={onEffortPicker}
          />
          <ChatStatusRow
            t={t}
            health={gateway.health}
            profileLabel={profileLabel}
            botChat={meta.isBotChat}
            backendOpen={backendMenu.open}
            onProfile={onProfile}
            onBackend={backendMenu.show}
          />
        </View>

        <ComposerSheets sheet={sheet} scope={sheetScope} bottom={dock.height - COMPOSER_DOCK_TOP + 4} available={dock.top - 56} onUi={openUi} />
        {chrome.sheets}

        <ModelPicker
          visible={pickerOpen}
          view={pickerView}
          defaultEffort={defaultEffort}
          bottom={dock.height - COMPOSER_DOCK_TOP}
          available={dock.top - 56}
          catalog={models}
          current={currentModel}
          onClose={closePicker}
          onRefresh={onRefreshModels}
          onSelect={onSelectModel}
          onEffort={onEffort}
        />

        <BackendPopover
          visible={backendMenu.open}
          anchor={backendMenu.anchor}
          controller={controller}
          link={link}
          profile={meta.profile}
          model={gateway}
          onClose={backendMenu.close}
        />
      </View>
    </KeyboardPaddedView>
  );
}

export default memo(ChatScreen);

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

const AppBar = memo(function AppBar({
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
        <Svg width={24} height={24} viewBox="0 0 20 20">
          <Path d="M3 5.5h14M3 10h14M3 14.5h9" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </IconButton>
      <View style={styles.titleBlock}>
        <View style={styles.titleLine}>
          {avatar}
          <Text numberOfLines={1} style={{ flexShrink: 1, color: t.uiTextPrimary, fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 }} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: 13, lineHeight: 17 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <IconButton label="New session" onPress={onNewChat}>
        <Svg width={23} height={23} viewBox="0 0 20 20">
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
});

const LinkBanner = memo(function LinkBanner({ link, onRetry }: { link: LinkState; onRetry: () => void }) {
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
      {link.kind === 'connecting' ? <GlyphSpinner size={12} label="Connecting" /> : null}
      <Text style={{ color: t.uiTextSecondary, fontSize: 14, lineHeight: 19, flex: 1 }} numberOfLines={2}>
        {text}
      </Text>
      {link.kind === 'waiting' ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: t.uiAccent, fontSize: 14, fontWeight: '600' }}>Retry now</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const Composer = memo(function Composer({
  t,
  drafts,
  profile,
  session,
  running,
  disabled,
  botLabel,
  followUp,
  edit,
  modelLabel,
  effortLabel,
  onSend,
  onSheet,
  onQueue,
  onStop,
  onNotice,
  onModelPicker,
  onEffortPicker,
}: {
  t: Tokens;
  drafts: DraftStore;
  profile: string;
  session: string;
  running: boolean;
  disabled: boolean;
  botLabel: string | null;
  followUp: boolean;
  edit: MessageEdit;
  modelLabel: string;
  /** the reasoning pill's text; null hides it for a model with no effort control */
  effortLabel: string | null;
  onSend: (text: string, attachments: ComposerAttachment[]) => void;
  onSheet: (sheet: ComposerSheet | null) => void;
  onQueue: (text: string) => void;
  onStop: () => void;
  onNotice: (text: string) => void;
  onModelPicker: () => void;
  onEffortPicker: () => void;
}) {
  const { text, setText, clear } = useComposerDraft(drafts, profile, session);
  const inputRef = useRef<TextInput>(null);
  const triggers = useComposerTriggers({ text, setText, inputRef, onSheet });
  useEditingText(edit, text, setText, () => inputRef.current?.focus());
  const [attachOpen, setAttachOpen] = useState(false);
  const attachments = useAttachments(onNotice);
  const dictation = useDictation({ getText: () => text, setText, onNotice });
  const [focused, setFocused] = useState(false);
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const hasPayload = text.trim() !== '' || attachments.items.length > 0;
  const canSend = hasPayload && !disabled;
  const showStop = running && !hasPayload;
  const placeholders = followUp ? FOLLOW_UP_PLACEHOLDERS : NEW_SESSION_PLACEHOLDERS;
  const placeholder = running ? 'Steer the running turn…' : botLabel ? `Message ${botLabel}` : placeholders[seed % placeholders.length];
  const primaryActive = showStop || canSend;

  const submit = () => {
    if (!canSend) return;
    if (edit.target) {
      void edit.submit(text);
      Keyboard.dismiss();
      return;
    }
    if (running && attachments.items.length > 0) {
      onNotice(ATTACH_WHILE_RUNNING);
      return;
    }
    dictation.cancel();
    onSend(text, attachments.items);
    clear();
    attachments.clear();
    Keyboard.dismiss();
  };
  // desktop controls.tsx: the secondary mid-turn action, while the primary button steers
  const queue = () => {
    if (!canSend) return;
    onQueue(text);
    clear();
  };

  return (
    <View style={styles.composerDock}>
      {session === DRAFT_KEY ? <RestoredDraftNotice drafts={drafts} profile={profile} liveText={text} /> : null}
      <EditBanner edit={edit} />
      {dictation.status !== 'idle' ? (
        <View style={styles.dictationRow}>
          <DictationActivity dictation={dictation} />
        </View>
      ) : null}
      <View
        style={[styles.composer, { backgroundColor: t.uiBgEditor, borderColor: focused ? t.dtComposerRing : t.uiComposerBorder, borderRadius: t.radius['2xl'] }]}
      >
        <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
        {/* the input owns the full width; the controls sit on a toolbar beneath, so a thumb aiming at the text never lands on the model pill */}
        <View style={styles.inputCell}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={triggers.onChangeText}
            onSelectionChange={triggers.onSelectionChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
            editable={dictation.status === 'idle'}
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
        <View style={styles.composerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add context"
          onPress={() => setAttachOpen(true)}
          hitSlop={4}
          style={({ pressed }) => [styles.ghostButton, { borderRadius: t.radius.full }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
        >
          <Codicon name="add" size={20} color={t.uiTextSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Model: ${modelLabel}`}
          onPress={onModelPicker}
          hitSlop={4}
          style={({ pressed }) => [styles.modelPill, { borderRadius: t.radius.full, backgroundColor: pressed ? t.uiControlActiveBackground : t.uiControlHoverBackground }]}
        >
          <Text style={[styles.modelPillText, { color: t.uiTextSecondary }]} numberOfLines={1}>
            {modelLabel}
          </Text>
          <Codicon name="chevron-down" size={12} color={t.uiTextTertiary} style={{ opacity: 0.7 }} />
        </Pressable>
        {effortLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Thinking: ${effortLabel}`}
            onPress={onEffortPicker}
            hitSlop={4}
            style={({ pressed }) => [styles.effortPill, { borderRadius: t.radius.full, backgroundColor: pressed ? t.uiControlActiveBackground : t.uiControlHoverBackground }]}
          >
            <Text style={[styles.modelPillText, { color: t.uiTextSecondary }]} numberOfLines={1}>
              {effortLabel}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.toolbarSpacer} />
        {dictation.available ? <MicButton dictation={dictation} disabled={disabled} /> : null}
        {running && canSend ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Queue message"
            onPress={queue}
            hitSlop={6}
            style={({ pressed }) => [styles.ghostButton, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
          >
            <StackIcon name="layers" size={18} color={t.uiTextTertiary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showStop ? 'Stop' : edit.target ? 'Send edited message' : running ? 'Steer' : 'Send'}
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
            <Codicon name="arrow-up" size={18} color={t.dtBackground} />
          )}
        </Pressable>
        </View>
      </View>
      <AttachMenu visible={attachOpen} onClose={() => setAttachOpen(false)} attachments={attachments} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // phone composer: a full-width input over a toolbar (add and model on the left, mic and send on the right); controls 36, input 40–180
  composerDock: { paddingHorizontal: 12, paddingTop: COMPOSER_DOCK_TOP, paddingBottom: 8 },
  composer: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  toolbarSpacer: { flex: 1 },
  dictationRow: { paddingBottom: 6 },
  ghostButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inputCell: { justifyContent: 'center', paddingHorizontal: 6 },
  placeholder: { position: 'absolute', top: 8, left: 6, right: 6 },
  input: { minHeight: 40, maxHeight: 180, paddingTop: 8, paddingBottom: 8, paddingLeft: 0, paddingRight: 0, textAlignVertical: 'top' },
  modelPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, maxWidth: 200, flexShrink: 1 },
  effortPill: { height: 36, paddingHorizontal: 12, justifyContent: 'center', flexShrink: 0 },
  modelPillText: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  primaryButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 12, height: 12, borderRadius: 3 },
});
