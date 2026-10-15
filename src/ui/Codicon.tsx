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
  checklist: 0xeab3,
  'chevron-down': 0xeab4,
  'chevron-left': 0xeab5,
  'chevron-right': 0xeab6,
  'chevron-up': 0xeab7,
  chip: 0xec19,
  'circle-slash': 0xeabd,
  clone: 0xea78,
  close: 0xea76,
  'cloud-upload': 0xeac3,
  code: 0xeac4,
  comment: 0xea6b,
  copy: 0xebcc,
  database: 0xeace,
  'debug-disconnect': 0xead0,
  'debug-pause': 0xead1,
  'desktop-download': 0xea78,
  'device-camera': 0xeada,
  diff: 0xeae1,
  'diff-added': 0xeadc,
  'diff-modified': 0xeade,
  'diff-removed': 0xeadf,
  'diff-renamed': 0xeae0,
  discard: 0xeae2,
  edit: 0xea73,
  ellipsis: 0xea7c,
  export: 0xebac,
  file: 0xea7b,
  'file-media': 0xeaea,
  folder: 0xea83,
  'folder-opened': 0xeaf7,
  'git-branch': 0xec6f,
  globe: 0xeb01,
  graph: 0xeb03,
  info: 0xea74,
  json: 0xeb0f,
  layers: 0xebd2,
  'link-external': 0xeb14,
  'list-flat': 0xeb84,
  'list-tree': 0xeb86,
  lock: 0xea75,
  'log-in': 0xea6f,
  markdown: 0xeb1d,
  mic: 0xec12,
  mute: 0xeb24,
  'new-folder': 0xea80,
  package: 0xeb29,
  'pass-filled': 0xebb3,
  play: 0xeb2c,
  pulse: 0xeb31,
  reactions: 0xeb35,
  refresh: 0xeb37,
  regex: 0xeb38,
  server: 0xeb50,
  'server-process': 0xeba2,
  'settings-gear': 0xeb51,
  share: 0xec25,
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
