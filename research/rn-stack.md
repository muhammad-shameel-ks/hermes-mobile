# hermes-mobile: which RN packages carry the desktop's rendering load

Snapshot date: **2026-10-12**. Every version, peer range and size below was read from the live npm registry on this
machine today (`npm view`, `npm pack`, `registry.npmjs.org/-/v1/search`); raw dumps:
`/tmp/rnstack/meta.jsonl`, `/tmp/rnstack/out.jsonl`, extracted tarballs `/tmp/rnstack/packs/x/*`. Desktop claims cite
`apps/desktop/...` under `/home/shameel/.hermes/hermes-agent/`. Prior-Expo-artifact claims cite `/tmp/post-stash-src/...`.
Numbers marked `[INFERENCE]` are reasoned from measured inputs, not measured on a device.

Two measurements were run for this report, both reproducible from `/tmp`:

- loader maths, exact desktop functions extracted to `/tmp/rnstack/bench/loader-math.ts` and timed with
  `node --experimental-strip-types /tmp/rnstack/bench/bench.ts` (Node 26.7, V8 with JIT, x64 workstation);
- colour-space deviation of `color-mix()` done in sRGB vs the CSS-declared oklab, with `culori@4.0.2`
  (`/tmp/rnstack/colormath/m.mjs`).

## A. Package-by-package verdict table

