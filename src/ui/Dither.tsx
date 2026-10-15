/**
 * The desktop's `.dither` fill (styles.css): `repeating-conic-gradient` on a
 * 2 px tile, which lands as a checker of 1 px cells in the current colour.
 */

import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

const paths = new Map<number, string>();

function ditherPath(size: number): string {
  let path = paths.get(size);
  if (!path) {
    const cells: string[] = [];
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) if ((row + col) % 2 === 1) cells.push(`M${col} ${row}h1v1h-1z`);
    path = cells.join('');
    paths.set(size, path);
  }
  return path;
}

function DitherImpl({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityElementsHidden importantForAccessibility="no">
      <Path d={ditherPath(size)} fill={color} />
    </Svg>
  );
}

export const Dither = memo(DitherImpl);
