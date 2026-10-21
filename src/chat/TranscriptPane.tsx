/**
 * The transcript: assistant-ui's FlatList over the open chat's messages, the empty and loading states, the
 * jump-to-bottom pill and the rows. It owns the only per-token subscription in the chat screen - the
 * open transcript - so everything around it (app bar, composer, status stack, sheets) stays still while
 * a turn streams.
 *
 * Each row is `ChatRow`, a memoised component keyed by message id that reads its view from
 * `TranscriptRows` and re-renders only when that view moved. The list's render function is a module
 * constant, so assistant-ui's per-index cells and RN's CellRenderer skip every row a token did not touch.
 */

import { createContext, memo, useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react-native';

import { BotAvatar } from '../bots/BotAvatar.tsx';
import { BOT_CHAT_EMPTY, type Bot } from '../bots/roster.ts';
import { ThreadLoader } from '../ui/loaders/presets.tsx';
import { useTokens } from '../ui/tokens.ts';
import { Wordmark } from '../ui/Wordmark.tsx';
import { usePullRefresh } from '../ui/usePullRefresh.tsx';
import { PendingApprovals } from './ApprovalCard.tsx';
import { openTranscript, type ChatMeta } from './chatSlices.ts';
import type { ChatController } from './controller.ts';
import { introBody } from './intro.ts';
import { MessageView } from './MessageView.tsx';
import { RequestsProvider } from './RequestsProvider.tsx';
import { ScrollToBottomButton } from './ScrollToBottomButton.tsx';
import { ShowEarlier } from './ShowEarlier.tsx';
import type { Message } from './transcript.ts';
import { TranscriptRows } from './transcriptRows.ts';
import { TurnActivity, TurnActivityContext, useTailStore } from './TurnActivity.tsx';
import { useChatSelector } from './useChatSelector.ts';
import { useJumpToBottom } from './useJumpToBottom.tsx';

export const SIDE_INSET = 24;
const WORDMARK = 'HERMES AGENT';
const BOT_FACE = 96;
const BOT_FACE_GAP = 16;

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

const RowsContext = createContext<TranscriptRows>(new TranscriptRows());

const ChatRow = memo(function ChatRow({ id }: { id: string }) {
  const rows = useContext(RowsContext);
  const subscribe = useCallback((listener: () => void) => rows.subscribe(id, listener), [rows, id]);
  const view = useSyncExternalStore(subscribe, () => rows.get(id));
  if (!view) return null;
  return (
    <View style={styles.row}>
      <MessageView message={view.message} bar={view.bar} latest={view.latest} />
    </View>
  );
});

const renderRow = ({ message }: { message: { id: string } }) => <ChatRow id={message.id} />;

type Props = {
  controller: ChatController;
  meta: ChatMeta;
  bot: Bot | null;
  opening: boolean;
  personality: string;
};

export const TranscriptPane = memo(function TranscriptPane({ controller, meta, bot, opening, personality }: Props) {
  const transcript = useChatSelector(controller, openTranscript);
  const { messages, running, wait } = transcript;
  const [rows] = useState(() => new TranscriptRows());
  // views are brought up to date during render so a row that mounts this pass reads its own message;
  // the rows whose view moved hear about it once the pass has committed
  rows.sync(messages, running);
  useLayoutEffect(() => rows.flush());

  const onNew = useCallback(
    async (append: AppendMessage) => {
      const text = append.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
      await controller.send(text);
    },
    [controller],
  );
  // one adapter object per (messages, running): a re-render for any other reason leaves the runtime untouched
  const adapter = useMemo(() => ({ messages, isRunning: running, convertMessage, onNew }), [messages, running, onNew]);
  const runtime = useExternalStoreRuntime(adapter);
  const jump = useJumpToBottom(meta.key, messages);
  const tail = useTailStore(messages, running, wait);
  const { anchorMinHeight } = jump;
  const listContent = useMemo(() => (anchorMinHeight === null ? styles.listContent : [styles.listContent, { minHeight: anchorMinHeight }]), [anchorMinHeight]);

  const { key, historyMore, loadingEarlier, loading } = meta;
  const showEarlier = useCallback(() => void controller.showEarlier(key), [controller, key]);
  const [pulling, setPulling] = useState(false);
  const refreshKey = useMemo(() => ({ controller, key }), [controller, key]);
  const onPull = useCallback(() => {
    setPulling(true);
    void refreshKey.controller.refreshOpen(refreshKey.key).finally(() => setPulling(false));
  }, [refreshKey]);
  // a reload replays the newest page; never while a turn streams under it or a load is already in flight
  const pull = usePullRefresh({ refreshing: pulling || loading, onRefresh: onPull, enabled: !running && !loading && key !== 'draft' });
  const header = useMemo(
    () => (
      <>
        {pull.header}
        {historyMore ? <ShowEarlier loading={loadingEarlier} onPress={showEarlier} /> : null}
      </>
    ),
    [historyMore, loadingEarlier, showEarlier, pull.header],
  );
  const footer = useMemo(
    () => (
      <>
        <TurnActivity key={key} placement="footer" inset={SIDE_INSET} />
        <PendingApprovals />
      </>
    ),
    [key],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RequestsProvider controller={controller}>
        <TurnActivityContext.Provider value={tail}>
          <View style={styles.body}>
            {messages.length === 0 ? (
              <EmptyState meta={meta} bot={bot} opening={opening} personality={personality} loadImage={controller.avatarDataFn} />
            ) : (
              <View style={styles.list}>
                <RowsContext.Provider value={rows}>
                  <ThreadPrimitive.MessagesFlatList
                    ref={jump.listRef}
                    style={styles.list}
                    contentContainerStyle={listContent}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    CellRendererComponent={jump.Cell}
                    onScroll={(event) => {
                      pull.track(event);
                      jump.onScroll(event);
                    }}
                    onScrollBeginDrag={jump.onDragStart}
                    onScrollEndDrag={jump.onDragEnd}
                    onMomentumScrollBegin={jump.onFlingStart}
                    onMomentumScrollEnd={jump.onFlingEnd}
                    onContentSizeChange={jump.onContentSize}
                    onLayout={jump.onLayout}
                    // following a streaming reply is useJumpToBottom's; assistant-ui's own follow can yank a reader mid-drag,
                    // and a send lifts the reader's message to the top instead of jumping to the bottom when the run starts
                    autoScroll={false}
                    scrollToBottomOnRunStart={false}
                    ListHeaderComponent={header}
                    ListFooterComponent={footer}
                    refreshControl={pull.refreshControl}
                    scrollEventThrottle={16}
                  >
                    {renderRow}
                  </ThreadPrimitive.MessagesFlatList>
                </RowsContext.Provider>
                <ScrollToBottomButton visible={jump.visible} count={jump.count} onPress={jump.toBottom} />
              </View>
            )}
          </View>
        </TurnActivityContext.Provider>
      </RequestsProvider>
    </AssistantRuntimeProvider>
  );
});

function EmptyState({
  meta,
  bot,
  opening,
  personality,
  loadImage,
}: {
  meta: ChatMeta;
  bot: Bot | null;
  opening: boolean;
  personality: string;
  loadImage: (name: string) => Promise<string | null>;
}) {
  const t = useTokens();
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  if (opening || meta.loading) {
    return (
      <View style={styles.empty}>
        <ThreadLoader />
      </View>
    );
  }
  if (meta.error) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: t.dtDestructive, fontSize: 16, fontWeight: '500', textAlign: 'center' }}>Could not load this session.</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 }}>{meta.error}</Text>
      </View>
    );
  }
  if (meta.isBotChat && bot) {
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

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingTop: 16, paddingBottom: 8 },
  row: { paddingHorizontal: SIDE_INSET, paddingVertical: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 48 },
  intro: { paddingHorizontal: SIDE_INSET, paddingBottom: 24 },
  wordmark: { marginHorizontal: 8, marginBottom: 4 },
  botIntro: { alignSelf: 'stretch', alignItems: 'center', transform: [{ translateY: -(BOT_FACE + BOT_FACE_GAP) / 2 }] },
  botWordmark: { width: '80%', paddingHorizontal: 8, marginTop: BOT_FACE_GAP, marginBottom: 4 },
  // desktop `[data-slot='aui_intro'] p:last-child`: leading 1.45, tracking-tight, at phone reading size
  introBody: { maxWidth: 544, fontSize: 17, lineHeight: 17 * 1.45, letterSpacing: -0.3, textAlign: 'center', marginTop: 6 },
});
