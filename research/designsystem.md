# Hermes Desktop Visual System - extraction for a React Native client

**Deliverable path requested: `/tmp/hermes-mobile-research/design-system.md`. I had no filesystem-write tool available in this session (only read/grep/glob/web_search/yield), so the document below is the deliverable and can be written verbatim to that path by the main agent.**

Read-only. No repo files touched. Line citations are `path:line`. Reasoning not directly read from source is marked `[INFERENCE]`. All literal values below were read from source; arithmetic on top of them (e.g. resolving a `color-mix`) is marked as derived.

---

## 0. Source map (what owns what)

| Concern | Owner |
| --- | --- |
| Raw preset palettes (hex per slot, light + dark) | `apps/shared/src/theme-presets.ts` (`THEME_PRESET_PALETTES`) |
| Built-in theme objects, font stacks, terminal ANSI | `apps/desktop/src/themes/presets.ts` |
| Runtime CSS paint, mix knobs, contrast clamps, profile/mode resolution | `apps/desktop/src/themes/context.tsx` |
| Accent re-seeding | `apps/desktop/src/themes/retint.ts` (+ `color.ts`) |
| CLI skin -> desktop theme | `apps/desktop/src/themes/skin.ts` |
| Theme name resolution order | `apps/desktop/src/themes/user-themes.ts:151-171` |
| Every `--ui-*` / `--dt-*` / `--z-*` / geometry token, `:root` light + `:root.dark` | `apps/desktop/src/styles.css` |
| Layout constants | `apps/desktop/src/app/layout-constants.ts`, `src/store/layout.ts`, `src/app/shell/titlebar.ts` |
| The contract itself | `apps/desktop/DESIGN.md` |

---

## 1. DESIGN.md normative rules (condensed, with the load-bearing numbers)

### 1.1 Principles (durable)
1. **Flat, not boxed.** No card-in-card, no divider borders inside a panel. Group with whitespace and a single hairline. (`DESIGN.md:31-34`)
2. **Borderless elevation for floating panels.** Overlays float on `shadow-nous` + a `--stroke-nous` hairline, not thick framed boxes. (`DESIGN.md:35-37`)
3. **One primitive per concern.** One `Button`, one control variant set, one `SearchField`, one `Loader`, one `ErrorState`. (`DESIGN.md:38-40`)
4. **Tokens, not literals.** Reference `--ui-*`, `--shadow-nous`, `--theme-*`; never raw hex / ad-hoc rgba in components. (`DESIGN.md:41-42`)
5. **Style lives in the primitive.** Variants/sizes own padding, radius, color, chrome; call sites pass `variant`/`size`, not `className` overrides. (`DESIGN.md:43-45`)
6. **Intent before automation.** Do not open panes, move focus, or navigate because a tool happened to produce something. (`DESIGN.md:46-48`)
7. **Immediate feedback.** Direct manipulation updates the view first; persistence reconciles after and rolls back visibly. (`DESIGN.md:49-51`)
8. When a rule and the code disagree, fix whichever is wrong; never fork a one-off at the call site. (`DESIGN.md:26-27`)

### 1.2 Information architecture
- Chat is the home surface. (`.md:57`)
- Durable pages: Chat, Skills, Messaging, Artifacts stay in shell chrome. (`.md:58-60`)
- Route overlays are short tasks: Settings, Command Center, Cron, Profiles, Agents, Starmap render as `OverlayView` cards and return to the previous route on close; model/session pickers and dialogs layer above, not a navigation stack. (`.md:61-65`)
- Panes (preview/files/review/terminal) are working context attached to the current task, surviving temporary hiding and chat switches. (`.md:66-69`)
- One action, one home: keyboard, palette and visible affordance invoke the same action/state. (`.md:70-73`)
- Projects own workspace cwd; `Sidebar -> Projects` for local folders and worktrees; no per-session/right-sidebar folder picker. (`.md:74-76`)
- Profile icons and condensed profile rows offer **Open in new window** and **Set as default**. New Window is `Cmd+Shift+N` / `Ctrl+Shift+N` and inherits the opener's device+profile only at startup. (`.md:78-90`)
- Navigation must preserve context: a background session finishing or tool result arriving may update badges/cached data but must NOT replace the foreground transcript or steal focus. (`.md:92-95`)

### 1.3 Surfaces and elevation
- Floating panels (base `Dialog`, route overlays, boot/install/update, model-picker, onboarding, prompt overlays, notifications) use exactly:
  `shadow-nous` + `border-(--stroke-nous)`. No per-overlay `shadow-[...]`; tune the token instead. (`.md:99-115`)
- Menus/popovers use their own shared `shadow-md` + `--ui-stroke-secondary`. Every floating list (`DropdownMenu`, `Select`, `Popover + cmdk`) paints through `src/components/ui/menu.ts`. (`.md:117-124`)
- Typed fields with suggestions use `ComboboxInput`, never `<input list>` + `<datalist>`. (`.md:124-126`)
- Drag affordances may use tokenized dashed targets and local blur. (`.md:128-130`)
- **Queued cards (`CardStack`, `src/components/ui/card-stack.tsx`)**: one 96%-scale silhouette **7px above** the front, **220ms** promotion, **180ms** upward clearance; no rotation or lateral throw on button/keyboard decisions; gestures never grant approval; departing cards are immediately inert; toasts can expand to the full live list; one persistent transcript-level host owns approvals; prepared approvals can precede `tool.start` and execution must not relocate/remount the stack; while approvals remain, a real activity line above the cards changes from awaiting approval to current-turn command status, and execution rows appear only when explicitly expanded; empty text continuations must not introduce paragraph gaps; final removal retires both the painted card and its measured footprint; reduced motion settles immediately without retaining empty clearance. (`.md:132-172`)

### 1.4 Window background / glass
- Settings -> Appearance -> Window layout offers **Minimize to tray**, off by default, local to the installation. Tray "Show Hermes" restores; "Quit Hermes" keeps the ordinary active-work confirmation. macOS tray in the menu bar; Dock icon hides only when no normal window remains visible. (`.md:174-189`)
- **Glass defaults to 29% Tint, Sidebar only, in both light and dark appearances. Fade defaults to zero.** Explicitly saved settings take precedence; changing defaults must not overwrite user choices. The shared `apps/shared/src/translucency.ts` resolver owns these defaults for both the renderer and Electron's first window paint. (`.md:191-198`)

### 1.5 Stroke and color tokens (the named contract table)
| Token | Use |
| --- | --- |
| `--ui-stroke-primary...quaternary` | hairlines, descending strength |
| `--ui-stroke-tertiary` | default in-panel divider / list hairline, and every bordered surface in the transcript |
| `--stroke-nous` | overlay hairline (pairs with `shadow-nous`) |
| `--ui-text-primary/-secondary/-tertiary` | text hierarchy |
| `--ui-bg-quaternary` | soft control fill (secondary button) |
| `--ui-widget-surface-background` | fill for inline chat widgets (`WIDGET_SHELL_CLASS`) |
| `--chrome-action-hover` | hover fill for quiet controls |
| `--theme-primary`, `--ui-accent` | brand/accent |

(`.md:200-213`, verbatim)

- Never hardcode `border-gray-*`, `bg-white`, `text-black`. The only sanctioned literals are the two `BrandMark` tiles (white in light, `#0d1117` in dark). (`.md:215-217`)

### 1.6 Buttons
- `src/components/ui/button.tsx` is the single source. Pick `variant` + `size`; no `h-*`/`px-*`/`py-*`/icon-size overrides. (`.md:219-221`)
- **Variants**: `default` (primary), `destructive`, `secondary` (soft fill, the default non-primary look), `outline` (transparent + 1px inset ring, no fill/shadow), `ghost`, `floating` (opaque popover fill + `shadow-md`, hover lifts the glyph only), `link`, `text` (boxless quiet inline: "Cancel", "Clear"), `textStrong` (bold underlined inline affordance), `grip` (quiet fill-free drawer handle; pair with size `grip` for a 48x16 hit area around a small ridge). (`.md:223-232`)
- **Sizes**: `default`, `xs`, `sm`, `lg`, `inline` (flush, zero box; replaces `h-auto px-0 py-0`), `micro` (status-stack/table-footers), and the icon family `icon` / `icon-xs` / `icon-sm` / `icon-lg` / `icon-titlebar`. (`.md:234-236`)
- Text buttons are square (no radius), sized by padding + line-height (no fixed heights). Only icon buttons carry the shared 4px radius. SVGs inherit `size-3.5` (`size-3` at `xs`). Polymorph with `asChild`. (`.md:283-287`)

### 1.7 Tooltips
- **Only when hover teaches something new.** Keep an `aria-label` for a11y regardless. (`.md:238-241`)
- Tip unlabeled chrome: toolbar/titlebar/statusbar icons, `TipKeybindLabel` shortcuts, ownership chips, unlabeled icon grids. (`.md:243-246`)
- Do **not** tip: menu triggers (kebabs / `...` / `ActionsMenu` / `DropdownMenuTrigger`), close/dismiss X buttons, controls whose visible label already says it. (`.md:248-254`)
- Never native `title=` on buttons; `src/components/ui/__tests__/no-native-title.test.ts` enforces it. (`.md:256-258`)
- **Timing**: `Tip` waits **200ms** before the first open; after a tip has opened the page is warm and the next trigger within **300ms** opens instantly; the cooldown starts on close; entrance has no animation; exit fades over **100ms** and moves **0.125rem** toward the anchor; reduced motion disables the exit; `OverflowTip` uses a longer delay; bubbles use a **0.25rem** radius. (`.md:260-269`)
- **Placement**: `placement` = `control` above (default), `toolbar` below, `row` right, `left-rail`/`right-rail` inward; explicit `side`/`align` override; Radix flips/shifts, keeps the arrow, hides detached triggers; controls/toolbars bound to their owning pane, rows/rails may extend into the window; `boundary="viewport"` to escape. Short labels size to content; descriptions wrap within **24rem**. (`.md:271-277`)
- Slash descriptions: autocomplete rows single-line/ellipsized, full catalog description revealed to the right of the hovered row. (`.md:279-282`)
- Model search: hyphens, dots, underscores and spaces are equivalent; original label spelling preserved inside marks; no dictionary spellcheck. (`.md:284-286`)
- Keybind hints: `<TipKeybindLabel actionId="..." />`; never hardcode combos. (`.md:288-292`)

### 1.8 Badges / profile rail / dialogs
- `src/components/ui/badge.tsx` variants: `default` (tinted primary), `muted`, `warn`, `destructive`, `outline`, `solid` (primary fill, icon-corner counts). Sizes: `default`, `xs`, `overlay` (titlebar glyph counts). (`.md:294-298`)
- Profile rail keeps create/import outside the scrolling squares; clipped horizontal edges reuse `edgeMask(edges, 'x')` from `fade-scroll.tsx`; fitting content is unmasked; drag gestures temporarily remove the mask. (`.md:299-306`)
- Sudo password dialogs keep the backdrop **unblurred** (`DialogContent` `blurBackdrop={false}`) and show the complete selectable command before the password field. Other dialogs keep the shared blurred backdrop. (`.md:308-313`)

### 1.9 Form controls
- `controlVariants` (`src/components/ui/control.ts`) is the shared shape for `Input`/`Textarea`/`SelectTrigger`. (`.md:315-318`)
- `SearchField`: borderless, underline-on-focus, auto-width. The only search input; do not wrap in a bordered tile; empty lists hide their search field. (`.md:319-322`)
- `SegmentedControl`: choice control for small mutually-exclusive sets. Replaces radio piles and pill rows. (`.md:323-325`)
- `Switch` with `size="xs"`, bare, `aria-label`, no bordered text wrapper. (`.md:326-327`)
- `FanMenu`: one hub control that fans sibling toggles out on hover; `direction` `vertical` | `horizontal` (split around the hub) | `arc`. Discs are `Button` `floating` off / `default` on; tips face outside the fan. (`.md:328-333`)

### 1.10 Layout
- **Gutters**: `PAGE_INSET_X` for page side padding; `PAGE_INSET_NEG_X` to bleed a child to the edge. Do not hardcode `px-6`/`px-8` on pages. (`.md:335-339`)
- **Master/detail overlays**: `OverlaySplitLayout` + `OverlaySidebar` / `OverlayMain`. (`.md:340-342`)
- **Settings subpages**: `OverlayNav` separates navigation from disclosure - labels navigate, the shared `DisclosureCaret` button opens a branch without changing the page; active paths reveal automatically, inactive stay folded; General comes first; parent labels/URLs open the first ordered subpage, never an overview or last visited child; no duplicate icon-and-title heading; page-level `SectionHeading page` retains actions/counts; narrow windows keep every destination in the shared navigation dropdown; search and saved field links resolve to the owning child before highlighting. (`.md:343-356`)
- **Rows**: `ListRow` (settings `primitives.tsx`) for label/description/action rows. Flat, flush-left; no per-row indentation fighting flush headers. (`.md:357-360`)
- **No dividers between rows** unless the list genuinely needs them; then it is a single `--ui-stroke-tertiary` hairline. (`.md:362-363`)

