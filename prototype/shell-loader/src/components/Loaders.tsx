/**
 * Loader port for the shell/loader prototype.
 *
 * Sources, copied verbatim from the desktop:
 * - Particle/curve maths, path building, pulse + rotation timing, and the
 *   `strokeWidth * strokeScale` / `opacity 0.1` curve treatment come from
 *   `apps/desktop/src/components/ui/loader.tsx` (`buildPath`, `detailScaleFor`,
 *   `particleFor`, `rotationFor`, `roseCurve`, and the `lemniscate-bloom` entry
 *   in `LOADER_CURVES`).
 * - The braille glyph spinner comes from
 *   `apps/desktop/src/components/ui/glyph-spinner.tsx` + `glyph-spinner.css`
 *   (the 1em-tall clipping viewport, the N-frame vertical strip, and the
 *   `steps(N)` transform travel that walks it one frame at a time).
 *
 * The ONE deviation: the desktop drives everything from a single
 * `requestAnimationFrame` loop that mutates `SVGCircleElement`/`SVGPathElement`
 * attributes in place. React Native cannot mutate SVG nodes per frame, so the
 * maths are the same but the driver is not — `engine` picks one of two
 * approaches to measure:
 *   - `literal`: 66ms interval -> React state -> one `<Path>` + a `<Circle>`
 *     per particle (the desktop's rAF loop is budgeted at 15fps, so this is the
 *     straw man).
 *   - `animated`: shared-value time + `useAnimatedProps` worklets, the whole
 *     trail emitted as one path string and the curve as a second, rotation
 *     baked into the point transform, zero React re-renders per frame.
 */

import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

export type LoaderKind = 'rose-curve' | 'lemniscate-bloom' | 'glyph'
export type LoaderEngine = 'literal' | 'animated'

interface LoaderProps {
  color: string
  engine: LoaderEngine
  kind: LoaderKind
  size?: number
  strokeScale?: number
}

interface CurveConfig {
  durationMs: number
  particleCount: number
  pulseDurationMs: number
  rotate: boolean
  rotationDurationMs: number
  strokeWidth: number
  trailSpan: number
}

type ParticleKind = Exclude<LoaderKind, 'glyph'>

const TWO_PI = Math.PI * 2

// `pathSteps = 240` from the desktop Loader default.
const PATH_STEPS = 240

// The desktop's rAF loop is budgeted at 15fps.
const LITERAL_FRAME_MS = 66

// Filled discs here cannot carry the desktop's per-particle opacity (one path,
// one opacity), so the trail takes a single opacity near the mean of the
// desktop's `0.04 + fade * 0.96`; the verbatim radius taper carries the rest.
const TRAIL_OPACITY = 0.72

const CURVES: Record<ParticleKind, CurveConfig> = {
  'rose-curve': {
    durationMs: 5400,
    particleCount: 78,
    pulseDurationMs: 4600,
    rotate: true,
    rotationDurationMs: 28000,
    strokeWidth: 4.5,
    trailSpan: 0.32,
  },
  'lemniscate-bloom': {
    durationMs: 5600,
    particleCount: 70,
    pulseDurationMs: 5000,
    rotate: false,
    rotationDurationMs: 34000,
    strokeWidth: 4.8,
    trailSpan: 0.4,
  },
}

const MONO = Platform.select({ default: 'monospace', ios: 'Menlo' })

// `unicode-animations` braille spinner, first cell of each frame.
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const GLYPH_FRAME_MS = 80

type Point = { x: number; y: number }

export function Loader({ color, engine, kind, size = 40, strokeScale = 1 }: LoaderProps): ReactElement {
  if (kind === 'glyph') {
    return <GlyphLoader color={color} size={size} />
  }

  if (engine === 'animated') {
    return <AnimatedLoader color={color} kind={kind} size={size} strokeScale={strokeScale} />
  }

  return <LiteralLoader color={color} kind={kind} size={size} strokeScale={strokeScale} />
}

/**
 * Desktop shape: one timer tick replaces the rendered tree. 66ms interval
 * driving React state, one `<Path>` and one `<Circle>` per particle.
 */
