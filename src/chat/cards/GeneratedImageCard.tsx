/**
 * An `image_generate` call as the image it made. While it runs, a frame in the
 * requested shape holds the place (a hint only, not a promise about the
 * delivered picture); once it lands the image replaces it and opens the
 * lightbox on tap. The desktop's diffusion canvas is a quiet pulse here.
 */

import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useTokens } from '../../ui/tokens.ts';
import { generatedImageDimensionsFromResult, generatedImageFromResult } from '../generatedImage.ts';
import type { ToolPart } from '../transcript.ts';
import { MediaImage } from './MediaImage.tsx';

const ASPECT_HINTS: Record<string, number> = { landscape: 16 / 9, square: 1, portrait: 9 / 16 };

const hintedRatio = (aspect?: string) => ASPECT_HINTS[String(aspect ?? '').toLowerCase().trim()] ?? ASPECT_HINTS.landscape;

/** whether this call has an image card to show, rather than the generic row */
export const hasGeneratedImage = (tool: ToolPart): boolean => tool.status === 'running' || generatedImageFromResult(tool.result) !== null;

function Rendering({ ratio }: { ratio: number }) {
  const t = useTokens();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={styles.wrap}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Rendering image"
        accessibilityLiveRegion="polite"
        style={[styles.frame, { aspectRatio: ratio, borderRadius: t.radius['2xl'], backgroundColor: t.uiBgTertiary }]}
      >
        <Animated.View style={animated}>
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>Rendering image…</Text>
        </Animated.View>
      </View>
    </View>
  );
}

function GeneratedImageCardImpl({ tool }: { tool: ToolPart }) {
  const t = useTokens();
  const aspect = typeof tool.args.aspect_ratio === 'string' ? tool.args.aspect_ratio : undefined;
  const ratio = hintedRatio(aspect);
  const image = tool.status === 'running' ? null : generatedImageFromResult(tool.result);
  if (!image) return <Rendering ratio={ratio} />;
  return <MediaImage src={image} alt="Generated image" dims={generatedImageDimensionsFromResult(tool.result)} hintRatio={ratio} radius={t.radius['2xl']} />;
}

export const GeneratedImageCard = memo(GeneratedImageCardImpl);

const styles = StyleSheet.create({
  wrap: { width: '100%', marginVertical: 8, alignItems: 'flex-start' },
  frame: { width: '100%', maxWidth: 420, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
