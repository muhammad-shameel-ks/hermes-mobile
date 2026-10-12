# Hermes desktop: loaders and motion systems - full spec for the React Native port

All paths are relative to `DESKTOP=/home/shameel/.hermes/hermes-agent/apps/desktop` unless prefixed with `repo:` for monorepo-root paths.

Delivery note: this agent's toolset is read-only (no write/exec tool), so `/tmp/hermes-mobile-research/loader-motion.md` was NOT created. The content below is the intended file; persist it verbatim.

---

## 0. Inventory: the four loader families

| Family | File | Engine | Where | Reduced motion |
| --- | --- | --- | --- | --- |
| `Loader` (21 curve variants) | `src/components/ui/loader.tsx` | raw `requestAnimationFrame` + SVG attribute writes | pages, overlays, thread centre, terminal | **none** (no check anywhere) |
| `GlyphSpinner` (18 unicode names) | `src/components/ui/glyph-spinner.tsx` + `.css` | CSS `steps()` translateY on a glyph strip (compositor) | transcript rows, model/reasoning pills, agent roster | inherited blanket CSS rule; `will-change` dropped |
| `StatusPulse` + status dots | `src/components/ui/status-pulse.tsx`, `src/app/chat/session-status-dot.tsx` | WAAPI `element.animate` on a shared 5 s beat; dots are static | response-loading row, sidebar rows, profiles | explicit `matchMedia` check (`status-pulse.tsx:102-107`) |
| Icon spinner `Loader2` (lucide) | used ad hoc in ~30 files | Tailwind `animate-spin` (1 s linear infinite, Tailwind default) | buttons, menu rows, upload overlays | `motion-reduce:animate-none` at `app/capabilities/connectors/connect-element.tsx:36`; otherwise blanket CSS |

Additional one-off loading surfaces: `DecodeText` (text scramble, boot), canvas ASCII diffusion (image generation), `PixelEggSprite` (pet hatch), `PetStarShower` (hatch celebration), pet spritesheet (`PetSprite`).

---

## 1. The custom Loader - every variant

### 1.1 Geometry and DOM shape (`src/components/ui/loader.tsx`)

- Root: `div` with `className = 'inline-grid size-10 place-items-center text-primary'` (`:363`), `aria-label` defaults to `label` prop default `'Loading'`, `role` default `'status'` (`:319-322`, `:358-362`).
- SVG: `aria-hidden`, `className='size-full overflow-visible'`, `fill='none'`, `viewBox='0 0 100 100'` (`:366`). So all maths is in a 0..100 user-space box; size is CSS-only (`size-10` = 40 px, `size-4/5/6/7/8/12/16` overrides at call sites).
- `<g ref>` gets `transform='rotate(<deg> 50 50)'` per frame (`:345`).
- One `<path opacity='0.1' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' strokeWidth={config.strokeWidth * strokeScale}>` - the faint curve, `d` rewritten every frame (`:348-356`).
- `config.particleCount` `<circle fill='currentColor'>` elements whose `cx/cy/r/opacity` are rewritten every frame with `toFixed(2)`/`toFixed(3)` (`:357-371`, `:349-355`).
- No `will-change`, no layer promotion, no DPR maths (SVG handles scaling; the SVG is resolution-independent by construction).

### 1.2 The animation loop (`loader.tsx:332-365`)

```
useEffect: startsAt = performance.now(); phaseOffset = Math.random()
render(now):
  time          = now - startedAt
  progress      = ((time + phaseOffset*durationMs) % durationMs) / durationMs
  detailScale   = detailScaleFor(time, config, phaseOffset)
  rotation      = rotationFor(time, config, phaseOffset)
  -> g.transform = rotate(rotation 50 50)
  -> path.d      = buildPath(config, detailScale, pathSteps)
  -> for each particle: cx, cy, r, opacity  (SVG node mutations)
  cleanup: cancelAnimationFrame
```

Properties that matter for the port:
- `phaseOffset = Math.random()` per mount (`:334`): every instance of the same variant starts at a different phase, and the same value seeds **both** the progress phase and the rotation phase (`:470`, `:520`).
- Full-speed rAF, **no fps cap**, **no visibility/minimised pause**, **no idle dormancy**, **no `prefers-reduced-motion` check** (`:332-365`; verified by grep: loader.tsx contains no `reduced|pause|visibility|budget`). The desktop mitigates only by unmounting; a mobile build must add its own AppState/reduced-motion gating or it will burn battery.
- Per frame this writes 1 path string with `pathSteps+1` points (default 241, `toFixed(2)` each) plus 4 attributes x `particleCount` (62-104) circles. That is ~250-500 string/number DOM mutations per frame.

### 1.3 Parameter maths (literal)

| Function | Line | Formula |
| --- | --- | --- |
| `detailScaleFor` | `:471-478` | `p = ((time + phaseOffset*pulseDurationMs) % pulseDurationMs)/pulseDurationMs`; `return 0.52 + ((sin(p*2pi + 0.55) + 1)/2) * 0.48` → range **0.52..1.00** |
| `rotationFor` | `:518-527` | `0` unless `rotate`; else `-(((time + phaseOffset*rotationDurationMs) % rotationDurationMs)/rotationDurationMs) * 360` (one full **counter-clockwise** turn per `rotationDurationMs`) |
| `particleFor` | `:492-512` | `tailOffset = i/(particleCount-1)`; point at `normalizeProgress(progress - tailOffset*trailSpan)`; `fade = (1 - tailOffset) ** 0.56`; `opacity = 0.04 + fade*0.96` (head 1.00 → tail 0.04); `radius = (0.9 + fade*2.7) * strokeScale` (head 3.60 → tail 0.90 user units) |
| `buildPath` | `:464-469` | `steps+1` points, `M x y` then `L x y`, `toFixed(2)`, joined by spaces |
| `normalizeProgress` | `:480-482` | `((p % 1) + 1) % 1` |

Defaults from the component signature (`:310-326`): `pathSteps = 240`, `strokeScale = 1`, `type = 'rose-curve'`, `label = 'Loading'`, `role = 'status'`.

### 1.4 Curve-shape helpers

- `baseCurve(name, opts)` `:372-390`: `point` defaults to constant `(50,50)`; `rotate` default **false**; `rotationDurationMs` default **36000**.
- `thinkingCurve(name, petalCount, opts)` `:391-410`: `strokeWidth 5.5`, `rotate true`. Point: `t = progress*2pi`; `x = 7cos t - 3*detailScale*cos(petal*t)`; `y = 7sin t - 3*detailScale*sin(petal*t)`; position `50 + x*3.9`, `50 + y*3.9`.
- `roseCurve(name, k, opts)` `:412-435`: `rotate true`, `rotationDurationMs 28000`. Point: `a = 9.2 + detailScale*0.6`; `r = a*(0.72 + detailScale*0.28)*cos(k*t)`; `50 + cos(t)*r*3.25`, `50 + sin(t)*r*3.25`.
- `spiralPetalCurve(name, spiralR, particleCount)` `:437-457`: fixed `durationMs 4600`, `pulseDurationMs 4200`, `rotate true`, `rotationDurationMs 28000`, `strokeWidth 4.4`, `trailSpan 0.34`. Point: `spiralr = 1`, `d = 3 + detailScale*0.25`, epicycloid `(spiralR-1)`; `scale = 2.2 + detailScale*0.45`.
- `cardioidCurve(name, opts)` `:459-486`: fixed `durationMs 6200`, `pulseDurationMs 5200`, `rotationDurationMs 36000`, `strokeWidth 4.9`, `trailSpan 0.36`; `a = opts.a + detailScale*0.8`, `scale 2.15`.

### 1.5 The 21 variants (name → all literal parameters)

`LOADER_TYPES` order, `loader.tsx:5-27`. Columns: durationMs / pulseDurationMs / particleCount / strokeWidth / trailSpan / rotate+rotationDurationMs / point formula.

