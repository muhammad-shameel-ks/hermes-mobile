/**
 * Assistant markdown through react-native-marked's hook form, so it renders as
 * plain views inside the transcript's own list (the `Markdown` component brings
 * a FlatList of its own). No syntax highlighting, by decision.
 *
 * A reply that streams renders as top-level blocks (markdownBlocks.ts), each a
 * memoised `MarkdownBlock`: a delta re-lexes and re-renders the open block at
 * the tail and nothing before it. While `streaming`, the text also goes through
 * `useDeferredValue`, so a tap or drag is not queued behind a markdown render:
 * React renders the new text at low priority and yields to input. A streamed
 * block's newest text fades in (streamFade.ts).
 */

import { memo, useDeferredValue, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type ColorSchemeName, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { MarkedLexer, useMarkdown, type MarkedStyles } from 'react-native-marked';
import Parser from 'react-native-marked/src/lib/Parser';
import type { UserTheme } from 'react-native-marked/src/theme/types';

import { mixPct } from '../ui/color.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { MediaAttachment } from './cards/MediaAttachment.tsx';
import { splitMarkdownBlocks, type BlockState, type Lex } from './markdownBlocks.ts';
import { TranscriptRenderer } from './MarkdownRenderer.tsx';
import { splitMediaTags } from './media.ts';
import { fadeSpans, fadeTail, growTrail, type FadePainter, type FadeTrail } from './streamFade.ts';

// the same call useMarkdown makes, so a block lexes exactly as it would inside the whole reply
const lex: Lex = (src) => MarkedLexer(src, { gfm: true }) as ReturnType<Lex>;

// useMarkdown's own style merge; required, not imported, because its source does not pass this project's strict checks
const getStyles: (styles?: MarkedStyles, colorScheme?: ColorSchemeName, theme?: UserTheme) => MarkedStyles = require('react-native-marked/src/theme/styles').default;

function stylesFor(t: Tokens): MarkedStyles {
  const text = { color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight };
  const heading = { color: t.uiTextPrimary, fontWeight: '600' as const, marginTop: 6, marginBottom: 4 };
  return {
    text,
    paragraph: { marginTop: 0, marginBottom: 8, paddingVertical: 0 },
    strong: { ...text, fontWeight: '700' },
    em: { ...text, fontStyle: 'italic' },
    strikethrough: { ...text, textDecorationLine: 'line-through' },
    link: { ...text, color: t.uiAccent, textDecorationLine: 'underline' },
    h1: { ...heading, fontSize: t.type.text * 1.45, lineHeight: t.type.text * 1.9 },
    h2: { ...heading, fontSize: t.type.text * 1.25, lineHeight: t.type.text * 1.7 },
    h3: { ...heading, fontSize: t.type.text * 1.1, lineHeight: t.type.lineHeight },
    h4: { ...heading, fontSize: t.type.text, lineHeight: t.type.lineHeight },
    h5: { ...heading, fontSize: t.type.text, lineHeight: t.type.lineHeight },
    h6: { ...heading, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight },
    // the library's own codespan is italic and light; the desktop's is upright mono on a neutral gray chip
    codespan: {
      fontFamily: MONO,
      fontSize: t.type.text * 0.92,
      fontStyle: 'normal',
      fontWeight: '400',
      color: t.uiInlineCodeForeground,
      backgroundColor: t.uiInlineCodeBackground,
    },
    code: {
      backgroundColor: t.uiWidgetSurfaceBackground,
      borderColor: t.uiStrokeTertiary,
      borderWidth: 1,
      borderRadius: t.radius['3xl'],
      padding: 10,
      marginBottom: 8,
    },
    codeText: { fontFamily: MONO, fontSize: t.type.tool, lineHeight: t.type.tool * 1.55, color: t.uiTextPrimary },
    blockquote: { borderLeftWidth: 2, borderLeftColor: t.uiStrokePrimary, paddingLeft: 10, marginBottom: 8, opacity: 0.9 },
    hr: { borderBottomWidth: 1, borderBottomColor: t.uiStrokeTertiary, marginVertical: 10 },
    list: { marginBottom: 8 },
    li: { ...text },
    table: { borderColor: t.uiStrokeTertiary, borderWidth: 1, borderRadius: t.radius.lg, marginBottom: 8 },
    tableRow: { borderColor: t.uiStrokeTertiary },
    tableCell: { padding: 6 },
  };
}

function buildTheme(t: Tokens) {
  return {
    styles: stylesFor(t),
    theme: { colors: { text: t.uiTextPrimary, link: t.uiAccent, code: t.uiWidgetSurfaceBackground, border: t.uiStrokeTertiary } },
  };
}

const themeCache = new WeakMap<Tokens, ReturnType<typeof buildTheme>>();

function markdownTheme(t: Tokens) {
  let entry = themeCache.get(t);
  if (!entry) {
    entry = buildTheme(t);
    themeCache.set(t, entry);
  }
  return entry;
}

const inkStyles = new Map<string, TextStyle>();

const FADE_PAINTER: FadePainter = {
  // host text and the views a block nests it in; react-native-marked's list keeps its items in `li`
  slot: (element) => {
    if (element.type === Text || element.type === View || element.type === ScrollView) return 'children';
    return Array.isArray(element.props.li) ? 'li' : null;
  },
  ink: (element) => {
    const color = StyleSheet.flatten(element.props.style)?.color;
    return typeof color === 'string' ? color : undefined;
  },
  paint: (text, ink, alpha, key) => {
    const color = mixPct(ink, alpha, 'transparent');
    let style = inkStyles.get(color);
    if (!style) {
      style = { color };
      inkStyles.set(color, style);
    }
    return (
      <Text key={key} style={style}>
        {text}
      </Text>
    );
  },
};

/** how soon a block whose tail is still fading repaints when no new text arrives to repaint it */
const FADE_TICK_MS = 50;

/**
 * A streamed block's elements with the newest text fading in. The trail grows while the block is
 * the open tail (`live`) and keeps ageing after it seals or the reply ends, so no chunk freezes
 * half-inked; repaints come from the stream's own renders, and from a short timer only while a
 * fade is still running with nothing else arriving.
 */
function FadeIn({ elements, length, live, ink }: { elements: ReactNode[]; length: number; live: boolean; ink: string }) {
  const reduced = useReducedMotion();
  const trail = useRef<FadeTrail | null>(null);
  const [, repaint] = useReducer((count: number) => count + 1, 0);
  const now = performance.now();
  // a cache over (length, clock): a render React discards or repeats records the same growth
  if (reduced) trail.current = null;
  else if (live) trail.current = growTrail(trail.current, length, now);
  else if (trail.current && trail.current.length !== length) trail.current = null;
  const spans = trail.current ? fadeSpans(trail.current, now) : [];
  const fading = spans.length > 0;
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(repaint, FADE_TICK_MS);
    return () => clearTimeout(timer);
  });
  return <>{fading ? fadeTail(elements, spans, ink, FADE_PAINTER) : elements}</>;
}

