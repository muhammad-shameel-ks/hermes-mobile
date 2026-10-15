/**
 * One transcript message. User turns are bubbles; assistant turns render their
 * parts in order - a collapsed reasoning disclosure, markdown text, and tool calls.
 * Reasoning and tool calls are the desktop's transcript scaffolding: quiet,
 * faded one-line rows (a glyph, a title, trailing meta, a caret right of the
 * text) where a run of two or more calls folds into one summary line. A turn
 * that arrives live slides in with the desktop's enter motion. Tool cards are
 * later work.
 */

import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

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
import { generatedImageEchoSources, stripGeneratedImageEchoes } from './generatedImage.ts';
import { Markdown } from './Markdown.tsx';
import { MemoryGlyph, MemoryTitle, ReviewNote } from './MemoryChrome.tsx';
import { parseReviewNote } from './reviewNote.ts';
import { ApprovalTimedOutAction } from './ApprovalTimedOutAction.tsx';
import { buildToolView, isFileEditTool, splitRunItems, summarizeToolRun, type ToolView } from './toolView.ts';
import { APPROVAL_COPY } from './requests.ts';
import type { Message, Part, ToolPart } from './transcript.ts';
import { TurnActivity } from './TurnActivity.tsx';

type Block = { kind: 'text'; text: string } | { kind: 'reasoning'; text: string } | { kind: 'tools'; tools: ToolPart[] };

