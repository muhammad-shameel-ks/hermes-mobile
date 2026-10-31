/**
 * Assistant markdown through react-native-marked's hook form, so it renders as
 * plain views inside the transcript's own list (the `Markdown` component brings
 * a FlatList of its own). No syntax highlighting, by decision.
 *
 * A reply that streams renders as top-level blocks (markdownBlocks.ts), each a
 * memoised `MarkdownBlock`: a delta re-lexes and re-renders the open block at
 * the tail and nothing before it, parsing the tokens the split already lexed.
 * While `streaming`, the text also goes through `useDeferredValue`, so a tap or
 * drag is not queued behind a markdown render: React renders the new text at
 * low priority and yields to input. A streamed reply's new text is laid out at
 * once but shows behind a reveal head that sweeps at the stream's pace and
 * fades in (streamReveal.ts, streamFade.ts).
 */

import { cloneElement, isValidElement, memo, useDeferredValue, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View, type ColorSchemeName, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { MarkedLexer, type MarkedStyles } from 'react-native-marked';
import Parser from 'react-native-marked/src/lib/Parser';
import type { UserTheme } from 'react-native-marked/src/theme/types';

import { mixPct } from '../ui/color.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { AlertBlock } from './cards/AlertBlock.tsx';
import { MediaAttachment } from './cards/MediaAttachment.tsx';
import { InlineCode } from './InlineCode.tsx';
import { splitMarkdownBlocks, type BlockState, type Lex, type LexResult } from './markdownBlocks.ts';
import { TranscriptRenderer } from './MarkdownRenderer.tsx';
import { OwnSwipe } from './OwnSwipe.tsx';
import { splitMediaTags } from './media.ts';
import { fadeTail, type FadePainter, type FadeProps, type FadeSlot } from './streamFade.ts';
import { REVEAL_TICK_MS, revealClock, StreamReveal } from './streamReveal.ts';

// the same call useMarkdown makes, so a block lexes exactly as it would inside the whole reply
const lex: Lex = (src) => MarkedLexer(src, { gfm: true }) as LexResult;

// the reveal's repaints stop in the background like the decorative loops (ui/clock.ts); only an explicit background pauses
revealClock.setForeground(AppState.currentState !== 'background');
AppState.addEventListener('change', (state) => revealClock.setForeground(state !== 'background'));

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
  const styles = stylesFor(t);
  const theme = { colors: { text: t.uiTextPrimary, link: t.uiAccent, code: t.uiWidgetSurfaceBackground, border: t.uiStrokeTertiary } };
  // what a parser takes: the library's defaults under ours, once per theme
  return { parserStyles: getStyles(styles, t.renderedMode, theme) };
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

const CHILDREN: readonly FadeSlot[] = ['children'];
const LIST: readonly FadeSlot[] = ['li'];
const TABLE: readonly FadeSlot[] = ['header', 'rows'];

const dimStyles = new Map<number, ViewStyle>();

/**
 * A card the fade cannot see into (an artifact, a diff, a listing), dimmed whole with the reveal. A
 * streamed block keeps each top-level card in one for as long as it shows (`boxCards`), so the box
 * never comes and goes and the card never remounts.
 */
const Dimmed = memo(function Dimmed({ alpha, children }: { alpha: number; children: ReactNode }) {
  let style = dimStyles.get(alpha);
  if (!style && alpha < 1) {
    style = { opacity: alpha };
    dimStyles.set(alpha, style);
  }
  return <View style={style}>{children}</View>;
});

const FADE_PAINTER: FadePainter = {
  // host text, the views a block nests it in (OwnSwipe wraps a table's or a code block's scroll view) and a
  // callout's body; react-native-marked's list keeps its items in `li` and its table its cells in `header` and `rows`
  slots: (element) => {
    if (element.type === Text || element.type === View || element.type === ScrollView || element.type === OwnSwipe || element.type === AlertBlock) return CHILDREN;
    if (Array.isArray(element.props.li)) return LIST;
    return Array.isArray(element.props.header) && Array.isArray(element.props.rows) ? TABLE : null;
  },
  // inline code and a boxed card take the alpha whole; anything else opaque (an inline image) stays solid
  dim: (element, alpha) => (element.type === InlineCode || element.type === Dimmed ? cloneElement(element, { alpha }) : element),
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

/**
 * A streamed block's elements behind the reply's reveal: clear past the head, fading in behind it.
 * Repaints come from the stream's own renders and, while anything in the block is still clear or
 * fading, from the shared reveal clock (one timer for every block). A tick skips a block that a
 * render painted less than half a tick ago.
 */
function FadeIn({ elements, start, length, reveal, ink }: { elements: ReactNode[]; start: number; length: number; reveal: StreamReveal; ink: string }) {
  const [, repaint] = useReducer((count: number) => count + 1, 0);
  const now = revealClock.now();
  const spans = reveal.spans(start, start + length, now);
  const animating = spans.length > 0;
  const paintedAt = useRef(now);
  useLayoutEffect(() => {
    paintedAt.current = now;
  });
  useLayoutEffect(() => {
    if (!animating) return;
    return revealClock.subscribe((tick) => {
      if (tick - paintedAt.current >= REVEAL_TICK_MS / 2) repaint();
    });
  }, [animating]);
  const boxed = boxCards(elements);
  return <>{animating ? fadeTail(boxed, spans, ink, FADE_PAINTER) : boxed}</>;
}

const boxedCache = new WeakMap<ReactNode[], ReactNode[]>();

/** a streamed block's elements with each top-level card the fade cannot see into in a `Dimmed`; once per parse */
function boxCards(elements: ReactNode[]): ReactNode[] {
  let boxed = boxedCache.get(elements);
  if (boxed) return boxed;
  let out: ReactNode[] | null = null;
  elements.forEach((element, index) => {
    if (!isValidElement<FadeProps>(element) || FADE_PAINTER.slots(element) !== null) return;
    out ??= elements.slice();
    out[index] = (
      <Dimmed key={element.key} alpha={1}>
        {element}
      </Dimmed>
    );
  });
  boxed = out ?? elements;
  boxedCache.set(elements, boxed);
  return boxed;
}

/**
 * One top-level block, or the whole reply; renders into its parent's view, so blocks add no native
 * views. `tokens` are the open block's lex from the split, so it is not lexed twice. `reveal` is the
 * reply's (null under reduced motion) and `start` is where the block begins in the reply's source.
 */
const MarkdownBlock = memo(function MarkdownBlock({
  text,
  tokens,
  streaming,
  reveal,
  start,
}: {
  text: string;
  tokens: LexResult | undefined;
  streaming: boolean;
  reveal: StreamReveal | null;
  start: number;
}) {
  const t = useTokens();
  const renderer = useMemo(() => new TranscriptRenderer({ streaming }), [streaming]);
  const { parserStyles } = markdownTheme(t);
  const parser = useMemo(() => new Parser({ styles: parserStyles, renderer }), [parserStyles, renderer]);
  const elements = useMemo(() => {
    renderer.reset();
    return parser.parse(tokens ?? lex(text));
  }, [renderer, parser, tokens, text]);
  if (!reveal) return <>{elements}</>;
  return <FadeIn elements={elements} start={start} length={text.length} reveal={reveal} ink={t.uiTextPrimary} />;
});

/** settled replies parsed under one theme: one parser, and the elements of the texts most recently shown */
type Settled = { renderer: TranscriptRenderer; parser: Parser; elements: Map<string, ReactNode[]> };

const settledCache = new WeakMap<Tokens, Settled>();
/** about a dozen chats' visible replies (the controller keeps 12 chats warm) */
const SETTLED_TEXTS = 300;

/**
 * A settled reply's elements, lexed and parsed once per text and theme. A streamed block builds a
 * parser and its elements per mounted instance, so every chat opened again would re-lex every visible
 * reply; from here a chat switched back to mounts the elements it already had. Element trees are
 * immutable, so two rows with the same text can share one.
 */
function settledElements(t: Tokens, text: string): ReactNode[] {
  let entry = settledCache.get(t);
  if (!entry) {
    const renderer = new TranscriptRenderer({ streaming: false });
    entry = { renderer, parser: new Parser({ styles: markdownTheme(t).parserStyles, renderer }), elements: new Map() };
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
  const reduced = useReducedMotion();
  const [reveal] = useState(() => new StreamReveal());
  const length = state.src.length;
  // a reply first seen streaming fades in whole from this render, so its first commit is not solid; a discarded
  // first render discards this instance's state with it
  if (streaming && !reveal.started) reveal.arrive(length, revealClock.now());
  // later text is laid out from this commit: the head sweeps toward it from now, or flushes once the reply settled
  useLayoutEffect(() => {
    const now = revealClock.now();
    if (streaming) reveal.arrive(length, now);
    else reveal.settle(length, now);
  }, [reveal, length, streaming]);
  let start = 0;
  return (
    <View>
      {state.blocks.map((block, index) => {
        const at = start;
        start += block.text.length;
        // `streaming` only changes how a fence renders, so a sealed block without a fence does not re-render when the reply ends
        return <MarkdownBlock key={index} text={block.text} tokens={block.tokens} streaming={streaming && block.fenced} reveal={reduced ? null : reveal} start={at} />;
      })}
    </View>
  );
}

const MarkdownChunk = memo(function MarkdownChunk({ text, streaming, blocks }: { text: string; streaming: boolean; blocks: boolean }) {
  return blocks ? <BlockChunk text={text} streaming={streaming} /> : <SettledChunk text={text} />;
});

/**
 * the reply's markdown, with the files its `MEDIA:` tags deliver rendered between the text around them;
 * `media={false}` for text that is not a session's (a kanban card's), whose paths must not resolve against the open chat
 */
function MarkdownImpl({ text, streaming = false, media = true }: { text: string; streaming?: boolean; media?: boolean }) {
  // a reply that has streamed keeps its blocks when it settles, so nothing remounts (a card keeps its state)
  const blocks = useRef(false);
  if (streaming) blocks.current = true;
  const deferred = useDeferredValue(text);
  const shown = streaming ? deferred : text;
  const segments = useMemo(() => (media ? splitMediaTags(shown) : null), [shown, media]);
  if (!segments || (segments.length === 1 && segments[0].kind === 'text')) return <MarkdownChunk text={shown} streaming={streaming} blocks={blocks.current} />;
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
