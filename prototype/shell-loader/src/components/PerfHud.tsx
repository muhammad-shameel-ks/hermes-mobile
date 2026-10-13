/**
 * PROTOTYPE - JS-thread frame sampler. Deliberately not styled with the tokens: it must not be
 * mistaken for the design. Simulator numbers are indicative only, never the verdict.
 */
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

export function PerfHud() {
  const [stats, setStats] = useState({ avg: 0, p95: 0 })

  useEffect(() => {
    let raf = 0
    let last = 0
    let samples: number[] = []

    const tick = (now: number) => {
      if (last) {
        samples.push(now - last)
        if (samples.length >= 30) {
          const sorted = [...samples].sort((a, b) => a - b)
          const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length
          const p95 = sorted[Math.max(0, Math.floor(sorted.length * 0.95) - 1)] ?? sorted[sorted.length - 1]
          setStats({ avg: 1000 / avg, p95 })
          samples = []
        }
      }
      last = now
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <View pointerEvents="none" style={styles.hud}>
      <Text style={styles.text}>
        js {stats.avg.toFixed(0)}fps · p95 {stats.p95.toFixed(1)}ms
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hud: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 4,
    bottom: 92,
    left: 14,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute'
  },
  text: { color: '#ffffff', fontFamily: 'Menlo', fontSize: 9 }
})
