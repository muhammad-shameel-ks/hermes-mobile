/**
 * VS Code codicons from the bundled codicon.ttf (@vscode/codicons 0.0.45,
 * CC-BY-4.0), the glyph set the desktop's composer and menus draw with.
 * Codepoints come from the package's codicon.css.
 */

import { Text, type StyleProp, type TextStyle } from 'react-native';

import { CODICON_FONT } from './tokens.ts';

const GLYPHS = {
  account: 0xeb99,
  add: 0xea60,
  agent: 0xec67,
  'arrow-down': 0xea9a,
  'arrow-up': 0xeaa1,
  browser: 0xeaae,
  check: 0xeab2,
  'chevron-down': 0xeab4,
  'chevron-right': 0xeab6,
  'chevron-left': 0xeab5,
  'chevron-up': 0xeab7,
  close: 0xea76,
  code: 0xeac4,
  copy: 0xebcc,
  database: 0xeace,
  'debug-pause': 0xead1,
  diff: 0xeae1,
  discard: 0xeae2,
  file: 0xea7b,
  globe: 0xeb01,
  graph: 0xeb03,
  info: 0xea74,
  json: 0xeb0f,
  markdown: 0xeb1d,
  package: 0xeb29,
  play: 0xeb2c,
  pulse: 0xeb31,
  regex: 0xeb38,
  'settings-gear': 0xeb51,
  share: 0xec25,
  'star-empty': 0xea6a,
  'star-full': 0xeb59,
  'symbol-color': 0xeb5c,
  sync: 0xea77,
  terminal: 0xea85,
  warning: 0xea6c,
  zap: 0xea86,
  'zoom-in': 0xeb81,
  'zoom-out': 0xeb82,
} as const;

export type CodiconName = keyof typeof GLYPHS;

export function Codicon({ name, size = 14, color, style }: { name: CodiconName; size?: number; color: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      accessible={false}
      allowFontScaling={false}
      style={[{ fontFamily: CODICON_FONT, fontSize: size, lineHeight: size, width: size, height: size, color, textAlign: 'center' }, style]}
    >
      {String.fromCodePoint(GLYPHS[name])}
    </Text>
  );
}
