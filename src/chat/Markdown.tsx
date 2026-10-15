/**
 * Assistant markdown through react-native-marked's hook form, so it renders as
 * plain views inside the transcript's own list (the `Markdown` component brings
 * a FlatList of its own). No syntax highlighting, by decision.
 */

import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';

import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { MediaAttachment } from './cards/MediaAttachment.tsx';
import { TranscriptRenderer } from './MarkdownRenderer.tsx';
import { splitMediaTags } from './media.ts';

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

function MarkdownChunk({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useTokens();
  const renderer = useMemo(() => new TranscriptRenderer({ streaming }), [streaming]);
  renderer.reset();
  const styles = useMemo(() => stylesFor(t), [t]);
  const theme = useMemo(
    () => ({ colors: { text: t.uiTextPrimary, link: t.uiAccent, code: t.uiWidgetSurfaceBackground, border: t.uiStrokeTertiary } }),
    [t],
  );
  const elements = useMarkdown(text, { styles, theme, colorScheme: t.renderedMode, renderer });
  return <View>{elements}</View>;
}

/** the reply's markdown, with the files its `MEDIA:` tags deliver rendered between the text around them */
function MarkdownImpl({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const segments = useMemo(() => splitMediaTags(text), [text]);
  if (segments.length === 1 && segments[0].kind === 'text') return <MarkdownChunk text={text} streaming={streaming} />;
  return (
    <View>
      {segments.map((segment, index) =>
        segment.kind === 'media' ? (
          <MediaAttachment key={`media:${index}:${segment.path}`} path={segment.path} />
        ) : segment.text.trim() ? (
          <MarkdownChunk key={`text:${index}`} text={segment.text} streaming={streaming} />
        ) : null,
      )}
    </View>
  );
}

export const Markdown = memo(MarkdownImpl);