### 1.11 Panel titlebars
- Top-edge panels extend into the native titlebar band; tab strips stay inside their zones so tab drops, focus and split boundaries share geometry; panels without room beside the measured window controls put tabs on a full-width row below the controls; minimized row groups use vertical restore rails; sidebar buttons/shortcuts restore minimized or hidden side groups without changing the selected tab; lower panels keep local headers; empty header space moves the window while tabs/actions stay no-drag. (`.md:365-386`)
- Left cluster: sidebar, settings, layout editor, HUD controls. Right: Flip and the right-sidebar toggle. Haptics stay in settings. In **Simple** interface mode only sidebar, settings and the layout editor render; `TITLEBAR_FIXED_TOOLS` is the one table both the buttons and the width reservation read. Holding Cmd reveals small slot numbers over target strip status dots after **400ms**. (`.md:388-394`)
- Tab close buttons fade the label with a **content mask**, not a painted gradient. The tab reads its surface token directly so glass tint is painted once. (`.md:396-398`)
- Sticky user messages clip covered scrolling content including the gap above them; wrappers stay unpainted, only the rounded user bubble owns a fill. (`.md:400-404`)

### 1.12 Feedback, empty/error/loading
- **Loading**: `Loader` (`src/components/ui/loader.tsx`) - animated math/ascii curves, `lemniscate-bloom` for long ops. Never ship the literal text "Loading...". (`.md:406-409`)
- **Errors**: `ErrorState` + canonical `ErrorIcon` (no bg chip). One look for the React boundary, in-dialog errors and the boot-failure banner. Pass nodes for title/description so Radix `DialogTitle`/`Description` flow through for a11y. (`.md:410-413`)
- **Logs**: `LogView` - no bg, hairline border, tight padding, small mono. (`.md:414-416`)
- **Empty**: `EmptyState` for plain page bodies; `PanelEmpty` for overlay master/detail empties with an icon and action. Never hand-roll a third centered empty. (`.md:417-419`)
- **Confirmation**: `ConfirmDialog` is the only way to ask "are you sure"; opens focused on Confirm so Enter confirms and Esc cancels; owns the pending -> done -> close beat and the inline error; one `secondaryAction` slot; never `window.confirm`; inline handlers call `confirm()` from `src/store/confirm.ts` rendered by the single `ConfirmHost`. (`.md:420-431`)

### 1.13 Chat typography
- Appearance -> Typography keeps **UI Scale** as whole-window zoom (100% default). **Chat Text Size** is a separate desktop-local multiplier (**110% default**) on conversation text and the composer editor, including floating and inline-edit composers. It does **not** resize the sidebar, settings, toolbars, media, or pane geometry. Conversation size and line-height tokens are derived inside the transcript/editor from their root base tokens; never multiply the global tokens or nest CSS zoom. (`.md:433-441`)

### 1.14 Chat, tools and boot surfaces
- Transcript + composer are built on `@assistant-ui/react`; extend `src/components/assistant-ui` and `src/app/chat/composer`, never fork a second markdown/message/tool-call/approval renderer. (`.md:443-446`)
- Inline widgets wear `WIDGET_SHELL_CLASS` (`src/components/chat/widget-shell.ts`): shared radius, `--ui-widget-surface-background` fill, **no border**; actions sit outside, below the panel. (`.md:447-451`)
- Bordered transcript surfaces (tables, fences, callouts, attachments) use `--ui-stroke-tertiary`, not `border-border`. (`.md:452-454`)
- Interactive directive chips in the composer expose their action on hover with a **500ms** grace period while the pointer crosses from chip to floating pill. (`.md:455-458`)
- A tool result may expose an inline action that opens a preview; it must not open the rail automatically. (`.md:459-461`)
- Tool rows reserve destructive red for explicit failures; missing read paths and ambiguous exit-1 results use neutral notices; errors described inside returned data are not tool failures; expanded failures show the actual explanation; supporting output keeps normal text color. (`.md:462-466`)
- Nested transcript scrollers keep height caps and hand vertical scrolling back at either edge (`overscroll-behavior-y: auto`) even when content fits; only the outer thread contains vertical overscroll. (`.md:467-471`)
- Composer status groups start collapsed except todos; progress updates and queue pause/resume preserve the user's disclosure choice; error banners meet the stack's top edge with no blank padding strip; file/preview links stay at the bottom of the stack; a centered ridge on the composer's top edge hides/reveals the whole stack with a short drawer slide, persisted per conversation and owner; hidden sections stay mounted but inert; reduced motion is instant. (`.md:472-479`)
- Popping out a composer makes it the window's only visible composer; drafts/attachments/queues stay session-owned; docking restores individual pane composers; typing focus and caret are preserved. (`.md:480-497`)
- Status-stack rows use `StatusRow` with a leading `dismiss` action, a state icon and optional trailing actions; `StatusDismissButton` owns the Codicon close button for previews/background tasks/queued prompts (never a trash icon or CSS glyph); icons/controls align to the first text line including messages with attachment metadata. (`.md:498-503`)
- `status-stack.css` owns the shared columns and a **0.25rem** nesting step; rows own their padding and full-width hover fill; `StatusControlRow` uses the same columns for goal/loop/heartbeat details; `StatusPendingIcon` supplies the dashed marker; the first row keeps normal padding, no extra top inset. (`.md:504-508`)
- Keep the rounded status card stationary with the bounded scroll viewport inside it; outer scroll boundary uses `overscroll-behavior-y: contain`, nested rosters/transcripts use `auto`. (`.md:509-513`)
- Install, onboarding, connecting, boot failure and reauthentication are **distinct states** with shared visual primitives; preserve their recovery semantics when unifying appearance. (`.md:514-517`)
- Guide startup has a dedicated landing screen with the shared long-operation Loader and a localized label; no greeting, composer, Skip setup or statusbar appears early; reduced motion uses a static `BrandMark` and the same label; on readiness reveal the real conversation and fade controls in over **100ms**; never fabricate progress or delay readiness for motion. (`.md:518-525`)
- Respect `AppShell` overlay ownership: pick a rung of the z-ladder in `styles.css` rather than ad-hoc z-index literals. Plain `z-10`/`z-20` are still right *within* one component. (`.md:526-535`)

### 1.15 Iconography and brand
- **Tabler** is the default component/chrome set; import curated aliases and `iconSize` from `src/lib/icons.ts`; never import icon packages directly in feature code. (`.md:537-539`)
- **`Codicon`** is the compact editor/tool/status vocabulary via `src/components/ui/codicon.tsx`, including `codiconIcon()` where a Tabler-shaped component is required. (`.md:540-542`)
- Pick vocabulary by semantic context and reuse the existing icon; do not introduce a third icon set or mix styles within one control group. (`.md:543-545`)
- **`BrandMark`** (`src/components/brand-mark.tsx`) is the `nous-girl` mark on a fixed tile, theme-aware: black girl on white in light mode, white girl on the `#0d1117` dark tile in dark mode, keyed off `renderedMode` so bright surfaces in dark skins stay on the light mark. Marks generated by `scripts/generate_icons.py` from `assets/nous-girl-*.svg` x `assets/backgrounds/`. Do not reintroduce decorative star/sparkle icons. (`.md:546-555`)

### 1.16 Motion
- Visible windows keep animating when another app takes focus; hidden/minimized windows and inactive panes may pause; background polling stays focus-gated. (`.md:557-559`)
- Animated integer counts reuse `AnimatedInt` in `src/components/ui/diff-count.tsx`; its spring updates the DOM directly without per-frame React renders. (`.md:560-562`)
- **Quick, functional transitions (~100ms on controls).** Respect `prefers-reduced-motion` for anything beyond a fade. (`.md:563-565`)
- Choreographed exits stagger per-element then settle the surface; the outer container's fade is *delayed* so it doesn't swallow the inner animation. (`.md:566-569`)
- **Motion follows state; it never delays state.** Selection, drag targets, cancel and pressed feedback paint in the current frame. (`.md:570-571`)
- Do not animate layout geometry with `transition-all` on a hot interaction; name the properties, avoid backdrop-filter repaints during movement, remove animation before masking a performance problem. (`.md:572-575`)

### 1.17 Direct manipulation, keyboard, cancellation, affordances
- Direct manipulation paints first; persistence reconciles after and rolls back visibly. Hot-path state stays local or narrowly derived; pointer work coalesces per frame. One drop region has one visual owner. Forgiving geometry beats pixel-perfect triggers. Expensive stateful surfaces stay mounted when hidden - visibility is not lifecycle. (`.md:577-599`)
- Keyboard ownership follows focus; shell shortcuts must not steal a terminal's or editor's bindings. Focusing the Sessions sidebar preserves the last active chat's visual emphasis. Focused and hovered chat panes both retain full color and opacity; only panes that are neither recede, with **20% desaturation**. (`.md:601-614`)
- One cancel gesture does one thing. Cancellation is synchronous in the UI even if cleanup is async. Flows that deliberately cannot be dismissed (install/onboarding, destructive confirmation) must make that explicit. (`.md:615-622`)
- `cursor-pointer` at the primitive level. Global focus-ring reset. Titlebar actions have no active-background state. `Esc` closes every dismissable overlay/dialog (install/onboarding excluded); close is an x-icon, not the word "Close". (`.md:636-641`)
- i18n: every user-facing string through `useI18n()`; update all locales together. (`.md:624-634`)
- State (TS): shared state in small nanostores; features own their atoms, shared atoms in `src/store`; render components subscribe with `useStore`, actions read with `$atom.get()`; prefer derived coarse facts; colocated action modules over god hooks; keep persistence beside the owning atom; `interface` for public props. (`.md:643-655`)

### 1.18 Pre-add checklist (`.md:657-690`)
Reuse a primitive; tokens only (zero raw colors / one-off shadows); no className overriding a primitive's padding/size/radius/chrome; tips only where hover teaches something new; no native `title=` on buttons; keybind hints via `useKeybindHint`/`TipKeybindLabel`; overlays use `shadow-nous` + `border-(--stroke-nous)`; flat (no card-in-card, no gratuitous row dividers); no automatic navigation/focus steal/pane opening; direct manipulation paints immediately and rolls back cleanly; hot interactions avoid broad subscriptions, layout thrash and `transition-all`; keyboard ownership and single-action `Esc` correct; all registered locales updated; `cursor-pointer`, focus ring and `Esc`-to-close behave; touched a primitive/token/variant -> its named-contract entry in DESIGN.md updated in the same change.

---

## 2. Tokens

### 2.1 Resolution model (the formula, not the output)

```
resolvedTheme  = retintTheme(builtin | userTheme | backendSkin | contributed, $accentOverride?)
                 where builtin = BUILTIN_THEMES[normalizeSkin(storedSkin(profile))]
                       normalizeSkin drops RETIRED_SKINS -> 'nous'
                 (themes/user-themes.ts:151-158, themes/context.tsx:417-419, presets.ts:440-455)

mode           = 'light' | 'dark'  (ThemeMode 'system' -> prefers-color-scheme)
colors(skin, mode) = mode==='dark' ? (darkColors ?? colors) : (darkColors ? colors : synthLightColors(seed))
                 (themes/context.tsx:158-167)
renderedMode   = luminance(colors.background) > 0.5 ? 'light' : 'dark'   // decides the .dark class
                 (themes/context.tsx:196-207)  -> a bright dark-mode palette paints LIGHT
```

Then `applyTheme` writes, in this order (themes/context.tsx:273-352):

```
// runtime seeds - straight from the palette, no derivation
--theme-foreground      = colors.foreground
--theme-primary         = colors.primary
--theme-secondary       = colors.secondary
--theme-accent-soft     = colors.accent
--theme-midground       = colors.midground ?? colors.ring
--theme-warm            = colors.primary
--theme-background-seed = colors.background
--theme-sidebar-seed    = colors.sidebarBackground ?? colors.background
--theme-card-seed       = colors.card
--theme-elevated-seed   = colors.popover
--theme-bubble-seed     = colors.userBubble ?? colors.popover

// per-mode mix knobs (also declared as :root / :root.dark fallbacks)
--theme-mix-chrome   = dark ? 74% : 92%
--theme-mix-sidebar  = 100%
--theme-mix-card     = dark ? 38% : 22%
--theme-mix-elevated = dark ? 46% : 28%
--theme-mix-bubble   = dark ? 46% : 0%

// shadcn/Tailwind palette that is not CSS-derivable
--dt-primary-foreground    = colors.primaryForeground
--dt-secondary-foreground  = colors.secondaryForeground
--dt-accent-foreground     = colors.accentForeground
--dt-border                = colors.border
--dt-input                 = colors.input
--dt-ring                  = colors.ring
--dt-muted                 = colors.muted
--dt-midground-foreground  = colors.midgroundForeground ?? readableInk(midground)   // ink = #161616 or #ffffff
--dt-primary-solid         = ensureContrast(colors.primary, '#fcfcfc', 4.5)         // deepened until #fcfcfc clears AA
--dt-primary-solid-foreground = '#fcfcfc'
--dt-composer-ring         = colors.composerRing ?? midground
--dt-destructive           = colors.destructive
--dt-destructive-foreground= colors.destructiveForeground
--dt-sidebar-border        = colors.sidebarBorder ?? colors.border
--dt-user-bubble-border    = colors.userBubbleBorder ?? colors.border
--ui-success               = harmonize('#10b981', midground, 0.25)   // OKLCH hue-bend toward the accent
--dt-font-sans             = resolveChatFontFamily($chatFontFamily, typography.fontSans)
--dt-font-mono             = typography.fontMono
--noise-opacity-mul        = dark ? calc(0.04/0.21) : calc(0.34/0.21)

// optional typography knobs (the ONLY conditionally-painted vars; removed when a theme drops them)
--dt-base-size / --dt-line-height / --dt-letter-spacing = typography.baseSize|lineHeight|letterSpacing

// non-CSS side effects
root.dataset.hermesTheme = skinName ; root.dataset.hermesMode = rendered
root.classList.toggle('dark', isDark) ; color-scheme = rendered
setAppearance(rendered)                 // drives translucency defaults per painted appearance
window.hermesDesktop.setTitleBarTheme({ background: mix(background, NEUTRAL_CHROME[isDark?dark:light], isDark?0.26:0.08), foreground })
```

