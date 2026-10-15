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
  'chevron-left': 0xeab5,
  'chevron-right': 0xeab6,
  chip: 0xec19,
  'circle-slash': 0xeabd,
  clone: 0xea78,
  close: 0xea76,
  comment: 0xea6b,
  copy: 0xebcc,
  'debug-disconnect': 0xead0,
  'debug-pause': 0xead1,
  'device-camera': 0xeada,
  diff: 0xeae1,
  'diff-added': 0xeadc,
  discard: 0xeae2,
  edit: 0xea73,
  file: 0xea7b,
  'file-media': 0xeaea,
  folder: 0xea83,
  'git-branch': 0xec6f,
  globe: 0xeb01,
  info: 0xea74,
  layers: 0xebd2,
  lock: 0xea75,
  'log-in': 0xea6f,
  mic: 0xec12,
  mute: 0xeb24,
  'pass-filled': 0xebb3,
  pulse: 0xeb31,
  reactions: 0xeb35,
  refresh: 0xeb37,
  server: 0xeb50,
  'server-process': 0xeba2,
  'settings-gear': 0xeb51,
  sparkle: 0xec10,
  'star-empty': 0xea6a,
  'star-full': 0xeb59,
  'symbol-color': 0xeb5c,
  'symbol-misc': 0xeb63,
  sync: 0xea77,
  target: 0xebf8,
  terminal: 0xea85,
  tools: 0xeb6d,
  unlock: 0xeb74,
  unmute: 0xeb75,
  warning: 0xea6c,
  zap: 0xea86,
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
