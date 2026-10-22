/**
 * The assistant card itself: the frame that rises from the bottom with the edge glow around the
 * screen, and the signed-in card inside it. A summon listens at once; what is heard (or typed) starts
 * a fresh chat on the shared controller, the reply streams into the card, and follow-ups stay in that
 * chat while the card is up. "Open in Hermes" hands the chat to the app.
 */

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { assistant, glowComponent, type GlowPhase } from '../../modules/hermes-assistant/index.ts';
import type { Hosted } from '../app/controllerHost.ts';
import { botLabel } from '../bots/roster.ts';
import { openEntry, openTranscript } from '../chat/chatSlices.ts';
import type { ChatController, ChatSnapshot } from '../chat/controller.ts';
import { Markdown } from '../chat/Markdown.tsx';
import { useChatSelector } from '../chat/useChatSelector.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { KeyboardPaddedView } from '../ui/KeyboardPaddedView.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { ShimmerText } from '../ui/ShimmerText.tsx';
import { useTokens, WORDMARK_FONT, type Tokens } from '../ui/tokens.ts';
import { glowColors } from './glowColors.ts';
import { assistantTurns, replyPhase, type TurnState } from './turns.ts';
import { useAssistantVoice, type LevelStore } from './useAssistantVoice.ts';

/** how far below its resting place the card starts, and returns to when it closes */
const CARD_TRAVEL = 420;
/** a drag past this, or a flick, closes the card */
const DISMISS_DRAG = 120;
const DISMISS_VELOCITY = 900;

/**
 * `shown`, 0 hidden .. 1 up: the card's rise, the glow and the scrim follow it while they move. Once
 * `settled` (risen, not leaving) they rest on plain styles instead: a system dialog over the card (the
 * mic permission) can have the native views rebuilt from React's props, which drops animated values.
 */
export const PresenceContext = createContext<{ shown: SharedValue<number>; entered: boolean; settled: boolean } | null>(null);

const STILL: LevelStore = { get: () => 0, subscribe: () => () => {} };

function AssistantGlow({ phase, level }: { phase: GlowPhase; level: LevelStore }) {
  const t = useTokens();
  const presence = useContext(PresenceContext);
  const shown = presence?.shown;
  const value = useSyncExternalStore(level.subscribe, level.get);
  const fade = useAnimatedStyle(() => ({ opacity: shown ? shown.value : 1 }));
  const Glow = glowComponent();
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, presence?.settled === false ? fade : null]}>
      <Glow pointerEvents="none" style={StyleSheet.absoluteFill} phase={phase} level={value} colors={glowColors(t)} />
    </Animated.View>
  );
}

type FrameProps = {
  phase: GlowPhase;
  level?: LevelStore;
  /** the bot the card asks, beside the mark */
  label?: string;
  onClose: () => void;
  onOpenApp: () => void;
  children: ReactNode;
};

/** the glow and the card, docked at the bottom above the keyboard; the header drags it away */
export function CardFrame({ phase, level = STILL, label, onClose, onOpenApp, children }: FrameProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const presence = useContext(PresenceContext);
  const shown = presence?.shown;
  const settled = presence?.settled ?? true;
  const drag = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onChange((event) => {
          drag.value = Math.max(0, drag.value + event.changeY);
        })
        .onEnd((event) => {
          if (drag.value > DISMISS_DRAG || event.velocityY > DISMISS_VELOCITY) scheduleOnRN(onClose);
          else drag.value = withSpring(0, { damping: 20, stiffness: 260 });
        }),
    [drag, onClose],
  );

  const rise = useAnimatedStyle(() => {
    const progress = shown ? shown.value : 1;
    return {
      opacity: interpolate(progress, [0, 0.35, 1], [0, 1, 1]),
      transform: [{ translateY: (1 - progress) * CARD_TRAVEL + drag.value }],
    };
  });
  const follow = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));

  return (
    <>
      <AssistantGlow phase={phase} level={level} />
      <KeyboardPaddedView style={styles.dock}>
        <View style={{ paddingBottom: insets.bottom + 8 }}>
          <Animated.View
            accessibilityViewIsModal
            style={[styles.card, { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary }, settled ? follow : rise]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.header}>
                <View style={[styles.grabber, { backgroundColor: t.uiStrokePrimary }]} />
                <View style={styles.headerRow}>
                  <Text style={[styles.mark, { color: t.uiWordmark }]} accessibilityRole="header">
                    HERMES
                  </Text>
                  {label ? (
                    <Text numberOfLines={1} style={[styles.label, { color: t.uiTextTertiary }]}>
                      {label}
                    </Text>
                  ) : null}
                  <View style={styles.spacer} />
                  <IconButton icon="link-external" label="Open in Hermes" onPress={onOpenApp} />
                  <IconButton icon="close" label="Close" onPress={onClose} />
                </View>
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </KeyboardPaddedView>
    </>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'link-external' | 'close'; label: string; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { borderRadius: t.radius.full }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
    >
      <Codicon name={icon} size={16} color={t.uiTextSecondary} />
    </Pressable>
  );
}