1. **original-thinking** `:67-75` - thinkingCurve(petals=7): 4600 / 4200 / 64 / 5.5 / 0.38 / rotate 28000.
2. **thinking-five** `:76-84` - thinkingCurve(5): 4600 / 4200 / 62 / 5.5 / 0.38 / rotate 28000.
3. **thinking-nine** `:85-93` - thinkingCurve(9): 4700 / 4200 / 68 / 5.5 / 0.39 / rotate 30000.
4. **rose-orbit** `:94-106` - 5200 / 4600 / 72 / 5.2 / 0.42 / rotate 28000. Point: `r = 7 - 2.7*detailScale*cos(7t)`; `50 + cos(t)*r*3.9`, `50 + sin(t)*r*3.9`.
5. **rose-curve** `:108-114` - roseCurve(k=5): 5400 / 4600 / 78 / 4.5 / 0.32 / rotate 28000.
6. **rose-two** `:115-121` - roseCurve(2): 5200 / 4300 / 74 / 4.6 / 0.30 / rotate 28000.
7. **rose-three** `:122-128` - roseCurve(3): 5300 / 4400 / 76 / 4.6 / 0.31 / rotate 28000.
8. **rose-four** `:129-135` - roseCurve(4): 5400 / 4500 / 78 / 4.6 / 0.32 / rotate 28000.
9. **lissajous-drift** `:136-152` - 6000 / 5400 / 68 / 4.7 / 0.34 / **rotate false** (rotationDurationMs 36000 default). Point: `amp = 24 + detailScale*6`; `50 + sin(3t + 1.57)*amp`, `50 + sin(4t)*amp*0.92`.
10. **lemniscate-bloom** `:153-169` - 5600 / 5000 / 70 / 4.8 / 0.40 / **rotate false** (declares rotationDurationMs 34000 but `rotate` is unset → 0). Point: `scale = 20 + detailScale*7`; `denom = 1 + sin(t)^2`; `50 + scale*cos(t)/denom`, `50 + scale*sin(t)*cos(t)/denom`.
11. **hypotrochoid-loop** `:170-190` - 7600 / 6200 / 82 / 4.6 / 0.46 / **rotate false** (rot.Duration 42000 unused). Point: `r = 2.7 + detailScale*0.45`, `d = 4.8 + detailScale*1.2`, base 8.2; x/y classic hypotrochoid; `50 + x*3.05`, `50 + y*3.05`.
12. **three-petal-spiral** `:191` - spiralPetalCurve(3, 82): 4600 / 4200 / 82 / 4.4 / 0.34 / rotate 28000.
13. **four-petal-spiral** `:192` - spiralPetalCurve(4, 84).
14. **five-petal-spiral** `:193` - spiralPetalCurve(5, 85).
15. **six-petal-spiral** `:194` - spiralPetalCurve(6, 86).
16. **butterfly-phase** `:200-219` - 9000 / 7000 / 88 / 4.4 / 0.32 / rotate 50000. Point: `t = progress*pi*12`; `b = exp(cos t) - 2cos(4t) - sin(t/12)^5`; `scale = 4.6 + detailScale*0.45`; `50 + sin(t)*b*scale`, `50 + cos(t)*b*scale`.
17. **cardioid-glow** `:220-232` - cardioidCurve(a=8.4, 72 particles): 6200 / 5200 / 72 / 4.9 / 0.36 / rotate 36000. `r = a(1 - cos t)`; `50 + cos(t)*r*2.15`, `50 + sin(t)*r*2.15`.
18. **cardioid-heart** `:233-248` - cardioidCurve(a=8.8, 74): `r = a(1 + cos t)`; `50 - sin(t)*r*2.15`, `50 - cos(t)*r*2.15`.
19. **heart-wave** `:249-270` - 8400 / 5600 / 104 / 3.9 / 0.18 / rotate 22000. Point: `root = 3.3`, `xLimit = sqrt(root)`, `x = -xLimit + progress*xLimit*2`; `wave = 0.9*sqrt(max(0, root - x^2))*sin(6.4*pi*x)`; `y = |x|^(2/3) + wave`; `50 + x*23.2`, `18 + (1.75 - y)*(24.5 + detailScale*1.5)` (note the off-centre 18 y-origin).
20. **spiral-search** `:271-286` - 7800 / 6800 / 86 / 4.3 / 0.28 / rotate 44000. Point: `angle = 4t`; `radius = 8 + (1 - cos t)*(8.5 + detailScale*2.4)`; `50 + cos(angle)*radius`, `50 + sin(angle)*radius`.
21. **fourier-flow** `:295-320` - 2200 / 2000 / 92 / 4.2 / 0.31 / rotate 15000. Point: `mix = 1 + detailScale*0.16`; `x = 17cos t + 7.5cos(3t + 0.6*mix) + 3.2sin(5t - 0.4)`; `y = 15sin t + 8.2sin(2t + 0.25) - 4.2cos(4t - 0.5*mix)`; `+50` both.

Latent oddity worth noting for a faithful port: variants 9, 10, 11 pass `rotationDurationMs` but never `rotate`, so `baseCurve` leaves `rotate=false` and `rotationFor` returns 0 - they do not rotate despite declaring a rotation period.

### 1.6 How a variant is chosen (there is no picker)

`LOADER_TYPES` is exported but has **zero consumers** in `src` (grep: only the definition site); there is no settings row, atom or i18n key for a loader choice (grep of `src/i18n/en.ts` for `loader|spinner|thinkingAnimation` = none). Variant selection is a hardcoded `type` prop per call site, with a documented policy in `DESIGN.md:325-327`: one `Loader`, "animated math/ascii curves (`lemniscate-bloom` for long ops)", never the literal text "Loading...".

De facto mapping (state it signals):

| Variant | Call sites (`path:line`) | Signal / state |
| --- | --- | --- |
| `rose-curve` (default) | `src/components/page-loader.tsx:29-30`; `src/app/settings/connections-registry.tsx:612`; `src/components/assistant-ui/clarify/pending.tsx:268`; `src/components/assistant-ui/thread/status.tsx:244`; `src/app/session-import/index.tsx:182,273` (default) | generic page / list / panel loading: artifacts indexing, skills, preview file, command-center status+usage, maintenance curator+memory, connections registry, clarify question body, session-import scan+preview |
| `rose-curve` centred in the thread | `status.tsx:229-247` `CenteredThreadSpinner` (size-12, `text-midground/70`, height 220, strokeScale 0.72) | "loading session" - transcript being hydrated, no turn running |
| `lemniscate-bloom` | `src/app/updates-overlay.tsx:206` (size-12, checking) and `:523` (size-16, update in progress); `src/app/onboarding/flow.tsx:377` (size-7); `src/plugins/kanban/board.tsx:1389`; `src/plugins/kanban/drawer.tsx:1045` | long operations: update check/apply, onboarding "starting" screen, kanban board/drawer load |
| `fourier-flow` | `src/components/desktop-install-overlay.tsx:119` (size-6, install running), `:640` (size-5, fetching manifest), `:719` (size-4, cancelling) | Hermes desktop install pipeline + cancel |
| `spiral-search` | `src/app/right-sidebar/terminal/instance.tsx:66-71` (size-8, `text-(--ui-text-tertiary)`, `pathSteps 180`, `strokeScale 0.68`, over a `pointer-events-none absolute inset-0 z-10 grid place-items-center` layer) | terminal session spawning / pty attaching |
| `braille` GlyphSpinner | `src/app/chat/chat-swap-overlay.tsx:48,72`; `src/app/chat/composer/model-pill.tsx:149`; `src/components/chat/composer/reasoning-pill.tsx:85` | profile waking/hydration syncing (`wakingProfile`, `hydrationSyncing`), model unresolved, reasoning-effort pending - all at `opacity-50`/accent |
| `breathe` GlyphSpinner | `src/app/agents/index.tsx:32-36` (`size-3.5 text-[0.95rem] text-muted-foreground/80`), `:331-335` (`size-2.5`) | agent/subagent running, streaming |
| `Loader2` (lucide `animate-spin`) | ~30 sites, e.g. `app/composer/attachments.tsx:175`, `app/plugins/skills-tab.tsx:203,333`, `app/plugins/plugins-tab.tsx:490`, `sidebar/connection-switcher.tsx:260`, `sidebar/profile-switcher.tsx:1116,1313`, `command-palette/*`, `pet-generate/components/hatch-preview.tsx:149`, `onboarding/shell/*` | small "busy" in buttons/rows: install/update, attachment upload, connection/profile switch, theme install, adopt pet |
| `PageLoader` (wrapper) | `src/app/artifacts/index.tsx:353`; `src/app/capabilities/index.tsx:134`; `src/app/right-rail/preview-file.tsx:1143,1210`; `src/app/command-center/index.tsx:524,621`; `src/app/command-center/maintenance.tsx:275,321`; `src/contrib/messaging/index.tsx` | full-pane empty-state loading (grid h-full place-items-center, size-10 primary/70) |

