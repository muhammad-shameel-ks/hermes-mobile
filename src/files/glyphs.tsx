/**
 * The codicons the Files and Review surfaces draw with, from the same bundled
 * codicon.ttf as src/ui/Codicon.tsx (@vscode/codicons 0.0.45, CC-BY-4.0). Kept
 * beside the surfaces so Codicon.tsx's own table is not edited by two branches;
 * fold these entries in when convenient.
 */

import { Text, type StyleProp, type TextStyle } from 'react-native';

import { CODICON_FONT } from '../ui/tokens.ts';

const GLYPHS = {
  'cloud-upload': 0xeac3,
  close: 0xea76,
  copy: 0xebcc,
  'desktop-download': 0xea78,
  'diff-added': 0xeadc,
  'diff-modified': 0xeade,
  'diff-removed': 0xeadf,
  'diff-renamed': 0xeae0,
  ellipsis: 0xea7c,
  export: 0xebac,
  file: 0xea7b,
  'folder-opened': 0xeaf7,
  folder: 0xea83,
  'git-branch': 0xec6f,
  'link-external': 0xeb14,
  'list-flat': 0xeb84,
  'list-tree': 0xeb86,
  'new-folder': 0xea80,
  refresh: 0xeb37,
  warning: 0xea6c,
} as const;

export type FileGlyphName = keyof typeof GLYPHS;

export function FileGlyph({ name, size = 14, color, style }: { name: FileGlyphName; size?: number; color: string; style?: StyleProp<TextStyle> }) {
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
