/**
 * The faint statue behind the transcript (apps/desktop/src/components/Backdrop.tsx, `ds-assets/filler-bg0.jpg`,
 * downscaled to 1024 px): a square print 1.6 window-heights tall, pinned top-left and cropped by the chat surface.
 * The desktop difference-blends it at 2.5% and inverts it in light mode; over a near-white surface that paints
 * the print's own colours, so light mode is a plain low-opacity image. Dark mode uses a darkened print (lightness
 * inverted with hues kept, then dimmed to 55%): the cream paper would otherwise lift a near-black surface to grey,
 * where this keeps it near black and leaves only the strokes. The phone runs it a little stronger than the desktop:
 * at 2.5% it does not register on a phone-sized crop.
 * It is a static image, so it costs one decode and nothing per frame.
 */

import { memo } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useTokens } from '../ui/tokens.ts';

const LIGHT = require('../../assets/hermes-backdrop.jpg');
// `magick hermes-backdrop.jpg -negate -modulate 55,100,0`
const DARK = require('../../assets/hermes-backdrop-dark.jpg');
const OPACITY = 0.04;
/** `h-[160dvh] w-auto min-w-dvw` on a square image */
const HEIGHT_SCALE = 1.6;

function ChatBackdropImpl() {
  const { width, height } = useWindowDimensions();
  const dark = useTokens().renderedMode === 'dark';
  const side = Math.max(height * HEIGHT_SCALE, width);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]} importantForAccessibility="no-hide-descendants">
      <Image source={dark ? DARK : LIGHT} style={{ width: side, height: side, opacity: OPACITY }} resizeMode="cover" fadeDuration={0} />
    </View>
  );
}

export const ChatBackdrop = memo(ChatBackdropImpl);

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