`PageLoader` itself (`src/components/page-loader.tsx:15-33`) is the canonical "loading pane": `Loader aria-hidden, className='size-10 text-primary/70', pathSteps 220, strokeScale 0.72, type='rose-curve', role='presentation'` inside `div.grid.h-full.place-items-center` with `role='status'` and `aria-label = label`. `CenteredThreadSpinner` uses the same 220/0.72 pair at size-12.

---

## 2. GlyphSpinner (the other custom loader)

### 2.1 Component (`src/components/ui/glyph-spinner.tsx`)

- Frame source: `unicode-animations` (`import spinners, { type BrailleSpinnerName }`, `:4`). Frames are normalised to the first code point so each frame is one mono cell (`:37-49`).
- DOM: outer `span.inline-flex.items-center.justify-center.font-mono.leading-none.tabular-nums` with `role='status'` and `aria-label` (default `'Loading'`, `:105-110`); inner `span.glyph-spinner[data-paused]` `aria-hidden` (`:114`); strip `span.glyph-spinner__strip` with inline custom props; then one `span.glyph-spinner__frame` per frame (`:115-121`).
- Custom props (`:100-104`): `--glyph-spinner-duration = ${frames.length * interval}ms`, `--glyph-spinner-frames = frames.length`.
- Pausing: `data-paused='true'` when `paused` prop set **or** `usePaneVisible()` is false (kept-alive hidden tab) (`:88-97`, `:114`).
- Accessibility: frames are `aria-hidden`; the original per-tick text mutation (~12 announcements/s) was removed (`:110-113`).

### 2.2 Frames and cadences (`repo:node_modules/unicode-animations/dist/chunk-F2BWZODB.js:303-355`)

| name | interval ms | frames | cycle (frames x interval) |
| --- | --- | --- | --- |
| `braille` (default) | 80 | U+280B,2809,2819,2839,2838,283C,2834,2826,2827,2807,280F (10) | **800 ms** |
| `braillewave` | 100 | multi-row wave set | - |
| `dna` | 80 | - | - |
| `scan` | 70 | generated | - |
| `rain` | 100 | generated | - |
| `scanline` | 120 | generated | - |
| `pulse` | 180 | generated | - |
| `snake` | 80 | generated | - |
| `sparkle` | 150 | generated | - |
| `cascade` | 60 | generated | - |
| `columns` | 60 | generated | - |
| `orbit` | 100 | generated | - |
| `breathe` | 100 | generated | - |
| `waverows` | 90 | generated | - |
| `checkerboard` | 250 | generated | - |
| `helix` | 80 | generated | - |
| `fillsweep` | 100 | generated | - |
| `diagswipe` | 60 | generated | - |

`glyph-spinner.css` states "all 18 spinner variants (16 distinct frame/interval shapes) share this one rule set" (`:36-39`). Only `braille` and `breathe` are used by the desktop today.

### 2.3 CSS (`src/components/ui/glyph-spinner.css`)

- `.glyph-spinner`: `--glyph-spinner-frame-height: 1em`; `display:block; height:1em; overflow:hidden; line-height:1` (`:41-51`). `user-select:none` on the strip and frames, including inside `[data-selectable-text='true']` (`:58-67`).
- `.glyph-spinner__strip`: `animation: glyph-spinner-advance var(--glyph-spinner-duration, 800ms) steps(var(--glyph-spinner-frames, 10)) infinite` (`:70-73`).
- `will-change: transform` **only** while `:not([data-paused='true'])` (`:79-81`); removed under `[data-renderer-animations-paused]` and under reduced motion (`:84-91`).
- `.glyph-spinner__frame`: `display:block; height:1em; overflow:hidden; line-height:1` (per-frame clip so braille fallback ink cannot bleed) (`:93-104`).
- `[data-paused='true'] .glyph-spinner__strip { animation-play-state: paused }` (`:113-115`).
- Keyframes (`:122-127`): `from translateY(0)` to `translateY(calc(N * -1 * 1em))` - **absolute length deliberately, never a percentage**, because a percentage translate makes Chromium treat the animation as layout-dependent and refuse to composite (comment `:117-121`).

---

## 3. The shared engine

### 3.1 `createBudgetedLoop` (`src/lib/budgeted-loop.ts:1-127`)

```
createBudgetedLoop(draw: (now:number) => void, { fps = 15, idleWhen?, pauseWhenUnfocused = false })
  -> { dispose(): void; isDormant(): boolean; wake(): void }
```
- Tick: one `requestAnimationFrame(tick)` at a time; `frameInterval = 1000/fps`; `draw(now)` only when `now - lastDraw >= frameInterval`; after each draw, if `idleWhen?.()` → `dormant = true`, return (zero pending frames/timers); otherwise re-schedule (`:74-101`).
- `wake()` un-parks (`:112-120`); `dispose()` cancels the frame, disposes the pause controller, and makes later `wake()` a no-op (`:124-136`).
- Default budget 15 fps: "visually smooth for decorative/avatar-scale animation at a quarter of display cadence" (`:35-38`).

### 3.2 Pause controller (`src/lib/renderer-loop-pause.ts:8-43`)

`createRendererLoopPauseController(onChange, { pauseWhenUnfocused = false })`:
- `isPaused() = document.visibilityState === 'hidden' || (pauseWhenUnfocused && !windowFocused) || windowPaused`.
- `windowPaused` is driven by `window.hermesDesktop?.onWindowStateChanged?.({ isMinimized, isVisible })` (`:16-30`) - i.e. real Electron window state, not just visibility.
- `pauseWhenUnfocused` adds window blur/focus listeners (`:32-42`).

`installRendererAnimationPauseState()` (`:50-64`) mirrors that state onto `:root[data-renderer-animations-paused]`, and is installed **only for the primary window** (`src/main.tsx:83-87`); overlay/quick/wake windows intentionally keep animating while blurred.

### 3.3 Global CSS pause list and reduced motion (`src/styles.css`)

- Paused when the attribute is set (`:68-86`): `.shimmer, .quest-glow, .pet-egg, .pet-egg__glow, .pet-egg-shadow, .pet-wobble, .progress-slide, .kanban-arc, .glyph-spinner__strip, .decode-cursor-blink`, `.arc-border::before`, and streaming code cards.
- Blanket reduced-motion (`:20-33`), applied to `*, *::before, *::after`:
  `animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important;`
  Rationale in-comment: overlays and loading bars must resolve instantly, not be caught mid-fade.
- Blanket reduced-transparency (`:48-60`) kills `backdrop-filter` - relevant because motion under glass was a documented strobe source.
- Per-site `@media (prefers-reduced-motion: reduce)` blocks exist for: arc-border, setting-field-flash, hover-marquee?, tool-ticker, thread-jump, code-card-stream, pet egg/reveal/reaction, progress-slide, wake indicator, tips outline, status drawer, butterbar, glyph-spinner. JS-level checks exist for `StatusPulse`, `DecodeText`, `ParticleField`, `useEnterAnimation`, `GatewayConnectingOverlay`, `PetStarShower`, `Timeline`, onboarding glyph/intro.
- **Gaps** (the port must not inherit these): `Loader` (no check at all), `.glyph-spinner` (only `will-change`), status dots (static by design so nothing to skip), and any `animate-pulse`/`animate-spin` Tailwind utility that has no `motion-reduce:` prefix.