Derived values are computed by CSS, not JS (styles.css:239-600):

```
--ui-base   = --theme-foreground
--ui-accent = --theme-midground
--ui-accent-secondary = --theme-primary
--ui-warm   = --theme-warm

--ui-bg-chrome   = color-mix(in srgb, var(--theme-background-seed) var(--theme-mix-chrome),   var(--theme-neutral-chrome))
--ui-bg-sidebar  = color-mix(in srgb, var(--theme-sidebar-seed)    var(--theme-mix-sidebar),  var(--theme-neutral-sidebar))
--ui-bg-editor   = color-mix(in srgb, var(--theme-card-seed)       var(--theme-mix-card),     var(--theme-neutral-card))
--ui-bg-elevated = color-mix(in srgb, var(--theme-elevated-seed)   var(--theme-mix-elevated), var(--theme-neutral-card))
--ui-chat-bubble-background = color-mix(in srgb, var(--theme-bubble-seed) var(--theme-mix-bubble), var(--theme-neutral-card))

--ui-bg-card       = color-mix(in srgb, var(--ui-accent) 4%,  color-mix(in srgb, var(--ui-base) 4%, transparent))
--ui-bg-primary    = color-mix(in srgb, var(--ui-accent) var(--theme-fill-primary-accent-mix),    color-mix(in srgb, var(--ui-base) 10%, transparent))
--ui-bg-secondary  = color-mix(in srgb, var(--ui-accent) var(--theme-fill-secondary-accent-mix),  color-mix(in srgb, var(--ui-base)  7%, transparent))
--ui-bg-tertiary   = color-mix(in srgb, var(--ui-accent) var(--theme-fill-tertiary-accent-mix),   color-mix(in srgb, var(--ui-base)  5%, transparent))
--ui-bg-quaternary = color-mix(in srgb, var(--ui-accent) var(--theme-fill-quaternary-accent-mix), color-mix(in srgb, var(--ui-base)  4%, transparent))
--ui-bg-quinary    = color-mix(in srgb, var(--ui-accent) var(--theme-fill-quinary-accent-mix),    color-mix(in srgb, var(--ui-base)  3%, transparent))

--ui-row-hover-background   = color-mix(in srgb, var(--ui-accent) var(--theme-row-hover-accent-mix),   color-mix(in srgb, var(--ui-base) 3%, transparent))
--ui-row-active-background  = color-mix(in srgb, var(--ui-accent) var(--theme-row-active-accent-mix),  color-mix(in srgb, var(--ui-base) 5%, transparent))
--ui-row-open-background    = color-mix(in srgb, var(--ui-row-active-background) 28%, transparent)
--ui-control-hover-background  = color-mix(in srgb, var(--ui-accent) var(--theme-control-hover-accent-mix),  color-mix(in srgb, var(--ui-base) 4%, transparent))
--ui-control-active-background = color-mix(in srgb, var(--ui-accent) var(--theme-control-active-accent-mix), color-mix(in srgb, var(--ui-base) 5%, transparent))

--ui-text-primary     = color-mix(in srgb, var(--ui-base) 94%, transparent)
--ui-text-secondary   = color-mix(in srgb, var(--ui-base) 74%, transparent)
--ui-text-tertiary    = color-mix(in srgb, var(--ui-base) 54%, transparent)
--ui-text-quaternary  = color-mix(in srgb, var(--ui-base) 36%, transparent)
--conversation-scaffold-text = color-mix(in srgb, var(--ui-base) 64%, transparent)
--conversation-scaffold-meta = color-mix(in srgb, var(--ui-base) 44%, transparent)

--ui-stroke-primary    = color-mix(in srgb, var(--ui-accent) var(--theme-stroke-primary-accent-mix),    color-mix(in srgb, var(--ui-base) 10%, transparent))
--ui-stroke-secondary  = color-mix(in srgb, var(--ui-accent) var(--theme-stroke-secondary-accent-mix),  color-mix(in srgb, var(--ui-base)  7%, transparent))
--ui-stroke-tertiary   = color-mix(in srgb, var(--ui-accent) var(--theme-stroke-tertiary-accent-mix),   color-mix(in srgb, var(--ui-base)  5%, transparent))
--ui-stroke-quaternary = color-mix(in srgb, var(--ui-accent) var(--theme-stroke-quaternary-accent-mix), color-mix(in srgb, var(--ui-base)  3%, transparent))
```
Verified at `styles.css:239-420`. Re-skinning the accent + the 4 ratio groups re-tints every control, row and hairline at once - that is the whole point of the `--theme-*-accent-mix` knobs.

**Boot fallbacks vs runtime values.** `styles.css:206-237` declares `:root` values that are *not* the nous palette (e.g. `--theme-background-seed: #f8faff`, `--theme-warm: #cf806d`, `--theme-foreground: #17171a` at `styles.css:206-212`). Those are pre-paint fallbacks; `applyTheme` overwrites them inline on `:root` before the first themed frame. The only place the fallback survives is a document where the theme module never loaded. `[INFERENCE]` A mobile port should therefore treat `applyTheme`'s seed table as authoritative and the `:root` block as documentation of which names exist.

### 2.2 `--theme-*` variable set

| Variable | Light (`:root` fallback) | Dark (`:root.dark` fallback) | Set inline by applyTheme | Source |
| --- | --- | --- | --- | --- |
| `--theme-foreground` | `#17171a` | palette `foreground` | yes | styles.css:206 / context.tsx:299 |
| `--theme-primary` | `#0053fd` | palette `primary` | yes | styles.css:207 / context.tsx:300 |
| `--theme-secondary` | `color-mix(in srgb, #0053fd 7%, #ffffff)` | palette `secondary` | yes | styles.css:208 / context.tsx:301 |
| `--theme-accent-soft` | `color-mix(in srgb, #0053fd 10%, #ffffff)` | palette `accent` | yes | styles.css:209 / context.tsx:302 |
| `--theme-midground` | `#0053fd` | `midground ?? ring` | yes | styles.css:210 / context.tsx:303 |
| `--theme-warm` | `#cf806d` | `primary` | yes | styles.css:211 / context.tsx:304 |
| `--theme-background-seed` | `#f8faff` | palette `background` | yes | styles.css:212 / context.tsx:305 |
| `--theme-sidebar-seed` | `#f3f7ff` | `sidebarBackground ?? background` | yes | styles.css:213 / context.tsx:306 |
| `--theme-card-seed` | `#ffffff` | palette `card` | yes | styles.css:214 / context.tsx:307 |
| `--theme-elevated-seed` | `#ffffff` | palette `popover` | yes | styles.css:215 / context.tsx:308 |
| `--theme-bubble-seed` | `color-mix(in srgb, #0053fd 6%, #ffffff)` | `userBubble ?? popover` | yes | styles.css:216 / context.tsx:309 |
| `--theme-neutral-chrome` | `#f3f3f3` | `#0d0d0e` | no (inline via mixesFor only for chrome bg math) | styles.css:217, 607 / context.tsx:233 |
| `--theme-neutral-sidebar` | `#f3f3f3` | `#0a0a0b` | no | styles.css:218, 608 |
| `--theme-neutral-card` | `#fcfcfc` | `#161618` | no | styles.css:219, 609 |
| `--theme-mix-chrome` | `92%` | `74%` | yes | styles.css:220 / context.tsx:244 |
| `--theme-mix-sidebar` | `100%` | `100%` | yes | styles.css:221 / context.tsx:245 |
| `--theme-mix-card` | `22%` | `38%` | yes | styles.css:222 / context.tsx:246 |
| `--theme-mix-elevated` | `28%` | `46%` | yes | styles.css:223 / context.tsx:247 |
| `--theme-mix-bubble` | `0%` | `46%` | yes | styles.css:224 / context.tsx:248 |
| `--theme-fill-primary-accent-mix` | `16%` | `16%` | no | styles.css:225 |
| `--theme-fill-secondary-accent-mix` | `11%` | `11%` | no | styles.css:226 |
| `--theme-fill-tertiary-accent-mix` | `8%` | `8%` | no | styles.css:227 |
| `--theme-fill-quaternary-accent-mix` | `5%` | `5%` | no | styles.css:228 |
| `--theme-fill-quinary-accent-mix` | `3%` | `3%` | no | styles.css:229 |
| `--theme-stroke-primary-accent-mix` | `24%` | `24%` | no | styles.css:230 |
| `--theme-stroke-secondary-accent-mix` | `16%` | `16%` | no | styles.css:231 |
| `--theme-stroke-tertiary-accent-mix` | `10%` | `10%` | no | styles.css:232 |
| `--theme-stroke-quaternary-accent-mix` | `6%` | `6%` | no | styles.css:233 |
| `--theme-row-hover-accent-mix` | `4%` | `4%` | no | styles.css:234 |
| `--theme-row-active-accent-mix` | `8%` | `8%` | no | styles.css:235 |
| `--theme-control-hover-accent-mix` | `6%` | `6%` | no | styles.css:236 |
| `--theme-control-active-accent-mix` | `8%` | `8%` | no | styles.css:237 |

Total: **32 `--theme-*` variables** (11 seeds + 5 mix + 13 ratio + 3 neutral). `--theme-mix-sidebar` is the only mix knob identical in both modes.

### 2.3 Derived surface/text/stroke tokens (formula output for nous)

`nous` light palette (`theme-presets.ts:126-153`): background `#ffffff`, foreground `#1f2328`, card `#f6f8fa`, muted `#f6f6f6`, mutedForeground `#656d76`, popover `#ffffff`, primary `#0053fd`, primaryForeground `#ffffff`, secondary `#deeaff`, accent `#e3edff`, border `#d0d7de`, input `#ffffff`, ring `#0053fd`, midground `#0053fd`, midgroundForeground `#ffffff`, composerRing `#0053fd`, destructive `#cf222e`, sidebarBackground `#f6f8fa`, sidebarBorder `#d0d7de`, userBubble `#dae7fd`, userBubbleBorder `#d0d7de`.

`nous` dark palette (`theme-presets.ts:154-181`): background `#0d1117`, foreground `#e6edf3`, card `#010409`, muted `#1a1e24`, mutedForeground `#7d8590`, popover `#161b22`, primary `#4a84fe`, primaryForeground `#161616`, secondary `#1d2e4f`, accent `#17243a`, border `#30363d`, input `#0d1117`, ring `#4a84fe`, midground `#4a84fe`, midgroundForeground `#161616`, composerRing `#4a84fe`, destructive `#f85149`, sidebarBackground `#010409`, sidebarBorder `#30363d`, userBubble `#07162c`, userBubbleBorder `#30363d`.

