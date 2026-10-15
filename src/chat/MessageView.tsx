/**
 * One transcript message. User turns are bubbles; assistant turns render their
 * parts in order - a collapsed reasoning disclosure, markdown text, and tool calls.
 * Reasoning and tool calls are the desktop's transcript scaffolding: quiet,
 * faded one-line rows (a glyph, a title, trailing meta, a caret right of the
 * text) where a run of two or more calls folds into one summary line. A turn
 * that arrives live slides in with the desktop's enter motion. Tool cards are
 * later work.
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { FadeText } from '../ui/Fade.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { ShimmerText } from '../ui/ShimmerText.tsx';
import { DisclosureCaret, EnterView } from '../ui/motion.tsx';
import { MONO, SCAFFOLD_OPACITY, useTokens, type Tokens } from '../ui/tokens.ts';
import { AlertGlyph, ToolIcon } from '../ui/ToolIcon.tsx';
import { ActionBar } from './ActionBar.tsx';
import type { BarPlan } from './actionBar.ts';
import { ClarifyCard } from './ClarifyCard.tsx';
import { ChangedFilesCard } from './cards/ChangedFilesCard.tsx';
import { ToolCard } from './cards/ToolCard.tsx';
import { ToolDiffStats, ToolExtras } from './cards/ToolExtras.tsx';
import { stripGeneratedImageEchoes } from './generatedImage.ts';
import { Markdown } from './Markdown.tsx';
import { MemoryGlyph, MemoryTitle, ReviewNote } from './MemoryChrome.tsx';
import { parseReviewNote } from './reviewNote.ts';
import { ApprovalTimedOutAction } from './ApprovalTimedOutAction.tsx';
import { blocks, echoSources, sameList } from './messageBlocks.ts';
import { buildToolView, isFileEditTool, splitRunItems, summarizeToolRun, type ToolStatus, type ToolView } from './toolView.ts';
import { APPROVAL_COPY } from './requests.ts';
import type { Message, ToolPart } from './transcript.ts';
import { TurnActivity } from './TurnActivity.tsx';

function MessageViewImpl({ message, bar, latest = false }: { message: Message; bar?: BarPlan; latest?: boolean }) {
  const t = useTokens();

  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
    const bubble = (
      <View style={styles.userRow}>
        <View style={[styles.bubble, { backgroundColor: t.uiChatBubbleBackground, borderRadius: t.radius['3xl'] }]}>
          <Text selectable style={{ color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight }}>
            {text}
          </Text>
        </View>
      </View>
    );
    return (
      <>
        {bubble}
        {bar ? <ActionBar message={message} plan={bar} /> : null}
      </>
    );
  }

  if (message.role === 'system') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
    const review = parseReviewNote(text);
    if (review) return <ReviewNote label={review.label} detail={review.detail} />;
    return (
      <View style={[styles.notice, { borderColor: t.uiStrokeTertiary, borderRadius: t.radius['2xl'] }]}>
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }}>{text}</Text>
        {text === APPROVAL_COPY.timedOutSystemLine ? <ApprovalTimedOutAction /> : null}
      </View>
    );
  }

  const streaming = message.status === 'streaming';
  const content = blocks(message.parts);
  const echoes = echoSources(message.parts);
  return (
    <EnterView enabled={streaming} animationKey={`assistant-message:${message.id}`} style={styles.assistant}>
      {content.map((block, index) => {
        const last = index === content.length - 1;
        const key = `${message.id}:${index}`;
        if (block.kind === 'reasoning') {
          return <ReasoningBlock key={index} text={block.text} live={streaming && last} enabled={streaming} animationKey={`reasoning:${key}`} />;
        }
        if (block.kind === 'tools') {
          return <ToolBlock key={index} tools={block.tools} live={streaming && last} enabled={streaming} animationKey={`tool-run:${key}`} />;
        }
        return <TextBlock key={index} text={block.text} echoes={echoes} streaming={streaming && last} />;
      })}
      {latest && !streaming ? <ChangedFilesCard parts={message.parts} /> : null}
      {latest ? <TurnActivity placement="message" /> : null}
      {message.status === 'error' ? (
        <Text style={[styles.footnote, { color: t.dtDestructive, fontSize: t.type.caption }]}>
          {message.error ? `The turn failed: ${message.error}` : 'The turn failed.'}
        </Text>
      ) : null}
      {message.status === 'interrupted' ? (
        <Text style={[styles.footnote, { color: t.uiTextTertiary, fontSize: t.type.caption }]}>Stopped.</Text>
      ) : null}
      {bar ? <ActionBar message={message} plan={bar} /> : null}
    </EnterView>
  );
}

export const MessageView = memo(MessageViewImpl);

type ScaffoldStyles = {
  row: StyleProp<ViewStyle>;
  label: TextStyle;
  labelMeta: TextStyle;
  labelDestructive: TextStyle;
  labelAmber: TextStyle;
  subtitle: StyleProp<TextStyle>;
  meta: TextStyle;
  metaLegendary: StyleProp<TextStyle>;
  reasoningText: StyleProp<TextStyle>;
  terminal: StyleProp<ViewStyle>;
  terminalText: StyleProp<TextStyle>;
  detail: StyleProp<TextStyle>;
  detailFailed: StyleProp<TextStyle>;
};

function scaffoldLabel(t: Tokens, color: string): TextStyle {
  return { color, fontSize: t.type.tool, lineHeight: t.type.lineHeight, flexShrink: 1 };
}

const scaffoldCache = new WeakMap<Tokens, ScaffoldStyles>();

/**
 * Every style a scaffold row paints, built once per resolved theme. Tokens only change with the
 * theme, so rows hand their children the same style objects on every render, which is what lets
 * the memoised children (FadeText, ToolGlyph, ...) skip theirs.
 */
