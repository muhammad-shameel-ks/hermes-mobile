/**
 * Inline SVG, drawn natively by react-native-svg: no WebView, so the markup is
 * cut down to a static picture first (see ../svg.ts). Left-aligned and capped on
 * both axes, so a large intrinsic graphic scales down rather than filling the
 * column.
 */

import { memo, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { fitSvgToBox, sanitizeSvg, svgAspectRatio } from '../svg.ts';

const DEFAULT_RATIO = 1.5;

function SvgBlockImpl({ xml, maxHeightFraction = 0.33 }: { xml: string; maxHeightFraction?: number }) {
  const [width, setWidth] = useState(0);
  const window = useWindowDimensions();
  const clean = useMemo(() => sanitizeSvg(xml), [xml]);
  const ratio = useMemo(() => svgAspectRatio(clean) ?? DEFAULT_RATIO, [clean]);
  const markup = useMemo(() => fitSvgToBox(clean), [clean]);

  if (!clean.trim() || !/<svg\b/i.test(clean)) return null;

  const maxHeight = window.height * maxHeightFraction;
  const drawWidth = Math.min(width, maxHeight * ratio);
  const drawHeight = drawWidth / ratio;

  return (
    <View style={{ marginVertical: 8 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <SvgXml xml={markup} width={drawWidth} height={drawHeight} /> : null}
    </View>
  );
}

export const SvgBlock = memo(SvgBlockImpl);