| Token | nous light (resolved) | nous dark (resolved) | Source |
| --- | --- | --- | --- |
| `--ui-base` | `#1f2328` | `#e6edf3` | styles.css:239 |
| `--ui-accent` | `#0053fd` | `#4a84fe` | styles.css:240 |
| `--ui-accent-secondary` | `#0053fd` | `#4a84fe` | styles.css:241 |
| `--ui-warm` | `#0053fd` (applyTheme) / `#cf806d` (fallback) | `#4a84fe` | context.tsx:304 |
| `--theme-background-seed` | `#ffffff` | `#0d1117` | theme-presets.ts:127, 155 |
| `--theme-sidebar-seed` | `#f6f8fa` | `#010409` | theme-presets.ts:149, 177 |
| `--theme-card-seed` | `#f6f8fa` | `#010409` | theme-presets.ts:129, 157 |
| `--theme-elevated-seed` | `#ffffff` | `#161b22` | theme-presets.ts:133, 161 |
| `--theme-bubble-seed` | `#dae7fd` (ignored, mix 0%) | `#07162c` | theme-presets.ts:151, 179 |
| `--ui-bg-chrome` | `#fefefe` `[INFERENCE]` | `#0d1015` `[INFERENCE]` | styles.css:297-301 |
| `--ui-bg-sidebar` | `#f6f8fa` | `#010409` | styles.css:302-306 |
| `--ui-bg-editor` | `#fbfbfc` `[INFERENCE]` | `#0e0f12` `[INFERENCE]` | styles.css:307 |
| `--ui-bg-elevated` | `#fdfdfd` `[INFERENCE]` | `#16181d` `[INFERENCE]` | styles.css:308-312 |
| `--ui-bg-input` | `#fcfcfc` | `#fcfcfc` (not overridden in .dark) | styles.css:314 |
| `--ui-chat-bubble-background` | `#fcfcfc` (bubble mix 0% => neutral card) | `#0f1621` `[INFERENCE]` | styles.css:411-415 |
| `--ui-chat-bubble-opaque-background` | `var(--ui-bg-editor)` | same | styles.css:416 |
| `--ui-widget-surface-background` | `var(--ui-bg-editor)` | `color-mix(in srgb, var(--ui-bg-editor) 88%, #000)` = `#0c0d10` `[INFERENCE]` | styles.css:410, 634 |
| `--ui-surface-background` | `var(--ui-bg-editor)` | same | styles.css:397 |
| `--ui-sidebar-surface-background` | `var(--ui-bg-sidebar)` | same | styles.css:398 |
| `--ui-chat-surface-background` | `var(--ui-bg-chrome)` | same | styles.css:399 |
| `--ui-editor-surface-background` | `var(--ui-bg-chrome)` | same | styles.css:400 |
| `--ui-terminal-surface-background` | `var(--ui-chat-surface-background)` | same | styles.css:406 |
| `--ui-text-primary` | `rgba(31,35,40,0.94)` | `rgba(230,237,243,0.94)` | styles.css:364 |
| `--ui-text-secondary` | `rgba(31,35,40,0.74)` | `rgba(230,237,243,0.74)` | styles.css:365 |
| `--ui-text-tertiary` | `rgba(31,35,40,0.54)` | `rgba(230,237,243,0.54)` | styles.css:366 |
| `--ui-text-quaternary` | `rgba(31,35,40,0.36)` | `rgba(230,237,243,0.36)` | styles.css:367 |
| `--conversation-scaffold-text` | `rgba(31,35,40,0.64)` | `rgba(230,237,243,0.64)` | styles.css:373 |
| `--conversation-scaffold-meta` | `rgba(31,35,40,0.44)` | `rgba(230,237,243,0.44)` | styles.css:374 |
| `--ui-inline-code-background` | `rgba(20,20,20,0.05)` | `rgba(255,255,255,0.07)` | styles.css:417, 627 |
| `--ui-inline-code-foreground` | `rgba(20,20,20,0.88)` | `rgba(255,255,255,0.88)` | styles.css:418, 628 |
| `--ui-selection-background` | `rgba(255,210,74,0.55)` | `rgba(255,210,74,0.38)` | styles.css:419, 629 |
| `--ui-sash-hover-border` | `color-mix(in srgb, accent 18%, stroke-tertiary)` | same | styles.css:395 |
| `--ui-sash-hover-background` | `color-mix(in srgb, accent 6%, transparent)` | same | styles.css:396 |
| `--sidebar-edge-border` | `color-mix(in srgb, base 7.5%, transparent)` | `color-mix(in srgb, base 12%, transparent)` | styles.css:588, 618 |
| `--chrome-action-hover` | `= var(--ui-control-hover-background)` | same | styles.css:589 |
| semantic palette `--ui-red` | `#cf2d56` | `#e75e78` | styles.css:243, 613 |
| `--ui-orange` | `#db704b` | `#db704b` | styles.css:244 |
| `--ui-yellow` | `#c08532` | `#c08532` | styles.css:245 |
| `--ui-green` | `#1f8a65` | `#55a583` | styles.css:246, 614 |
| `--ui-cyan` | `#4c7f8c` | `#6f9ba6` | styles.css:247, 615 |
| `--ui-blue` | `#0053fd` | `#0053fd` | styles.css:248 |
| `--ui-purple` | `#9e94d5` | `#9e94d5` | styles.css:249 |
| `--ui-success` | `harmonize('#10b981', midground, 0.25)` `[INFERENCE]` for nous a blue accent turns it teal | same | context.tsx:341 |
| `--ui-diff-add-border` / `-background` / `-foreground` | `--ui-green` / `color-mix(green 12%, transparent)` / `color-mix(green 70%, #000)` | foreground `color-mix(green 62%, #fff)` | styles.css:270-277, 616-617 |
| `--ui-diff-remove-border` / `-background` / `-foreground` | `--ui-red` / `color-mix(red 12%, transparent)` / `color-mix(red 70%, #000)` | foreground `color-mix(red 62%, #fff)` | styles.css:269-277, 616-617 |
| `--tool-memory-legendary-{from,mid,to,icon,meta,glow}` | 6 color-mix tokens gold->purple | same | styles.css:258-264 |
| `--context-usage-{system,tools,rules,skills,mcp,subagents,memory,conversation}` | 8 tokens | same | styles.css:250-257 |

### 2.4 `--dt-*` (shadcn/Tailwind bridge)