function scaffoldStyles(t: Tokens): ScaffoldStyles {
  let hit = scaffoldCache.get(t);
  if (!hit) {
    const meta: TextStyle = { color: t.conversationScaffoldMeta, fontSize: t.type.tool * 0.85, flexShrink: 0, fontVariant: ['tabular-nums'] };
    const code = { fontSize: t.type.tool * 0.95, lineHeight: t.type.tool * 1.55 };
    const labelMeta = scaffoldLabel(t, t.conversationScaffoldMeta);
    hit = {
      row: [styles.scaffoldRow, { minHeight: t.type.lineHeight }],
      label: scaffoldLabel(t, t.conversationScaffoldText),
      labelMeta,
      labelDestructive: scaffoldLabel(t, t.dtDestructive),
      labelAmber: scaffoldLabel(t, AMBER[t.renderedMode]),
      subtitle: [labelMeta, styles.subtitle],
      meta,
      metaLegendary: [meta, { color: t.toolMemoryLegendaryMeta }],
      reasoningText: [styles.reasoningText, { color: t.conversationScaffoldText, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }],
      terminal: [styles.terminal, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiBgTertiary }],
      terminalText: [styles.code, { color: t.uiTextSecondary, fontSize: t.type.tool * 0.95 }],
      detail: [styles.code, { color: t.uiTextSecondary, ...code }],
      detailFailed: [styles.code, { color: t.dtDestructive, ...code }],
    };
    scaffoldCache.set(t, hit);
  }
  return hit;
}

/** the title's ink: a failure reads red, a warning amber, a running call quiet */
function titleStyle(s: ScaffoldStyles, status: ToolStatus): TextStyle {
  return status === 'error' ? s.labelDestructive : status === 'warning' ? s.labelAmber : status === 'running' ? s.labelMeta : s.label;
}

/**
 * One scaffold line (desktop components/chat/scaffold-row + disclosure-row): the
 * label and its in-flow meta, then a caret to the RIGHT of the text. The press
 * target hugs the content rather than spanning the row. With no hover on touch,
 * `caretRest` is the caret's resting opacity: thinking headers keep a faint one,
 * tool rows show it only once open.
 */
