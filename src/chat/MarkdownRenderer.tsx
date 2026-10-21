/**
 * react-native-marked's renderer, extended with the transcript's inline pieces:
 * images and media links become the lightbox image, player or file card;
 * `listing`, `svg`, `diff` and artifact-sized fences become their cards; alert
 * blockquotes become callouts; and a link to a file on the gateway's disk
 * degrades to copy-path. Mermaid, KaTeX and URL embeds are not here by
 * decision (no WebView): they stay a code block and a plain link.
 *
 * Keys come from a counter that `reset()` rewinds before every parse, so an
 * element keeps its key from one streaming delta to the next. The base
 * renderer's slugger never rewinds, which would remount the whole reply (and a
 * card's own state) on every token. Each streamed block (Markdown.tsx) owns its
 * renderer, so its keys are local to it and a block's key never depends on the
 * blocks around it.
 */

import type { ReactNode } from 'react';
import { Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Renderer } from 'react-native-marked';

import { useTokens } from '../ui/tokens.ts';
import { detectArtifact, sanitizeLanguageTag } from './artifact.ts';
import { AlertBlock, extractAlert } from './cards/AlertBlock.tsx';
import { ArtifactCard } from './cards/ArtifactCard.tsx';
import { copyText } from '../ui/clipboard.ts';
import { DiffView } from './cards/DiffView.tsx';
import { ListingSet } from './cards/ListingCard.tsx';
import { MediaAttachment } from './cards/MediaAttachment.tsx';
import { MediaImage } from './cards/MediaImage.tsx';
import { SvgBlock } from './cards/SvgBlock.tsx';
import { VideoCard } from './cards/VideoCard.tsx';
import { AudioCard } from './cards/AudioCard.tsx';
import { InlineCode } from './InlineCode.tsx';
import { OwnSwipe } from './OwnSwipe.tsx';
import { parseListings } from './listing.ts';
import { isFileMediaPath, mediaKind, mediaPathFromMarkdownHref } from './media.ts';

function CodeSlab({ children }: { children: ReactNode }) {
  const t = useTokens();
  return <View style={{ backgroundColor: t.uiBgEditor, borderRadius: t.radius['3xl'], overflow: 'hidden', marginBottom: 8 }}>{children}</View>;
}

export class TranscriptRenderer extends Renderer {
  private counter = 0;
  private readonly streaming: boolean;

  constructor(options: { streaming?: boolean } = {}) {
    super({ selectable: true });
    this.streaming = options.streaming ?? false;
  }

  reset(): void {
    this.counter = 0;
  }

  override getKey(): string {
    this.counter += 1;
    return `md-${this.counter}`;
  }

  override image(uri: string, alt?: string, _style?: ImageStyle, title?: string): ReactNode {
    const key = this.getKey();
    switch (mediaKind(uri)) {
      case 'video':
        return <VideoCard key={key} path={uri} />;
      case 'audio':
        return <AudioCard key={key} path={uri} />;
      default:
        return <MediaImage key={key} src={uri} alt={alt || title} />;
    }
  }

  override codespan(text: string, styles?: TextStyle): ReactNode {
    return <InlineCode key={this.getKey()} text={text} style={styles ?? {}} />;
  }

  override link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode {
    const path = mediaPathFromMarkdownHref(href) ?? (!href.startsWith('#') && isFileMediaPath(href) ? href : null);
    if (!path) return super.link(children, href, styles, title);
    // a media file is a block, not a run of text; anything else has no door until Files lands
    if (mediaKind(path) !== 'file') return <MediaAttachment key={this.getKey()} path={path} />;
    return (
      <Text
        key={this.getKey()}
        selectable
        accessibilityRole="button"
        accessibilityLabel={`Copy the path ${path}`}
        onPress={() => void copyText(path)}
        style={styles}
      >
        {children}
      </Text>
    );
  }

  override code(text: string, language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode {
    const tag = sanitizeLanguageTag(language ?? '');
    const key = this.getKey();

    const artifact = detectArtifact(language, text);
    if (artifact) return <ArtifactCard key={key} code={text} detection={artifact} streaming={this.streaming} />;

    if (tag === 'listing') {
      // mid-stream the JSON is a prefix and does not parse; the plain fence below holds the place
      const listings = this.streaming ? [] : parseListings(text);
      if (listings.length > 0) return <ListingSet key={key} listings={listings} />;
    }
    if (tag === 'svg' && !this.streaming && /<svg[\s>]/i.test(text)) return <SvgBlock key={key} xml={text} />;
    if (tag === 'diff' || tag === 'patch') {
      return (
        <CodeSlab key={key}>
          <DiffView diff={text} />
        </CodeSlab>
      );
    }
    return <OwnSwipe key={key}>{super.code(text, language, containerStyle, textStyle)}</OwnSwipe>;
  }

  override table(header: ReactNode[][], rows: ReactNode[][][], tableStyle?: ViewStyle, rowStyle?: ViewStyle, cellStyle?: ViewStyle): ReactNode {
    return <OwnSwipe key={this.getKey()}>{super.table(header, rows, tableStyle, rowStyle, cellStyle)}</OwnSwipe>;
  }

  override blockquote(children: ReactNode[], styles?: ViewStyle): ReactNode {
    const alert = extractAlert(children);
    if (alert) return <AlertBlock key={this.getKey()} type={alert.type}>{alert.body}</AlertBlock>;
    return super.blockquote(children, styles);
  }
}
