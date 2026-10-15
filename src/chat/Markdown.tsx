/**
 * Assistant markdown through react-native-marked's hook form, so it renders as
 * plain views inside the transcript's own list (the `Markdown` component brings
 * a FlatList of its own). No syntax highlighting, by decision.
 *
 * A reply that streams renders as top-level blocks (markdownBlocks.ts), each a
 * memoised `MarkdownBlock`: a delta re-lexes and re-renders the open block at
 * the tail and nothing before it. While `streaming`, the text also goes through
 * `useDeferredValue`, so a tap or drag is not queued behind a markdown render:
 * React renders the new text at low priority and yields to input.
 */

import { memo, useDeferredValue, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { MarkedLexer, useMarkdown, type MarkedStyles } from 'react-native-marked';

import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { MediaAttachment } from './cards/MediaAttachment.tsx';
import { splitMarkdownBlocks, type BlockState, type Lex } from './markdownBlocks.ts';
import { TranscriptRenderer } from './MarkdownRenderer.tsx';
import { splitMediaTags } from './media.ts';

// the same call useMarkdown makes, so a block lexes exactly as it would inside the whole reply
const lex: Lex = (src) => MarkedLexer(src, { gfm: true }) as ReturnType<Lex>;

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

/** one top-level block, or the whole reply; renders into its parent's view, so blocks add no native views */
const MarkdownBlock = memo(function MarkdownBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useTokens();
  const renderer = useMemo(() => new TranscriptRenderer({ streaming }), [streaming]);
  renderer.reset();
  const { styles, theme } = markdownTheme(t);
  const elements = useMarkdown(text, { styles, theme, colorScheme: t.renderedMode, renderer });
  return <>{elements}</>;
});

function WholeChunk({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <View>
      <MarkdownBlock text={text} streaming={streaming} />
    </View>
  );
}

function BlockChunk({ text, streaming }: { text: string; streaming: boolean }) {
  // a cache only: the blocks are a function of `text`, so a render React discards or repeats cannot change them
  const previous = useRef<BlockState | null>(null);
  const state = splitMarkdownBlocks(text, lex, previous.current);
  previous.current = state;
  return (
    <View>
      {state.blocks.map((block, index) => (
        // `streaming` only changes how a fence renders, so blocks without one do not re-render when it ends
        <MarkdownBlock key={index} text={block.text} streaming={streaming && block.fenced} />
      ))}
    </View>
  );
}

const MarkdownChunk = memo(function MarkdownChunk({ text, streaming, blocks }: { text: string; streaming: boolean; blocks: boolean }) {
  return blocks ? <BlockChunk text={text} streaming={streaming} /> : <WholeChunk text={text} streaming={streaming} />;
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
