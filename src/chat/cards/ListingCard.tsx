/**
 * ```listing: a property listing as a native card. The photos bleed to the
 * card's rounded edge as a mosaic - one frame, a pair, or a hero beside two
 * stacked frames, with the overflow folded into a `+N` - and any frame opens the
 * lightbox at that photo, which pages through the whole set. Facts ride one
 * quiet meta line and the catches get one muted line, so the one that matters
 * keeps its weight. Portal CDNs expire URLs, so a photo that fails to load
 * drops out of the mosaic.
 */

import { memo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { mixPct } from '../../ui/color.ts';
import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { useOpenLightbox } from '../Lightbox.tsx';
import { specLine, type Listing } from '../listing.ts';
import { widgetShell } from './widgetShell.ts';

function Gallery({ listing }: { listing: Listing }) {
  const t = useTokens();
  const openLightbox = useOpenLightbox();
  const [broken, setBroken] = useState<string[]>([]);
  const live = listing.images.filter((src) => !broken.includes(src));
  if (live.length === 0) return null;

  const mosaic = live.length >= 3;
  const visible = live.slice(0, mosaic ? 3 : live.length);
  const open = (tile: number) => openLightbox(live.map((src) => ({ src, alt: listing.address })), tile);
  const tile = (src: string, position: number, style: object) => {
    const more = position === visible.length - 1 ? live.length - visible.length : 0;
    return (
      <Pressable key={src} onPress={() => open(position)} accessibilityRole="imagebutton" accessibilityLabel={`Open image: ${listing.address}`} style={[styles.tile, { backgroundColor: t.uiBgTertiary }, style]}>
        <Image
          source={{ uri: src }}
          resizeMode="cover"
          accessibilityLabel={listing.address}
          style={StyleSheet.absoluteFill}
          onError={() => setBroken((prev) => (prev.includes(src) ? prev : [...prev, src]))}
        />
        {more > 0 ? (
          <View style={[StyleSheet.absoluteFill, styles.more, { backgroundColor: mixPct(t.dtBackground, 0.55, 'transparent') }]}>
            <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{`+${more}`}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  if (live.length === 1) return <View style={[styles.gallery, { aspectRatio: 4 / 3 }]}>{tile(visible[0], 0, styles.fill)}</View>;
  if (!mosaic) {
    return <View style={[styles.gallery, styles.row, { aspectRatio: 3 / 2 }]}>{visible.map((src, i) => tile(src, i, styles.half))}</View>;
  }
  return (
    <View style={[styles.gallery, styles.row, { aspectRatio: 3 / 2 }]}>
      {tile(visible[0], 0, styles.hero)}
      <View style={styles.stack}>
        {tile(visible[1], 1, styles.fill)}
        {tile(visible[2], 2, styles.fill)}
      </View>
    </View>
  );
}

function ListingCardImpl({ listing }: { listing: Listing }) {
  const t = useTokens();
  const meta = [specLine(listing), ...listing.facts].filter(Boolean).join(' · ');
  return (
    <View style={[widgetShell(t), styles.card]}>
      <Gallery listing={listing} />
      <View style={styles.body}>
        <View style={styles.title}>
          <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500', flexShrink: 1 }}>{listing.address}</Text>
          {listing.price ? (
            <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{listing.price}</Text>
          ) : null}
        </View>
        {meta ? <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, marginTop: 2, fontVariant: ['tabular-nums'] }}>{meta}</Text> : null}
        {listing.note ? <Text style={{ color: t.uiTextSecondary, fontSize: t.type.text, lineHeight: t.type.lineHeight, marginTop: 6 }}>{listing.note}</Text> : null}
        {listing.catches.length > 0 ? (
          <View style={styles.catches}>
            <Codicon name="warning" size={12} color="#f59e0b" />
            <Text style={{ flex: 1, color: t.uiTextTertiary, fontSize: t.type.tool }}>{listing.catches.join(' · ')}</Text>
          </View>
        ) : null}
        {listing.links.length > 0 ? (
          <View style={styles.links}>
            {listing.links.map((link) => (
              <Text
                key={link.url}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(link.url).catch(() => {})}
                style={{ color: t.uiAccent, fontSize: t.type.tool, textDecorationLine: 'underline' }}
              >
                {link.label}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const ListingCard = memo(ListingCardImpl);

export function ListingSet({ listings }: { listings: Listing[] }) {
  return (
    <View style={styles.set}>
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  set: { width: '100%', maxWidth: 512, gap: 8, marginVertical: 6 },
  // the shell's fill and radius, not its inset: photos bleed to the edge and only the text is inset
  card: { padding: 0, overflow: 'hidden' },
  gallery: { width: '100%', gap: 4 },
  row: { flexDirection: 'row' },
  tile: { overflow: 'hidden' },
  fill: { flex: 1 },
  half: { flex: 1 },
  hero: { flex: 2 },
  stack: { flex: 1, gap: 4 },
  more: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 14, paddingVertical: 12 },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12 },
  catches: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
});
