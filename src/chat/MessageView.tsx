/**
 * One transcript message. User turns are bubbles; assistant turns render their
 * parts in order - a collapsed reasoning disclosure, markdown text, and tool calls,
 * where two or more consecutive calls collapse into one tool run row. A turn that
 * arrives live slides in with the desktop's enter motion. Tool cards, the action
 * bar and the desktop's live tool ticker are later work.
 */

import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { DisclosureCaret, EnterView } from '../ui/motion.tsx';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { Markdown } from './Markdown.tsx';
import type { Message, Part, ToolPart } from './transcript.ts';

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

function MessageViewImpl({ message }: { message: Message }) {
  const t = useTokens();

  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
    return (
      <View style={styles.userRow}>
        <View style={[styles.bubble, { backgroundColor: t.uiChatBubbleBackground, borderRadius: t.radius['3xl'] }]}>
          <Text selectable style={{ color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight }}>
            {text}
          </Text>
        </View>
      </View>
    );
  }

  if (message.role === 'system') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
    return (
      <View style={[styles.notice, { borderColor: t.uiStrokeTertiary, borderRadius: t.radius['2xl'] }]}>
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }}>{text}</Text>
      </View>
    );
  }

  const streaming = message.status === 'streaming';
  const content = blocks(message.parts);
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
              <ToolBlock tools={block.tools} />
            </EnterView>
          );
        }
        return <Markdown key={index} text={block.text} />;
      })}
      {message.status === 'error' ? (
        <Text style={[styles.footnote, { color: t.dtDestructive, fontSize: t.type.caption }]}>
          {message.error ? `The turn failed: ${message.error}` : 'The turn failed.'}
        </Text>
      ) : null}
      {message.status === 'interrupted' ? (
        <Text style={[styles.footnote, { color: t.uiTextTertiary, fontSize: t.type.caption }]}>Stopped.</Text>
      ) : null}
    </EnterView>
  );
}

export const MessageView = memo(MessageViewImpl);

function Disclosure({ open, t }: { open: boolean; t: Tokens }) {
  return (
    <View style={styles.caret}>
      <DisclosureCaret open={open} size={12} color={t.uiTextTertiary} />
    </View>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.block}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.disclosureRow}
      >
        <Disclosure open={open} t={t} />
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>{live ? 'Thinking…' : 'Thought'}</Text>
      </Pressable>
      {open ? (
        <Text
          selectable
          style={[styles.reasoningText, { color: t.uiTextTertiary, borderLeftColor: t.uiStrokeTertiary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }]}
        >
          {text.trim()}
        </Text>
      ) : null}
    </View>
  );
}

const pluralTools = (n: number) => (n === 1 ? '1 tool' : `${n} tools`);

function ToolBlock({ tools }: { tools: ToolPart[] }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  if (tools.length === 1) return <ToolRow tool={tools[0]} />;
  const running = tools.filter((tool) => tool.status === 'running').length;
  return (
    <View style={[styles.block, styles.toolGroup, { borderColor: t.uiStrokeQuaternary, borderRadius: t.radius['2xl'] }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.toolHeader}
      >
        <Disclosure open={open} t={t} />
        {running ? <ActivityIndicator size="small" color={t.uiTextTertiary} style={styles.toolSpinner} /> : null}
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.tool, fontFamily: MONO, flexShrink: 1 }} numberOfLines={1}>
          {running ? `Running ${pluralTools(tools.length)}` : `Used ${pluralTools(tools.length)}`}
          <Text style={{ color: t.uiTextQuaternary }}>{` · ${[...new Set(tools.map((tool) => tool.name))].join(', ')}`}</Text>
        </Text>
      </Pressable>
      {open ? (
        <View style={[styles.toolGroupBody, { borderTopColor: t.uiStrokeQuaternary }]}>
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} nested />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({ tool, nested = false }: { tool: ToolPart; nested?: boolean }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const detail = tool.result?.trim() || tool.summary || '';
  const expandable = tool.status === 'done' && detail !== '';
  const duration = tool.durationS !== undefined && tool.durationS >= 0.1 ? `${tool.durationS.toFixed(1)}s` : '';
  return (
    <View style={nested ? undefined : [styles.block, styles.toolGroup, { borderColor: t.uiStrokeQuaternary, borderRadius: t.radius['2xl'] }]}>
      <Pressable
        onPress={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !expandable }}
        style={styles.toolHeader}
      >
        {expandable ? <Disclosure open={open} t={t} /> : <View style={styles.caretSpacer} />}
        {tool.status === 'running' ? (
          <ActivityIndicator size="small" color={t.uiTextTertiary} style={styles.toolSpinner} />
        ) : null}
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.tool, fontFamily: MONO }}>{tool.name}</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, fontFamily: MONO, flex: 1 }} numberOfLines={1}>
          {tool.summary || tool.context ? ` ${tool.summary || tool.context}` : ''}
        </Text>
        {duration ? <Text style={{ color: t.uiTextQuaternary, fontSize: t.type.tool, fontFamily: MONO }}>{duration}</Text> : null}
      </Pressable>
      {open ? (
        <View style={[styles.toolResult, { backgroundColor: t.uiWidgetSurfaceBackground, borderRadius: t.radius.xl }]}>
          {tool.context && tool.summary ? (
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, fontFamily: MONO, marginBottom: 6 }} selectable>
              {tool.context}
            </Text>
          ) : null}
          <Text
            selectable
            numberOfLines={24}
            style={{ color: t.uiTextSecondary, fontSize: t.type.tool, lineHeight: t.type.tool * 1.5, fontFamily: MONO }}
          >
            {detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' },
  assistant: { gap: 2 },
  block: { marginBottom: 8 },
  notice: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  footnote: { marginTop: 2 },
  caret: { width: 12, marginRight: 4, alignItems: 'center', justifyContent: 'center' },
  caretSpacer: { width: 16 },
  disclosureRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 2 },
  reasoningText: { marginTop: 6, marginLeft: 5, paddingLeft: 10, borderLeftWidth: 1 },
  toolGroup: { borderWidth: 1, overflow: 'hidden' },
  toolHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 32, paddingHorizontal: 10, gap: 2 },
  toolSpinner: { transform: [{ scale: 0.7 }], marginRight: 2 },
  toolGroupBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 2 },
  toolResult: { marginHorizontal: 10, marginBottom: 10, padding: 10 },
});
