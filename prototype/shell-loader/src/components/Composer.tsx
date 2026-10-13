/**
 * PROTOTYPE - the composer at the desktop's conversation type size and composer ring.
 */
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Tokens } from '../theme/tokens'

export function Composer({ tokens: t }: { tokens: Tokens }) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.shell, { borderTopColor: t.uiStrokeQuaternary, paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View
        style={[
          styles.input,
          { backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.lg }
        ]}>
        <Text style={{ color: t.uiTextQuaternary, fontSize: t.type.text, lineHeight: t.type.lineHeight }}>
          Message hermes
        </Text>
        <View style={[styles.send, { backgroundColor: t.uiBgPrimary, borderRadius: t.radius.md }]}>
          <Text style={{ color: t.dtPrimarySolidForeground, fontSize: t.type.tool }}>send</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  send: { paddingHorizontal: 8, paddingVertical: 3 },
  shell: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10 }
})