function LiteralLoader({
  color,
  kind,
  size,
  strokeScale,
}: {
  color: string
  kind: ParticleKind
  size: number
  strokeScale: number
}) {
  const config = CURVES[kind]
  const phase = useMemo(() => Math.random(), [])
  const [time, setTime] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const id = setInterval(() => setTime(Date.now() - startedAt), LITERAL_FRAME_MS)

    return () => clearInterval(id)
  }, [])

  const progress = ((time + phase * config.durationMs) % config.durationMs) / config.durationMs
  const detailScale = detailScaleFor(time, config, phase)
  const rotation = rotationFor(time, config, phase)
  const d = buildPath(kind, detailScale, 0)

  const particles: Array<{ index: number } & Point & { opacity: number; radius: number }> = []

  for (let index = 0; index < config.particleCount; index++) {
    const particle = particleFor(kind, config, index, progress, detailScale, strokeScale)

    particles.push({ index, ...particle })
  }

  return (
    <Svg fill="none" height={size} viewBox="0 0 100 100" width={size}>
      <G transform={`rotate(${rotation} 50 50)`}>
        <Path
          d={d}
          fill="none"
          opacity={0.1}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={config.strokeWidth * strokeScale}
        />
        {particles.map(particle => (
          <Circle
            cx={particle.x}
            cy={particle.y}
            fill={color}
            key={`${kind}-${particle.index}`}
            opacity={particle.opacity}
            r={particle.radius}
          />
        ))}
      </G>
    </Svg>
  )
}

const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * UI-thread engine: a frame callback advances a monotonic time shared value;
 * `useAnimatedProps` worklets rebuild the two path strings every frame and
 * rotate the points themselves. No React state, no re-render.
 */
function AnimatedLoader({
  color,
  kind,
  size,
  strokeScale,
}: {
  color: string
  kind: ParticleKind
  size: number
  strokeScale: number
}) {
  const config = CURVES[kind]
  const phase = useSharedValue(Math.random())
  const curveD = useSharedValue('')
  const trailD = useSharedValue('')

  // One worklet builds both path strings and publishes them; the animated props
  // below only read a shared value, so one worklet never calls another (which
  // the worklets runtime cannot resolve across declarations).
  useFrameCallback(frame => {
    const t = frame.timeSinceFirstFrame
    const pulse = ((t + phase.value * config.pulseDurationMs) % config.pulseDurationMs) / config.pulseDurationMs
    const detailScale = 0.52 + ((Math.sin(pulse * TWO_PI + 0.55) + 1) / 2) * 0.48
    const rotation = config.rotate
      ? -(((t + phase.value * config.rotationDurationMs) % config.rotationDurationMs) / config.rotationDurationMs) * 360
      : 0
    const radians = (rotation * Math.PI) / 180
    const cosR = Math.cos(radians)
    const sinR = Math.sin(radians)
    const progress = ((t + phase.value * config.durationMs) % config.durationMs) / config.durationMs

    let curve = ''

    for (let index = 0; index <= PATH_STEPS; index++) {
      const theta = ((index / PATH_STEPS) % 1) * TWO_PI
      let x = 0
      let y = 0

      if (kind === 'rose-curve') {
        const a = 9.2 + detailScale * 0.6
        const r = a * (0.72 + detailScale * 0.28) * Math.cos(5 * theta)

        x = 50 + Math.cos(theta) * r * 3.25
        y = 50 + Math.sin(theta) * r * 3.25
      } else {
        const scale = 20 + detailScale * 7
        const denom = 1 + Math.sin(theta) ** 2

        x = 50 + (scale * Math.cos(theta)) / denom
        y = 50 + (scale * Math.sin(theta) * Math.cos(theta)) / denom
      }

      if (rotation !== 0) {
        const dx = x - 50
        const dy = y - 50

        x = 50 + dx * cosR - dy * sinR
        y = 50 + dx * sinR + dy * cosR
      }

      curve += `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `
    }

    let trail = ''

    for (let index = 0; index < config.particleCount; index++) {
      const tailOffset = index / (config.particleCount - 1)
      const wrapped = ((progress - tailOffset * config.trailSpan) % 1 + 1) % 1
      const theta = wrapped * TWO_PI
      let x = 0
      let y = 0

      if (kind === 'rose-curve') {
        const a = 9.2 + detailScale * 0.6
        const r = a * (0.72 + detailScale * 0.28) * Math.cos(5 * theta)

        x = 50 + Math.cos(theta) * r * 3.25
        y = 50 + Math.sin(theta) * r * 3.25
      } else {
        const scale = 20 + detailScale * 7
        const denom = 1 + Math.sin(theta) ** 2

        x = 50 + (scale * Math.cos(theta)) / denom
        y = 50 + (scale * Math.sin(theta) * Math.cos(theta)) / denom
      }

      if (rotation !== 0) {
        const dx = x - 50
        const dy = y - 50

        x = 50 + dx * cosR - dy * sinR
        y = 50 + dx * sinR + dy * cosR
      }

      const fade = (1 - tailOffset) ** 0.56
      const radius = (0.9 + fade * 2.7) * strokeScale
      const diameter = radius * 2

      trail +=
        `M ${(x - radius).toFixed(2)} ${y.toFixed(2)}` +
        ` a ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 ${diameter.toFixed(3)} 0` +
        ` a ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 -${diameter.toFixed(3)} 0 Z `
    }

    curveD.value = curve
    trailD.value = trail
  })

  const curveProps = useAnimatedProps(() => ({ d: curveD.value }))
  const trailProps = useAnimatedProps(() => ({ d: trailD.value }))

  return (
    <Svg fill="none" height={size} viewBox="0 0 100 100" width={size}>
      <AnimatedPath
        animatedProps={curveProps}
        fill="none"
        opacity={0.1}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={config.strokeWidth * strokeScale}
      />
      <AnimatedPath animatedProps={trailProps} fill={color} opacity={TRAIL_OPACITY} />
    </Svg>
  )
}