/** consecutive tool parts become one block, so a run of calls reads as one row */
function blocks(parts: Part[]): Block[] {
  const out: Block[] = [];
  for (const part of parts) {
    if (part.kind === 'tool') {
      const last = out[out.length - 1];
      if (last?.kind === 'tools') last.tools.push(part);
      else out.push({ kind: 'tools', tools: [part] });
    } else if (part.text.trim()) {
      out.push(part);
    }
  }
  return out;
}

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
  const echoes = generatedImageEchoSources(message.parts);
  return (
    <EnterView enabled={streaming} animationKey={`assistant-message:${message.id}`} style={styles.assistant}>
      {content.map((block, index) => {
        const last = index === content.length - 1;
        const key = `${message.id}:${index}`;
        if (block.kind === 'reasoning') {
          return (
            <EnterView key={index} enabled={streaming} animationKey={`reasoning:${key}`}>
              <Reasoning text={block.text} live={streaming && last} />
            </EnterView>
          );
        }
        if (block.kind === 'tools') {
          return (
            <EnterView key={index} enabled={streaming} animationKey={`tool-run:${key}`}>
              <ToolBlock tools={block.tools} live={streaming && last} />
            </EnterView>
          );
        }
        return <Markdown key={index} text={stripGeneratedImageEchoes(block.text, echoes)} streaming={streaming && last} />;
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
  return (
    <View style={[styles.scaffoldRow, { minHeight: t.type.lineHeight }]}>
      <Pressable
        onPress={onToggle}
        disabled={!onToggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: onToggle ? open : undefined, disabled: !onToggle }}
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

function scaffoldLabel(t: Tokens, color = t.conversationScaffoldText): TextStyle {
  return { color, fontSize: t.type.tool, lineHeight: t.type.lineHeight, flexShrink: 1 };
}

function scaffoldMeta(t: Tokens): TextStyle {
  return { color: t.conversationScaffoldMeta, fontSize: t.type.tool * 0.85, flexShrink: 0, fontVariant: ['tabular-nums'] };
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const label = live ? 'Thinking' : 'Thought';
  return (
    <View style={styles.scaffold}>
      <ScaffoldRow open={open} onToggle={() => setOpen((v) => !v)} caretRest={0.4} label={label}>
        {live ? (
          <ShimmerText style={scaffoldLabel(t)} fontSize={t.type.tool}>
            {label}
          </ShimmerText>
        ) : (
          <Text style={scaffoldLabel(t)}>{label}</Text>
        )}
      </ScaffoldRow>
      {open ? (
        <Text selectable style={[styles.reasoningText, { color: t.conversationScaffoldText, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }]}>
          {text.trim()}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Consecutive tool calls, split the desktop's way (ToolGroupSlot): file edits and
 * other cards stay on screen as their own rows, and the reads and commands
 * between them fold into a run.
 */
function ToolBlock({ tools, live }: { tools: ToolPart[]; live: boolean }) {
  const items = splitRunItems(tools.map((tool) => tool.name));
  return (
    <View style={styles.toolBlock}>
      {items.map((item, index) => {
        if (item.kind === 'card') {
          const tool = tools[item.index];
          if (tool.name === 'clarify') return <ClarifyCard key={tool.id} tool={tool} fallback={<ToolRow tool={tool} />} />;
          return <ToolCard key={tool.id} tool={tool} fallback={<ToolRow tool={tool} />} />;
        }
        const run = tools.slice(item.start, item.end + 1);
        if (run.length === 1) return <ToolRow key={run[0].id} tool={run[0]} />;
        return <ToolRun key={run[0].id} tools={run} live={live && index === items.length - 1} />;
      })}
    </View>
  );
}

/** a run of two or more calls: one summary line, opening to the rows; live, the newest row ticks under it */
function ToolRun({ tools, live }: { tools: ToolPart[]; live: boolean }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const summary = summarizeToolRun(tools, live);
  return (
    <View style={styles.toolBlock}>
      <View style={styles.scaffold}>
        <ScaffoldRow open={open} onToggle={() => setOpen((v) => !v)} caretRest={0} label={summary}>
          {live ? (
            <ShimmerText style={scaffoldLabel(t)} fontSize={t.type.tool}>
              {summary}
            </ShimmerText>
          ) : (
            <FadeText style={scaffoldLabel(t)} fadeColor={t.uiChatSurfaceBackground}>
              {summary}
            </FadeText>
          )}
        </ScaffoldRow>
      </View>
      {open ? tools.map((tool) => <ToolRow key={tool.id} tool={tool} />) : live ? <ToolRow tool={tools[tools.length - 1]} /> : null}
    </View>
  );
}

const AMBER = { light: '#b45309', dark: '#fcd34d' } as const;

function ToolGlyph({ view, color, legendary = false }: { view: ToolView; color: string; legendary?: boolean }) {
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
}

function ToolRow({ tool }: { tool: ToolPart }) {
  const t = useTokens();
  const view = useMemo(() => buildToolView(tool), [tool]);
  // a row that carries a diff opens on it until the reader says otherwise
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? Boolean(view.inlineDiff);
  const expandable = view.status !== 'running' && Boolean(view.detail || view.command || view.inlineDiff || view.imageUrl);
  // an edit that landed with no diff to review is a bare, dead row (a `write_file` create after a reload)
  if (isFileEditTool(tool.name) && tool.status === 'done' && view.status !== 'error' && !view.inlineDiff) return null;
  const failed = view.status === 'error';
  // a landed memory write wears the desktop's gold → purple chrome instead of the scaffold grey
  const legendary = tool.name === 'memory' && view.status === 'success';
  const meta = legendary ? [scaffoldMeta(t), { color: t.toolMemoryLegendaryMeta }] : scaffoldMeta(t);
  const titleColor =
    failed ? t.dtDestructive : view.status === 'warning' ? AMBER[t.renderedMode] : view.status === 'running' ? t.conversationScaffoldMeta : t.conversationScaffoldText;

  return (
    <View
      style={[styles.scaffold, open && [styles.toolShell, { borderColor: t.uiStrokeTertiary }], open && isFileEditTool(tool.name) && styles.fileEdit]}
    >
      <View style={open ? [styles.toolShellHeader, { borderBottomColor: t.uiStrokeTertiary }] : undefined}>
        <ScaffoldRow open={open} onToggle={expandable ? () => setPicked(!open) : undefined} caretRest={0} label={view.title}>
          <ToolGlyph view={view} color={view.status === 'warning' ? AMBER[t.renderedMode] : t.dtDestructive} legendary={legendary} />
          {view.status === 'running' ? (
            <ShimmerText style={scaffoldLabel(t, titleColor)} fontSize={t.type.tool}>
              {view.title}
            </ShimmerText>
          ) : legendary ? (
            <MemoryTitle style={scaffoldLabel(t)}>{view.title}</MemoryTitle>
          ) : (
            <FadeText style={scaffoldLabel(t, titleColor)} fadeColor={t.uiChatSurfaceBackground}>
              {view.title}
            </FadeText>
          )}
          {view.status !== 'running' && view.countLabel ? <Text style={meta}>{view.countLabel}</Text> : null}
          <ToolDiffStats view={view} />
          {view.durationLabel ? <Text style={meta}>{view.durationLabel}</Text> : null}
        </ScaffoldRow>
      </View>
      {open ? (
        <View style={styles.toolBody}>
          <ToolExtras view={view} />
          {view.command ? (
            <View style={[styles.terminal, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiBgTertiary }]}>
              <Text selectable style={[styles.code, { color: t.uiTextSecondary, fontSize: t.type.tool * 0.95 }]}>
                <Text style={{ color: t.uiAccent }}>{'$ '}</Text>
                {view.command}
              </Text>
            </View>
          ) : null}
          {view.detail ? (
            <Text
              selectable
              numberOfLines={24}
              style={[styles.code, { color: failed ? t.dtDestructive : t.uiTextSecondary, fontSize: t.type.tool * 0.95, lineHeight: t.type.tool * 1.55 }]}
            >
              {view.detail}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

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