/**
 * One top-level block, or the whole reply; renders into its parent's view, so blocks add no native
 * views. `fades` is fixed per call site: only a reply seen streaming fades its text in.
 */
const MarkdownBlock = memo(function MarkdownBlock({ text, streaming, fades, live }: { text: string; streaming: boolean; fades: boolean; live: boolean }) {
  const t = useTokens();
  const renderer = useMemo(() => new TranscriptRenderer({ streaming }), [streaming]);
  renderer.reset();
  const { styles, theme } = markdownTheme(t);
  const elements = useMarkdown(text, { styles, theme, colorScheme: t.renderedMode, renderer });
  if (!fades) return <>{elements}</>;
  return <FadeIn elements={elements} length={text.length} live={live} ink={t.uiTextPrimary} />;
});

/** settled replies parsed under one theme: one parser, and the elements of the texts most recently shown */
type Settled = { renderer: TranscriptRenderer; parser: Parser; elements: Map<string, ReactNode[]> };

const settledCache = new WeakMap<Tokens, Settled>();
/** about a dozen chats' visible replies (the controller keeps 12 chats warm) */
const SETTLED_TEXTS = 300;

/**
 * A settled reply's elements, lexed and parsed once per text and theme. `useMarkdown` builds styles, a
 * parser and the elements per mounted instance, so every chat opened again re-lexed every visible reply;
 * from here a chat switched back to mounts the elements it already had. Element trees are immutable,
 * so two rows with the same text can share one.
 */