const profileLabel = (snapshot: ChatSnapshot): string => {
  const { visible, hidden } = snapshot.roster;
  const bot = visible.find((row) => row.name === snapshot.profile) ?? hidden.find((row) => row.name === snapshot.profile);
  return bot ? bot.label : botLabel({ name: snapshot.profile });
};

const linkOpen = (snapshot: ChatSnapshot) => snapshot.link.kind === 'open';
const chatRunning = (snapshot: ChatSnapshot) => openEntry(snapshot).transcript.running;
const chatPhase = (snapshot: ChatSnapshot): GlowPhase => {
  const { messages, running } = openEntry(snapshot).transcript;
  return replyPhase(messages, running);
};
/** an approval or a secret prompt waits: those are answered in the app; a clarify is answered by asking */
const needsApp = (snapshot: ChatSnapshot) => {
  const { approvals, prompts } = openEntry(snapshot).requests;
  return approvals.length > 0 || Object.keys(prompts).length > 0;
};
const idlePhase = (): GlowPhase => 'idle';
const never = () => false;

/** the signed-in card: listening on arrival, then the chat it starts */
export function ReadyCard({ hosted, onClose }: { hosted: Hosted<ChatController>; onClose: () => void }) {
  const t = useTokens();
  const controller = hosted.value;
  const [asked, setAsked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  // the mic opens once the card is up, so its permission prompt never cuts the rise short
  const entered = useContext(PresenceContext)?.entered ?? true;
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  /** a question heard before the socket opened, sent the moment it does */
  const [pending, setPending] = useState<string | null>(null);
  const askedRef = useRef(false);
  const open = useChatSelector(controller, linkOpen);
  const running = useChatSelector(controller, asked ? chatRunning : never);
  const phase = useChatSelector(controller, asked ? chatPhase : idlePhase);
  const blocked = useChatSelector(controller, asked ? needsApp : never);
  const label = useChatSelector(controller, profileLabel);

  const ask = useCallback(
    (question: string) => {
      const prompt = question.trim();
      if (!prompt) return;
      setNotice(null);
      // the chat starts with the first question, so a card closed unasked leaves the app where it was
      if (!askedRef.current) {
        askedRef.current = true;
        controller.newChat();
        setAsked(true);
      }
      setPending(prompt);
    },
    [controller],
  );

  useEffect(() => {
    if (pending === null || !open) return;
    setPending(null);
    controller.send(pending).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [pending, open, controller]);

  const voice = useAssistantVoice({ onHeard: ask, onNotice: setNotice });
  const { listen } = voice;

  // nothing is heard or sent from the lock screen until the phone is unlocked
  useEffect(() => {
    let live = true;
    void (assistant?.whenUnlocked() ?? Promise.resolve(true)).then((ok) => {
      if (live && ok) setUnlocked(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // the mic is on when the card arrives, and again when the reader summons it while it is up
  useEffect(() => {
    if (!unlocked || !entered || !voice.available) return;
    listen();
    const summon = assistant?.addListener('onSummon', listen);
    return () => summon?.remove();
  }, [unlocked, entered, voice.available, listen]);

  const submit = () => {
    ask(text);
    setText('');
  };

  const listening = voice.status !== 'off';
  const glow: GlowPhase = listening ? 'listening' : pending !== null ? 'thinking' : phase;
  const canSend = unlocked && text.trim() !== '';

  return (
    <CardFrame phase={glow} level={voice.level} label={label} onClose={onClose} onOpenApp={() => assistant?.openApp()}>
      {asked ? <Turns controller={controller} pending={pending} /> : null}
      {listening || !asked ? <Heard t={t} heard={voice.heard} listening={listening} available={voice.available} /> : null}
      {blocked ? <Text style={[styles.notice, { color: t.uiTextSecondary }]}>Hermes is waiting for your approval. Open the chat in Hermes to answer.</Text> : null}
      {notice ? <Text style={[styles.notice, { color: t.uiTextTertiary }]}>{notice}</Text> : null}
      <View style={[styles.composer, { backgroundColor: t.uiBgEditor, borderColor: t.uiComposerBorder, borderRadius: t.radius['2xl'] }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={voice.cancel}
          onSubmitEditing={submit}
          editable={unlocked}
          placeholder={asked ? 'Ask a follow-up' : 'Ask Hermes'}
          placeholderTextColor={t.uiTextTertiary}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          style={[styles.input, { color: t.uiTextPrimary, fontSize: t.type.text }]}
          selectionColor={t.uiAccent}
          accessibilityLabel="Question"
        />
        {voice.available ? <MicButton t={t} status={voice.status} disabled={!unlocked} onPress={listening ? voice.finish : listen} /> : null}
        {running && !canSend ? (
          <PrimaryButton t={t} label="Stop" onPress={() => void controller.stop()}>
            <View style={[styles.stopGlyph, { backgroundColor: t.dtBackground }]} />
          </PrimaryButton>
        ) : canSend ? (
          <PrimaryButton t={t} label="Send" onPress={submit}>
            <Codicon name="arrow-up" size={18} color={t.dtBackground} />
          </PrimaryButton>
        ) : null}
      </View>
    </CardFrame>
  );
}

/** what is being heard, or the invitation to speak before anything was asked */
function Heard({ t, heard, listening, available }: { t: Tokens; heard: string; listening: boolean; available: boolean }) {
  const size = t.type.text * 1.25;
  if (heard) return <Text style={[styles.heard, { color: t.uiTextPrimary, fontSize: size, lineHeight: size * 1.35 }]}>{heard}</Text>;
  if (listening) {
    return (
      <View style={styles.heardBox}>
        <ShimmerText fontSize={size} style={{ fontSize: size, color: t.uiTextSecondary }}>
          Listening…
        </ShimmerText>
      </View>
    );
  }
  return <Text style={[styles.heard, { color: t.uiTextTertiary, fontSize: size, lineHeight: size * 1.35 }]}>{available ? 'Tap the mic or type to ask' : 'Type to ask Hermes'}</Text>;
}

function MicButton({ t, status, disabled, onPress }: { t: Tokens; status: 'off' | 'listening' | 'settling'; disabled: boolean; onPress: () => void }) {
  const active = status !== 'off';
  const primary = t.dtPrimarySolid;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status === 'listening' ? 'Done speaking' : 'Speak'}
      accessibilityState={{ disabled: disabled || status === 'settling', busy: status === 'settling' }}
      disabled={disabled || status === 'settling'}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.roundButton,
        { borderRadius: t.radius.full, opacity: disabled ? 0.5 : 1 },
        active ? { backgroundColor: mixPct(primary, pressed ? 0.2 : 0.14, 'transparent') } : pressed && { backgroundColor: t.uiControlHoverBackground },
      ]}
    >
      {status === 'settling' ? <GlyphSpinner size={14} color={primary} /> : <Codicon name="mic" size={19} color={active ? primary : t.uiTextSecondary} />}
    </Pressable>
  );
}

function PrimaryButton({ t, label, onPress, children }: { t: Tokens; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.primaryButton, { backgroundColor: t.dtForeground, opacity: pressed ? 0.9 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** the card's chat: every prompt asked since it rose, the newest following its reply */
const Turns = memo(function Turns({ controller, pending }: { controller: ChatController; pending: string | null }) {
  const t = useTokens();
  const { height } = useWindowDimensions();
  const transcript = useChatSelector(controller, openTranscript);
  const turns = useMemo(() => assistantTurns(transcript.messages, transcript.running), [transcript.messages, transcript.running]);
  const scroll = useRef<ScrollView>(null);
  const contentHeight = useRef(0);
  return (
    <ScrollView
      ref={scroll}
      style={{ maxHeight: height * 0.5 }}
      contentContainerStyle={styles.turns}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={(_, h) => {
        if (h === contentHeight.current) return;
        contentHeight.current = h;
        scroll.current?.scrollToEnd({ animated: true });
      }}
    >
      {turns.map((turn) => (
        <TurnView key={turn.id} t={t} prompt={turn.prompt} reply={turn.reply} state={turn.state} activity={turn.activity} error={turn.error} />
      ))}
      {pending !== null ? <TurnView t={t} prompt={pending} reply="" state="waiting" activity="Connecting" error={null} /> : null}
    </ScrollView>
  );
});

type TurnProps = { t: Tokens; prompt: string; reply: string; state: TurnState; activity: string; error: string | null };

const TurnView = memo(function TurnView({ t, prompt, reply, state, activity, error }: TurnProps) {
  return (
    <View style={styles.turn}>
      <Text numberOfLines={4} style={[styles.prompt, { color: t.uiTextSecondary, fontSize: t.type.text, lineHeight: t.type.lineHeight }]}>
        {prompt}
      </Text>
      {reply ? <Markdown text={reply} streaming={state === 'streaming'} /> : null}
      {activity ? (
        <ShimmerText fontSize={t.type.caption} style={{ fontSize: t.type.caption, color: t.conversationScaffoldText }}>
          {activity}
        </ShimmerText>
      ) : null}
      {error ? <Text style={[styles.notice, { color: t.uiRed }]}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  header: { paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { fontFamily: WORDMARK_FONT, fontSize: 15, letterSpacing: 1.2 },
  label: { fontSize: 13, flexShrink: 1 },
  spacer: { flex: 1 },
  iconButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  heard: { paddingHorizontal: 2 },
  heardBox: { paddingHorizontal: 2, alignItems: 'flex-start' },
  notice: { fontSize: 13, lineHeight: 18, paddingHorizontal: 2 },
  turns: { gap: 16, paddingHorizontal: 2, paddingBottom: 4 },
  turn: { gap: 6 },
  prompt: { fontWeight: '500' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, minHeight: 40, paddingVertical: 8, paddingHorizontal: 0 },
  roundButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 12, height: 12, borderRadius: 3 },
});
