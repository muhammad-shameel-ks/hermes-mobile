/**
 * PROTOTYPE - floating variant switcher. Stands in for the UI branch's bottom bar: tap the arrows
 * to cycle the loader kind, tap the chips to flip engine and appearance.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { MONO } from '../../App'
import type { LoaderEngine, LoaderKind } from './Loaders'
import type { Mode, Tokens } from '../theme/tokens'

const KINDS: LoaderKind[] = ['rose-curve', 'lemniscate-bloom', 'glyph']

interface SwitcherProps {
  engine: LoaderEngine
  kind: LoaderKind
  mode: Mode
  onEngine: (engine: LoaderEngine) => void
  onKind: (kind: LoaderKind) => void
  onMode: (mode: Mode) => void
  tokens: Tokens
}

export function Switcher({ engine, kind, mode, onEngine, onKind, onMode, tokens: t }: SwitcherProps) {
  const cycle = (delta: number) => {
    const next = (KINDS.indexOf(kind) + delta + KINDS.length) % KINDS.length
    onKind(KINDS[next])
  }

  return (
    <View style={[styles.bar, { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokePrimary, borderRadius: t.radius.md }]}>
      <Pressable hitSlop={10} onPress={() => cycle(-1)}>
        <Text style={[styles.arrow, { color: t.uiTextPrimary, fontFamily: MONO }]}>‹</Text>
      </Pressable>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: t.uiTextPrimary, fontFamily: MONO, fontSize: 11 }}>
          {kind} · {kind === 'glyph' ? 'compositor' : engine}
        </Text>
        <View style={styles.chips}>
          {[
            {
              label: kind === 'glyph' ? 'engine n/a' : engine === 'literal' ? 'switch to animated' : 'switch to literal',
              onPress: () => onEngine(engine === 'literal' ? 'animated' : 'literal')
            },
            {
              label: mode === 'dark' ? 'to light' : 'to dark',
              onPress: () => onMode(mode === 'dark' ? 'light' : 'dark')
            }
          ].map(chip => (
            <Pressable disabled={kind === 'glyph' && chip.label === 'engine n/a'} key={chip.label} onPress={chip.onPress}>
              <Text style={{ color: t.uiAccent, fontFamily: MONO, fontSize: 9 }}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable hitSlop={10} onPress={() => cycle(1)}>
        <Text style={[styles.arrow, { color: t.uiTextPrimary, fontFamily: MONO }]}>›</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  arrow: { fontSize: 16, paddingHorizontal: 6 },
  bar: {
    alignItems: 'center',
    bottom: 92,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    right: 14
  },
  chips: { flexDirection: 'row', gap: 10 }
})