/**
 * Braille spinner, compositor-style: all frames are mounted as a vertical strip
 * and a Reanimated `steps(10)` loop scrolls it one line-height at a time — no
 * per-frame text swap, no state.
 */
function GlyphLoader({ color, size }: { color: string; size: number }) {
  const offset = useSharedValue(0)

  useEffect(() => {
    offset.value = 0
    offset.value = withRepeat(
      withTiming(-BRAILLE_FRAMES.length * size, {
        duration: BRAILLE_FRAMES.length * GLYPH_FRAME_MS,
        easing: Easing.steps(BRAILLE_FRAMES.length, true),
      }),
      -1,
      false
    )
  }, [offset, size])

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }))

  return (
    <View style={{ height: size, overflow: 'hidden', width: size }}>
      <Animated.View style={stripStyle}>
        {BRAILLE_FRAMES.map(frame => (
          <Text
            key={frame}
            style={{
              color,
              fontFamily: MONO,
              fontSize: size,
              height: size,
              lineHeight: size,
              textAlign: 'center',
              width: size,
            }}
          >
            {frame}
          </Text>
        ))}
      </Animated.View>
    </View>
  )
}

// --- maths, ported from apps/desktop/src/components/ui/loader.tsx -------

// `buildPath`: `Array.from({ length: steps + 1 }, ...)` joined with M/L.
function buildPath(kind: ParticleKind, detailScale: number, rotation: number) {
  let d = ''

  for (let index = 0; index <= PATH_STEPS; index++) {
    const point = rotatePoint(pointFor(kind, index / PATH_STEPS, detailScale), rotation)
    const command = index === 0 ? 'M' : 'L'

    d += `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)} `
  }

  return d
}

function particleFor(
  kind: ParticleKind,
  config: CurveConfig,
  index: number,
  progress: number,
  detailScale: number,
  strokeScale: number
): Point & { opacity: number; radius: number } {
  const tailOffset = index / (config.particleCount - 1)
  const wrapped = ((progress - tailOffset * config.trailSpan) % 1 + 1) % 1
  const point = pointFor(kind, wrapped, detailScale)
  const fade = (1 - tailOffset) ** 0.56

  return {
    opacity: 0.04 + fade * 0.96,
    radius: (0.9 + fade * 2.7) * strokeScale,
    x: point.x,
    y: point.y,
  }
}

function pointFor(kind: ParticleKind, progress: number, detailScale: number): Point {
  const t = progress * TWO_PI

  if (kind === 'rose-curve') {
    const a = 9.2 + detailScale * 0.6
    const r = a * (0.72 + detailScale * 0.28) * Math.cos(5 * t)

    return {
      x: 50 + Math.cos(t) * r * 3.25,
      y: 50 + Math.sin(t) * r * 3.25,
    }
  }

  const scale = 20 + detailScale * 7
  const denom = 1 + Math.sin(t) ** 2

  return {
    x: 50 + (scale * Math.cos(t)) / denom,
    y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
  }
}

// Desktop applies `rotate(rotation 50 50)` on the group transform; baking it
// into the points is the equivalent, and lets the animated engine avoid a third
// animated prop. Same direction as an SVG rotate in a y-down space.
function rotatePoint(point: Point, rotation: number): Point {
  if (rotation === 0) {
    return point
  }

  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - 50
  const dy = point.y - 50

  return {
    x: 50 + dx * cos - dy * sin,
    y: 50 + dx * sin + dy * cos,
  }
}

function detailScaleFor(time: number, config: CurveConfig, phaseOffset: number) {
  const pulseProgress =
    ((time + phaseOffset * config.pulseDurationMs) % config.pulseDurationMs) / config.pulseDurationMs

  return 0.52 + ((Math.sin(pulseProgress * TWO_PI + 0.55) + 1) / 2) * 0.48
}

function rotationFor(time: number, config: CurveConfig, phaseOffset: number) {
  if (!config.rotate) {
    return 0
  }

  return (
    -(((time + phaseOffset * config.rotationDurationMs) % config.rotationDurationMs) / config.rotationDurationMs) *
    360
  )
}
