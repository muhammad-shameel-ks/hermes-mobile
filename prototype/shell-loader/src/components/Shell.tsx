/**
 * PROTOTYPE - the shell: chrome, a button-opened drawer, transcript, composer, safe areas.
 * Drawer width is the desktop token (237) rather than a phone convention - one of the things
 * to judge on screen.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LoaderEngine, LoaderKind } from './Loaders'
import { Composer } from './Composer'
import { Transcript } from './Transcript'
import type { Tokens } from '../theme/tokens'

interface ShellProps {
  drawerOpen: boolean
  engine: LoaderEngine
  kind: LoaderKind
  onToggleDrawer: () => void
  tokens: Tokens
}

const SESSIONS = [
  'gateway replay window',
  'token ladder port',
  'bot mode chat',
  'android hairlines',
  'PKCE loopback spike',
  'loader budget'
]

export function Shell({ drawerOpen, engine, kind, onToggleDrawer, tokens }: ShellProps) {
  const t = tokens
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.root, { backgroundColor: t.uiBgChrome, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.uiStrokeQuaternary }]}>
        <Pressable hitSlop={12} onPress={onToggleDrawer}>
          <Text style={[styles.chromeLabel, { color: t.uiTextSecondary }]}>sessions</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.uiTextPrimary, fontWeight: '600' }]}>hermes</Text>
        <Text style={[styles.chromeLabel, { color: t.uiTextQuaternary }]}>{t.mode}</Text>
      </View>

      <Transcript engine={engine} kind={kind} tokens={t} />

      <Composer tokens={t} />

      {drawerOpen ? (
        <View style={styles.drawerLayer}>
          <Pressable onPress={onToggleDrawer} style={styles.scrim} />
          <View
            style={[
              styles.drawer,
              {
                backgroundColor: t.uiBgSidebar,
                borderRightColor: t.uiStrokeSecondary,
                paddingBottom: 10 + insets.bottom,
                paddingTop: insets.top + 10
              }
            ]}>
            <View style={[styles.segmented, { borderColor: t.uiStrokeSecondary }]}>
              {['SESSIONS', 'BOTS'].map((label, index) => (
                <View
                  key={label}
                  style={[
                    styles.segment,
                    index === 0 && { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius.md }
                  ]}>
                  <Text
                    style={{
                      color: index === 0 ? t.uiTextPrimary : t.uiTextTertiary,
                      fontSize: t.type.tool
                    }}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>

            <ScrollView style={styles.sessionList}>
              {SESSIONS.map((session, index) => (
                <View
                  key={session}
                  style={[
                    styles.row,
                    { borderRadius: t.radius.md },
                    index === 1 && { backgroundColor: t.uiRowActiveBackground }
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: index === 1 ? t.uiTextPrimary : t.uiTextSecondary,
                      fontSize: t.type.base,
                      lineHeight: t.type.lineHeight
                    }}>
                    {session}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={[styles.drawerFooter, { borderTopColor: t.uiStrokeQuaternary }]}>
              {['nous', 'simple', 'auto'].map(chip => (
                <View
                  key={chip}
                  style={[styles.chip, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius.md }]}>
                  <Text style={{ color: t.uiTextSecondary, fontSize: t.type.tool }}>{chip}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  chromeLabel: { fontSize: 11 },
  drawer: {
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    paddingHorizontal: 8,
    position: 'absolute',
    top: 0,
    width: 237
  },
  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    paddingTop: 8
  },
  drawerLayer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  chip: { paddingHorizontal: 6, paddingVertical: 3 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 14
  },
  root: { flex: 1 },
  row: { paddingHorizontal: 8, paddingVertical: 5 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.22)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  segment: { flex: 1, paddingVertical: 4 },
  segmented: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 8
  },
  sessionList: { flex: 1 },
  title: { fontSize: 13, letterSpacing: 0.4 }
})