| Need | Package (registry today) | Verdict | Fallback | Fidelity loss |
|---|---|---|---|---|
| Chat runtime + transcript bindings | `@assistant-ui/react-native` **0.1.47** (2026-10-09, MIT, peers `react ^18\|\|^19`, `react-native *`) | **ADOPT.** Official RN bindings, same runtime/core/adapter surface as the desktop's `@assistant-ui/react` 0.14.24; docs `assistant-ui.com/docs/react-native`; must be the *only* assistant-ui package in the app (docs: "One assistant-ui package per app") | hand-roll on `useExternalStoreRuntime` primitives from `@assistant-ui/core` 0.3.27 | Web-only features absent: Radix popovers/hover, tool group, follow-up suggestions, sources (`/docs/react-native/elements` "From web to React Native" table) |
| Message list | RN `FlatList` inside `ThreadPrimitive.MessagesFlatList` / `RowsFlatList` (`src/primitives/thread/ThreadMessages.tsx:8`) | **KEEP** for v1 (it ships stick-to-bottom + history paging glue, `thread/flatListScroll.ts`, 14 KB) | `@shopify/flash-list` **2.3.3** (2026-10-01, MIT, JS-only v2, new-arch only) or `@legendapp/list` **3.6.0** (2026-09-29, peers `react`, RN optional) | FlashList recycling resets component state unless `useRecyclingState`/`useMappingHelper` are used (exported, `src/index.ts:26-27`); you also re-implement the scroll glue, since the assistant-ui list is FlatList-typed |
| Markdown renderer (streaming) | `react-native-marked` **8.3.2** (2026-09-23, MIT, peers `react-native >=0.76`, `react-native-svg >=12.3.0`) | **ADOPT** (this is what the official RN markdown element installs: `r.assistant-ui.com/native/markdown-text.json`) | `@ronradtke/react-native-markdown-display` **9.0.3** (2026-06-29, has `MarkdownStream`) | No Shiki-grade highlighting, no KaTeX, no mermaid, no resizable tables, no hover-reveal chrome |
| Markdown, stale/legacy | `react-native-markdown-display` **7.0.2** (last publish 2023-12-11) | **REJECT** (unmaintained) | the `@ronradtke` fork (above) | n/a |
| HTML renderer | `react-native-render-html` **6.3.4** is **deprecated** on the registry ("replaced with @native-html/render"); `@native-html/render` **1.0.3** (2026-10-06) | **REJECT for the transcript** (markdown, not HTML) | `@native-html/render` 1.0.3 if embedded HTML ever appears | WebView-backed tables/plugins, no DOM layout parity |
| Code blocks (syntax) | `react-native-shiki-engine` **0.3.12** (2026-06-06, "native Oniguruma regex engine", peers `react`/`react-native`) | **EVALUATE** - the only route to the desktop's Shiki output without WASM | `react-native-code-highlighter` **1.3.1** (needs `react-syntax-highlighter >=15.5.0`); plain monospace `Text` (what the official element does) | npm package unmeasured on device; Prism-based fallback needs colour-token mapping and is a different grammar set than `shiki` 4.3.1 the desktop pins |
| Math / diagrams | `katex` 0.19.0, `@streamdown/math` 1.0.3, `@streamdown/mermaid` 1.0.3 are web (`react-dom`) | **DEFER** | `react-native-webview` **14.0.1** (2026-07-11) hosting KaTeX/mermaid HTML | Desktop renders math inline in the text flow (`markdown-text.tsx:56-64`, KaTeX memoized per equation); a WebView is a separate scrolling surface, no text selection continuity |
| Loader / spinner vector layer | `react-native-svg` **15.15.5** (2026-05-20, MIT, Fabric codegen) | **ADOPT as default** (Java/Kotlin draw, no `.so`); drive it with 2 animated props, not 417 | `@shopify/react-native-skia` **2.14.0** (2026-10-01, MIT, peers `react >=19`, `react-native >=0.78`, `react-native-reanimated >=4.0.0`, `react-native-worklets >=0.7.0`) | Per-node prop updates per frame; Skia would remove that at the cost of a native lib (arm64-v8a static archives in `react-native-skia-android@154.0.1`: 57.8 MB across 9 files; tarball 70.2 MB, unpacked 224.6 MB) |
| Frame-driven animation | `react-native-reanimated` **4.7.1** + `react-native-worklets` **0.13.0** (2026-10-11; peers pin `react-native 0.86 - 0.88` per `compatibility.json`) | **ADOPT** (Skia's `usePathValue`/`useClock` and SVG `useAnimatedProps` both need it) | RN `Animated` + `useNativeDriver` only for transform/opacity (RN docs: native driver cannot do layout/geometry props, so no `cx`/`d`) | Worklets run in Hermes, no JIT |
| Blur / glass | `expo-blur` **57.0.3** (2026-10-01, peers `expo`, `react`, `react-native`) | **ADOPT** with `blurMethod="dimezisBlurViewSdk31Plus"` + a `BlurTargetView` ref on Android | `@sbaiahmed1/react-native-blur` **6.0.2** (2026-09-20, peers RN `>=0.80`), `@nguyenduy1412/react-native-blur` **2.1.0** (2026-10-08, RN `>=0.76`), `@react-native-community/blur` **4.4.1** (2024-08-29) | Android blur is a re-blur of a target view (Dimezis BlurView), not a compositor backdrop: no `saturate()`, no exact `blur(0.75rem)` match, and SDK < 31 falls back to a plain translucent view (`src/BlurView.types.ts:7-23`) |
| Gradient fills | RN core `backgroundImage: 'linear-gradient(...)'` / `'radial-gradient(...)'` (RN 0.87 view-style-props docs, non-experimental) | **ADOPT core**; `expo-linear-gradient` **57.0.2** only where a gradient must be a child/mask | `react-native-linear-gradient` **2.8.3** (2023-09-06) | No `repeating-conic-gradient`, no `background-clip: text`, no animatable gradient angle without JS |
| Mask / edge fade | `@react-native-masked-view/masked-view` **0.3.2** (published 2025-09-09) | **ADOPT for masks** (Android supported) | `react-native-edge-fade` **0.2.2** (2026-08-20, peers reanimated >=3 optional) for edge fades; Skia for the ring/composite cases | No `mask-composite`, no scroll-driven mask progress: the desktop's `--scroll-fade-top/bottom` animation-timeline (`styles.css:1108-1160`) becomes a scroll listener / Reanimated scroll value |
| Colour maths for CSS tokens | `culori` **4.0.2** (build-time + the runtime Uniwind already uses) | **ADOPT** for precomputing the 262 `color-mix()` sites | `@csstools/postcss-color-mix-function` **4.0.15** (CSS-correct build-time transform) | sRGB interpolation vs the declared oklab: measured ΔE2000 0.18-0.50 for tint mixes, 9.20 for a far-hue pair (section D) |
| Styling layer | `uniwind` **1.12.2** (2026-10-05; peers `react >=19`, `react-native >=0.81`, `tailwindcss >=4`, deps `culori` 4.0.2 + `lightningcss` 1.30.1) | **ADOPT** - the official RN elements are authored as Tailwind classes with `@layer theme` CSS variables, and Uniwind resolves `color-mix`/`oklch` for native | `nativewind` **4.2.7** (+ `react-native-css` **3.0.7**, peer RN `>=0.81`) | Uniwind declares some properties unsupported and drops them silently (`backdropFilter: () => ({})`, `src/bundler/css-processor/rn.ts:38`; no `mask*`, `background-clip`, `mix-blend-mode`, `isolation` mappings at all) |
| Fonts | `expo-font` **57.0.4** (2026-10-05) + `@expo-google-fonts/jetbrains-mono` **0.4.1** (license `MIT AND OFL-1.1`, ships static TTF per weight/style) | **ADOPT** | embed TTFs via the `expo-font` config plugin (Android `fontDefinitions` weight/style pairs) | `woff2` cannot load on Android (Expo fonts guide: OTF/TTF supported; woff/woff2 iOS-only); the display face `Collapse` is a commercial Blaze Type font (section E) |

## B. Transcript renderer (Q1 detail)

**An official RN package exists.** `@assistant-ui/react-native` 0.1.47, published 2026-10-09, MIT, described as
"React Native bindings for assistant-ui", peers `react ^18 || ^19` and `react-native *` (registry metadata). It shares
the runtime and adapters of `@assistant-ui/react`, so the gateway binding the desktop builds can be reused: the desktop
wraps the runtime at `apps/desktop/src/app/chat/index.tsx:463` with a custom
`IncrementalExternalStoreRuntime` (`src/lib/incremental-external-store-runtime.ts:245-263`), and the RN package exports
`useExternalStoreRuntime`, `ExternalStoreAdapter`, `useLocalRuntime`, `useRemoteThreadListRuntime`
(`src/index.ts:100-190` of the tarball). Exports are grouped exactly like the web kit:
`ThreadPrimitive.{Root,Messages,MessagesFlatList,RowsFlatList,Row,MessageByIndex,If,Empty,Suggestion}`,
`MessagePrimitive.{Root,Content,Parts,PartByIndex,GroupedParts,If,Attachments}`, `ComposerPrimitive`,
`ActionBar/BranchPicker/Attachment/ThreadListItem/ChainOfThought/Suggestion/Error`, plus the tool registry API
(`makeAssistantToolUI`, `Tools`, `hitl`, ...). Support status: documented, with a scaffold
(`npx assistant-ui@latest create --native`), an Expo example app, registry elements
(`https://r.assistant-ui.com/native/*`) and per-element docs; the package is still 0.1.x.

**The list is FlatList, not FlashList.** `ThreadMessages.tsx:8` imports `FlatList` from `react-native`;
`ThreadRowsFlatList.tsx:2` does the same. Both wrap a 14 KB scroll glue (`thread/flatListScroll.ts`) that implements
stick-to-bottom on content growth, `history` paging (`useHistoryLoad`, `getFlatListPagingProps`), inversion and
"keep the visible row anchored while older ones load". The rows API (`createThreadRowsSelector` +
`ThreadPrimitive.Row`, `@assistant-ui/core` `src/react/utils/threadRows.ts`) flattens a thread into
`message | part | turn-end` rows with stable keys, which is how a long agentic transcript stays cheap (one row per
grouped part, matching the desktop's grouping idea in `thread/list.tsx:52-110`).

**Markdown is bring-your-own, and the official answer is `react-native-marked`.** The RN default text renderer is
`<Text>{part.text}</Text>` (`primitives/message/MessageParts.tsx`), and `MessageContent` exposes
`renderText/renderToolCall/renderImage/renderReasoning/renderSource/renderFile/renderData`. The registry item
`markdown-text` (fetched today from `r.assistant-ui.com/native/markdown-text.json`) is the reference implementation:
`MarkedLexer(text, { gfm: true })` to split top-level blocks, one memoized `MarkdownBlock` per block, a 50 ms
throttled value plus `useDeferredValue`, a custom `TaskListTokenizer` for `- [x]` items, and a `CodeBlock` that is a
plain monospace `<Text>` in a horizontal `ScrollView` with a copy button (no syntax highlighting). Tables are styled
through `styles.tableCell` (react-native-marked depends on `react-native-reanimated-table` 0.0.2, last published
2023-12-03).

Comparison against hand-rolling a virtualized transcript:

| Option | Streaming | Code blocks | Tables | Cost |
|---|---|---|---|---|
| `@assistant-ui/react-native` + `react-native-marked` (official element) | block-level memo + 50 ms throttle, no full re-parse | plain mono, copy button | reanimated-table inside a list row | cheapest to ship; inherits assistant-ui's runtime, rows and history paging |
| Hand-rolled `@shopify/flash-list` 2.3.3 + own markdown | you rebuild throttle/block memo yourself | `react-native-shiki-engine` 0.3.12 or compiler-side highlighting | own `<ScrollView horizontal>` grid | full control, but you re-implement `flatListScroll.ts`, history paging and rows |
| `@ronradtke/react-native-markdown-display` 9.0.3 | ships `MarkdownStream` | `prism-react-renderer` dep | markdown-it tables | different parser (`markdown-it` vs `marked`); extra dep tree (`@react-native-vector-icons/material-design-icons`) |
| `markdown-to-jsx` 9.10.3 | parser only | byo | byo | peers list `react-native` as optional but there is no RN component kit; you own every element mapping |

Verdict: **adopt `@assistant-ui/react-native` 0.1.47 + `react-native-marked` 8.3.2, keep FlatList for v1, and treat
FlashList 2.3.3 as a measured optimisation only if a long-transcript profile demands it.** The desktop's own answer to
long transcripts is not a virtualizer: it is a paint-weight budget with paging
(`apps/desktop/src/lib/render-weight.ts:1-45`, `thread/list.tsx:52-110`: `RENDER_BUDGET = 600`, `MIN_VISIBLE_GROUPS = 8`,
"Show earlier" prepends a page and the most recent turns are never virtualized). RN's list already unmounts offscreen
rows, so the port needs the *grouping*, not the budget arithmetic.

## C. Motion and loaders (Q2 detail)

What the desktop actually does per frame (`components/ui/loader.tsx`):

- 240 path samples by default (`:374 pathSteps = 240`), `config.point` called 241 times, each result formatted with
  `toFixed(2)` and joined into one `d` string, ~3.4 KB (`buildPath`, `:516-522`).
- 62-104 particles (`:45-247`; max is `heart-wave`, 104), each computing one more curve point and writing 4 SVG
  attributes (`:332-357`: `cx`, `cy`, `r`, `opacity`), plus one group `transform` (`:344`).
- Browser-only: the desktop can afford `setAttribute` per frame because the SVG is a DOM subtree; there is no RN
  equivalent that cheap.

Measured on this workstation (V8, JIT on), per frame, for the exact desktop code:

| Curve | particles | path steps | maths + string build |
|---|---|---|---|
| `rose-curve` | 78 | 240 | 58.4 µs |
| all 21 curves, range | 62-104 | 240 | 53.3 µs (`lemniscate-bloom`) to 79.7 µs (`cardioid-glow`) |
| `heart-wave` | 104 | 240 | 56.1 µs |
| `rose-curve` | 78 | 120 / 180 / 240 / 360 | 30.7 / 45.9 / 58.1 / 82.8 µs |

So the curve maths is 0.3-0.5% of a 60 Hz frame on a JIT engine. `[INFERENCE]` Hermes has no JIT; for this kind of
floating-point loop with `Math.sin/cos` and string formatting, a 3-10x penalty is the working assumption, giving
**0.2-0.8 ms/frame on a mid-range Android CPU**. The math is not the risk; the update path is.

Frame budget for a mid-range Android device (60 Hz = 16.67 ms; 30 fps = 33.3 ms; treat 8 ms as the JS/decorative
ceiling so a streaming transcript can keep the frame):

| Approach | Per-frame work | Estimated frame cost `[INFERENCE]` | Verdict |
|---|---|---|---|
| Skia `Canvas` + `useFrameCallback` worklet, path rebuilt with `usePathValue` (`@shopify/react-native-skia` `src/external/reanimated/interpolators.ts:32-55`), all particles as `<Circle>` siblings in one canvas | 1 worklet tick, 1 path build, ~105 GPU draw ops | 0.5-2 ms (worklet maths + Skia recording); GPU cost negligible | **best fidelity + best headroom**, cost is 57.8 MB of arm64-v8a static libs in the npm dep and a heavier install |
| SVG + Reanimated, 2 animated props per frame: one `d` for the stroke path, one `d` for all 104 particles as arc subpaths (`M x y m -r 0 a r r 0 1 0 2r 0 a r r 0 1 0 -2r 0`) | 2 prop writes, ~8 KB of strings | 0.5-1.5 ms | **recommended SVG path**: keeps `react-native-svg` 15.15.5 (no native lib) and avoids a native graphics stack; loses per-particle opacity |
| SVG + Reanimated, per-particle props (104 components x 4 props) | 417 prop values through one Fabric commit per frame | 2-6 ms | works but eats a third to a half of the frame on a 60 Hz budget; use only with a 30 fps cap |
| SVG + React state at 30 fps (what `/tmp/post-stash-src/components/ui/loader.tsx:405-497` does: `setPathD`/`setParticles`/`setRotation` then `setTimeout(paint, 33)`) | full React commit of 105 nodes + native prop diff, 30x/s | 5-15 ms per commit | **avoid**: it is the stash's compromise, and it competes with streaming markdown re-renders on the same JS thread |
| `Animated` + `useNativeDriver: true` | n/a | n/a | **impossible**: the native driver animates only non-layout style props (transform, opacity) - RN docs "Caveats"; `cx`/`cy`/`d` are props, not animatable styles |
| Static frame under reduced motion (all variants) | 0 | 0 | required by the desktop contract, see section F |

Two properties of the desktop loader that the RN port must keep: it is decorative and therefore *budgetable* (the
desktop's own convention is `createBudgetedLoop` with `fps = 15` default, `lib/budgeted-loop.ts:37-45`), and the
particle ring is a visual trail whose opacity is a pure function of the tail index
(`particleFor`, `:537-549`), so quantising opacity into 4-8 buckets (one SVG path per bucket) is visually safe.

**Glyph spinner.** Desktop: a vertical strip of all frames translated with `steps()` on the compositor
(`components/ui/glyph-spinner.css:96-141`), driven by `unicode-animations` data (10 braille frames, 80 ms each,
`unicode-animations@1.0.3` `dist/braille.global.js:332-335`; duration computed as `frames.length * interval`,
`glyph-spinner.tsx:91`). RN equivalent: one `<Text>` per frame stacked in a 1em-clipped `View`, translated with
Reanimated and `steps(10, 'jump-end')` (exported: `react-native-reanimated` `src/css/easing/steps.ts`, `src/css/index.ts`
"steps"), or a CSS-mode animation on the same strip (`animationName` + `animationTimingFunction`, `src/css/*`). The
naive alternative (12.5 Hz `setState` swapping one glyph) is exactly the ticker the desktop removed for causing
document-scale style recalculation (`glyph-spinner.css:1-16`). Caveat: braille is **not** in JetBrains Mono
(`glyph-spinner.css:71-77` comment), so Android renders it from a fallback symbol face whose metrics are not the 1em
box; keep the per-frame `overflow: hidden` clip and verify on device.

## D. CSS-only effects (Q3 detail)

Counts are from the desktop source today. `styles.css` alone holds 148 `color-mix(`, 19 `backdrop-filter`, 8
`mask-image`, 6 `background-clip`, 1 `conic-gradient`, 0 `mix-blend-mode`; src-wide the totals are **262**
`color-mix()` (176 `in srgb`, 16 `in oklab`, 70 with no colour space, i.e. oklab per CSS Color 5), 37
`backdrop-blur*` utility usages, 10 `mask-image`, 4 `mix-blend-*`, 146 `animate-*`.

| Feature | Desktop usage (evidence) | RN substitute | Fidelity loss |
|---|---|---|---|
| `color-mix()` | token layer: `--ui-bg-*`, `--ui-text-*`, shadows (`styles.css:174-420`), arbitrary Tailwind values (`components/ui/kbd.tsx:11-31`), 18 nested mixes, `transparent` as the second operand in most | **Uniwind** resolves at build time (`src/bundler/css-processor/functions.ts:84` `processColorMix`) and at runtime (`src/core/native/native-utils.ts:39-58` `colorMix`, with a special case for `#00000000` that turns a mix into alpha output) | Uniwind **drops the interpolation space** (`functions.ts:240` filters out `in`, `srgb`, `oklab`, ...), so every mix is computed in sRGB by `culori` - measured ΔE2000 0.18-0.50 on theme tints (`#0053fd 7% + #ffffff`, `#9e94d5 58% + #64748b`), 9.20 on a far-hue pair (`#0053fd 50% + #cf2d56`). Mixes with `transparent` are exact (alpha-only). One site omits the percentage (`components/chat/image-generation-placeholder.tsx`), which would not fit `rt.colorMix(color, weight, mixColor)` `[INFERENCE]` |
| relative OKLCH | exactly one: `--dt-scrollbar-thumb: oklch(from var(--dt-midground) l 0 h)` (`styles.css:462`) | precompute in JS with `culori` (`parse` -> zero chroma -> `formatHex`) at build time, or keep Uniwind's plain-`oklch` path for anything else | none if precomputed; Uniwind has no relative-colour-syntax support, and RN core cannot parse it at all (see below) |
| RN colour parsing baseline | n/a | RN core accepts rgb/rgba/hsl/hsla/hwb/hex/named only (`@react-native/normalize-colors` 0.87.1 `index.js:244-283` regex set; RN "Color Reference" docs) | `oklch`, `oklab`, `lab`, `lch`, `color()`, `color-mix`, `light-dark` are all rejected without a JS pre-pass |
| `backdrop-filter` | dropdown/select/dialog/thread-timeline-popover surfaces `blur(0.75rem) saturate(1.08)` (`styles.css:1419-1420`), clear-mode overlay scrim `blur(0.5rem)` (`:764`), 37 Tailwind `backdrop-blur*` uses, global reduced-transparency gate (`:35-63`) | `expo-blur` 57.0.3 with `blurMethod="dimezisBlurViewSdk31Plus"` + `blurTarget` ref to a `BlurTargetView` (`src/BlurView.types.ts:7-23`, `src/BlurView.tsx:60-107`) | Android blurs a *target view*, not the compositor backdrop: no `saturate(1.08)`, radius is a Dimezis blur with `blurReductionFactor` tuning, SDK < 31 renders a translucent plain view, and a target that changes every frame (streaming transcript behind a dialog) re-blurs on change. Uniwind emits nothing for `backdrop-filter` (`rn.ts:38`), so these surfaces need the component-level substitute |
| `mask-image` | `scroll-fade-y` utility (`:1139-1160`, mask stops animated by `animation-timeline: scroll(self y)`), pane-tab hover label mask (`:1748`), sticky-human clamp (`:1899`), streaming code-card fade (`:2199`), HUD thread viewport (`:3267`), plus `components/ui/fade-text.tsx:21` and `fade-scroll.tsx:39` | `@react-native-masked-view/masked-view` 0.3.2 with a gradient mask (`expo-linear-gradient` 57.0.2 or core `backgroundImage: 'linear-gradient(...)'`), `react-native-edge-fade` 0.2.2 for the scroller edges, Skia `Path` boolean ops for the `mask-composite: exclude` ring (`styles.css:1225-1232`, `lib/tour/app-tour.css:255-256`) | Android MaskedView rasterises children (memory + re-raster on change); the desktop's scroll-driven mask progress has no RN analogue, so it becomes an `onScroll` -> state/shared-value write; `mask-composite` must be redrawn rather than composed by the platform |
| `background-clip: text` | one site: `.tool-memory-legendary-title` gradient over the label (`:1240-1250`), plus `filter: drop-shadow` glow on the glyph (`:1252-1254`) | `MaskedView` (gradient child) over `<Text>`, or Skia text with a `LinearGradient` shader and a loaded font; ready-made alternative `react-native-linear-gradient-text` 1.2.12 (2025-01-19, peers masked-view + react-native-linear-gradient) | masked text keeps the gradient but adds a native mask node per label; `drop-shadow` has no cross-platform RN filter (RN `filter` supports `dropShadow` on **Android 12+** only, brightness/opacity only on iOS), so the glow needs Skia or a prerendered asset |
| conic gradients | `.dither` repeating-conic-gradient checker (`:848`), tour spotlight ring (`app-tour.css:240`), kanban arc (`kanban.css:19`) | Skia `SweepGradient`/shader for the rings and the dither pattern (RuntimeEffect or a generated tile via `expo-image`), or SVG with dense stops | Uniwind explicitly returns `""` for `conic-gradient` and `radial-gradient` (`functions.ts:121-124`, comment "Not supported by RN") although RN core now supports radial gradients; a rasterised dither tile is exact only at the device pixel ratio |
| `mix-blend-mode` | `Backdrop.tsx:15` `mix-blend-difference`, `chat/wordmark.tsx:34` `mix-blend-plus-lighter`, `settings/billing/tier-art.tsx:13-15` `mix-blend-lighten`/`screen` | **RN core `mixBlendMode`** (New Architecture, Android 10+; RN view-style-props docs) with `isolation` to scope the stacking context | Android < 10 unsupported; Uniwind has no `mixBlendMode` mapping, so these must be style props, not classes; blending is per-view in RN, so a multi-child subtree blends as one group `[INFERENCE]` |
| Other modern CSS with no RN equivalent | `animation-timeline: scroll(self y)` (1), `container-type`/`@container` for `.fit-text` wordmark sizing (`:1965-1990`), `:has()` (18 uses), `@property` registered custom properties (`:1108-1130`), `text-wrap`/`field-sizing`/`view-transition` (0 uses) | `.fit-text` -> `onLayout` + font measurement; `:has()` -> explicit React state; registered-number animation -> Reanimated shared values | The scroll-driven and container-query features are the ones that change architecture, not just syntax |

## E. Typography (Q4 detail)

Fonts the desktop ships and uses:

- `apps/desktop/src/fonts/JetBrainsMono-{Regular,Bold,Italic}.woff2` (92.4-96.4 KB each) declared at
  `styles.css:105-125` (weights 400/700/400-italic), `font-display: swap`.
- `Collapse-Bold.woff2` loaded from `node_modules/@nous-research/ui/dist/fonts/` (`styles.css:95-101`, weight 700) and
  used only by `.wordmark` (`styles.css:1953`, "the display lettering an empty chat is titled with"). The
  `@nous-research/ui` package 0.18.2 (MIT) also ships Mondwest, Neuebit, PP NeueBit and Rules Expanded/Compressed, but
  nothing in `apps/desktop/src` references them (grep for `font-family` in the desktop returns only Collapse, JetBrains
  Mono, the CJK stacks at `:1816-1824` and the system tokens).
- Token stacks: `--dt-font-sans` = `Segoe WPC, Segoe UI, -apple-system, ...` (`:476-479`), `--dt-font-mono` =
  `JetBrains Mono, Cascadia Code, ... Noto Sans Mono, SF Mono, monospace` (`:487-490`), `--dt-font-kbd` = system UI
  (`:481-482`, used by `components/ui/kbd.tsx:17`).

Licences, read from the font name tables on this machine with `fontTools` (IDs 13/14):

| Font | Manufacturer / designer | Licence record | Verdict |
|---|---|---|---|
| JetBrains Mono | JetBrains / Philipp Nurullin | "This Font Software is licensed under the SIL Open Font License, Version 1.1", `https://openfontlicense.org`; `@expo-google-fonts/jetbrains-mono` 0.4.1 declares `MIT AND OFL-1.1` and ships `LICENSE_FONT` | **safe to bundle** (OFL 1.1); port the static TTFs, not the woff2 |
| Collapse (Bold) | Blaze Type / Keussel | name table: "Check blazetype.eu for licencing details", `https://blazetype.eu/eula` | **commercial face**: the desktop may only be licensed for desktop/web use; app embedding needs a Blaze Type licence that covers it. Not verifiable from the shipped files `[INFERENCE]`; the EULA text was not fetched |
| Mondwest / PP NeueBit | Pangram Pangram / Steve Marchal | "Pangram Pangram Foundry All Rights Reserved" | unused by the desktop; do not ship |
| Rules Expanded/Compressed | Blaze Type / Matthieu Salva | no licence string in the name table | unused by the desktop; do not ship |

Loading in RN/Expo and what breaks:

- **Format**: Expo officially supports OTF/TTF; the `expo-font` config plugin accepts woff/woff2 on **iOS only**. The
  desktop's woff2 files therefore cannot be dropped into an Android asset folder. Use
  `@expo-google-fonts/jetbrains-mono` 0.4.1 (16 static faces: `400Regular`, `700Bold`, `400Regular_Italic`, ...), load
  via `expo-font@57.0.4` `useFonts` in the root layout (with `expo-splash-screen` gating) or embed via the config
  plugin's Android `fontDefinitions` with explicit `weight`/`style` pairs.
- **Weights**: RN resolves a family by (weight, style) pair on Android, so the three desktop faces map to three
  definitions (`400` normal, `700` normal, `400` italic). Missing the italic definition silently synthesises a slant.
- **What breaks without JetBrains Mono**: code fences, diffs, terminal panes and the tool rows fall back to the Android
  `monospace` face; the desktop documents that matching the terminal is the point of bundling the face
  (`styles.css:481-486`). Advance width and x-height change, so fixed-width diff gutters, the `tabular-nums` columns and
  the 13 px/20 px code card line box all shift; the line-height constants in the port must be retuned against the real
  face. The braille spinner is unaffected in principle (JetBrains Mono has no braille; both platforms use a symbol
  fallback), but the fallback face differs (Android symbol fallback vs macOS/iOS), so the 1em cell must be verified.
- **What breaks for the wordmark**: without Collapse, the empty-chat title loses the display face entirely
  (`styles.css:1951-1957`: `letter-spacing: 0.08em`, `line-height: 0.9`, uppercase, weight 700). Fallbacks, in order of
  fidelity: licence Collapse for app embedding; convert the wordmark to vectors at build time (still a font-licence
  question `[INFERENCE]`); substitute a free display face and accept a visibly different wordmark.
- **RN text primitives that mirror desktop behaviour**: `fontVariant: ['tabular-nums']` (RN text-style-props lists it)
  for numeric columns and the spinner; numeric `letterSpacing`/`lineHeight`; on Android `includeFontPadding: false` +
  `textAlignVertical: 'center'`/`verticalAlign: 'middle'` to reproduce the desktop's `leading-none` +
  `items-center` line-box centring; `fontVariationSettings` exists on RN 0.88+ if a variable face is ever used
  (Expo fonts guide "Variable fonts").

## F. Reduced motion and list-performance primitives (Q5 detail)

Desktop mechanisms and their RN counterparts:

| Desktop | Evidence | RN/Expo equivalent | Gap |
|---|---|---|---|
| fps budget per decorative loop, default 15 | `lib/budgeted-loop.ts:37-45` | Reanimated `useFrameCallback(cb, autostart)` returning `{setActive, isActive, callbackId}` (`src/hook/useFrameCallback.ts:11-48`) | RN has no built-in fps throttle: the worklet runs every display frame, so the budget must be implemented by skipping the draw body or by `setActive` toggling |
| idle dormancy (parks with zero timers until `wake()`) | `budgeted-loop.ts:14-17`, `:44-45` | `setActive(false)` on a frame callback; nothing else is scheduled | Needs an explicit idle predicate in the app (the desktop's `idleWhen`) |
| Pause on hidden/minimised window, optional unfocused | `lib/renderer-loop-pause.ts:11-42` (`visibilitychange`, window state, blur/focus) | `AppState` (`active`/`background`/`inactive`) - the stash already gates its paint loop on it (`/tmp/post-stash-src/components/ui/loader.tsx:419-425`); navigation focus (`useIsFocused`/expo-router) replaces "pane not visible" | RN keeps screens mounted and, on Android, the JS thread keeps running in `background` for a while: both the AppState gate and a focus gate are required. The desktop's `:root[data-renderer-animations-paused]` blanket CSS pause (`styles.css:67-89`, 9 animation classes) becomes per-component `setActive`/`isActive` |
| Kept-alive hidden panes gate hot subscriptions | `components/pane-shell/pane-visibility.ts:31-38` (`usePaneVisible`, `PaneLifecycleContext`) | screen-level focus/visibility context of our own (the RN kit does not ship one) | Must be built; the desktop's spinner pauses on it (`glyph-spinner.tsx:88,105`) |
| Reduced motion: blanket CSS freeze plus ~10 per-component opt-outs plus ~14 `matchMedia` call sites | `styles.css:24-31`, `:1276-1280`, `:1348-1352`, `:2567-2571`, `:2628-2634`, `:2655-2659`, `:2768-2772`, `:2879-2890`, `:2919-2926`; `hooks/use-media-query.ts:8` | `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` (the stash's `/tmp/post-stash-src/lib/use-reduced-motion.ts` is exactly this), Reanimated `useReducedMotion()` (`src/hook/useReducedMotion.ts:17`, exported `src/index.ts:147`); the official RN elements' `useMotion` reads the setting once per screen | The desktop's freeze lands every animation on a static frame rather than unmounting (iteration-count 1, 0.01 ms); the RN port must hold a static loader frame the same way (stash: `paintFrame(0)` and stop) |
| Looping animations must not block list rendering | n/a in Electron | `isInteraction: false` on `Animated` loops (RN animations doc "Caveats": a running animation can prevent VirtualizedList from rendering more rows); the assistant-ui RN docs state their looping indicators use it | Must be applied per loop |
| One scroll owner, stick-to-bottom | `thread/list.tsx:70-78` ("pure rendering, never touches scrollTop, so it can't fight use-stick-to-bottom"), `use-stick-to-bottom` dep | assistant-ui's `flatListScroll.ts` auto-scroll glue; FlashList 2.3.3 has `maintainVisibleContentPosition` **on by default** (`src/FlashListProps.ts:387-389`) | Adding a second scroll writer (own `scrollToEnd` in an effect) is the failure mode the desktop comment warns about |
| Transcript size budget | `lib/render-weight.ts:1-45` (`messagePaintWeight`), `thread/list.tsx` `RENDER_BUDGET = 600`, `MIN_VISIBLE_GROUPS = 8`, `useTranscriptWindow`, per-pane share | FlatList `windowSize`/`maxToRenderPerBatch`/`removeClippedSubviews`/`initialNumToRender`, or FlashList recycling (`useRecyclingState`, `useMappingHelper`) | The desktop's weight arithmetic has no RN equivalent and is not needed if rows stay grouped; keep the row grouping, drop the budget |

## G. Frame-budget risk list (ranked)

1. **417 SVG prop writes per frame** (104 particles x 4 attrs, `loader.tsx:332-357`). `[INFERENCE]` 2-6 ms/frame on a
   mid-range Android device once Fabric commits and the `SvgView` canvas re-draw are included. Mitigation: single
   particle-path (2 animated props) or Skia canvas; else cap at 30 fps like the stash (`frameMs = 33`).
2. **React-state-driven loader** (the stash approach, `/tmp/post-stash-src/components/ui/loader.tsx:414-497`): a full
   commit of ~105 nodes per paint plus the transcript's own streaming commit on the same JS thread. `[INFERENCE]`
   5-15 ms per commit on mid-range hardware. Mitigation: never drive the loader from state; use Reanimated/Skia, and
   keep the loader out of any subtree that re-renders on stream tokens (memo boundary).
3. **Allocation per frame**: ~3.4 KB `d` string plus 104 particle objects at 60 fps is ~200 KB/s of young-generation
   garbage in Hermes, whose GC is more stop-the-world than V8's. Mitigation: reuse preallocated arrays, cap at 30 fps,
   and prefer Skia (one recorder pass, no strings) when the loader is on screen for long.
4. **expo-blur over a live transcript**: each `BlurView` re-blurs its target on change; the desktop's 0.75 rem frost sits
   on dialog/menu surfaces that open *over* streaming text (`styles.css:1419-1420`), i.e. the worst case. Android SDK
   30 and below is explicitly documented as slow by expo-blur (`BlurView.types.ts:7-11`). Mitigation: ship the
   `dimezisBlurViewSdk31Plus` gate, and treat "blur disabled" as a supported state (the desktop already has a
   reduced-transparency path at `styles.css:35-63`).
5. **Skia install footprint**: `@shopify/react-native-skia` 2.14.0 depends on `react-native-skia-android@154.0.1`
   (70.2 MB tarball / 224.6 MB unpacked; per-ABI static archives: arm64-v8a 57.8 MB, x86_64 59.6 MB, armeabi-v7a
   47.1 MB, x86 49.8 MB, 9 files each). APK cost is the linked `libreactnativeskia.so`, not these archives, and was
   not measured here `[INFERENCE]`; also pulls `react-native-reanimated >=4` and `react-native-worklets >=0.7` peers.
6. **Markdown re-parse during streaming**: the official element re-lexes per top-level block on a 50 ms throttle, and
   the desktop additionally caches parsed blocks (`markdown-text.tsx` uses `parseMarkdownIntoBlocksCached`) and memoizes
   KaTeX per equation. Mitigation: keep the per-block memo and throttle from the registry element, never re-parse the
   whole document on every token.
7. **Tables inside a virtualised row**: `react-native-marked` renders tables through `react-native-reanimated-table`
   0.0.2 (2023-12-03) and the official element sizes cells with fixed padding (`markdownText styles.tableCell`); the
   desktop's tables are resizable and horizontally scrollable in place (`ResizableMarkdownTable`). Mitigation: wrap in
   a horizontal `ScrollView` with a max width, and do not nest a vertical virtual list inside a list row.
8. **Text and mask interactions**: text inside `MaskedView` (gradient text, fades) loses nothing visually but Android's
   rasterised mask is re-rendered on every layout/paint change; the desktop's `.sticky-human-clamp` mask
   (`styles.css:1899`) sits on content that grows while streaming. Mitigation: only mask settled rows, or use a gradient
   overlay view instead of a mask where the background is opaque.
9. **`overflow: hidden` + `borderRadius` clipping**: the desktop's glass shells rely on clipped corners
   (`styles.css:1419` surfaces); RN's documented caveat is that a rounded border may need `overflow: 'hidden'` on a
   parent with a background. Verify each blurred/glass surface on Android with hardware acceleration on.

## H. Not verified here

- Device/emulator measurements: no Android device or emulator run was performed; all frame costs above are
  compute-derived and marked `[INFERENCE]`.
- The Blaze Type EULA text (`https://blazetype.eu/eula`) was not fetched, so the Collapse embedding question stays
  open.
- Expo SDK/React Native pairing numbers (which SDK ships RN 0.86/0.87) are owned by the toolchain research ticket;
  the reanimated matrix above ("4.7.x -> RN 0.86-0.88", `compatibility.json`) and Expo dist-tags
  (`expo` latest 57.0.28, `react-native` latest 0.87.1) are the inputs it needs.
- `react-native-shiki-engine` 0.3.12 was not unpacked or run: its "native Oniguruma" claim and Hermes compatibility are
  unverified, so it is a candidate, not a recommendation.