### 3.4 Other shared primitives

- `prefersReducedMotion()` / `useMediaQuery()` (`src/hooks/use-media-query.ts:3-5`, `:7-30`): read at call time, not render time.
- `useEnterAnimation(enabled, animationKey)` (`src/lib/use-enter-animation.ts:62-113`): WAAPI `el.animate([{transform:'translateY(0.375rem)'},{transform:'translateY(0)'}], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' })`; **transform-only on purpose** (an `opacity` keyframe with `fill:'both'` once pinned rows invisible when Chromium paused the timeline); per-key once-only registry with `MAX_TRACKED_KEYS = 2048` (`:27-30`); skipped entirely under reduced motion.
- `dither` utility (`styles.css:847-849`): `repeating-conic-gradient(currentColor 0% 25%, transparent 0% 50%) 0 0 / 0.125rem 0.125rem` - the 2x2 checker used by the square alive-indicators.

---

## 4. Everything else that animates (with constants)

### 4.1 Turn/tool/transcript surfaces

| Thing | Where | Literal motion |
| --- | --- | --- |
| Response loading row (turn running) | `src/components/assistant-ui/thread/status.tsx:249-269` | `StatusPulse kind='opacity'` (`dither inline-block size-3 rounded-[2px] text-midground/80`) + optional shimmer hint + `ActivityTimerText` |
| StatusPulse | `src/components/ui/status-pulse.tsx:3-4`, `:110-125` | `PULSE_DURATION_MS = 400`, `PULSE_PERIOD_MS = 5_000`; opacity frames `[1, 0.5, 1]` easing `ease-in-out`; ping frames `{opacity,scale(1)} -> {opacity:0, scale(2)}` easing `cubic-bezier(0, 0, 0.2, 1)`; one shared ref-counted controller, one aligned beat for all instances, in-flight animations cancelled when minimized/hidden (`:41-52`) |
| Turn timer | `src/components/chat/activity-timer.ts:89` | 1 Hz `useViewedInterval(..., 1000, active)`; `formatElapsed` -> `Ns` or `m:ss`; finished durations cached in a module registry so scrolling back still reports them |
| "Quiet wait" threshold | `src/components/assistant-ui/thread/turn-activity.ts:11` | `TURN_QUIET_S = 2` |
| Thinking disclosure | `src/components/assistant-ui/thread/message-parts.tsx:279-420` | header label gets `shimmer` only while `pending`; body `max-h-40` preview with ResizeObserver auto-pin to bottom (`:283-322`); hidden entirely when no reasoning text |
| Disclosure caret | `src/components/ui/disclosure-caret.tsx:11-22` | `transition-transform duration-150` + `rotate-90` when open |
| Caret opacity | `src/components/chat/disclosure-row.tsx:52-62` | `transition-opacity duration-150`; closed uses `opacity-(--disclosure-caret-rest)`, open/hover/focus-within `opacity-80`; hover pill `-mx-1.5 px-1.5` |
| Scaffolding fade | `styles.css:2258-2276` | `[data-conversation-scaffold] { opacity: 0.67; transition: opacity 120ms ease-out }`; `:is(:hover, :has(:focus-visible))` -> 1 |
| Tool ticker reel | `styles.css:2547-2570` | `.tool-ticker__reel { transform: translateY(index * -1 * var(--conversation-line-height)); transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1) }`; window height = one line; reduced motion `transition: none` |
| Streaming code card | `styles.css:2573-2581`, `:2641-2654` | `code-card-stream-enter`: opacity 0.74 -> 1, translateY 0.375rem -> 0; `code-card-stream-glow`: box-shadow ring 6%->12% + shadow 0.5rem/1.5rem -> 0.75rem/2rem; paused under the global pause attribute; off under reduced motion |
| Jump-to-bottom button | `styles.css:2596-2637` | in: `200ms cubic-bezier(0.22, 1, 0.36, 1) forwards` from `translateY(0.3rem) scale(1.1)`; out: `180ms ease-in forwards` to `translateY(0.3rem) scale(0.9)`; X centring `-50%` baked into every frame; reduced motion -> `none` + `opacity 120ms linear` |
| Shimmer (thinking/tool labels, artifact titles, generating labels) | `repo:node_modules/tw-shimmer/src/index.css:1-80` | text variant: `background-position: 100% 0 -> 0` keyframe `tw-shimmer`; defaults `--shimmer-speed: 200` px/s, `--shimmer-track-width: 200px`, spread `calc(4ch + 80px)`, angle `15deg`, fg `oklch(from currentColor l c h / alpha*0.2)`, dark variant lifts lightness; `.shimmer-bg` skeleton default speed 1000 px/s |
| Message enter | `src/lib/use-enter-animation.ts:92-99` | 180 ms, `cubic-bezier(0.16, 1, 0.3, 1)`, translateY(0.375rem) -> 0, `fill: backwards` |
| Overlay zone fade | `src/components/pane-shell/tree/renderer/tree-group.tsx:968`, `:1049` | `OVERLAY_FADE_MS = 80`; `animation: hermes-zone-fade 80ms linear both` (keyframes `opacity 0.001 -> 1`, mirroring a native clamp(t/200ms)) |
| Command-palette deep link | `styles.css:1263-1280` | `setting-field-flash 1.6s ease-out` (primary 22% -> transparent); off under reduced motion |
| Tooltips | `DESIGN.md:208-212` | hover trigger delay 300 ms (opens instantly if re-entered within 300 ms); entrance has **no** animation; exit fades 100 ms + moves 0.125rem toward the anchor; radius 0.25rem; reduced motion disables the exit animation |
| Card stack | `src/components/ui/card-stack.tsx:188-203` | WAAPI `animate(y, 0..1, { duration: 0.08 })`, return `duration: 0.12`; zero durations under reduced motion |
| Scroll fade | `styles.css:1116-1159` | `@property --scroll-fade-top/bottom`, `scroll-fade-y` utility: `--scroll-fade-size: 1.25rem`, mask gradient driven by `animation-timeline: scroll(self y)` with ranges `0 -> pad+size` and `100% - pad - size -> 100%` |

### 4.2 Working / running indicators

| Thing | Where | Literal motion |
| --- | --- | --- |
| Travelling arc ring (sidebar row + HUD composer + Nous hero) | `styles.css:1178-1352`; uses `src/plugins/kanban/board.tsx:305`, `src/app/chat/index.tsx:1444` | `.arc-border`: `--arc-angle 160deg`, `--arc-width 0.078125rem`, `--arc-standoff 0.125rem`, `--arc-radius var(--radius-md)`, `--arc-duration **2.23s**`, `animation: arc-border var(--arc-duration) linear infinite`; `::before` is `240% x 240%` with `repeating-linear-gradient` stops `transparent 0%, c0 18.75%, c1 25%, c2 31.25%, transparent 43.75%, 50%` and keyframes `translate(0,0) -> translate(-50%,-50%)` (exactly one gradient period, seamless); `.arc-reverse` reverses; `.arc-nous` = blue `#4f8cff` -> orange `#ff8c42` at **3.27s**; `.arc-row` standoff 0; `.arc-composer` width 2px, radius 0.75rem, z-index 6; ring made with `mask-composite: exclude`; `will-change: transform`; off under reduced motion (comment: the old `background-position` version cost ~3,600 main-thread style recalcs/min/arc) |
| Kanban card arc | `src/plugins/kanban/kanban.css:7-46` | `@property --kanban-arc-angle`; `conic-gradient(from angle, transparent 0deg, tone 55deg, transparent 110deg)`; `animation: kanban-arc-spin **2.2s** linear infinite` (to 360deg); `.kanban-arc--stale` tone `#fbbf24`, `animation-duration: **6s**` |
| Session status dots | `src/app/chat/session-status-dot.tsx:20-90` | deliberately **static**: `DOT_BASE = 'size-1.5 rounded-full'`; needs-input `bg-amber-500`; working `bg-(--ui-accent)`; stalled `border border-(--ui-accent)` (hollow); background `border border-(--ui-text-tertiary)`; unread `bg-(--ui-success)`; draft `border border-(--ui-text-quaternary)`; idle `size-1 rounded-full bg-(--ui-text-quaternary)`. Comment: motion on a 6px circle only says "something is happening", which the row's arc already says better |
| Ad-hoc pulses | `src/app/capabilities/mcp/mcp-status.ts:71-72` (`probing: 'animate-pulse bg-foreground/40'`); `src/app/sidebar/cron-jobs-section.tsx:380-382` (`size-1.5 animate-pulse` when running); `src/app/chat/composer/voice-activity.tsx:59-60` (`transition-[height,opacity] duration-100 ease-out`, inactive `animate-pulse opacity-45`); `src/components/chat/zoomable-image.tsx:236` (`animate-pulse` on download icon) | Tailwind `animate-pulse` (2s cubic-bezier(0.4,0,0.6,1) infinite opacity 1->0.5) / `animate-spin` (1s linear) |
| Agents roster | `src/app/agents/index.tsx:32-36,331-335,382-383,394` | `GlyphSpinner spinner='breathe'`; running goal text gets `shimmer text-foreground/65`; rows use `useEnterAnimation(true, 'subagent-row:<id>')` |