function ScaffoldRow({
  children,
  open,
  onToggle,
  caretRest,
  label,
}: {
  children: ReactNode;
  open: boolean;
  onToggle?: () => void;
  caretRest: number;
  label: string;
}) {
  const t = useTokens();
  const accessibilityState = useMemo(() => ({ expanded: onToggle ? open : undefined, disabled: !onToggle }), [onToggle, open]);
  return (
    <View style={scaffoldStyles(t).row}>
      <Pressable
        onPress={onToggle}
        disabled={!onToggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        style={styles.scaffoldPress}
      >
        <View style={styles.scaffoldContent}>{children}</View>
        {onToggle ? (
          <View style={[styles.caret, { opacity: open ? 0.8 : caretRest }]}>
            <DisclosureCaret open={open} size={11} color={t.conversationScaffoldText} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/*
 * The blocks below compare their props by part reference, not by value, and skip `enabled` and
 * `animationKey`: EnterView reads those once at mount. A stream delta replaces only the part it
 * extended, so it re-renders the live block and nothing before it.
 */

type EnterProps = { enabled: boolean; animationKey: string };

const ReasoningBlock = memo(
  function ReasoningBlock({ text, live, enabled, animationKey }: { text: string; live: boolean } & EnterProps) {
    return (
      <EnterView enabled={enabled} animationKey={animationKey}>
        <Reasoning text={text} live={live} />
      </EnterView>
    );
  },
  (a, b) => a.text === b.text && a.live === b.live,
);

const TextBlock = memo(
  function TextBlock({ text, echoes, streaming }: { text: string; echoes: readonly string[]; streaming: boolean }) {
    const shown = useMemo(() => stripGeneratedImageEchoes(text, echoes), [text, echoes]);
    return <Markdown text={shown} streaming={streaming} />;
  },
  (a, b) => a.text === b.text && a.streaming === b.streaming && sameList(a.echoes, b.echoes),
);

/** the label's row: independent of the reasoning text, so a delta never reaches it */
const ReasoningHeader = memo(function ReasoningHeader({ live, open, onToggle }: { live: boolean; open: boolean; onToggle: () => void }) {
  const t = useTokens();
  const label = live ? 'Thinking' : 'Thought';
  const style = scaffoldStyles(t).label;
  return (
    <ScaffoldRow open={open} onToggle={onToggle} caretRest={0.4} label={label}>
      {live ? (
        <ShimmerText style={style} fontSize={t.type.tool}>
          {label}
        </ShimmerText>
      ) : (
        <Text style={style}>{label}</Text>
      )}
    </ScaffoldRow>
  );
});

const ReasoningText = memo(function ReasoningText({ text }: { text: string }) {
  const t = useTokens();
  return (
    <Text selectable style={scaffoldStyles(t).reasoningText}>
      {text.trim()}
    </Text>
  );
});

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <View style={styles.scaffold}>
      <ReasoningHeader live={live} open={open} onToggle={toggle} />
      {open ? <ReasoningText text={text} /> : null}
    </View>
  );
}

/**
 * Consecutive tool calls, split the desktop's way (ToolGroupSlot): file edits and
 * other cards stay on screen as their own rows, and the reads and commands
 * between them fold into a run.
 */
const ToolBlock = memo(
  function ToolBlock({ tools, live, enabled, animationKey }: { tools: ToolPart[]; live: boolean } & EnterProps) {
    const items = useMemo(() => splitRunItems(tools.map((tool) => tool.name)), [tools]);
    return (
      <EnterView enabled={enabled} animationKey={animationKey}>
        <View style={styles.toolBlock}>
          {items.map((item, index) => {
            if (item.kind === 'card') return <CardSlot key={tools[item.index].id} tool={tools[item.index]} />;
            const run = tools.slice(item.start, item.end + 1);
            if (run.length === 1) return <ToolRow key={run[0].id} tool={run[0]} />;
            return <ToolRun key={run[0].id} tools={run} live={live && index === items.length - 1} />;
          })}
        </View>
      </EnterView>
    );
  },
  (a, b) => a.live === b.live && sameList(a.tools, b.tools),
);

const CardSlot = memo(function CardSlot({ tool }: { tool: ToolPart }) {
  const fallback = <ToolRow tool={tool} />;
  if (tool.name === 'clarify') return <ClarifyCard tool={tool} fallback={fallback} />;
  return <ToolCard tool={tool} fallback={fallback} />;
});

/** a run of two or more calls: one summary line, opening to the rows; live, the newest row ticks under it */
const ToolRun = memo(
  function ToolRun({ tools, live }: { tools: ToolPart[]; live: boolean }) {
    const t = useTokens();
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen((v) => !v), []);
    const summary = useMemo(() => summarizeToolRun(tools, live), [tools, live]);
    const style = scaffoldStyles(t).label;
    return (
      <View style={styles.toolBlock}>
        <View style={styles.scaffold}>
          <ScaffoldRow open={open} onToggle={toggle} caretRest={0} label={summary}>
            {live ? (
              <ShimmerText style={style} fontSize={t.type.tool}>
                {summary}
              </ShimmerText>
            ) : (
              <FadeText style={style} fadeColor={t.uiChatSurfaceBackground}>
                {summary}
              </FadeText>
            )}
          </ScaffoldRow>
        </View>
        {open ? tools.map((tool) => <ToolRow key={tool.id} tool={tool} />) : live ? <ToolRow tool={tools[tools.length - 1]} /> : null}
      </View>
    );
  },
  (a, b) => a.live === b.live && sameList(a.tools, b.tools),
);

const AMBER = { light: '#b45309', dark: '#fcd34d' } as const;

const ToolGlyph = memo(function ToolGlyph({ view, color, legendary = false }: { view: ToolView; color: string; legendary?: boolean }) {
  const t = useTokens();
  let glyph: ReactNode = null;
  if (legendary) {
    glyph = <MemoryGlyph size={GLYPH} />;
  } else if (view.status === 'running') {
    glyph = <GlyphSpinner spinner="breathe" size={GLYPH} label="Running" />;
  } else if (view.status === 'error' || view.status === 'warning') {
    glyph = <AlertGlyph size={GLYPH} color={color} />;
  } else if (view.icon) {
    glyph = <ToolIcon name={view.icon} size={GLYPH} color={t.uiTextTertiary} />;
  }
  return glyph ? <View style={styles.glyph}>{glyph}</View> : null;
});

const ToolRow = memo(function ToolRow({ tool }: { tool: ToolPart }) {
  const t = useTokens();
  const s = scaffoldStyles(t);
  const view = buildToolView(tool);
  // a row that carries a diff opens on it until the reader says otherwise
  const [picked, setPicked] = useState<boolean | null>(null);
  const diffOpen = Boolean(view.inlineDiff);
  const open = picked ?? diffOpen;
  const toggle = useCallback(() => setPicked((current) => !(current ?? diffOpen)), [diffOpen]);
  const expandable = view.status !== 'running' && Boolean(view.hasDetail || view.command || view.inlineDiff || view.imageUrl);
  // an edit that landed with no diff to review is a bare, dead row (a `write_file` create after a reload)
  if (isFileEditTool(tool.name) && tool.status === 'done' && view.status !== 'error' && !view.inlineDiff) return null;
  // a landed memory write wears the desktop's gold → purple chrome instead of the scaffold grey
  const legendary = tool.name === 'memory' && view.status === 'success';

  return (
    <View
      style={[styles.scaffold, open && [styles.toolShell, { borderColor: t.uiStrokeTertiary }], open && isFileEditTool(tool.name) && styles.fileEdit]}
    >
      <View style={open ? [styles.toolShellHeader, { borderBottomColor: t.uiStrokeTertiary }] : undefined}>
        <ScaffoldRow open={open} onToggle={expandable ? toggle : undefined} caretRest={0} label={view.title}>
          <ToolGlyph view={view} color={view.status === 'warning' ? AMBER[t.renderedMode] : t.dtDestructive} legendary={legendary} />
          {view.status === 'running' ? (
            <ShimmerText style={titleStyle(s, view.status)} fontSize={t.type.tool}>
              {view.title}
            </ShimmerText>
          ) : legendary ? (
            <MemoryTitle style={s.label}>{view.title}</MemoryTitle>
          ) : (
            <FadeText style={titleStyle(s, view.status)} fadeColor={t.uiChatSurfaceBackground}>
              {view.title}
            </FadeText>
          )}
          {view.subtitle ? (
            <Text numberOfLines={1} style={s.subtitle}>
              {view.subtitle}
            </Text>
          ) : null}
          {view.status !== 'running' && view.countLabel ? <Text style={legendary ? s.metaLegendary : s.meta}>{view.countLabel}</Text> : null}
          <ToolDiffStats view={view} />
          {view.durationLabel ? <Text style={legendary ? s.metaLegendary : s.meta}>{view.durationLabel}</Text> : null}
        </ScaffoldRow>
      </View>
      {open ? <ToolBody view={view} /> : null}
    </View>
  );
});

/** an opened row's body; mounted only while open, so its detail text is built only when read */
const ToolBody = memo(function ToolBody({ view }: { view: ToolView }) {
  const t = useTokens();
  const s = scaffoldStyles(t);
  const detail = view.detailPreview;
  return (
    <View style={styles.toolBody}>
      <ToolExtras view={view} />
      {view.command ? (
        <View style={s.terminal}>
          <Text selectable style={s.terminalText}>
            <Text style={{ color: t.uiAccent }}>{'$ '}</Text>
            {view.command}
          </Text>
        </View>
      ) : null}
      {detail ? (
        <Text selectable numberOfLines={24} style={view.status === 'error' ? s.detailFailed : s.detail}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
});

const GLYPH = 14;

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' },
  assistant: { gap: 6 },
  notice: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  footnote: { marginTop: 2 },
  scaffold: { opacity: SCAFFOLD_OPACITY, maxWidth: '100%', overflow: 'hidden' },
  scaffoldRow: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%' },
  scaffoldPress: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 6 },
  scaffoldContent: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 6 },
  caret: { width: 12, alignItems: 'center', justifyContent: 'center' },
  subtitle: { flexShrink: 2 },
  glyph: { width: GLYPH, height: GLYPH, alignItems: 'center', justifyContent: 'center' },
  reasoningText: { marginTop: 2, paddingBottom: 4 },
  toolBlock: { gap: 6 },
  // an open edit is the turn's deliverable, not scaffolding: full strength and the full block gap
  fileEdit: { opacity: 1, marginVertical: 6 },
  toolShell: { borderWidth: 1, borderRadius: 5 },
  toolShellHeader: { borderBottomWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  toolBody: { padding: 6, gap: 6 },
  terminal: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6 },
  code: { fontFamily: MONO },
});