| Token | Light | Dark | Source |
| --- | --- | --- | --- |
| `--dt-background` | `var(--ui-bg-chrome)` | same | styles.css:421 |
| `--dt-foreground` | `var(--ui-text-primary)` | same | styles.css:422 |
| `--dt-card` | `var(--ui-bg-editor)` | same | styles.css:423 |
| `--dt-card-foreground` | `var(--ui-text-primary)` | same | styles.css:424 |
| `--dt-muted` | `var(--ui-bg-tertiary)` | same | styles.css:425 |
| `--dt-muted-foreground` | `var(--ui-text-tertiary)` | same | styles.css:426 |
| `--dt-popover` | `color-mix(in srgb, var(--ui-bg-elevated) 96%, transparent)` | same | styles.css:427 |
| `--dt-primary` | `var(--theme-primary)` | `#4a84fe` | styles.css:429 |
| `--dt-primary-foreground` | `#fcfcfc` (fallback) / palette value inline | `#161616` (palette) | styles.css:430 / context.tsx:314 |
| `--dt-primary-solid` | `ensureContrast(#0053fd, #fcfcfc, 4.5)`; the light primary measures ~5.6:1 so it passes through unchanged `[INFERENCE]` | a **darkened** `#4a84fe` (measures ~3.4:1, so `ensureContrast` deepens it) `[INFERENCE]` | context.tsx:330 / styles.css:433-435 |
| `--dt-primary-solid-foreground` | `#fcfcfc` | `#fcfcfc` | context.tsx:238, 331 |
| `--dt-secondary` | `var(--theme-secondary)` | `#1d2e4f` | styles.css:437 |
| `--dt-secondary-foreground` | `var(--ui-text-secondary)` | same | styles.css:438 |
| `--dt-accent` | `var(--theme-accent-soft)` | `#17243a` | styles.css:439 |
| `--dt-accent-foreground` | `var(--ui-text-primary)` | same | styles.css:440 |
| `--dt-border` | `var(--ui-stroke-secondary)` | same | styles.css:441 |
| `--dt-input` | `var(--ui-stroke-primary)` | same | styles.css:442 |
| `--dt-input-border` | `7%` | `4%` | styles.css:445, 626 |
| `--dt-input-bg` | `0%` | `0%` | styles.css:448 |
| `--dt-input-inset` | `inset 0 1px 1px rgba(0,0,0,0.10)` | `inset 0 1px 1px rgba(0,0,0,0.38)` | styles.css:452, 625 |
| `--ui-tab-hover-darken` | `2.5%` | `6%` | styles.css:456, 626b |
| `--dt-ring` | `var(--ui-stroke-primary)` | same | styles.css:457 |
| `--dt-midground` | `var(--theme-midground)` | `#4a84fe` | styles.css:458 |
| `--dt-scrollbar-thumb` | `oklch(from var(--dt-midground) l 0 h)` - midground lightness, chroma 0 | same | styles.css:462 |
| `--dt-composer-ring` | `var(--ui-base)` (fallback) / `composerRing ?? midground` inline | `#4a84fe` | styles.css:463 / context.tsx:332 |
| `--dt-destructive` | `#cf2d56` | `#cf2d56` (inline `#f85149` for nous dark) | styles.css:464 / theme-presets.ts:175 |
| `--dt-destructive-foreground` | `#ffffff` | `#ffffff` | styles.css:465 |
| `--dt-sidebar-bg` | `var(--ui-bg-sidebar)` | `#010409` | styles.css:466 |
| `--dt-sidebar-border` | `var(--ui-stroke-secondary)` | same | styles.css:467 |
| `--dt-user-bubble` | `color-mix(in srgb, var(--ui-chat-bubble-background) var(--user-bubble-keep, 100%), transparent)` = `#fcfcfc` at default | `#0f1621` at default | styles.css:475-476 |
| `--dt-user-bubble-border` | `var(--ui-stroke-tertiary)` | same | styles.css:477 |
| `--dt-font-sans` | system stack (see 3.1) | same | styles.css:479-484 |
| `--dt-font-kbd` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` (key caps never use theme typography) | same | styles.css:486 |
| `--dt-font-mono` | JetBrains Mono-first stack | same | styles.css:490 |
| `--dt-base-size` | `1rem` | `1rem` | styles.css:491 |
| `--dt-line-height` | `1.5` | `1.5` | styles.css:492 |
| `--dt-letter-spacing` | `0` | `0` | styles.css:493 |
| `--dt-spacing-mul` | `1` | `1` | styles.css:494 |
| `--radius` | `0.75rem` | `0.75rem` | styles.css:496 |
| `--radius-scalar` | `0.2` | `0.2` | styles.css:501 |

### 2.5 Elevation, stroke, z-ladder, radius

Shadows (`styles.css:174-205`), all literal, all already resolved:

```
--shadow-xs: 0 0.0625rem 0.125rem color-mix(in srgb, #000 5%, transparent)
--shadow-sm: 0 0 0 0.0625rem color-mix(in srgb, var(--dt-foreground) 6%, transparent),
             0 0.125rem 0.5rem color-mix(in srgb, #000 4%, transparent)
--shadow-md: 0 0 0 0.0625rem color-mix(in srgb, var(--dt-foreground) 8%, transparent),
             0 0.25rem 1rem color-mix(in srgb, #000 8%, transparent),
             0 1rem 2rem -1.5rem color-mix(in srgb, #000 18%, transparent)
--shadow-nous: 0 0.125rem 0.25rem -0.125rem color-mix(in srgb, #000 7%, transparent),
               0 0.5rem 0.75rem -0.375rem color-mix(in srgb, #000 6%, transparent),
               0 1.25rem 1.75rem -0.875rem color-mix(in srgb, #000 6%, transparent),
               0 2.25rem 3rem -1.75rem color-mix(in srgb, #000 0%, transparent)
--stroke-nous: color-mix(in srgb, currentColor 3%, transparent)
--shadow-lg: inset 0 0.0625rem 0 color-mix(in srgb, #fff 28%, transparent),
             0 0 0 0.0625rem color-mix(in srgb, var(--dt-foreground) 8%, transparent),
             0 0.75rem 2rem color-mix(in srgb, #000 12%, transparent)
--shadow-composer: 0 0.0625rem 0.125rem color-mix(in srgb, #000 5%, transparent)
```
`--shadow-nous` is the defining one: every layer is x=0 (single top light source), cast downward, with negative spread that grows with the blur so the shadow pools below the panel instead of bleeding out all sides. `--stroke-nous` uses `currentColor` so one token adapts per element.

Radii (`styles.css:156-163`) - **the whole scale is multiplied by `--radius-scalar` which is pinned to 0.2** (`styles.css:497-501`):

| Tailwind class | Formula | Rendered |
| --- | --- | --- |
| `rounded-xs` | `0.2 x 0.125rem` | `0.025rem` = 0.4px |
| `rounded-sm` | `0.2 x 0.5rem` | `0.1rem` = 1.6px |
| `rounded-md` | `0.2 x 0.625rem` | `0.125rem` = 2px |
| `rounded-lg` | `0.2 x 0.75rem` | `0.15rem` = 2.4px |
| `rounded-xl` | `0.2 x 1rem` | `0.2rem` = 3.2px |
| `rounded-2xl` | `0.2 x 1.5rem` | `0.3rem` = 4.8px |
| `rounded-3xl` | `0.2 x 2rem` | `0.4rem` = 6.4px |
| `rounded-4xl` | `0.2 x 2.5rem` | `0.5rem` = 8px |
| `rounded-full` | `0.2 x 9999rem` | effectively full |

**This is the single biggest divergence from stock shadcn and a mobile port must not use 8/12px defaults.** Menu surfaces (`rounded-lg`) therefore render at 2.4px, overlays/dialogs/user bubbles (`rounded-xl`) at 3.2px, the composer (`rounded-2xl`) at 4.8px. Buttons use literal `rounded-[2.5px]`; icon buttons and menu rows use literal `rounded-[4px]`/`rounded-md` (2px); badges use literal `rounded-[3px]`.

Z-ladder (`styles.css:282-296`): `--z-modal-backdrop 120`, `--z-modal 130`, `--z-modal-popover 140`, `--z-over-modal 200`, `--z-over-modal-content 210`, `--z-switcher-backdrop 219`, `--z-switcher 220`, `--z-connecting 1200`, `--z-onboarding 1300`, `--z-onboarding-popover 1310`, `--z-setup 1400`, `--z-crash 1500`. Values are deliberately sparse so a one-off can slot between rungs. Component-local stacking uses plain `z-10`/`z-20`.

### 2.6 Preset inventory and how a preset resolves
- 12 built-ins in `BUILTIN_THEMES` (`presets.ts:406-419`): `nous` (default), `github`, `catppuccin`, `everforest`, `solarized`, `nous-alt`, `classic`, `midnight`, `ember`, `mono`, `slate`, `cyberpunk`. `DEFAULT_SKIN_NAME = 'nous'` (`presets.ts:424`); `RETIRED_SKINS = {nous-light, default, gold}` (`presets.ts:429`).
- Resolution order for a name: `BUILTIN_THEMES[name]` -> `$userThemes[name]` -> `$backendThemes[name]` -> first contributed theme with that name (`user-themes.ts:151-158`). Listing order: built-ins, contributed (minus shadowed), backend (minus user-shadowed), user (`user-themes.ts:161-171`).
- Only `nous` and `github` carry full terminal ANSI palettes plus `typography.fontUrl` for Courier Prime (their mono stack does not ship Courier Prime, hence the webfont). `midnight`, `ember`, `cyberpunk` override `fontMono`/`fontSans`. `classic` is generated through `skinToDesktopTheme` from the CLI's stock skin (`presets.ts:376-399`).
- `retintTheme` re-seeds the accent family from one hex: seed slots are `primary`, `ring`, `midground`, `composerRing`; membership is decided by hue within `ACCENT_HUE_TOLERANCE = 25` degrees (or chroma < `ACCENT_MIN_CHROMA = 0.03` for greys), and derived slots are `accent = mixOklab(seed, background, light 0.88 / dark 0.82)`, `secondary = mixOklab(seed, background, 0.86 / 0.72)`, `userBubble = mixOklab(card, seed, 0.12 / 0.18)` (`retint.ts:56-63, 108-137`). Light seeds are contrast-clamped to `ACCENT_MIN_CONTRAST = 4.5` on the sidebar; dark seeds carry across via the theme's own light->dark lightness delta, then clamp (`retint.ts:140-176`). Passing a theme its own accent is a byte-exact no-op (`retint.ts:186-193`).
- `$accentOverride` (`accent-override.ts:20`) is a dev-only, non-persisted live-authoring knob; production is always `null`.
- `synthLightColors` (`context.tsx:120-149`) generates a light palette for dark-only skins by mixing white toward the accent at 0.10/0.06 and borders at `mix('#ececef', accent, 0.14)`, ink `#161616`.
- `skinToDesktopTheme` (`skin.ts:56-130`) converts a CLI skin: seeds from `background|status_bar_bg`, `ui_text|banner_text|status_bar_text`, `ui_accent|banner_accent|banner_title`, `ui_border|banner_border`, `ui_error`, `completion_menu_bg|banner_dim`; everything else is mixed toward bg/fg (`card` 0.025/0.04, `muted` 0.04/0.06, `popover` 0.05/0.08, `input` 0.06/0.10, sidebar = `mix(background, foreground, 0.012/0.02)`, `userBubble = mix(background, accent, 0.12/0.18)`). Skin `customCSS` is injected as a scoped `<style>`.

---

## 3. Typography

### 3.1 Font families actually shipped

| Family | Where it comes from | Used for | Source |
| --- | --- | --- | --- |
| System sans stack | `'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif` + emoji fallbacks | the entire UI (`--dt-font-sans`) | presets.ts:41-43, styles.css:479-484 |
| `'JetBrains Mono'` | **bundled woff2**: `src/fonts/JetBrainsMono-Regular.woff2`, `-Bold.woff2`, `-Italic.woff2` (Apache-2.0), weights 400 normal + 700 normal + 400 italic | code, diffs, terminal, mono labels (`--dt-font-mono`) | styles.css:104-123, src/fonts/ |
| `'Collapse'` | **not bundled in this repo**: `node_modules/@nous-research/ui/dist/fonts/Collapse-Bold.woff2`, weight 700 only | the `.wordmark` only: `font-weight: 700; line-height: 0.9; text-transform: uppercase; letter-spacing: 0.08em` | styles.css:95-101, 1952-1958 |
| Emoji fallbacks | `'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', emoji` appended to both stacks | tofu prevention | presets.ts:30-34 |
| `--dt-font-kbd` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` - never follows theme typography overrides | key caps | styles.css:486 |
| CJK overrides | `[data-slot='composer-rich-input']:lang(zh)` -> PingFang SC / Microsoft YaHei / Noto Sans CJK SC; `:lang(zh-hant)` -> PingFang TC / Microsoft JhengHei / Noto Sans CJK TC; `:lang(ja)` -> Hiragino Sans / Yu Gothic UI / Noto Sans CJK JP | composer only | styles.css:1815-1825 |

A mobile port needs **JetBrains Mono shipped as an asset** and a system-sans substitute (SF Pro on iOS, Roboto on Android) - the desktop stack is Windows/macOS-oriented. `Collapse` is only needed if the wordmark is reproduced; it is not in this repo.

### 3.2 Root and global type settings

| Knob | Value | Effect | Source |
| --- | --- | --- | --- |
| `html { font-size }` | `var(--dt-base-size, 0.875rem)` = `1rem` = 16px | all rem-based Tailwind sizes | styles.css:806-808, 491 |
| `body { font-size }` | `0.8125rem` = 13px (hardcoded, not a var) | default UI text | styles.css:815 |
| `body { line-height }` | `var(--dt-line-height, 1.55)` = `1.5` | default leading | styles.css:816, 492 |
| `body { letter-spacing }` | `var(--dt-letter-spacing, 0)` = `0` | default tracking | styles.css:817, 493 |
| `-webkit-font-smoothing` | `antialiased` | | styles.css:820 |
| UI Scale (window zoom) | presets `[90,100,110,125,150,175]`, default 100% | whole-window zoom, applied by Electron `window.hermesDesktop.zoom.setPercent` | appearance-settings.tsx:173, store/zoom.ts:13-16 |
| Chat Text Size | presets `[90,100,110,125,150,175]`, **default 110** | writes `--chat-text-scale = value/100` on documentElement | store/chat-text-scale.ts:6-26 |

There are **no custom `--text-*` entries in the Tailwind `@theme` block** (styles.css:127-163 defines only colors, fonts, `--spacing-mul`, radii, sidebar aliases and shadows). The type scale is therefore stock Tailwind v4 (`text-xs` 0.75rem/1rem, `text-sm` 0.875rem/1.25rem, `text-base` 1rem/1.5rem, `text-lg` 1.125rem/1.75rem, `text-xl` 1.25rem/1.75rem) **plus** a large set of literal `text-[Nrem]` sizes and the four `--conversation-*-font-size` tokens below.

### 3.3 Conversation type scale (the ones that matter)

```
--conversation-text-base-size:              0.8125rem   (13px)   styles.css:511
--conversation-tool-base-size:              0.6875rem   (11px)   styles.css:512
--conversation-caption-base-size:           0.75rem     (12px)   styles.css:513
--conversation-base-line-height:            1.125rem    (18px)   styles.css:514
--conversation-caption-base-line-height:    1rem        (16px)   styles.css:515

// derived inside [data-slot='aui_thread-content'] and [data-slot='composer-rich-input']  (styles.css:1722-1729)
--conversation-text-scale           = var(--chat-text-scale, 1)
--conversation-text-font-size       = calc(0.8125rem * var(--chat-text-scale, 1))
--conversation-tool-font-size       = calc(0.6875rem * var(--chat-text-scale, 1))
--conversation-caption-font-size    = calc(0.75rem   * var(--chat-text-scale, 1))
--conversation-line-height          = calc(1.125rem  * var(--chat-text-scale, 1))
--conversation-caption-line-height  = calc(1rem      * var(--chat-text-scale, 1))

// setup/onboarding chat re-bases them (styles.css:1185-1190)
[data-setup-chat] { text 0.9375rem; tool 0.75rem; caption 0.8125rem; line-height 1.375rem }
```

At the default 110%, chat body computes to **14.3px / 19.8px leading** `[INFERENCE: 13 x 1.1, 18 x 1.1]`. `[data-slot='aui_assistant-message-content']` sets `padding-left: var(--message-text-indent)` (0.75rem) and `line-height: 1.5` (styles.css:1731-1734); markdown children inherit the conversation size rather than the prose plugin's (styles.css:1755-1758).

### 3.4 Type scale table (role -> size, weight, line-height, tracking, source)

| Role | Size | Weight | Line-height | Tracking | Source |
| --- | --- | --- | --- | --- | --- |
| App/body default | 0.8125rem (13px) | 400 | `--dt-line-height` = 1.5 | `--dt-letter-spacing` = 0 | styles.css:815-817 |
| Chat body / assistant prose | `--conversation-text-font-size` = 13px x scale (14.3px @110%) | inherit (400) | 1.5 (content) / `--conversation-line-height` (scaffold) | inherit | styles.css:1731-1734, 1724 |
| Chat user message text | `--conversation-text-font-size` inline; bubble radius 3.2px | 400 | inherit | inherit | user-message.tsx:78 |
| Tool rows / tool ticker / run summary | `--conversation-tool-font-size` = 11px x scale | 400 | `--conversation-line-height` | inherit | styles.css:1725, 2555-2558 |
| Tool caption / dialog banner | `--conversation-caption-font-size` = 12px x scale | 400 | `--conversation-caption-line-height` | inherit | styles.css:1726, dialog.tsx:145 |
| Transcript scaffold (thinking header, settled tool run, activity ticker) | tool size | 400 | `--conversation-line-height` | inherit | status.tsx:41-43, styles.css:373-374 |
| System/agent notice rows | `text-[0.6875rem] leading-5` (11/20px), `max-w-[min(86%,44rem)]`, centered, `text-muted-foreground/60` | 400 | 20px | - | system-message.tsx:121,145,170; agent-delivery.tsx:122 |
| Inter-agent collapsed reply body | `text-[0.75rem] leading-5`, `max-w-[36rem]`, `border --ui-stroke-tertiary`, `rounded-lg` | 400 | 20px | - | assistant-message.tsx:179 |
| Button label | `text-xs leading-4` (12/16px); `xs` size `text-[0.6875rem] leading-4`; `lg` `text-sm leading-5`; `micro` `text-xs leading-4` | 500 (`font-medium`); `micro` 400 | 16px | - | button.tsx:14, 45, 47, 52 |
| Menu row | `text-xs` (12px) | 400 | - | - | menu.ts:23 |
| Menu label | `text-xs` | 500 | - | - | menu.ts:27 |
| Menu/popover surface base text | `text-[length:var(--conversation-text-font-size)]` | - | - | - | menu.ts:11 |
| Dialog content base text | `text-[length:var(--conversation-text-font-size)]` | - | - | - | dialog.tsx:157 (and banner variant) |
| Dialog title | `text-[0.9375rem] tracking-tight` (15px) | 600 (`font-semibold`) | - | tight (~-0.025em) | dialog.tsx:284 |
| Error state title | `text-xl tracking-tight` (20px) | 600 | - | tight | error-state.tsx:53 |
| Error state description | `text-sm leading-5` (14/20px) `max-w-prose` | 400 | 20px | - | error-state.tsx:59 |
| Empty state title | `text-sm` (14px) | 500 | - | - | empty-state.tsx:19 |
| Empty state description | `text-xs` (12px), `mt-1`, `text-muted-foreground` | 400 | - | - | empty-state.tsx:20 |
| Sidebar row label | `text-[0.8125rem]` (13px), `leading-[1.35]`, `text-(--ui-text-secondary)`, `truncate` | 400 | 1.35 | - | row-geometry.ts:44-47 |
| Sidebar section meta (counts) | `text-[0.6875rem]` (11px) | 500 | - | - | chrome.tsx:29 |
| Sidebar group caption | `text-[0.64rem]` (10.24px) uppercase, `tracking-[0.12em]` | 600 | - | 0.12em | chrome.tsx:135 |
| Sidebar workspace facts | `text-[0.625rem] leading-none` (10px) | 400 | 1 | - | chrome.tsx:285 |
| Statusbar item | `text-[0.6875rem]` (11px), `text-(--ui-text-tertiary)`, `gap-1 px-1.5` | 400 | - | - | statusbar-controls.tsx:31, 323 |
| Statusbar status-stack row | `text-[0.73rem] leading-4` (11.68/16px) | 400 | 16px | - | status-stack/status-row.tsx:131 |
| Status stack subagent title / meta | `text-xs` / `text-[0.68rem]` | 400 | - | - | subagent-section.tsx:58-59 |
| Coding status cwd | `font-mono text-[0.62rem] leading-4` (9.92/16px) `text-muted-foreground/50` | 400 | 16px | - | coding-row.tsx:248 |
| Badge | `text-[0.65rem]` (10.4px) `leading-none`; `xs` `text-[0.6rem]`; `overlay` `text-[7px]` `tabular-nums` | 500; overlay 600 | 1 | - | badge.tsx:12-14 |
| Input / control | `text-xs leading-4` (12/16px); `xs` `text-[0.6875rem] leading-4` | 400 | 16px | - | control.ts:8-16 |
| Key cap (`kbd`) | `font-mono text-[10px]`, `rounded`, `border --ui-stroke-secondary`, `bg-foreground/5`, `px-1` | 400 | - | - | zone-editor.tsx:412 |
| LogView | `font-mono text-[0.6875rem] leading-[1.5]` (11/16.5px) | 400 | 1.5 | - | log-view.tsx:12 |
| Preview console | `font-mono text-[0.6875rem] leading-relaxed` | 400 | relaxed | - | preview-console.tsx:255 |
| Preview file (code) | `font-mono text-[0.7rem] leading-relaxed` | 400 | relaxed | - | preview-file.tsx:706 |
| Preview log pre | `font-mono text-[0.66rem] leading-relaxed text-(--ui-text-secondary)` | 400 | relaxed | - | (dist mirror of a src pre) |
| Overlay nav link | `text-[length:var(--conversation-text-font-size)]` (13px x scale), `h-7 px-2 rounded-md` | 400 | - | - | overlay-split-layout.tsx:121 |
| Settings row title / caption | conversation-text size / 500 ; conversation-caption size / `--ui-text-tertiary` | - | - | - | many settings rows (e.g. command-center/index.tsx:136-139) |
| Panel title / zone editor heading | `text-sm` | 600 | - | - | zone-editor.tsx:409 |
| Panel description | `text-xs text-muted-foreground/80` | 400 | - | - | zone-editor.tsx:410 |
| Composer queue entry | `text-[0.73rem] leading-4 text-foreground/92` | 400 | 16px | - | queue-panel.tsx:179 |
| Voice activity label | conversation-text size, `font-medium text-foreground/85` | 500 | - | - | voice-activity.tsx:195 |
| Floating pane header | `text-[0.6875rem] text-(--ui-text-secondary)` | 500 on the title span | - | - | floating-panes.tsx:177,183 |
| Titlebar hint / glyph counts | `text-[0.625rem] font-semibold tabular-nums` | 600 | 1 | - | tab-key-hints.tsx:37 |
| Tab slot numbers / zone tags | `text-[0.64rem] uppercase tracking-[0.16em]` | 600 | - | 0.16em | zone-editor.tsx:472, layout-picker.tsx:84 |
| Wordmark | `'Collapse'` | 700 | 0.9 | 0.08em, uppercase | styles.css:1952-1958 |

### 3.5 Markdown rhythm (paragraph/gap tokens)

```
--paragraph-gap   = 0.7rem   (prose paragraph spacing, single knob)   styles.css:538
--turn-block-gap  = 0.75rem  (gap between top-level turn blocks)      styles.css:524
--scaffold-block-gap = calc(var(--turn-block-gap) / 3) = 0.25rem      styles.css:529
--tool-row-gap    = 0.375rem (tight gap inside one action group)      styles.css:531
--conversation-turn-gap = 0.375rem                                    styles.css:521
--sticky-human-top = 0.23rem                                          styles.css:539
--message-text-indent = 0.75rem (prose + tools share ONE left edge)   styles.css:510
```
Rules: `.aui-md :where(p)` gets `margin-block: var(--paragraph-gap) 0` (top-owned, bottom zeroed) at higher specificity than the typography plugin (styles.css:1764-1766); headings get `margin-block: 1rem 0.25rem` (styles.css:1782-1784); the first rendered element of a prose block is flush (styles.css:1790-1793); prose<->prose keeps `--paragraph-gap` while any other block pair gets `--turn-block-gap`, and scaffold<->scaffold gets `--scaffold-block-gap` (styles.css:2350-2370). HUD mode tightens `--turn-block-gap` to 0.375rem and `--paragraph-gap` to 0.4rem (styles.css:3524-3525).

---

## 4. Geometry

### 4.1 App shell

```
SidebarProvider            className="h-screen min-h-0 flex-col bg-background"  style="--sidebar-width: 100%"
  div [data-contrib-shell] className="flex h-screen min-h-0 w-screen flex-col bg-(--ui-bg-chrome) text-(--ui-text-primary)"
      style="--titlebar-height: 0px"                       (app/contrib/controller.tsx:813-823)
    <LayoutTreeRoot titlebar />                            (pane tree: splits, groups, tab strips)
    <SessionTileCloseConfirm />
    <Butterbar /> <TermsButterbar />
    {statusbarVisible && <WiredPane part="statusbar" />}    (statusbar unmounts, not just hides)
```

- The shell is a **flex column**, not a CSS grid: titlebar/tree area on top, statusbar as the last `shrink-0` row. Within the tree, `LayoutTreeRoot` is `relative flex min-h-0 min-w-0 flex-1` (pane-shell/tree/index.tsx:51) and splits/groups carry all pane geometry. `components/pane-shell/tree/index.tsx:58-62` injects a style block that zeroes borders/box-shadow on `aside` and `[data-slot=sidebar]` inside `[data-tree-group]` - the "seam invariant": the tree draws one sash hairline per seam and mounted content must not paint its own edge chrome.
- The only opaque full-window painters are the contrib shell and `[data-slot='sidebar-wrapper']`; under glass both are forced transparent (styles.css:706-710).

| Element | Value | Source |
| --- | --- | --- |
| Window minimum | 400px (`[INFERENCE]` from the layout-constants comment) | layout-constants.ts:28-32 |
| Sessions sidebar width | default **237px**, max **360px**; min == default (clamp is `min(MAX, max(DEFAULT, width))`) | store/layout.ts:34-35, 553-556 |
| `--sidebar-width` CSS token | `14.8125rem` = 237px | styles.css:573 |
| shadcn sidebar primitives | `SIDEBAR_WIDTH` 16rem, `SIDEBAR_WIDTH_MOBILE` 18rem, `SIDEBAR_WIDTH_ICON` 3rem - **overridden to `100%`** by the app's `SidebarProvider` | sidebar.tsx:20-22, controller.tsx:810 |
| Sidebar dock threshold | **640px**; below it both rails leave the grid and become hover-reveal overlays | layout-constants.ts:25-32 |
| Sidebar content padding | `px-2.5` on SidebarContent; nav group `pb-2 pt-[calc(var(--titlebar-height)+0.375rem)]` (`--titlebar-height` is 0 here, so 0.375rem) | sidebar/index.tsx:1576-1577 |
| — CSS alias | `--sidebar-content-inline-padding: 1rem` | styles.css:578 |
| File browser rail | default 237px, min 10rem, max 20rem | store/layout.ts:39-41 |
| Chat min width | `--chat-min-width: 28rem` (448px) | styles.css:574 |
| Titlebar height | `TITLEBAR_HEIGHT = 34` (px). Inside the shell `--titlebar-height` is **0px**; portaled surfaces re-pin 34px or use a `34px` fallback | titlebar.ts:3, controller.tsx:822, overlay-view.tsx:103, find-bar.tsx:307 |
| Titlebar control hit target | 24 x 24 | titlebar.ts:11-12, styles.css:575-576 |
| Titlebar glyph size | 13.9px | titlebar.ts:13, styles.css:577 |
| Titlebar drag handle | 48px permanent native drag target | titlebar.ts:6 |
| Titlebar left-cluster offset | native button x + 74px; fallback 24px; edge inset 14px; 0.75rem right inset | titlebar.ts:14-21, 74-88 |
| Titlebar header band | `h-(--titlebar-height)`, `border-b --ui-stroke-tertiary`, `bg-(--ui-chat-surface-background)`, `px-[max(0.75rem,--titlebar-content-inset)]`, `gap-3`, right pad = `tools-right + tools-width + 0.75rem` | titlebar.ts:84-85 |
| Panel tab strip | tab strip row `h-7` (28px) when tabs drop below controls, else `TITLEBAR_HEIGHT`; vertical restore rail `w-7 min-w-7 h-full` (28px) | tree-group.tsx:523, 568 |
| Statusbar height | **20px** (`h-5`), `shrink-0`, `px-1 py-0`, two groups with `gap-0.5`, `overflow-x-clip` | statusbar-controls.tsx:102-119 |

### 4.2 Page/overlay gutters

| Token | Value | Source |
| --- | --- | --- |
| `PAGE_INSET_X` | `px-[clamp(1.25rem,4vw,4rem)]` (20px -> 64px) | layout-constants.ts:8 |
| `PAGE_INSET_NEG_X` | `-mx-[clamp(1.25rem,4vw,4rem)]` | layout-constants.ts:12 |
| `PAGE_MAX_W` | `max-w-[75rem]` (1200px) | layout-constants.ts:17 |
| Overlay split grid | `grid-cols-[13rem_minmax(0,1fr)]`, collapsing to one column under **47.5rem** | overlay-split-layout.tsx:55 |
| Overlay main padding | `pt-[calc((var(--titlebar-height)/2+1rem)*2/3)] pb-2 px-[clamp(0.8333rem,2.6667vw,2.6667rem)]`; narrow top `pt-[calc(0.5rem*2/3)]` | overlay-split-layout.tsx:97 |
| `OverlayView` scrim padding | `p-[calc(var(--titlebar-height)+0.625rem)]`, `sm:p-[calc(var(--titlebar-height)+0.875rem)]` - equidistant on all sides | overlay-view.tsx:82-83 |
| `OverlayView` card | `rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) shadow-md` | overlay-view.tsx:92 |
| Overlay top clearance (beside the close X) | `pt-[calc(var(--titlebar-height)/2-0.4375rem)]` = 0.4375rem at 34px | overlay-view.tsx:17 |
| Master/detail grid | `sm:grid-cols-[14rem_minmax(0,1fr)]`, wide variant `sm:grid-cols-[minmax(0,var(--md-split,0.75fr))_minmax(0,1fr)]` | master-detail.tsx:53, 121 |
| Page search shell row | `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 px-3 pb-2 pt-[calc(var(--titlebar-height)+0.5rem)]` | page-search-shell.tsx:94 |

### 4.3 Sidebar rows (canonical measurements every row composes)

| Token | Value | Meaning | Source |
| --- | --- | --- | --- |
| `SIDEBAR_ROW_MIN_H` | `min-h-[1.625rem]` = **26px** | height lives ONLY on the shell | row-geometry.ts:29 |
| `SIDEBAR_ROW_PAD_X` | `pl-2 pr-2` = 8px | body padding inside the click target | row-geometry.ts:30 |
| `SIDEBAR_ROW_PAD_TRAIL` | `pr-2` = 8px | row's trailing inset, on the shell | row-geometry.ts:31 |
| `SIDEBAR_ROW_GAP` | `gap-1.5` = 6px | lead -> label | row-geometry.ts:32 |
| `SIDEBAR_ROW_LEAD` | `grid size-3.5 shrink-0 place-items-center` = **14x14** | fixed leading cell for dot/icon/drag handle | row-geometry.ts:36 |
| `SIDEBAR_ROW_INSET` | `pl-2 pr-2 gap-1.5 flex h-full min-w-0 items-center self-stretch py-0.5` | the row body | row-geometry.ts:38-42 |
| `SIDEBAR_TRUNCATED_LEADING` | `leading-[1.35]` | truncate would shave Windows ink at 1.0 | row-geometry.ts:44-47 |
| `SIDEBAR_ROW_CARD_MIN_H` | `min-h-[3.375rem]` = **54px** | inbox-style three-line card | row-geometry.ts:55 |
| `SIDEBAR_LEAD_ICON_SIZE` | `0.875rem` = 14px | codicon in row leads, matches the file tree | row-geometry.ts:58 |
| Row stack gap | `gap-px` (1px) between rows | chrome.tsx:108 |
| Nested rows | `pb-1 pl-2` (4px / 8px step) | chrome.tsx:113 |
| Row corner radius | `rounded-md` = **2px** | chrome.tsx:189 |
| Section row-group pad bottom | `pb-1.75` (7px) | sidebar/index.tsx:1728 |

### 4.4 Chat/composer geometry

| Token | Value | Source |
| --- | --- | --- |
| `--composer-width` | **100%** (only override anywhere is onboarding `36rem`) | styles.css:542, onboarding-chat/intro-copy.css:3 |
| Thread content | `mx-auto flex min-h-full w-full max-w-(--composer-width) px-6` - i.e. full pane width with 24px side insets | list.tsx:1593-1594; styles.css:1915-1918 |
| Thread top pad | `pt-[calc(var(--titlebar-height)+0.75rem)]` for secondary windows, else `pt-[calc(var(--titlebar-height)-0.5rem)]` (both 0.75rem / -0.5rem inside the shell) | list.tsx:734-738 |
| Centered notice cap | `max-w-[min(86%,44rem)]` (system/agent/inter-agent notices only - this is where 44rem appears, not the message column) | system-message.tsx:121, agent-delivery.tsx:122 |
| Composer control sizes | `--composer-control-size: 1.5rem`, `--composer-control-primary-size: 1.625rem`, `--composer-control-gap: 0.25rem`, `--composer-row-gap: 0.25rem` | styles.css:543-546 |
| Composer surface padding | `--composer-surface-pad-x: 0.5rem`, `--composer-surface-pad-y: 0.3125rem`, `--composer-shell-pad-block-end: 0.625rem` | styles.css:548-549, 509 |
| Composer input | min height `1.625rem`, max height `9.375rem`, inline min width `8rem` | styles.css:550-552 |
| Composer fallback / measured height | `2.75rem` / `calc(0.5rem + 0.625rem + 2.75rem)` = 3.875rem | styles.css:553-554 |
| Composer shell | `w-[min(--composer-width,calc(100%-2rem))] max-w-full -translate-x-1/2 rounded-2xl pt-2 pb-[--composer-shell-pad-block-end]`, gradient `from-transparent to-background/55`, ring `border-[color-mix(--dt-composer-ring calc(18%*--composer-ring-strength),--dt-input)]` | composer/index.tsx:1579, 1453 |
| `--composer-ring-strength` | `1` light, `1.3` dark | styles.css:547, 619 |
| Composer grid | stacked: `grid-cols-[auto_1fr]` areas `menu,input,controls`; inline: `grid-cols-[auto_1fr_auto]` area `menu_input_controls` | composer/index.tsx:1529-1530 |
| Thread viewport | `max(0rem, calc(100% - --composer-measured-height + --composer-surface-measured-height))` | styles.css:556-559 |
| Thread bottom clearance | `calc(var(--composer-measured-height) + 2rem)`, re-declared per chat surface; HUD `0.25rem` | styles.css:507, 2537, 3512 |
| Image preview envelope | `--image-preview-max-width: 40rem`, `--image-preview-height: clamp(26.25rem, calc(var(--vsq)*140), 40rem)`, `--vsq: min(0.5vh,0.5vw)` | styles.css:560, 570-571 |
| Inline user fence | `my-1.5 rounded-md border --ui-stroke-tertiary bg-[color-mix(currentColor 5%,transparent)] px-2.5 py-2 font-mono text-[0.86em] leading-snug` | user-message-text.tsx:131 |
| User bubble | `rounded-xl (3.2px) border bg-(--dt-user-bubble) px-3 py-2 gap-1.5`; sticky wrapper `-mx-4 w-[calc(100%+2rem)] px-4 pb-(--conversation-turn-gap) pt-1` | user-message.tsx:78, 55 |
| Tool ticker | `height: var(--conversation-line-height)`, reel `translateY(index * -1 * line-height)`, `transition: transform 240ms cubic-bezier(0.22,1,0.36,1)` | styles.css:2547-2558 |
| run/file-tree row heights | `--file-tree-row-height: 1.375rem` (22px); review file tree virtualizer `ROW_HEIGHT = 24` | styles.css:540; review/file-tree.tsx:105 |

### 4.5 Radius / border / shadow inventory per component

| Component | Radius (rendered) | Border | Shadow | Source |
| --- | --- | --- | --- | --- |
| Button (all variants) | `rounded-[2.5px]`; icon sizes `rounded-[4px]`; `grip` `rounded-full` | none (outline variant uses a 1px inset ring at 50% of `--ui-stroke-secondary`) | none | button.tsx:14, 46-53 |
| Badge | `rounded-[3px]`; overlay size `rounded-[2px]` | `outline` variant: `--ui-stroke-secondary` | none | badge.tsx:9-14 |
| Input/Textarea/SelectTrigger | `rounded-[2.5px]`, `border` colored by `--dt-input-border` (7% light / 4% dark of `--dt-composer-ring`), inset `--dt-input-inset` | yes | inset only | control.ts:8-9, styles.css:1511-1534 |
| Menu surface (Dropdown/Select/Popover-menu) | `rounded-lg` = **2.4px** | `--ui-stroke-secondary` | `shadow-md` + `backdrop-blur-md` | menu.ts:11 |
| Popover (default variant) | `rounded-lg`; arrow 16x7 | border-only, no shadow | none | popover.tsx:24, 88-99 |
| Dialog | `rounded-xl` = **3.2px** | `--stroke-nous` hairline | `shadow-nous`; scrim `bg-black/22` + `backdrop-blur-[0.125rem]` | dialog.tsx:157-160 |
| OverlayView card | `rounded-xl` = 3.2px | `--ui-stroke-secondary` | `shadow-md`; scrim `bg-black/22` + `backdrop-blur-[0.125rem]` | overlay-view.tsx:71, 92 |
| Tooltip bubble | `0.25rem` | none | (surface fill only) | tooltip.css:3 |
| Sidebar row | `rounded-md` = 2px | none | none | chrome.tsx:189 |
| User bubble | `rounded-xl` = 3.2px | `--ui-stroke-tertiary` (`--dt-user-bubble-border`) | none | user-message.tsx:78 |
| Inline widget (`WIDGET_SHELL_CLASS`) | shared radius | **none** (explicitly borderless) | none | DESIGN.md:447-451 |
| Status card | rounded (radius from the shared card) | - | - | DESIGN.md:509-513 |

---

## 5. Iconography and glyphs

- **Two vocabularies, one per semantic context** (DESIGN.md:537-545):
  - **Tabler** = component/chrome. Curated aliases + `iconSize` live in `src/lib/icons.ts`; feature code must import from there, never from an icon package.
  - **Codicon** = compact editor/tool/status vocabulary, `src/components/ui/codicon.tsx`, plus `codiconIcon()` when a Tabler-shaped component is required. Loaded via `@import '@vscode/codicons/dist/codicon.css'` (styles.css:5) which is **unlayered** and pins `font: 16px/1` - hence the override `.titlebar-icon-button .codicon[class*='codicon-'] { font-size: var(--titlebar-icon-size) }` (styles.css:8-11).
- `iconSize` scale (`lib/icons.ts:285-291`): `xs size-3` (12px), `sm size-3.5` (14px), `md size-4` (16px), `lg size-5` (20px), `xl size-6` (24px). Buttons default SVGs to `size-3.5` and `size-3` at `xs` (button.tsx:14, 45).
- Codicon sizes seen in chrome: sidebar/file-tree leads `0.875rem` (row-geometry.ts:58), status-stack group icons `0.8rem` (status-stack/index.tsx:294), `ErrorIcon` default `1.75rem` (error-state.tsx:11), preview browser bar `0.8125rem` (preview-browser-bar.tsx:155).
- `StatusDismissButton` owns the Codicon close glyph for previews/background tasks/queued prompts; do not substitute a trash icon or CSS glyph (DESIGN.md:498-503).
- `BrandMark` (`src/components/brand-mark.tsx`): the `nous-girl` mark on a fixed tile - **black girl on white in light mode, white girl on the `#0d1117` tile in dark mode**, keyed off `renderedMode`; generated by `scripts/generate_icons.py` from `assets/nous-girl-*.svg` x `assets/backgrounds/`. `#0d1117` and `#ffffff` are the only sanctioned raw color literals in the app (DESIGN.md:215-217, 546-555).
- Hover-reveal convention: `DisclosureCaret` rests at `opacity: var(--disclosure-caret-rest)` = **0** (styles.css:534) and many chrome affordances are `opacity-0` until `group-hover`/`focus-visible`; note the app registers `@custom-variant hover (&:hover)` to bypass Tailwind v4's `@media (hover: hover)` gate because some Windows hosts answer false (styles.css:16-22).

---

## 6. Component inventory with the variants each surface uses

### 6.1 shadcn/ui primitives (`src/components/ui/`, 100+ files)

**Core actions**
| Component | Variants / sizes |
| --- | --- |
| `button.tsx` | variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `grip`, `floating`, `link`, `text`, `textStrong`; sizes: `default`, `xs`, `sm`, `lg`, `inline`, `micro`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`, `grip`, `icon-titlebar`; extras: `asChild`, `loading` (label stays in flow and goes invisible, spinner overlays - preserves exact width) |
| `badge.tsx` | variants: `default`, `muted`, `success`, `warn`, `destructive`, `outline`, `solid`; sizes: `default`, `xs`, `overlay` |
| `split-button.tsx`, `generate-button.tsx`, `copy-button.tsx`, `row-button.tsx`, `action-status.tsx` | task-specific button wrappers composing `Button` |

**Forms**
| Component | Notes |
| --- | --- |
| `control.ts` | `controlVariants` sizes `xs`, `sm`, `default` - the shared shape for text entry |
| `input.tsx`, `textarea.tsx`, `sanitized-input.tsx`, `field.tsx` | `Field` is the label+control+description layout |
| `search-field.tsx` | borderless, underline-on-focus, auto-width - the ONLY search input |
| `segmented-control.tsx` | small mutually-exclusive choice sets |
| `switch.tsx` | sizes `default` (h-5 w-9, thumb size-4 translate-x-4), `xs` (h-4 w-7, thumb size-3 translate-x-3.5) |
| `checkbox.tsx`, `slider.tsx`, `color-swatches.tsx`, `setup-field-list.tsx`, `setup-form-dialog.tsx` | |

**Floating surfaces**
| Component | Notes |
| --- | --- |
| `menu.ts` | the shared list surface/motion/row/label classes - DropdownMenu, Select and Popover+cmdk all paint through it |
| `dropdown-menu.tsx`, `select.tsx`, `popover.tsx` (`default` \| `accent` \| `menu`), `context-menu.tsx`, `command.tsx` (`variant="menu"`), `tooltip.tsx` + `tooltip.css`, `actions-menu.tsx`, `title-menu-trigger.tsx`, `tab-dropdown.tsx`, `highlight-matches.tsx` | `popover.tsx` variants: `default` (glass, border-only), `accent` (opaque `--dt-primary-solid` fill with `--dt-primary-solid-foreground` ink), `menu` (exactly the menu surface, no arrow); default `sideOffset` 4 for menu / 6 otherwise; `arrowPadding` 12; `collisionPadding` 8 |
| `dialog.tsx` | props `showCloseButton`, `fitContent` (`w-auto max-w-[92vw]`), `blurBackdrop`, `banner` + `bannerTone` (`error` \| `warn` \| `info`), `chrome`, `bodyClassName`, `overlayClassName`; nested dialogs bump the scrim/content to `z-(--z-modal)+1/+2`; publishes a portal container so nested popovers stay DOM descendants |
| `confirm-dialog.tsx` | the only "are you sure" affordance; focused on Confirm |
| `sheet.tsx`, `popover.tsx`, `card-stack.tsx`, `drop-affordance.tsx`, `fan-menu.tsx` | |

**Structure and feedback**
| Component | Notes |
| --- | --- |
| `tabs.tsx` | list `h-9 rounded-lg bg-muted p-1`; trigger `h-7 rounded-md px-3 text-sm font-medium`, active `bg-background text-foreground shadow-xs` |
| `pane-tab.tsx`, `text-tab.tsx` | pane tab strip tabs; closeable tabs get `--pane-tab-close-width: 1.5rem` and a mask-based label fade |
| `card-stack.tsx`, `separator.tsx`, `skeleton.tsx`, `pagination.tsx`, `progress.tsx`, `scroll-area.tsx`, `fade-scroll.tsx` (`edgeMask(edges, 'x' \| 'y')`), `glyph-spinner.tsx` + `.css`, `status-pulse.tsx`, `decode-text.tsx`, `diff-count.tsx` (`AnimatedInt`) | |
| `loader.tsx` | `LOADER_TYPES` incl. `lemniscate-bloom`; `<svg viewBox="0 0 100 100">` inside `inline-grid size-10 place-items-center text-primary`; `role="status"`, label defaults to "Loading" |
| `empty-state.tsx` | `grid min-h-48 place-items-center text-center` |
| `error-state.tsx` | `ErrorIcon` / `ErrorBanner` / `ErrorState` |
| `log-view.tsx` | `rounded-lg border --ui-stroke-tertiary px-2.5 py-1.5 font-mono text-[0.6875rem] leading-[1.5]` selectable |
| `alert.tsx`, `sidebar.tsx` (shadcn sidebar anatomy with 20+ `data-slot`s), `avatar-chip.tsx`, `profile-glyph.tsx`, `connector-card.tsx`, `connector-logo.tsx`, `favicon.tsx`, `file-type-icon.tsx`, `tool-icon.tsx`, `codicon.tsx`, `kbd.tsx`, `disclosure-caret.tsx`, `fade-text.tsx`, `zoomable.tsx` + `use-zoom-pan.ts`, `sandboxed-frame.tsx` | |

### 6.2 assistant-ui layer (`src/components/assistant-ui/`)

- **thread/**: `index.tsx` (`data-slot="thread"`, a `relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)] contain-[layout_paint]`), `list.tsx` (virtualized list + `data-slot="aui_thread-content"` + show-earlier pill), `message-parts.tsx`, `assistant-message.tsx`, `user-message.tsx`, `user-message-text.tsx`, `user-edit-composer.tsx`, `system-message.tsx`, `agent-delivery.tsx`, `agent-message.tsx`, `response-group.tsx`, `status.tsx`, `turn-activity.ts`, `message-reactions.tsx`, `timeline*.tsx`, `message-hover-time.tsx`, `transcript-window.tsx`, `changed-files-card.tsx`, `block-direction.test.tsx`, `text-direction.test.tsx`.
- **tool/**: `approval.tsx`, `approval-activity.ts`, `fallback.tsx`, `run-summary.ts`, `run-ticker.tsx`, `delegate.tsx`, `skill-activity.ts`, `tool-group`, `fallback-model/`, plus `hide-code-diffs` and `fallback-preview-scope` tests.
- **clarify/**: `index.tsx`, `pending.tsx`, `settled.tsx`, `confirm-bar.tsx`, `question-block.tsx`, `choice-row.tsx`, `setup-pickers.tsx`, `setup-rows.ts`, `undelivered-notice.tsx`, `core/shell.tsx`.
- **embeds/**: `registry.tsx`, `url-embed.tsx`, `social-embed.tsx`, `listing-embed.tsx`, `youtube-embed.tsx`, `mermaid-embed.tsx`, `embed-consent.tsx`, `embed-size.ts`, and `providers/` (youtube, vimeo, spotify, twitter, instagram, tiktok, pinterest, maps).
- Root-level: `markdown-text.tsx`, `markdown-table.tsx`, `directive-text.tsx`, `transcript-directive.tsx`, `inline-preview-directive.tsx`, `connector-tool.tsx`, `mcp-setup-tool.tsx`, `catalog-install-tool.tsx`, `catalog-advanced-dialog.tsx`, `start-chat-tool.tsx`, `message-render-boundary.tsx`, `tooltip-icon-button.tsx`.

The `data-slot` namespace (`aui_*`) is the styling contract: `aui_thread-content`, `aui_assistant-message-content`, `aui_assistant-message-root`, `aui_user-message-root`, `aui_user-inline-text`, `aui_user-inline-code`, `aui_user-fence`, `aui_system-message-root`, `aui_thinking-disclosure`, `aui_thinking-body`, `aui_turn-activity`, `aui_msg-actions`, `aui_msg-reactions`, `aui_turn-duration`, `aui_intro`, `aui_markdown-image`, `aui_composer-clearance`, `aui-md-table`, `aui-prose-fence`, `aui-shiki`.

### 6.3 Per-surface component list

| Surface | Composition |
| --- | --- |
| **App shell** | `SidebarProvider` (shadcn) > `[data-contrib-shell]` flex column > `LayoutTreeRoot` > `SessionTileCloseConfirm` > `Butterbar` + `TermsButterbar` > `StatusbarControls`. Glass-capable, transparent under `[data-hermes-glass]`. |
| **Left sidebar (Sessions)** | `SidebarContent` `px-2.5`; a `SidebarGroup` nav row of `Button variant="ghost"` items (icon `size-4` at 72% ink, label `truncate`, `data-tour` markers); `ProfileRail` below with `edgeMask('x')` clipped edges; then scrolling sections: pinned, recents, projects, cron, messaging; each section headed by `chrome.tsx` primitives (`SidebarSectionMeta`, `SidebarRowShell`, `SidebarRowCluster`, `SidebarRowBody`, `SidebarRowLead`, `SidebarRowLabel`, workspace divider with `DisclosureCaret` + hairline rule); rows via `RowButton`, `session-row.tsx`, `virtual-session-list.tsx`, `load-more-row.tsx`; `SearchField` for the session filter; `DropdownMenu` from `filter-menu.tsx`; card rows (`$sidebarCardRows`) use `min-h-[3.375rem]`. |
| **Transcript** | `thread/index.tsx` > `ThreadMessageList` > (`user-message` sticky + bubble `rounded-xl bordered`, `assistant-message` with `aui_assistant-message-content`, `system-message`, `agent-delivery`) with `tool/*` rows, `clarify/*` inline widgets wearing `WIDGET_SHELL_CLASS`, `turn-activity`, `timeline-rail`, `show-earlier` pill (`rounded-full border-border/65 bg-(--composer-fill) px-3 py-1 text-xs`). |
| **Composer dock** | `composer/index.tsx` grid: leading menu column (`+` menu, model pill, voice `FanMenu`), `composer-rich-input` (contenteditable, owns `--conversation-*` derivation), trailing controls column (`--composer-control-size` 24px / primary 26px, gap 4px); above it `ComposerStatusStack` (todos expanded, everything else collapsed, `StatusRow` + `StatusDismissButton` + `StatusPendingIcon`), `CodingStatusRow` (git branch/PR/#), queue panel, attachments row; a centered ridge toggles the whole drawer. |
| **Right rail** | `right-sidebar/index.tsx` (`aside`: `border-l`/`border-r` `--ui-stroke-secondary`, `bg-(--ui-sidebar-surface-background)`, `pt-(--titlebar-height)`, inset white 18% highlight hairline) with a 28px vertical restore rail (`w-7`) when minimized and a tab strip (`PaneTabStrip`) of preview tabs: `preview-pane.tsx` (webview + `preview-browser-bar.tsx`), `preview-file.tsx` (code/diff, `--file-tree-row-height` 22px tree, review `ROW_HEIGHT` 24), `preview-console.tsx`, `preview-artifact.tsx`, review `index.tsx` + `file-tree.tsx`, terminal panes (`xterm` with its own ANSI theme, `--ui-terminal-surface-background`). |
| **Statusbar** | `StatusbarControls` footer `h-5`: left group (gateway/connection switcher via `connection-switcher.tsx`, profile dropdown when the rail is hidden) and right group (model pill, context usage, command center, version/updates, resources); items are `Button`/`a`/`button` with `STATUSBAR_ACTION_CLASS` or an arbitrary-node escape hatch; menus open `side="top" sideOffset={8}`, `w-56`, `align` from `item.menuAlign ?? 'start'`; a `ContextMenu` on the bar itself offers customize/hide. |
| **Route overlays** | `OverlayView` card wrapping `OverlaySplitLayout` (`grid-cols-[13rem_minmax(0,1fr)]`) with `OverlayNav` + `OverlaySidebar`/`OverlayMain`; used by Settings, Command Center, Cron, Profiles, Agents, Starmap; `edgeBadge` straddles the top border; `OVERLAY_TOP_CLEARANCE` for content beside the X. |
| **Dialogs / menus / tips** | `Dialog`/`DialogContent` (+ banner, + `fitContent`), `ConfirmDialog`, `DropdownMenu`/`Select`/`Popover`/`Command` all through `menu.ts`, `Tip`/`OverflowTip`/`TipKeybindLabel` through `tooltip.tsx`, `context-menu.tsx` on rows, `notifications.tsx` region at `top-[calc(var(--titlebar-height,34px)+0.75rem)]` `w-[min(28rem,calc(100%-2rem))]`, `find-bar.tsx` at `right-4 top-[calc(var(--titlebar-height,34px)+0.5rem)]`. |
| **Onboarding / boot / setup** | Dedicated landing with the long-operation `Loader` + static `BrandMark` under reduced motion, `intro-copy.css` (`--composer-width: 36rem`, `[data-setup-chat]` larger base sizes 0.9375/0.75/0.8125rem with 1.375rem leading), `decode-text.tsx` for CONNECTING, distinct install/onboarding/connecting/boot-failure/reauthentication states on the boot z-rungs 1200-1500. |
| **HUD mode** | Same app with the frame removed: `[data-hud-shell]` drops every `backdrop-filter` app-wide except the single `[data-hud-glass]` element, flattens the composer to `--composer-fill: var(--dt-card)`, `rounded-xl` on the bar with `rounded-t-0` variants per edge, tightens `--turn-block-gap` to 0.375rem and `--paragraph-gap` to 0.4rem, sets `--thread-viewport-height: 100%` and `--thread-last-message-clearance: 0.25rem`. |

---

## 7. CSS-only features that need a native reimplementation decision

| # | Feature | Where | Why it is a problem on RN | Suggested decision |
| --- | --- | --- | --- | --- |
| 1 | **`color-mix(in srgb, A p%, B)`** - the entire token system | ~60 declarations in styles.css:297-420, 411-415, 625-634; also inside component `className` strings (button outline inset ring, dialog info banner, zone editor, launch cards, `WIDGET` fills) | Hermes RN has no `color-mix`. Every `--ui-*` token is a formula, not a literal. | Resolve at runtime in JS: a `mixSrgb(hexA, pct, hexB)` helper mirroring CSS's gamma-space interpolation, then feed a `useTheme()` context of concrete rgba values. The 13 `--theme-*-accent-mix` ratios plus the target color must be data, not code, so a retint still re-derives everything. |
| 2 | **`color-mix(..., transparent)` alpha text tokens** | `--ui-text-primary/secondary/tertiary/quaternary`, `--conversation-scaffold-text/meta` (styles.css:364-374) | RN has no stacked-alpha tokens. | Represent as `{ color, alpha }` pairs or pre-composited rgba; `--ui-text-secondary` = 74% ink is the workhorse label color. |
| 3 | **`backdrop-filter: blur(0.125rem)` scrim** | `dialog.tsx:33` (`DialogOverlay`), `overlay-view.tsx:71`, `zone-editor.tsx:404` (blur 6px) | RN has no backdrop-filter; `expo-blur` `BlurView` with `intensity`/`tint` is an approximation and is expensive on Android over live content. | Ship the `bg-black/22` scrim everywhere (it is the legibility layer); make the 2px frost optional, off by default on Android. |
| 4 | **`backdrop-filter: blur(0.75rem) saturate(1.08)` on menu surfaces** | styles.css:1412-1421 (`[data-slot='dropdown-menu-content']`, `select-content`, `dialog-content`, `thread-timeline-popover`) plus `backdrop-blur-md` in `menu.ts:11` | Same. Note the fill is already 96% opaque, so the blur contributes texture only. | Drop the frost; keep the 96% fill + `--ui-stroke-secondary` + `shadow-md`. |
| 5 | **Native window glass / vibrancy** | `store/translucency.ts` (per DESIGN.md:191-198), `[data-hermes-glass]` blocks styles.css:637-770, `--translucency-glass-keep`, `--glass-rail-edge` gradient, defaults **29% tint, sidebar-only, fade 0** | Electron-only: the material is composited below web contents and CSS blur cannot reach it. | Decision required. Options: (a) drop glass entirely on mobile; (b) use `expo-blur` over a wallpaper only for the sidebar; (c) keep the tokens (`--translucency-glass-keep`) so a future platform material can plug in. Recommend (c) for schema parity, (a) for v1 rendering. |
| 6 | **`prefers-reduced-transparency` blanket gate** | styles.css:58-65 - kills every `backdrop-filter` when the OS asks | No RN equivalent. | Read the platform accessibility flag (`AccessibilityInfo.isReduceTransparencyEnabled` on iOS) and skip blur. |
| 7 | **`prefers-reduced-motion` blanket gate** | styles.css:23-33 - `animation-duration: 0.01ms !important`, `animation-iteration-count: 1`, `transition-duration: 0.01ms`, `scroll-behavior: auto` | RN respects the platform flag only when you check it. | Use `AccessibilityInfo.isReduceMotionEnabled` + `useReducedMotion()` and make every animation skip to its end state. |
| 8 | **`oklch(from var(--x) l 0 h)` relative color syntax** | `--dt-scrollbar-thumb` (styles.css:462) - desaturates the accent to a grey thumb keeping its lightness | No RN support. | One-off OKLCH conversion at theme-apply time, or just use a grey derived from `--ui-base`. |
| 9 | **OKLCH math (`mixOklab`, `ensureContrastOklch`, `hexToOklch`, `readableInk`, `harmonize`)** | `src/themes/color.ts`, `retint.ts`, `context.tsx:121-149, 330, 341` | Pure JS/TS - ports directly. | Port `themes/color.ts` verbatim (it is dependency-free) so accent retinting, `--dt-primary-solid`, `--ui-success` and `synthLightColors` stay byte-identical. |
| 10 | **`conic-gradient` / `radial-gradient` ornaments** | pet egg (`styles.css:2668-2731`), `.arc-border::before` ring (styles.css:1216-1228), stream glow | RN has `expo-linear-gradient` only. | These are pet/HUD/decoration only; safe to omit for a first mobile client. |
| 11 | **`mask-image` gradient fades** | tab close label fade (styles.css:1747-1752), streaming code-card bottom fade (styles.css:2199-2200), `edgeMask()` in `fade-scroll.tsx`, `fade-text.tsx` | RN has no `mask-image` on plain views. | Use `expo-linear-gradient` overlays (color-to-transparent) which is what they approximate visually anyway. |
| 12 | **`contain: layout paint`, `overscroll-behavior-y`, `scroll-behavior`, sticky positioning** | thread and list containers (thread/index.tsx:184, list.tsx:1567; user-message.tsx:55 sticky) | RN scroll/sticky semantics differ. | Sticky user prompt needs a manual pinned-header implementation (`use-sticky-prompt-clip.ts` is the desktop logic to mirror). |
| 13 | **`-webkit-app-region: drag` / `no-drag`** | titlebar and HUD | Electron-only. | Native header/nav bar; no token needed. |
| 14 | **CSS `@custom-variant compact (@media (max-height: 768px))`** | styles.css:92-93, used by the sidebar section flattening | Tall vs short viewport behavior. | `useWindowDimensions().height < 768` branch. |
| 15 | **`@container` queries** | e.g. billing rows `@2xl:w-[220px]` (settings/billing/index.tsx:371) | RN lacks container queries. | Use measured width via `onLayout`. |
| 16 | **xterm.js / Shiki / KaTeX / Mermaid / webview / `sandboxed-frame`** | terminal panes, code cards, math, diagram embeds, browser preview | No RN equivalents. | Explicitly out of scope for v1; render code as monospace text blocks and links as open-in-browser. |
| 17 | **`--chat-text-scale` multiplier applied through `calc()` on 5 tokens** | styles.css:1722-1729, store/chat-text-scale.ts | `calc()` string multiplication does not exist in RN `StyleSheet`. | Do the arithmetic in JS (13px x scale) and expose the 5 derived numbers from the theme context; the preset list `[90,100,110,125,150,175]` with default 110 ports as data. |
| 18 | **Global focus-ring reset + `:focus-visible` ring** | styles.css:1393+, `ring-[0.1875rem] ring-ring/50` | RN has no focus ring, but has press/ripple states. | Replace with `Pressable` opacity/scale feedback; keep the 3px/50% ring values for tablet + keyboard (iPadOS) if the client supports hardware keyboards. |

---

## 8. Where a mobile client must differ (not just reimplement)

1. **Hover-dependent affordances are the default, not the exception.** Everything from `Tip` (200ms) to the `+` action buttons to `DisclosureCaret` (rest opacity 0) is revealed by hover or focus. On touch there is no hover: each of these needs an always-visible or long-press alternative. DESIGN.md:243-254 explicitly says tips exist "only when hover teaches something new" - on touch, the answer is usually "show it".
2. **`--titlebar-height` is structurally 0 inside the shell.** `controller.tsx:822` zeroes it for content, and the pane tree forbids header bands inside zones (`tree/index.tsx:58-70`). A mobile client has no native titlebar band to clear, so every `calc(var(--titlebar-height) + X)` collapses to `X`; do NOT port the 34px offsets.
3. **The radius scale must be ported as data.** 2px/2.4px/3.2px radii read as "square" on a phone at 3x density. Decide explicitly: keep desktop parity (square) or scale up. Do not silently adopt RN/shadcn defaults of 8-12px, which would look like a different product.
4. **UI Scale (whole-window zoom) does not exist on mobile.** Only the Chat Text Size multiplier is meaningful, and it must keep affecting conversation + composer text only, not sidebar/settings/pane geometry (DESIGN.md:433-441).
5. **Multi-pane is the desktop's core geometry** (splits, tab strips, drag-to-dock, floating panes, 28px restore rails). A phone is a single-column surface. The `LayoutTreeRoot` model is not portable; pick one pane at a time with a switcher, and keep the app shell's flex-column order (content -> statusbar) intact.
6. **Statusbar items are contributions with `leftItems` / `items` groups and a context menu** (`statusbar-controls.tsx:46-122`). On a phone, 20px is below the minimum touch target (44pt); the bar needs either a taller variant or a collapse to a single status chip.
7. **`SIDEBAR_DOCK_MIN_WIDTH_PX = 640` has no meaning** on a 390pt phone. The overlay-rail behavior (hover-reveal edges at `w-1.5`, `narrow-overlays.tsx:193`) is the closer analogue.
8. **i18n catalogs must ship.** 10 locales exist (`en`, `zh`, `zh-hant`, `ru`, `ja`, `es`, `fr`, `ar`, `de` + topic splits; `src/i18n/`). DESIGN.md:624-634 makes updating all of them a hard rule.
9. **`--spacing-mul` (`--dt-spacing-mul`) is an unused but declared knob** (styles.css:154, 494). If the port adds density settings, that is the intended seat.