### 4.3 Boot / connect

| Thing | Where | Literal motion |
| --- | --- | --- |
| Pre-paint background | `index.html:14-41` | inline script sets `documentElement.style.backgroundColor` from `hermes-boot-background` (defaults `#111111` dark / `#f7f7f7` light) before the bundle runs; skipped for `hud|overlay|quick|wake` |
| Transparent window roots | `src/main.tsx:61`, `:71-78` | `TRANSPARENT_WINDOWS = {hud, overlay, quick, wake}`; injects `html,body,#root{background:transparent !important;}` |
| Connecting overlay | `src/components/gateway-connecting-overlay.tsx:20-29`, `:88-113` | `TEXT = 'CONNECTING'`; exit choreography `TEXT_OUT_MS 360`, `POST_TEXT_HOLD_MS 300`, `OVERLAY_OUT_MS 520` (total 1180 ms); overlay `transition-opacity duration-500 ease-out`; text `transition duration-300 ease-out` with `translate-y-2 opacity-0 saturate-0`; preview `PREVIEW_CONNECT_MS 2600`, `PREVIEW_REPLAY_MS 1100` (`?connecting=1`); reduced motion jumps to `gone`; full-screen only for the first boot (never re-covers chat) |
| DecodeText | `src/components/ui/decode-text.tsx:26-27`, `:63-110` | `TICK_MS = 45`, `HOLD_TICKS = 16`, `DECODE_SCRAMBLE_CHARS = '/\\|-_=+<>~:*'`, `resolved += 0.5` per tick (half a char), holds 16 ticks (720 ms) then stops unless `loop`; `prefix` characters never scramble; cursor `decode-cursor-blink` = `1s step-end infinite` (`styles.css:1356-1368`); reduced motion resolves instantly; typography baked in: `font-mono text-[0.64rem] font-semibold uppercase tracking-[0.4em] tabular-nums` |
| Empty-pane / pane-loading marks | `src/contrib/context.tsx:30`, `src/contrib/panes.tsx:81`, `src/components/pane-shell/tree/renderer/tree-group.tsx:827` | `DecodeText text='HERMES' text='LOGS' prefix={1} cursor` |
| Boot progress / failure | `src/store/boot.ts:21` `$desktopBoot`; `src/components/boot-failure-overlay.tsx:91`, mounted `src/contrib/wiring.tsx:1344` | boot progress phases drive the connecting overlay text; failure raises a modal recovery surface (`boot.error && !boot.running`) |
| Desktop install overlay | `src/components/desktop-install-overlay.tsx:118-119,639-641,718-720` | `Loader type='fourier-flow'` size-6 running / size-5 fetching manifest / size-4 cancelling |

### 4.4 Pet / mascot

| Thing | Where | Literal motion |
| --- | --- | --- |
| Egg wobble | `styles.css:2667-2766` | `.pet-egg` 5.5rem x 7rem (`--sm` 3.25 x 4.1rem), `transform-origin: 50% 88%`, `animation: pet-egg-wobble **2.4s ease-in-out infinite**`; keyframes: `0/62/100% 0deg, 8% -7, 16% +6, 24% -5, 32% +4, 40% 0, 70% -12, 76% +12, 82% -9, 88% +7, 94% -3`; `.pet-wobble` uses the same animation at `transform-origin 50% 85%` |
| Egg glow + contact shadow | `styles.css:2716-2735`, `:2813-2840` | both `2.4s ease-in-out infinite` on the same beat as the wobble; glow: opacity 0.35/0.4 -> 0.85 and scale 0.92 -> 1.08 at 84%; shadow: scaleX 1 -> 0.8 opacity 0.6 -> 0.45 at 76% |
| Pet reveal + reactions | `styles.css:2841-2892` | `.pet-reveal { animation: pet-reveal-pop 620ms cubic-bezier(0.22, 1.4, 0.4, 1) both }` (0% scale 0.35 + translateY 0.4rem, 60% scale 1.12, 100% scale 1); `.reaction-pop { animation: reaction-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both }` (0% scale 0.4, 60% scale 1.18) |
| Hatch progress bar | `styles.css:2902-2925`; `src/components/ui/progress.tsx:66-68` | `.progress-slide { width: 40%; left: 0; will-change: transform; animation: progress-slide **1.15s ease-in-out infinite** }`, `translateX(-105%) -> 250%` (replaced a layout-thrashing `left: -42% -> 100%`); reduced motion: no animation, full width, opacity 0.4 |
| Pixel egg sprite | `src/components/pet/pixel-egg-sprite.tsx:20-45`, `:100-140` | 12-frame, 32x32 sheet (frames 0-5 intact bounce, 6-11 crack/hatch); `BOUNCE_MS = 250`, `HATCH_MS = 190`, per-egg speed jitter `x (0.85 + rand*0.3)`; bounce rest `REST_MIN_MS = 2600` .. `REST_MAX_MS = 6200`; first-bounce stagger `((index % 4) + 1) * (2600/4) + rand*2600`; creme recolor LUT (outline `[78,66,58]` below cutoff 46, shadow `[214,198,168]` -> highlight `[253,249,238]`); DPR `min(dpr, 3)`; scheduler = rAF for <=16 ms gaps, `setTimeout` beyond |
| Hatch celebration canvas | `src/components/pet/pet-star-shower.tsx:17-30`, `:76-79` | `GOLD '#ffd76a'`, `BURST = 15`, `VELOCITY = 500`, `DECAY = 0.9` (per 60 Hz frame: `0.9^(dt*60)`), `GRAVITY = 90`, `RAY_COUNT = 24`, `GOLD_MIX = 0.6`, `MOTE_MS = 333`, motes cap 40, star size 3.5-9 px, ttl 0.8-1.5 s, rays ttl 0.9 s + spin 0.6 rad/s, `globalCompositeOperation = 'lighter'`, `dt` clamped to 0.05 s, accent from `--ui-accent` (fallback `#9aa0ff`), DPR `min(dpr, 3)`; whole effect returns early under reduced motion |
| Pet spritesheet | `src/components/pet/pet-sprite.tsx:5-11`, `:300-400` | defaults `frameW 192`, `frameH 208`, `frames 6`, `loopMs 1100`, `scale 0.33`; per-state cadence `stepMs = loopMs / count` (~183 ms at 6 frames); redraws only when the visible cell changes; state from `$petState` subscription (no React re-render); `pauseWhenUnfocused` opt-in; DPR from `devicePixelRatio` + `(resolution: Ndppx)` media query; `imageSmoothingQuality = 'high'`; rows: idle, running-right, running-left, waving, jumping, failed, waiting, running, review |
| Vibe hearts | `src/components/particles/particle-field.tsx` + `src/components/chat/vibe-hearts.tsx:23-56` | see 4.5 |

