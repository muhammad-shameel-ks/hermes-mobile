/**
 * PROTOTYPE - a sample transcript at the desktop's real type scale and radii: user bubble,
 * assistant prose, a tool row, a streaming scaffold carrying the loader, an inline widget, a
 * system notice. Not a renderer - just enough surface to judge the ladder.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { MONO } from '../../App'
import { Loader, type LoaderEngine, type LoaderKind } from './Loaders'
import type { Tokens } from '../theme/tokens'

interface TranscriptProps {
  engine: LoaderEngine
  kind: LoaderKind
  tokens: Tokens
}

export function Transcript({ engine, kind, tokens: t }: TranscriptProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.bubble, { backgroundColor: t.uiChatBubbleBackground, borderRadius: t.radius.xl }]}>
        <Text style={[styles.body, { color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight * 1.5 }]}>
          Port the loader engine and show me the maths at 1:1 - I want to see whether the trail
          reads the same as the desktop at this size.
        </Text>
      </View>

      <View style={styles.scaffold}>
        <Loader color={t.uiTextTertiary} engine={engine} kind={kind} size={20} strokeScale={0.5} />
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool, lineHeight: t.type.lineHeight }}>
          thinking
        </Text>
      </View>

      <View style={[styles.widget, { backgroundColor: t.uiWidgetSurfaceBackground, borderRadius: t.radius.md }]}>
        <Text style={{ color: t.uiTextQuaternary, fontFamily: MONO, fontSize: t.type.tool }}>
          loader bench - {kind} - {engine} at 24 / 40 / 88
        </Text>
        <View style={styles.benchRow}>
          <Loader color={t.uiAccent} engine={engine} kind={kind} size={24} />
          <Loader color={t.uiAccent} engine={engine} kind={kind} size={40} />
          <Loader color={t.uiAccent} engine={engine} kind={kind} size={88} />
        </View>
      </View>

      <View style={styles.block}>
        <Text style={[styles.body, { color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight * 1.5 }]}>
          The maths is 53-80us a frame, so the curve is not the cost. The cost is how many props
          cross the bridge per frame: 417 writes against two animated props against one canvas.
        </Text>
      </View>

      <View style={[styles.toolRow, { borderColor: t.uiStrokeTertiary, borderRadius: t.radius.md }]}>
        <Text style={{ color: t.uiTextSecondary, fontFamily: MONO, fontSize: t.type.tool, lineHeight: t.type.lineHeight }}>
          read loader.tsx
        </Text>
        <Text style={{ color: t.uiTextQuaternary, fontFamily: MONO, fontSize: t.type.tool }}>
          480 lines
        </Text>
      </View>

      <View style={[styles.widget, { backgroundColor: t.uiWidgetSurfaceBackground, borderRadius: t.radius.md }]}>
        <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight }}>
          inline widget shell - shared radius, surface fill, no border
        </Text>
      </View>

      <Text style={[styles.notice, { color: t.uiTextTertiary, fontSize: t.type.tool, lineHeight: 20 }]}>
        session resumed from replay, seq 1284
      </Text>

      <View style={[styles.bubble, { backgroundColor: t.uiChatBubbleBackground, borderRadius: t.radius.xl }]}>
        <Text style={{ color: t.uiTextPrimary, fontSize: t.type.caption, fontWeight: '600' }}>
          radius check
        </Text>
        <View style={styles.radiusRow}>
          {([['xs', t.radius.xs], ['sm', t.radius.sm], ['md', t.radius.md], ['lg', t.radius.lg], ['xl', t.radius.xl]] as const).map(
            ([name, value]) => (
              <View key={name} style={styles.radiusCell}>
                <View
                  style={{
                    backgroundColor: t.uiBgSecondary,
                    borderColor: t.uiStrokePrimary,
                    borderRadius: value,
                    borderWidth: StyleSheet.hairlineWidth,
                    height: 34,
                    width: 34
                  }}
                />
                <Text style={{ color: t.uiTextQuaternary, fontFamily: MONO, fontSize: 9 }}>{name} {value}</Text>
              </View>
            )
          )}
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  benchRow: { alignItems: 'center', flexDirection: 'row', gap: 18, marginTop: 10 },
  block: { paddingHorizontal: 2 },
  body: { letterSpacing: 0 },
  bubble: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 12, paddingVertical: 8 },
  content: { gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  notice: { alignSelf: 'center', maxWidth: '86%', textAlign: 'center' },
  radiusCell: { alignItems: 'center', gap: 4 },
  radiusRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  scaffold: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  toolRow: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  widget: { paddingHorizontal: 10, paddingVertical: 8 }
})
