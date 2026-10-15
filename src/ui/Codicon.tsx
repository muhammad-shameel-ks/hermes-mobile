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
  check: 0xeab2,
  checklist: 0xeab3,
  'chevron-down': 0xeab4,
  'chevron-right': 0xeab6,
  'chevron-left': 0xeab5,
  'circle-slash': 0xeabd,
  close: 0xea76,
  comment: 0xea6b,
  'debug-pause': 0xead1,
  discard: 0xeae2,
  layers: 0xebd2,
  'pass-filled': 0xebb3,
  pulse: 0xeb31,
  'server-process': 0xeba2,
  'settings-gear': 0xeb51,
  'star-empty': 0xea6a,
  'star-full': 0xeb59,
  sync: 0xea77,
  target: 0xebf8,
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