### 4.5 ParticleField (float-up emitter)

`src/components/particles/particle-field.tsx`:
- `DEFAULT_PARTICLE_CONFIG` (`:55-65`): `count 12`, `spawnWindowMs 550`, `size [6, 13] px`, `rise [6.75, 15.75] %`, `duration [320, 700] ms`, `swayAmp [9, 24] px`, `bank [7, 16] deg`, `swayDuration [1300, 2800] ms`, `maxAlive 200`.
- `spawn()` (`:118-138`): `life = Math.random() ** 1.7` (biases rise/duration together), `leftPct = 4 + rand*92`, `delayMs <= 120`, `swayDelayMs` **negative** random (drops each particle in mid-swing), colour picked uniformly from the caller list.
- Emission (`:139-158`): each burst releases `n` particles with `setTimeout(Math.random() * spawnWindowMs)`; under reduced motion it adds exactly one particle (CSS then plays `particle-flash`).
- Retirement: `onAnimationEnd` removes the particle only for `particle-rise` or `particle-flash` (`:186-192`).

`src/components/particles/particle-field.css`: three nested layers, one transform each - `.particle` rise+fade (`particle-rise`, `linear`), keyframes `0% opacity 0 translate3d(0,0,0)`, `6% opacity 1`, `70% opacity 1`, `100% opacity 0 translate3d(0, -rise%, 0)` (travel measured against the full-height track, not the glyph); `.particle__sway` `particle-sway` `ease-in-out ... infinite alternate` = `translateX(-sway) rotate(-bank)` -> `translateX(sway) rotate(bank)` on its own clock; `.particle__glyph` `particle-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1)` `scale(0.3) -> scale(1)`. All three carry `will-change: transform` (particle also `opacity`). Reduced motion: `.particle` becomes a fixed-height element with `particle-flash 650ms ease-out` (`0% opacity 0 scale 0.6`, `20% opacity 1 translateY(-0.5rem) scale 1.1`, `100% opacity 0 translateY(-1rem) scale 1`) and both inner layers get `animation: none`.

Consumer presets (`src/components/chat/vibe-hearts.tsx`): `HEART_COLORS = ['#ff9ec4']`; `COMPOSER_HEART_CONFIG = { count: 12, size: [6,13], rise: [6.75,15.75], duration: [320,700] }`; `PET_HEART_CONFIG = { count: 10, spawnWindowMs: 450, size: [6,12], rise: [98,118], duration: [480,880], swayAmp: [5,14], bank: [6,14] }`; glyph = 14x12 pixel heart path with `shapeRendering='crispEdges'`, `fill='currentColor'`.

### 4.6 Bot faces

- Two rendering paths (`src/plugins/hermes-bots/avatar.tsx:16-19`, `:1016-1090`): **blobatar** (deterministic SVG from a shape string via `sdk.blobatarSvg`, tagged `data-bot-face=<name>` for PNG backfill) and **legacy math face** (SVG with `data-hb-math='1'`, `data-hb-mood`, `data-hb-shape`, viewBox `0 0 40 44`).
- The desktop does **not** import `blobatar/motion.css` (grep: no match anywhere in `src`), so blobatar faces render **static** - there is no idle breathing/blinking for them. Only the math face animates.
- Face clock (`:590-980`), 15 fps budgeted loop with `idleWhen: faces.length === 0 || visibleFaces.size === 0` (`:893-897`), falling back to a hand-rolled rAF with a `lastPaint` gate on older SDKs (`:914-971`). Pose per mood (`facePose`, `:605-645`), `t` in seconds:
  - `think`: `turn = -18 + sin(0.55t)*14`; `tilt = sin(0.48t)*12 + sin(1.35t)*3`; `blink = t % 1.45 > 1.26` (190 ms blink every 1.45 s); dots `0.2 + 0.8*max(0, sin(2.4t - {0, 0.7, 1.4}))`.
  - `work`: `turn = -11 + sin(0.48t)*8`; `tilt = sin(0.42t)*8 + sin(1.1t)*1.6`; same blink window; dots at 2.6 rad/s with the same 0.7 offsets.
  - `idle`: static zero, `blink = t % 3.2 > 3.02` (180 ms blink every 3.2 s), dots 0.
- Mood changes blend from the last painted pose in elapsed time via a `WeakMap<SVGSVGElement, {mood, pose, from, since}>` (`:654-683`), so a paused clock still settles correctly.
- Blobatar library motion (present but unused here; keep for reference): `mo-breathe` duration `calc(2800ms * var(--mo-rate))` with per-seed negative phase `--mo-phase` (0..2800 ms) and `--mo-bob-phase` (0..3400 ms), `mo-shake` loop `calc(112ms * var(--mo-rate))`, blink period 3500-6500 ms, saccade 4200-7600 ms, `thinking` pose seesaws on a 900 ms cycle (`repo:apps/desktop/node_modules/blobatar/src/{animate.ts,motion.css,CHANGELOG.md,tests}`).

### 4.7 Wake indicator (separate always-on-top window)

- Trigger path: `src/lib/wake-indicator.ts` (states `capturing | detected | hidden`, pushing via `window.hermesDesktop.wakeIndicator.setState`) -> IPC `hermes:wake-indicator:set` (`electron/main.ts:15819-15822`) -> `createWakeIndicatorWindowController` (`electron/wake-indicator-window.ts:64-70`: `alwaysOnTop: true`, `backgroundColor: '#00000000'`, `focusable: false`) -> broadcast `hermes:wake-indicator:state` -> `src/app/wake-indicator/wake-indicator-app.tsx` renders `<div class='wake-indicator-light'>` with `data-state` (`app/wake-indicator/wake-indicator-app.tsx:31-35`).
- Window: `WAKE_INDICATOR_WINDOW_WIDTH = 176`, `WAKE_INDICATOR_WINDOW_HEIGHT = 52`, `WAKE_INDICATOR_FADE_MS = 500`; bounds centred horizontally at the top of the chosen display (`y = display.bounds.y`), preferring an `internal` display (`electron/wake-indicator.ts:1-31`).
- CSS (`src/app/wake-indicator/wake-indicator.css`): surface `padding-top: 5px`, `pointer-events: none`, transparent; light: `120px x 28px`, `border-radius: 999px`, `background: rgba(124, 58, 237, 0.62)`, `border: 1px solid rgba(216, 180, 254, 0.82)`, `box-shadow: 0 0 10px rgba(124,58,237,0.7), 0 0 24px rgba(168,85,247,0.48)`, `backdrop-filter: blur(20px) saturate(1.2)`, rest `opacity: 0; transform: scale(0.96)`, `transition: opacity 500ms ease-out, transform 500ms ease-out`.
  - `detected` -> `animation: wake-indicator-breathe **2.5s ease-in-out infinite**`: `0/100% opacity 0.34 scale 0.96`, `50% opacity 0.94 scale 1`.
  - `capturing` -> `opacity: 1; transform: scale(1)`.
  - reduced motion -> `transition: opacity 200ms ease-out`, animation none, static `opacity: 0.72 scale 1`.
- Voice sync: `syncWakeIndicatorWithVoice(active, status)` maps `listening` -> `capturing`, anything else -> `detected`, and hides when inactive (`src/lib/wake-indicator.ts:24-45`); the renderer that owns the indicator clears it on unmount (`src/app/chat/hooks/use-composer-voice.ts:293-305`).

### 4.8 Decorative / misc

