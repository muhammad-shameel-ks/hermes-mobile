# Performance

How the app stays responsive while a reply streams, and the rules that keep it that way.

## Why this document exists

While the agent replied, expanding a **Reasoning disclosure** or **Tool run** made the whole app laggy: the **Transcript** scrolled (native thread) but the drawer, buttons and further taps stalled. The cause was JS-thread starvation. Every streamed token ran synchronous controller work, re-rendered the whole app shell, re-lexed the whole reply's markdown and kept dozens of shimmer timelines alive. Every tap needs the JS thread, so taps queued behind that work.

The fix is a budget: **per-token work must be O(what changed), never O(thread), and must not wake React more than ~20 times a second.**

## How a token travels now

```
gateway event
  -> ChatController.onEvent            (transcript.applyEvent: touches only the live message/part)
  -> set(patch, paced)                 (snapshot is updated immediately; getSnapshot() never lags)
  -> NotifyThrottle                    (<= ~20 wake-ups/s, stretches to 3x the last render cost, <= 250 ms)
  -> useChatSelector slices            (only TranscriptPane sees the transcript)
  -> TranscriptRows / ChatRow(id)      (only the live row re-renders)
  -> MessageView blocks (memo)         (only the live block re-renders)
  -> Markdown (open block only)        (useDeferredValue so taps can interrupt it)
```

Edge events (`message.start`, `message.complete`, `tool.start/complete`, errors, sends, navigation, anything that changes `running`, `cwd`, the queue or `loading`) notify synchronously.

## Rules

### Store and events (`controller.ts`, `transcript.ts`)
1. High-frequency events go through the paced path: add the event type to `PACED_EVENTS` and make sure it changes only the transcript or status. Anything touching `running`, `cwd`, the queue or `loading` must notify synchronously.
2. `getSnapshot()` is the source of truth and never lags; only the wake-up is paced. Do not rely on one notification per event, and do not add per-event side effects inside `set()`.
3. Reducers return the same object when nothing changed; `updateTranscript` / `updateEntry` use identity to skip the write.
4. Transcript reducers touch only the live message and the changed part. Find messages from the tail, never `map`/`some`/`[...arr].reverse().find` over the list. Never mutate a `Part` or `ToolPart` after it enters state - replace it (caches below key on identity).
5. Derived values handed to React are memoised by input identity (see `currentModel()`).
6. Every timer has a `forget`/`dispose` path and an injectable clock.

### Subscriptions (`useChatSelector`, `chatSlices.ts`)
1. Never read the whole snapshot in a mounted component. No bare `useSyncExternalStore(controller.subscribe, controller.getSnapshot)`; use `useChatSelector(controller, selector, shallowEqual)` with a slice from `chatSlices.ts`.
2. Slices are flat objects of references with constant-time (or O(entries)) selectors. Only `TranscriptPane` selects the transcript; chrome uses `chatMeta` (booleans and identities, never `messages`).
3. Subscribe where you render. Heavy, rarely-shown regions (the Drawer content, settings screens via `useSettings`) subscribe inside a child that mounts only when visible. Context values carry no streaming state and are never inline objects.
4. Rows are `memo` components keyed by id reading from `TranscriptRows`. The FlatList render function is a module constant or a `useCallback` with stable deps. No providers inside a row.
5. Per-token work is O(changed). Pair every incremental path with a test that counts touched messages (see `tests/transcript-rows.test.ts`).
6. Give `useExternalStoreRuntime` one adapter object per `(messages, running)`.
7. Guard `setState` in `onLayout` / `onScroll` / `onContentSizeChange`: compare first, don't allocate, rAF-throttle.
8. Opening a drawer, sheet or overlay is one `setState`. Run data refreshes after that render, never inside the tap handler.

### Message rendering (`MessageView.tsx`, `toolView.ts`, `ui/motion.tsx`)
1. Every per-block / per-row component under `MessageView` is `memo`, with props that are part objects or primitives, never fresh arrays, objects or JSX.
2. Derived per-part data is cached in a `WeakMap` keyed by the part (`buildToolView`, `toolDiff`, `toolResultRecord`, `blocks()`).
3. Never `JSON.parse` / `JSON.stringify` tool results in render. Keep `detail` lazy; read `detailPreview` only inside a body that mounts while open; always pass tool output through `clipDetail` before `<Text numberOfLines>`.
4. No Reanimated hooks on idle rows. Use the plain-versus-animated split chosen at mount (`EnterView`, `DisclosureCaret`).
5. Style objects are built once per theme (`WeakMap<Tokens, ...>`); never call style factories inline in render.
6. Layout measurements go in refs; only the derived value that changes output goes in state, and the setter bails when unchanged.
7. UI hidden while streaming must not follow the message object (`sameBar`).

