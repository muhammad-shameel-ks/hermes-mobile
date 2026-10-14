/**
 * PROTOTYPE - not the app skeleton. Throwaway: it answers a question and dies.
 *
 * Question: does the desktop's token-exact shell read right on a phone at 3x, and which loader
 * update path holds up? The shell itself is already decided (drawer-first, no titlebar/statusbar),
 * so the variants are the three loaders x two engines, switchable from the floating bar.
 *
 * Deviation from the prototype skill's UI branch: React Native has no URL, so the variant lives in
 * React state and the switcher is a tap target instead of a ?variant= search param.
 */
import { useState } from 'react'
import { View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold, useFonts } from '@expo-google-fonts/jetbrains-mono'

import { Composer } from './src/components/Composer'
import type { LoaderEngine, LoaderKind } from './src/components/Loaders'
import { PerfHud } from './src/components/PerfHud'
import { Shell } from './src/components/Shell'
import { Switcher } from './src/components/Switcher'
import { resolveTokens, type Mode } from './src/theme/tokens'

export const MONO = 'JetBrainsMono_400Regular'
export const MONO_BOLD = 'JetBrainsMono_700Bold'

export default function App() {
  const [fontsLoaded] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_700Bold })
  const [mode, setMode] = useState<Mode>('dark')
  const [kind, setKind] = useState<LoaderKind>('glyph')
  const [engine, setEngine] = useState<LoaderEngine>('animated')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // First paint waits for the fonts: no wordmark, no mono, before the real faces are in.
  if (!fontsLoaded) {
    return null
  }

  const tokens = resolveTokens(mode)

  return (
    <SafeAreaProvider>
      <View style={{ backgroundColor: tokens.uiBgChrome, flex: 1 }}>
        <StatusBar style={tokens.renderedMode === 'dark' ? 'light' : 'dark'} />
        <Shell
          drawerOpen={drawerOpen}
          engine={engine}
          kind={kind}
          onToggleDrawer={() => setDrawerOpen(open => !open)}
          tokens={tokens}
        />
        <PerfHud />
        <Switcher
          engine={engine}
          kind={kind}
          mode={mode}
          onEngine={setEngine}
          onKind={setKind}
          onMode={setMode}
          tokens={tokens}
        />
      </View>
    </SafeAreaProvider>
  )
}