- HUD mode motion (`src/app/hud/hud-shell.tsx:25-41`, published as CSS props at `:338-343`): `HUD_RECENT_HOLD_MS 1100`, `HUD_REVEAL_MS 110`, `HUD_FADE_MS 180`, `HUD_DIM_MS = round(180 * 1.5) = 270`, `HUD_COLLAPSE_MS = round(180 * 0.66) = 119`. Band `translate: 0 var(--hud-exit-shift, 2.5rem)`, `transform-origin: bottom center`, and per-property transitions: `opacity var(--hud-fade) var(--hud-ease-exit)`, `translate var(--hud-collapse) var(--hud-ease-exit)`, `scale/filter var(--hud-dim) var(--hud-ease-enter)`, `height var(--hud-reveal) var(--hud-ease-enter)`, `background-color var(--hud-dim) var(--hud-ease-enter)` (`styles.css:3004-3083`). Easings (`styles.css:2947-2948`): `--hud-ease-enter: cubic-bezier(0.16, 1, 0.3, 1)`, `--hud-ease-exit: cubic-bezier(0.4, 0, 0.7, 0.2)`. Occupancy: HUD sits on the `?win=hud` transparent window; long-press drag `LONG_PRESS_MS = 140` + `MOVE_TOLERANCE = 8` (`src/app/hud/composer-drag.ts:7-9`).
- Translucency peek: default scope fade `420ms cubic-bezier(0.22, 1, 0.36, 1)`; peek state `opacity 0.08` with `160ms cubic-bezier(0.32, 0.72, 0, 1)` (`styles.css:782-789`).
- Butterbar: `butterbar-in 240ms cubic-bezier(0.2, 0.9, 0.25, 1)` (`translateY(40%)` -> 0, opacity 0 -> 1); dot pills `transition: width 200ms ease-out, background-color 150ms ease-out`, active dot `width: 0.75rem` (`src/app/shell/butterbar.css`).
- Tips: `[data-tip-target] { outline: 2px solid var(--dt-primary); outline-offset: 3px; animation: hermes-tip-outline-pulse 1.8s ease-in-out infinite }` (50% colour mixed to 45% alpha); region targets inset to `-2px`; animation off under reduced motion (`src/components/tips/tips.css`).
- Hover marquee (`styles.css:1613-1630`): `animation: hover-marquee var(--marquee-t, 3s) linear infinite` with holds at 0-10% and near 100% (Spotify-style scroll-in/hold/snap-back/hold), one direction, reduced-motion handled by the blanket rule plus the hover variant's own gate.
- Scramble-on-boot onboarding glyph: `src/app/onboarding/glyph.tsx:41-45` resolves instantly under reduced motion.
- Canvas ASCII diffusion placeholder for image generation (`src/components/chat/image-generation-placeholder.tsx:1-233`): `RAMP = ' .,:;-=+*#%@'`; `MAX_ANIMATED_INSTANCES = 2` (beyond it a single static frame is drawn); 15 fps `createBudgetedLoop`; DPR `min(dpr, 2)`; `cycle = (time * 0.028) % 1` with `denoise = smoothstep(0.02, 0.82, cycle)` then recovering after 0.82; `fontSize = clamp(width/58, 8, 13)`, cell `fontSize*0.78` x `fontSize*1.28`; centre drifts `0.53 + sin(0.055t)*0.02` / `0.5 + cos(0.048t)*0.02`; `bloom` = two Gaussians (`exp(-r^2/0.075)*0.72` + ring at `0.28 + sin(5a + 0.16t)*0.035`, width 0.0028), `contour` = `exp(-((sin(3a + 17r - 0.17t)*0.5 + 0.5 - r)^2)/0.016)*0.38`, `stem` = `exp(-((sx+0.05)^2/0.004 + (sy-0.25)^2/0.08))*0.46`; noise = `fbm` (4 octaves, frequency x2.04, amplitude x0.52) + per-timestep hashed static noise blended by `smoothstep(0,1, time*1.15 - floor(time*1.15))`; dropout when `hash > 0.35 + signal*0.68`; chromatic offset draws the glyph twice more at +-0.75 px for `signal > 0.58 && denoise > 0.34`; theme tokens read through a probe element because `color-mix()` cannot be parsed directly.

---

## 5. React Native feasibility, per item

Legend: **Direct** = literal port (same numbers); **Rewrite** = needs a different engine; **Cut/reduce** = port the maths, reduce the budget.