### Markdown (`Markdown.tsx`, `markdownBlocks.ts`)
1. Never feed a growing string to `useMarkdown` or the lexer. Go through `<Markdown streaming>` so only the open block re-lexes and re-renders.
2. A renderer branch that depends on `streaming` must be reachable only from a fenced block (or widen `block.fenced`).
3. No cross-block lexer state. Anything needing document-wide context (reference links, footnotes) must be covered by the whole-text fallback in `markdownBlocks.ts`, with a case added to the differential test.
4. Changes to `splitMarkdownBlocks` keep `tests/markdownBlocks.test.ts` green and extend its corpus. Never seal a block before a blank line or when the next block starts on an unfinished line.
5. Block keys are the block index (blocks only append). Keep `Markdown` mounted across the streaming-to-settled transition.
6. Per-delta code in the markdown path is bounded by the open block, not the reply. Prefer exact early exits to caches.
7. Components the parser creates (`InlineCode`, cards) are memoised by value, because the parser hands them fresh style objects.
8. Keep `useDeferredValue` on streaming text and bypass it when `streaming` is false.
9. The streamed-text fade (`streamFade.ts`) repaints only a streamed block's trailing characters, cloning just the elements on that path. Its repaint timer runs only while a chunk is still fading and nothing else re-renders the block.

### Animation (`ui/clock.ts`, `ui/loops.ts`, `ShimmerText.tsx`)
1. Decorative loops use `useLoop` from `ui/clock.ts`: one shared timeline per spec, paused in the background, freezable with `holdLoops()`. No per-instance `withRepeat`, `setInterval` or `setTimeout` for decoration.
2. Animate only `transform` and `opacity` (the synchronous props). Anything else - `left`, `width`, SVG `d`/`cx`/`cy` - costs a shadow-tree commit that contends with React's commits.
3. A stepped animation needs a `useDerivedValue` between the timeline and the style, or it pushes a native update every frame.
4. One `useAnimatedStyle` result can drive many views; express per-view offsets as static styles so mapper count stays constant.
5. Animated components inside the transcript are `memo` (by-value comparator when callers build `style` inline) and build static child trees once.
6. Context values never contain `messages`; provide a stable store (`useTailStore`) and read primitives via `useSyncExternalStore`.
7. Isolate fast ticks (1 Hz or faster `setState`) in the smallest component that paints them.
8. Pause what can't be seen (`reduced`, background, `enabled`), and stop every animation on unmount.
9. Add a pure, Node-testable test for new animation maths, as `shimmer.ts` does.

### Lists, theme, startup, persistence
1. Never derive colour inline: use the memoised helpers in `ui/color.ts`. Tokens are one object per skin, mode, accent and scale; never spread or clone `useTokens()` results into context values.
2. Unbounded or server-sized lists use `FlatList` over a flat cell model built by a pure, unit-tested `*ListItems.ts`. Row state flows through `extraData` and stable-identity maps.
3. Never key a memo on a whole snapshot, only on the slice. Per-chat derived values go through a stabiliser such as `stableActivities` so a stream delta doesn't change their identity.
4. Callbacks passed into memoised rows read the latest props through a ref. A hook that takes a function (`search`, `request`) keeps it in a ref, not in effect deps.
5. A screen off the launch path goes behind `lazyScreen` (or `require` inside an entry function). A native module used only in an async action loads with `await import()` inside it. Keep `open.tsx` entry modules free of heavy static imports. Expo SDK 57's metro `inlineRequires` is off and should stay off.
6. Persistence stays async, debounced and batched: no `*Sync` SQLite calls, and never `JSON.stringify` an unbounded payload (size-check incrementally, as `serializeTail` does).

## Measuring

- `npm run perf` micro-benchmarks the pure hot paths (transcript reducer over a 5k-delta turn, session list build, colour derivation, tail serialisation). Compare before and after a change; Node numbers show ratios, not device milliseconds.
- Bundle impact: `npx expo export --platform ios --dev --no-minify --output-dir <tmp>` (never into the repo), then inspect the `__d(...)` module boundaries.
- Device checks that tests cannot cover: stream a long reply with several tool calls, tap expand controls repeatedly, then open the drawer; watch the shimmer and spinner behaviour; try a long thread.

## Known remaining costs

- One very large open markdown block (a giant paragraph, loose list or fence) is still re-lexed whole per update: O(that block), not O(reply).
- Expanding a Tool run with hundreds of calls mounts every row in one commit (each is now cheap). `DiffView` is still one `View` and `Text` per line when fully expanded.
- `AnimatedFace` (15 Hz) and `Loader` (60 Hz) animate SVG props, which cost a shadow-tree commit per tick. The bot-chat face is the only one that runs during streaming.
- assistant-ui's `ExternalStoreRuntimeCore` still does an O(messages) pass per update and per-row accessor evaluations; avoiding that means replacing `MessagesFlatList`. Following a streaming reply is already ours (`TailFollow` in `scroll.ts`, driven by `useJumpToBottom`), with assistant-ui's `autoScroll` off.
- Streamed text arrives in steps of up to 50 ms (`STREAM_NOTIFY_MS`) rather than per token; each step fades in over `FADE_MS`, so the open block repaints on a 50 ms timer for up to that long after the last step.
- Eager native modules still on the launch path: `expo-audio`, `expo-media-library`, `expo-video`, `expo-speech` (chat cards) and `expo-speech-recognition` (`chat/dictation.ts`).
- `@assistant-ui/*` is about 2 MB and Reanimated about 2.1 MB of the 12 MB dev bundle.