function settledElements(t: Tokens, text: string): ReactNode[] {
  let entry = settledCache.get(t);
  if (!entry) {
    const { styles, theme } = markdownTheme(t);
    const renderer = new TranscriptRenderer({ streaming: false });
    entry = { renderer, parser: new Parser({ styles: getStyles(styles, t.renderedMode, theme), renderer }), elements: new Map() };
    settledCache.set(t, entry);
  }
  const hit = entry.elements.get(text);
  if (hit) {
    // most recently used last, so the oldest text is the one evicted
    entry.elements.delete(text);
    entry.elements.set(text, hit);
    return hit;
  }
  entry.renderer.reset();
  const elements = entry.parser.parse(lex(text));
  if (entry.elements.size >= SETTLED_TEXTS) entry.elements.delete(entry.elements.keys().next().value!);
  entry.elements.set(text, elements);
  return elements;
}

/** a reply that was settled when it mounted (one seen streaming keeps its blocks instead) */
const SettledChunk = memo(function SettledChunk({ text }: { text: string }) {
  const t = useTokens();
  return <View>{settledElements(t, text)}</View>;
});

function BlockChunk({ text, streaming }: { text: string; streaming: boolean }) {
  // a cache only: the blocks are a function of `text`, so a render React discards or repeats cannot change them
  const previous = useRef<BlockState | null>(null);
  const state = splitMarkdownBlocks(text, lex, previous.current);
  previous.current = state;
  return (
    <View>
      {state.blocks.map((block, index) => (
        // `streaming` only changes how a fence renders and `live` only the open tail, so a sealed block without a fence does not re-render when the reply ends
        <MarkdownBlock key={index} text={block.text} streaming={streaming && block.fenced} fades live={streaming && index === state.blocks.length - 1} />
      ))}
    </View>
  );
}

const MarkdownChunk = memo(function MarkdownChunk({ text, streaming, blocks }: { text: string; streaming: boolean; blocks: boolean }) {
  return blocks ? <BlockChunk text={text} streaming={streaming} /> : <SettledChunk text={text} />;
});

/** the reply's markdown, with the files its `MEDIA:` tags deliver rendered between the text around them */
function MarkdownImpl({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // a reply that has streamed keeps its blocks when it settles, so nothing remounts (a card keeps its state)
  const blocks = useRef(false);
  if (streaming) blocks.current = true;
  const deferred = useDeferredValue(text);
  const shown = streaming ? deferred : text;
  const segments = useMemo(() => splitMediaTags(shown), [shown]);
  if (segments.length === 1 && segments[0].kind === 'text') return <MarkdownChunk text={shown} streaming={streaming} blocks={blocks.current} />;
  return (
    <View>
      {segments.map((segment, index) =>
        segment.kind === 'media' ? (
          <MediaAttachment key={`media:${index}:${segment.path}`} path={segment.path} />
        ) : segment.text.trim() ? (
          <MarkdownChunk key={`text:${index}`} text={segment.text} streaming={streaming} blocks={blocks.current} />
        ) : null,
      )}
    </View>
  );
}

export const Markdown = memo(MarkdownImpl);