| Item | RN mapping | Risk / notes |
| --- | --- | --- |
| Loader curve maths (all 21 variants) | Pure functions -> worklets (`react-native-worklets`) verbatim; every constant above transfers as-is | None - it is sin/cos/pow arithmetic |
| Loader rAF loop (path `d` + circles) | **Rewrite**: `react-native-svg` cannot take a worklet-updated `d` string cheaply (native re-parse of ~241 `L` segments per frame). Use `@shopify/react-native-skia`: build `Skia.Path` with `moveTo/lineTo` in a `useDerivedValue` on the UI thread and `drawPath` (stroke) + N `drawCircle` calls | **60fps risk**: 250-500 SVG writes/frame is what the desktop does; on mobile, cap to 30 fps for large sizes, or pre-render the faint curve once per (variant, detailScale bucket) and animate only the beads |
| Loader particles (62-104) | Skia `drawCircle` loop in one worklet, or Reanimated `AnimatedCircle` per particle | Prefer one canvas: 100 independently animated Reanimated props is worse than one draw call list. Opacity/radius per particle maps literally (`0.04 + fade*0.96`, `(0.9 + fade*2.7)*strokeScale`) |
| Loader phase/rotation randomisation | `Math.random()` at mount -> same | None |
| Loader reduced motion | **Must add**: `useReducedMotion()` / `AccessibilityInfo.isReduceMotionEnabled()` -> render one static frame (e.g. `progress` at 0) | Desktop has no check here at all; the blanket CSS rule that covers the rest of the app does not exist in RN |
| GlyphSpinner | **Direct-ish**: a fixed-height `View` with `overflow:'hidden'` holding N `<Text>` frames; animate `translateY` with `withRepeat(withTiming(-N*lineHeight, { duration: N*interval, easing: Easing.steps(N, false) }))` (Reanimated has `Easing.steps`) | Font risk: braille U+2800-28FF is absent from bundled mono fonts (desktop relies on a system fallback and clips each frame for exactly that reason). Verify the Android/iOS fallback or substitute a vector dot-matrix. Zero JS per frame once set up |
| GlyphSpinner frame data | Ship the frame arrays (braille 10 frames @80 ms; breathe @100 ms; etc.) as static data - the `unicode-animations` package is DOM-free and can be bundled, or inline the 2 used variants | None |
| StatusPulse | `withRepeat(withSequence(withTiming(...400 ms), withDelay(5000-400, ...)), -1)`; per-instance or one shared driver as desktop does | Prefer the desktop's shared-beat discipline: many sidebar dots each on their own 5 s timer is a battery bug |
| Status dots | Static `View` with border/background - direct port | None |
| Arc-border (2.23s ring, sidebar rows + HUD) | **Rewrite**: `mask-composite: exclude` + travelling `repeating-linear-gradient` has no RN equivalent. Best: Skia `SweepGradient` shader + stroked circle (2 px `arc-composer`) with an animated rotation, or a rotating `LinearGradient` clipped by an inner circle mask | Highest-effort visual port, and it is the primary "turn is running" signal in the sidebar (the dot is deliberately motionless) |
| Kanban arc (conic 2.2s / 6s stale) | Skia `SweepGradient` with animated start angle; `@property` angle animation becomes a shared value | Same class as arc-border; simpler because the ring is a full card outline |
| Shimmer (labels, thinking, code cards) | **Rewrite**: build the same effect with a masked moving `LinearGradient` (`expo-linear-gradient` + `MaskedView`) or Reanimated opacity pulse on a highlight overlay | Desktop speed is 200 px/s text / 1000 px/s skeleton with spread `4ch + 80px`; on RN, `background-clip: text` becomes a masked gradient over `<Text>` (MaskedView), which is GPU-heavy on Android |
| Message enter (180 ms translateY) | `entering={FadeInDown.duration(180)}` or a `withTiming` on mount; keep the once-per-key registry as a module `Map` | If using Reanimated `entering`, the layout-animation system can replay on list recycling - prefer explicit mount-time springs on a stable key |
| Scaffolding opacity 0.67 / 120 ms | Plain `Animated.View` opacity + `Pressable` hover/press state | Touch devices have no hover: `:has(:focus-visible)` lift becomes focus-only |
| Thinking disclosure | Disclosure row + `LayoutAnimation`/`withTiming` height; caret `rotate: 90deg` over 150 ms | The ResizeObserver auto-pin becomes `onContentSizeChange` + `scrollToEnd` (there is no synchronous pre-paint hook) |
| Tool ticker reel 240 ms | `translateY` `withTiming(..., 240, Easing.bezier(0.22,1,0.36,1))` on a clipped one-line window | Direct |
| thread-jump in/out 200/180 ms | Two `withTiming` presets on translateY+scale+opacity | Direct |
| Pet egg wobble/glow/shadow 2.4 s, 11 keyframe stops | One shared clock `withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }))`, then `interpolate(progress, [0,.08,.16,.24,.32,.40,.62,.70,.76,.82,.88,.94,1], [0,-7,6,-5,4,0,0,-12,12,-9,7,-3,0])` | Port the exact stops; do not substitute a spring |
| Pet reveal / reaction pop | `Easing.bezier(0.22, 1.4, 0.4, 1)` and `Easing.bezier(0.34, 1.56, 0.64, 1)` (overshoot beziers are valid in Reanimated) | Direct |
| Pixel egg sprite (12 frames, 250/190 ms, 2.6-6.2 s rest) | Skia `useImage` + `drawImageRect` per frame, or `<Image>` with a cropped source; drive with `useFrameCallback` scheduling at `frameMs` | Low risk; keep `min(dpr, 3)` and `imageSmoothingEnabled=false` (nearest neighbour) |
| PetStarShower (canvas confetti) | Skia `Canvas` + `useFrameCallback`; maths port directly (velocity 500, decay `0.9^(dt*60)`, gravity 90, 24 rays, motes 333 ms) | **Cut/reduce**: additive blending on a phone at 60fps with full-screen rays is heavy; halve rays/BURST or run at 30fps. Reduced-motion must return early as it already does |
| Pet spritesheet (183 ms cell, 1100 ms loop) | Skia or `<Image>` crop; `loopMs / frames` cadence; redraw only on cell change | Direct; the desktop's per-state `framesByState` counts are part of the gateway payload, so keep them |
| Bot math face (15fps clock) | react-native-svg props driven by a worklet, or Skia; same pose maths | Keep the 15 fps budget and the dormancy (`idleWhen` -> pause when no visible faces); blink windows are 190 ms every 1.45 s (think/work) and 180 ms every 3.2 s (idle) |
| Blobatar faces | `SvgXml` with the same deterministic SVG string; **stay static** like the desktop | Do not import the library's motion CSS expectations; if you want motion, it must be re-authored as Reanimated |
| Wake indicator window | **No RN equivalent**: it is a separate always-on-top translucent Electron window. On mobile this becomes an in-app overlay (or a heads-up pill) with the same 120x28 pill, breathing 2.5 s, 500 ms transitions. `backdrop-filter: blur(20px)` -> `expo-blur` `BlurView` (intensity ~20, Android needs `experimentalBlurMethod`) | Keep the state machine (`hidden | detected | capturing`) and the 176x52 geometry only if a floating window is possible (Android overlays); otherwise in-app |
| DecodeText (45 ms, 16-tick hold) | Same `setInterval` + `<Text>`; cursor blink as a Reanimated opacity loop (1 s step-end) | ~22 setState/s for the duration of boot only; acceptable, but stop the timer when the text resolves (desktop does) |
| Connecting overlay choreography (360/300/520 ms) | Three chained `withDelay`/`withTiming` phases, or the same `setTimeout` state machine | Port the state machine; it encodes "never re-cover the chat after the first boot" |
| HUD band (110/180/270/119 ms, exit shift 2.5rem) | Reanimated `withTiming` per property with the same two beziers; `filter` has no RN equivalent (drop it or use a blur view) | The HUD itself is an Electron transparent window; on mobile it is a screen with a floating composer - keep the timings |
| Butterbar (240 ms cubic-bezier(0.2,0.9,0.25,1), 40% slide) | `withTiming` on translateY + opacity | Direct |
| Tips outline pulse (1.8 s) | Border/outline colour interpolation on a wrapper `View` (outline -> borderWidth 2 + borderRadius inherit); `outline-offset` has no RN style, so wrap in a padded container | Minor layout difference |
| Canvas ASCII diffusion | **Cut/reduce**: Skia text drawing per cell is far more expensive than canvas2d `fillText`. Reduce `fontSize` clamp or cell count, or degrade to a static frame + shimmer | Desktop already caps at 2 animated instances and 15 fps; keep both caps |
| Global pause/dormancy | Replace `createRendererLoopPauseController` with `AppState` + `useFrameCallback` (auto-pauses when inactive); keep the dormancy contract (no frames when nothing is visible) for every loop | The desktop's biggest perf lesson: "an animation loop that never sleeps" was a repeating bug class (see `budgeted-loop.ts:1-15`); the RN build should route every decorative clock through one helper with `AppState` and `fps` options |
| Reduced motion globally | RN has no blanket kill switch. Enumerate every animation above and gate on `useReducedMotion()`; the desktop's gaps (Loader) must be closed rather than inherited | Or build one `<Motion>` wrapper component that neutralises durations when the flag is on |

### 60fps risk ranking (highest first)

1. **Loader** SVG path rebuild - 241-segment `d` string + 100 circle attribute writes every frame, unthrottled, on screen during any page load and the thread centre spinner.
2. **Canvas ASCII diffusion** - `fillText` per cell per frame (desktop caps to 2 instances at 15 fps).
3. **Arc-border / kanban arc** - a masked travelling gradient cannot be done with plain RN views; a naive `LinearGradient` + `Animated` rotation on Android will re-rasterise every frame.
4. **PetStarShower** - full-screen additive canvas at 60 fps.
5. **Many simultaneous infinite animations** - the desktop explicitly batches StatusPulse instances onto one beat, pauses off-screen glyph spinners, and pauses the listed decorative set when minimized; without those three policies a mobile sidebar list will animate dozens of loops at once.
6. **HUD/glass surfaces** - `backdrop-filter` under motion caused documented strobe bugs (see the reduced-transparency block, `styles.css:48-60`); prefer opaque fills on mobile.

### Numbers a port must reproduce exactly (short list)

Loader: `detailScale 0.52..1.0` (`0.52 + ((sin(p*2pi + 0.55)+1)/2)*0.48`), `opacity 0.04 + fade*0.96`, `radius (0.9 + fade*2.7)*strokeScale`, `fade = (1 - i/(N-1))^0.56`, path `opacity 0.1`, `viewBox 0 0 100 100`, default `pathSteps 240` / PageLoader `220` / terminal `180`, `strokeScale` defaults `1` / PageLoader `0.72` / terminal `0.68`, per-variant durationMs/pulseDurationMs/particleCount/strokeWidth/trailSpan/rotationDurationMs from section 1.5. GlyphSpinner: braille 10 frames x 80 ms = 800 ms, breathe 100 ms/frame, step clip 1em. StatusPulse: 400 ms on a 5000 ms beat. Arc: 2.23 s (3.27 s nous, 2.2 s kanban, 6 s stale). HUD: 110/180/270/119 ms + `cubic-bezier(0.16,1,0.3,1)` / `cubic-bezier(0.4,0,0.7,0.2)`. Pet: 2.4 s wobble stops, 620 ms reveal, 260 ms reaction, 1.15 s progress slide, 1100 ms/6 frames sprite, 250/190 ms egg, 2600-6200 ms rest. Particles: 12 count, 550 ms spawn window, rise 6.75-15.75 %, duration 320-700 ms, sway 1300-2800 ms, pop 260 ms `cubic-bezier(0.34,1.56,0.64,1)`. Wake: 120x28 pill, 2.5 s breathe, 500 ms transitions, `rgba(124,58,237,0.62)`.
