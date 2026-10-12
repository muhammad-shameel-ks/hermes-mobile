# Right-hand panes (terminal / preview / files / review) on Android RN: feasibility

Scope: the desktop's four right-hand surfaces and their server side, and what an Expo dev-client
Android app can do with each. Read-only investigation; no repo was modified.

Surfaces actually inspected:

| Surface | Desktop location | Server side |
|---|---|---|
| Terminal | `apps/desktop/src/app/right-sidebar/terminal/**` (user shell + read-only agent tabs) | `/api/pty`, `/api/console` in `hermes_cli/web_routers/chat_ws.py`; node-pty in Electron main |
| Preview | `apps/desktop/src/app/chat/right-rail/preview-*.{ts,tsx}` | `/api/fs/read-data-url`, `/api/files/read`, `/api/media` |
| Files | `apps/desktop/src/app/right-sidebar/files/**`, `file-actions.tsx` | `/api/files/*`, `/api/fs/*` (`hermes_cli/web_routers/files.py`) |
| Review/diff | `apps/desktop/src/app/right-sidebar/review/**`, `components/chat/diff-lines.tsx` | `/api/git/review/*` (`hermes_cli/web_routers/git.py`) |

The browser implementation of the PTY client is `web/src/pages/ChatPage.tsx` + `web/src/lib/pty-*.ts`.
Everything below that is labelled "the web client" is that pair.

## 0. Verdict table

| Pane | Fidelity ceiling on Android RN | Packages | Hard blockers | Phase-1? |
|---|---|---|---|---|
| **Terminal** (`/api/pty` = the Hermes Ink TUI chat, not a shell) | Bytes-exact ANSI reproduction is achievable (xterm.js is the same engine, same version the desktop and web pin) but the *input* side is degraded: no Esc/Ctrl/arrow chords from a soft keyboard, Android IME composition quirks, keyboard-overlay resize dance. It is the browser Chat tab ported into a WebView, never the desktop's shell terminal. | `@xterm/xterm@6.0.0` + addons (fit/webgl/serialize/unicode11/web-links) inside `react-native-webview@13.16.1` (SDK 57 pin) | 1) The dashboard's `/api/pty` refuses non-loopback peers on a loopback bind (4408), so a phone needs a non-loopback or gated server. 2) Android IME + xterm in a WebView is the known-broken path (open upstream issues). 3) Hosting the xterm bundle means an asset + a bridge, so it is a mini-app inside the app. | **No** for phase 1. Ship the read-only agent terminal (`agent.terminal.output` over `/api/ws`, `process.list`) instead; it is a FlatList, not a terminal emulator. |
| **Preview** (URL / HTML file / artifact) | Web content renders in a real Chromium WebView, so *rendering* fidelity is high. The security posture is where fidelity is lost: RN WebView has no `will-attach-webview` preload scoping, no `setWindowOpenHandler`, and the one flag that approximates popup denial (`setSupportMultipleWindows={false}`) is itself a documented UXSS exposure. | `react-native-webview`, `expo-web-browser@57.0.3`, `expo-image@57.0.5`, `expo-video@57.0.5`, `expo-audio@57.0.5`, `react-native-pdf@7.0.5` + `react-native-blob-util@0.25.1` | Untrusted remote HTML must *not* share the WebView that hosts the terminal or the dashboard token. The Electron hardening has no line-for-line RN equivalent; it needs a re-derived policy plus a bridge for `preview.act` / `preview.read`. | **Partial yes.** Phase 1 can ship artifacts + local file previews (image/PDF/text) and `Linking.openURL` for URLs. Arbitrary URL browsing with a trusted-click bridge is phase 2+. |
| **Files** (`/api/files`, `/api/fs`) | Full REST parity is reachable: browse, read text, read data URL, mkdir, upload (base64 or multipart), delete, download. What a phone *gains* (share sheet, OS "open with", camera/document picker) and what it *loses* (reveal-in-file-manager, drag-and-drop move, inline rename UX) is small. | `expo-file-system@57.0.7`, `expo-sharing@57.0.23`, `expo-document-picker@57.0.3`, `expo-image-picker@57.0.20`, `expo-clipboard@57.0.2`, `expo-intent-launcher@57.0.1`, `expo-media-library@57.0.5` | None protocol-side; the pane is already remote-aware. Sensitive-path denylist and the managed-root policy come free from the server. | **Yes.** Highest value per unit of work of the four. |
| **Review / diff** | Unified diff text arrives as a plain string (`{"diff": "..."}`) so the *data* is fully available; the desktop's shiki token colouring and 200-line virtualized window are reproducible in RN (native Oniguruma engine exists) but are the expensive 20%. Row-level diff (add/context/remove tint + line numbers) is cheap and matches the desktop's information density. | `diff@9.0.0` (or nothing: server sends unified text), `parse-diff@0.12.0`, `react-native-shiki-engine@0.3.12`, optional `@shopify/react-native-skia` (SDK pin 2.6.2) | Mutations (stage/commit/push/PR) are the risky half and were already flagged high-risk on mobile by the Kotlin prior art. Read-only diff needs no new server work. | **Yes, read-only.** `/api/git/review/list` + `/api/git/review/diff` + `/api/git/file-diff` only; no stage/commit/push in phase 1. |

Prior art to respect (shipped Kotlin app, same machine):
- Terminal = **DESKTOP-ONLY**: "A real PTY emulator plus a software keyboard that can send Esc, Ctrl-C, arrows. The phone keyboard cannot drive a shell. Refer to Termux for this" (`/home/shameel/hermes-app/docs/PARITY-PLAN.md:141`), and "Do not build a degraded version. A half-working terminal on a phone is worse than Termux" (`PARITY-PLAN.md:499`).
- Preview = **ADAPTED, size L**: "Needs an embedded WebView with a JS bridge and a remote-control protocol. Effectively building a second app" (`PARITY-PLAN.md:142`).
- Host filesystem browser = **DESKTOP-ONLY** (`PARITY-PLAN.md:156`); artifacts page = AS-IS `M` (`PARITY-PLAN.md:157`).
- `/api/pty` was never probed by that app ("Not probed; needs `ptyprocess`", `PLATFORM-API.md:509-510`).

This report reaches the same conclusion for the terminal, but with a narrower reason: the blocker is
the *input* modality and the peer/origin gate, not the byte protocol, which is trivial.

---

## 1. Terminal: what `/api/pty` actually speaks

### 1.1 The server handler

`/api/pty` is a WebSocket route: `@router.websocket("/api/pty")` at
`hermes_cli/web_routers/chat_ws.py:538`. Before accepting it runs `_ws_gate` (`chat_ws.py:126`):

| Gate | Close code | Source |
|---|---|---|
| embedded chat disabled | 4404 | `chat_ws.py:137` |
| auth failure (bad token / invalid ticket / unusable internal cred) | 4401 | `chat_ws.py:144` |
| Host or Origin mismatch (DNS-rebinding guard) | 4403 | `chat_ws.py:150` |
| peer IP not allowed | 4408 | `chat_ws.py:156` |

The reasons are clamped to RFC 6455's 123-byte limit by `_ws_close_reason` (`chat_ws.py:110-121`);
the reason string is machine-readable and the web client logs it but never shows it
(`web/src/lib/pty-close-copy.ts:8-12`).

Peer rule that matters for a phone: on a loopback bind, only loopback peers (`127.0.0.1`, `::1`,
`localhost`) pass; a LAN peer is refused with 4408 unless the server is bound non-loopback or is in
gated mode (`hermes_cli/web_server_chat.py:144-161`). Host check: the `Host` header must equal the
bound host, or any host when bound to `0.0.0.0`/`::`
(`hermes_cli/web_server.py:602-626`). A missing `Origin` header is accepted
(`web_server_chat.py:180-182`), so a non-browser client that sends no Origin is fine. [INFERENCE]
React Native's OkHttp-backed `WebSocket` sends no `Origin` and sets `Host` from the URL, so the
only gate that can bite is the loopback peer rule.

Auth (`web_server_chat.py:250-348`): loopback/`--insecure` mode uses `?token=` compared in constant
time; gated mode uses a single-use browser-minted `?ticket=` with a 30s TTL, a process-lifetime
`?internal=`, or a `?token=` that verifies as a user session token through the same
`_verify_access_token` seam the REST bearer leg uses (so a "token mode" remote connection works).
The web client mints the ticket per connect: `buildWsAuthParam()` returns `["ticket", ticket]` when
`window.__HERMES_AUTH_REQUIRED__` else `["token", ...]` (`web/src/lib/api.ts:285-297`).

### 1.2 Frame format

Binary, unframed, raw PTY bytes. There is no message envelope.

| Direction | Frame | Evidence |
|---|---|---|
| server -> client | `ws.send_bytes(chunk)` per PTY read, one frame per read (`os.read(fd, 65536)`) | `hermes_cli/pty_session.py:102` (keep-alive drain), `hermes_cli/web_server_chat.py:63-93` (`_legacy_pump`) |
| server -> client, one-off | JSON **text** frame `{"type":"resume","id":<session_id>}` when the server resolved the channel's active-session marker and the client did not ask for `?resume=` | `chat_ws.py:573` |
| server -> client, failure | **text** frame, red ANSI banner, then close 1011 | `chat_ws.py:452-457` (`_pty_fail`); Windows/POSIX-missing variant at `chat_ws.py:551-556` |
| client -> server | raw bytes; the handler accepts either `bytes` or `text` frames and encodes text to UTF-8 | `chat_ws.py:492-497`, `web_server_chat.py:111-115` |
| client -> server, resize | text (or any) frame whose *entire* content is `\x1b[RESIZE:<cols>;<rows>]` | below |

Chunking is real: the resume sanitizer exists because "A CSI escape, a UTF-8 code point, *and* a
long blank-line run can each straddle a frame boundary"
(`web/src/lib/pty-resume-sanitizer.ts:10-13`). Any client must be tolerant of split escape
sequences; only the resize frame is content-matched.

### 1.3 The resize escape

`_RESIZE_RE = re.compile(rb"\x1b\[RESIZE:(\d+);(\d+)\]")` (`hermes_cli/web_server_chat.py:43`).
It is consumed by the server and never written to the child, but only when it matches the whole
frame: `match = _RESIZE_RE.match(raw); if match and match.end() == len(raw): session.bridge.resize(...)`
(`chat_ws.py:501-503`, legacy path `web_server_chat.py:118-121`). So a user *typing* that byte
sequence followed by other bytes is not swallowed. Client side sends it on every xterm resize
(`web/src/pages/ChatPage.tsx:1532`) and once immediately after open so Ink has a size on first paint
(`ChatPage.tsx:1272`).

### 1.4 Keepalive

There are no WebSocket ping frames from either side (browsers cannot send them), so the app-level
keepalive *is* the resize frame: `PTY_KEEPALIVE_INTERVAL_MS = 20_000`, documented at
`web/src/lib/pty-reconnect.ts:29-35` and armed in `ChatPage.tsx:1280`. Server side, a quiet PTY
costs one idle read per 200 ms (`_PTY_READ_CHUNK_TIMEOUT = 0.2`,
`web_server_chat.py:44`) plus a 50 ms idle backoff (`web_server_chat.py:49`).

### 1.5 Close codes (complete contract)

| Code | Meaning | Client action | Evidence |
|---|---|---|---|
| 4401 | login expired / bad credential before accept | reload banner | `pty-close-copy.ts:21-24` |
| 4403 | page address does not match the server | no action | `pty-close-copy.ts:24-27` |
| 4404 | this server has no terminal chat | update/reload | `pty-close-copy.ts:28-31` |
| 4408 | server only accepts chat from the machine it runs on | no action | `pty-close-copy.ts:32-35` |
| 1011 | server could not start the chat (no node, bad profile, no POSIX PTY) | show restart, reason already printed in the terminal | `ChatPage.tsx:1424-1429`, `chat_ws.py:452-457` |
| 4409 | superseded by a newer tab that attached the same token | stay quiet | `pty_session.py:15`, `ChatPage.tsx:1441-1444` |
| 4410 | the agent process exited (real end) | ended affordance | `pty_session.py:14`, `ChatPage.tsx:1435-1440` |
| 1013 | PTY input stalled, socket recycled | reconnect | `web_server_chat.py:54-59` |
| 1001/1006/1012 | transient transport drop or server restart | reconnect ladder | `ChatPage.tsx:1445-1457` |

Reconnect ladder: base 250 ms, cap 3000 ms, 5 attempts (`pty-reconnect.ts:26-29`), plus a
CONNECTING timeout of 8000 ms because a mobile socket can wedge after a radio handoff and never
fire `onclose` (`pty-reconnect.ts:13-15`), and a 1 s throttle so a burst of
visibilitychange/pageshow/focus/online on tab-return collapses into one reconnect
(`pty-reconnect.ts:8-10`). Resume replay then suppresses `ESC[K`/`ESC[X` for 30 s
(`pty-reconnect.ts:49-54`, `pty-resume-sanitizer.ts`).

### 1.6 Keep-alive / attach (what survives a window that closes)

`?attach=<opaque token>` opts into a PTY that outlives the socket: `PTY_REGISTRY` keeps
`ttl=30*60` s, `max_sessions=16`, a 1 MiB ring buffer (`web_server_chat.py:50-51`), replays the
buffer on attach and then asks the TUI for one full redraw with `TUI_FORCE_REDRAW = b"\x0c"`
(`pty_session.py:16`, `pty_session.py:127-149`). Reattach keys are `token\0profile\0resume`
(`pty_session.py:56-65`). The web client isolates its token per browser tab with sessionStorage
plus a Web Lock because two tabs sharing a token makes the second steal the first's terminal
(`web/src/lib/pty-attach-token.ts:1-63`). [INFERENCE] On RN this whole mechanism is optional: a
phone can connect without `?attach=` and take the legacy 1:1 path
(`chat_ws.py:615-631`), losing only background survival.

### 1.7 What the PTY actually runs

Not a shell. `argv, cwd, env = await _resolve_chat_argv_async(...)` (`chat_ws.py:590`) is the same
resolver the dashboard uses, i.e. the Hermes TUI child (`node`/Ink), plus `HERMES_TUI_RESUME`, the
sidecar URL and the profile home. The Windows-unavailable message says it plainly: "the embedded
terminal requires a POSIX PTY" (`chat_ws.py:551-556`). Resume, cwd and profile are query params
(`chat_ws.py:569-608`); a `?channel=` marker file makes the next connection resume the same chat
(`chat_ws.py:513-537`).

By contrast the desktop's terminal *pane* never touches `/api/pty`: it spawns a real login shell
through `node-pty` in the Electron main process (`apps/desktop/electron/terminal-ipc.ts:11-23`),
with SSH targets and a per-tab registry; tab kinds are `'user' | 'agent'`
(`apps/desktop/src/app/right-sidebar/terminal/terminals.ts:131`), where `agent` tabs are read-only
views fed by `agent.terminal.output` events (`agent-terminal-stream.ts:1-2`,
`tui_gateway/session_notifications.py:823-838`, contract at `tui_gateway/contracts/events.py:617`).
So "the desktop terminal pane" has **no** REST/WS equivalent at all. The only server-side terminal a
phone could reach is the chat TUI - and, separately, a read-only tail of agent background processes
over the gateway.

`/api/console` (`chat_ws.py:299`) is the other half: a curated in-process command engine exchanging
JSON frames (`{"type":"ready"|"output"|"complete"|"error"|"clear"|"confirm_required"}`, prompt
`hermes> `, 60 s command timeout, `chat_ws.py:176-196` and `_ConsoleSender` at `chat_ws.py:211-270`)
with the same `_ws_gate`. It never spawns a PTY (`chat_ws.py:176-180`). This is the only terminal-ish
surface that is plausibly *better* on a phone than a PTY, because it is a line protocol with a
structured result, not a screen buffer.

### 1.8 Hosting it in RN: the three options

**A. `react-native-webview` + the real xterm.js.** This is the only route that reproduces the pane
byte-for-byte, because the engine is identical: the desktop pins `@xterm/xterm 6.0.0` with
`addon-fit 0.11.0`, `addon-webgl 0.19.0`, `addon-serialize 0.14.0`, `addon-unicode11 0.9.0`,
`addon-web-links 0.12.0` (`apps/desktop/package.json:108-113`); the web app pins the same versions
minus serialize (`web/package.json:23-27`). xterm's own support statement is "only modern browsers
are supported officially. Specifically the latest versions of *Chrome*, *Edge*, *Firefox*, and
*Safari*" (`@xterm/xterm@6.0.0/README.md:89-91`); the WebGL addon is a "WebGL2-based renderer" that
requires xterm v4+ (`@xterm/addon-webgl@0.19.0/README.md:3`). Android System WebView is Chromium and
is updated through Google Play (Android 10+ can even be switched between WebView channels via
developer options: <https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/prerelease.md>),
so a modern device is a supported engine; WebGL works in it but WebGL2 extension coverage varies by
device, and the standing advice is to test WebGL capability *inside the WebView* being shipped
rather than in Chrome (<https://stackoverflow.com/questions/46278911/webgl-in-android-webview>).
Mitigation already in the tree: the addon exposes a `webglcontextlost` event and disposing is the
documented handling (`@xterm/addon-webgl@0.19.0/README.md:26`), and the web client already keeps a
DOM-renderer fallback whose colours resolve to the same token as the WebGL background
(`apps/desktop/src/app/right-sidebar/terminal/instance.tsx:16-22`).

Costs and risks of A, all of which are *input*, not output:
- xterm's core input capture is a hidden textarea; on Android that is a long-standing problem
  area: "xtermjs uses texarea element to capture keys and it doesn't work well with Android:
  numerous workarounds" (<https://github.com/xtermjs/xterm.js/issues/3025>), "Erratic text output
  from typing into xterm console on Chrome on Android devices" (open,
  <https://github.com/xtermjs/xterm.js/issues/3600>), "Accommodate predictive keyboard on mobile"
  (<https://github.com/xtermjs/xterm.js/issues/2403>), and specifically for the RN WebView host
  "Inconsistent term.onData Event Behavior Between iOS and Android in React Native WebView Terminal"
  (open, <https://github.com/xtermjs/xterm.js/issues/5108>).
- RN WebView keyboard/scroll interactions are also a known mess: "Keyboard overlaps on webview in
  android" (<https://github.com/react-native-webview/react-native-webview/issues/1065>), "WebView
  content scrolls up and becomes invisible when typing input on Android with New Architecture"
  (<https://github.com/react-native-webview/react-native-webview/issues/3848>), "Keyboard can't show
  after input some special characters"
  (<https://github.com/react-native-webview/react-native-webview/issues/410>).
- Bundle plumbing: xterm must be served to the WebView (asset + `source={{ html, baseUrl }}` or an
  Android asset copied by a config plugin) and the socket should stay *inside* the WebView, because
  bridging binary frames out to RN would mean base64-in-JSON per frame. Keeping the socket in the
  WebView is also what lets the web client's IME code be reused verbatim (1.9). [INFERENCE on the
  asset mechanism; the socket-placement argument is mine, not documented]
- One existing wrapper exists and is nearly useless: `@fressh/react-native-xtermjs-webview@0.0.8`
  ("React Native WebView that embeds xterm.js with sensible defaults and a bridge for input and
  output"), peer-pinned to `react-native-webview 13.15.0` and `react 19.1.0`, last published
  2025-10-08. It predates both the SDK 57 pin (`13.16.1`) and the current `14.0.1`, so it is a
  reference implementation, not a dependency.

**B. A native RN terminal widget.** There is none that is usable. `npm view react-native-terminal`
and `@quidone/react-native-terminal` both 404 (checked against the live registry); the only hits for
"react native terminal" / "react native pty" are `node-pty` and friends, which are Node-only. The
real native option is Termux's own view: Termux publishes `terminal-emulator`, `terminal-view` and
`termux-shared` as reusable libraries for third-party apps
(<https://github.com/termux/termux-app/wiki/Termux-Libraries>), and JitPack builds
`com.github.termux/termux-app` at `v0.119.0-beta.3` exposing exactly those three modules
(<https://jitpack.io/api/builds/com.github.termux/termux-app/latestOk>). Two consequences: it is a
*compiled Kotlin/Java* view, so RN needs a native module plus a new-architecture view manager, and
Termux is GPL-3.0 (the `com.termux:terminal-emulator` artifact is listed as GPL 3.0), which is a
copyleft decision for the whole app. That is a whole-product licensing question, not a pane
decision.

**C. Do not do it.** Ship the read-only agent terminal instead: subscribe to the gateway event
`agent.terminal.output` (`{process_id, chunk}`, `tui_gateway/contracts/events.py:617`) and
`terminal.close`, list processes with the `process.list` RPC
(`apps/shared/src/gateway-contract.generated.ts:5288`), and render the tail as monospace text. The
desktop's own bounded-backlog design is already the model for this and needs no terminal emulator
(`agent-terminal-stream.ts:20-35`: 256 KB per process, 24 processes / 2 MB total, LRU with the
mounted tab never evicted). On a phone this is a `FlatList` over a string, and it keeps `read`-only
semantics, which is also the safest thing to put in a phone user's hands. The one desktop feature
that has to be dropped is `read_terminal`, which is an agent->pane request (`terminal.read`, see
`server-requests.ts:703-713`) and would need the RN app to answer server requests to keep working.

### 1.9 Do the mobile IME fixes transfer?

Yes for option A, no for B and C - and this is the strongest argument for A if the terminal is built
at all.

The IME problem was solved in the browser, and the fix is *inside* the WebView, so it travels with
the xterm bundle unchanged:

- `MOBILE_REPLACEMENT_WINDOW_MS = 350` (`web/src/lib/pty-mobile-input.ts:6`) is the window after a
  mobile IME / `beforeinput` replacement event during which subsequent terminal input is treated as
  a candidate line replacement rather than a plain append; the window is armed in two places
  (`ChatPage.tsx:843`, `ChatPage.tsx:847`) and consumed at the `onData` path
  (`ChatPage.tsx:1503-1510`). The pure helpers (`replace a duplicated final word`, `Gboard
  re-emitted the final word`, `>=2-char word guard`) are in the same file
  (`pty-mobile-input.ts:28-45`, `:115`). All of it is DOM/xterm-shaped, not RN-shaped: it needs
  `inputType`, an `onData` stream and a tracked current line. Nothing about it depends on the host
  being a phone browser rather than an Android WebView.
- The composition/echo de-duplicator is the second half: `ECHO_WINDOW_MS = 80` and the delivered-text
  tracker that drops re-sends arriving through both the `compositionend` and `onData` channels
  (`web/src/lib/pty-composition.ts:14-16`, `:24-35`).
- Keyboard-overlay geometry: the fix is `window.visualViewport` maths,
  `inset = layoutHeight - vv.height - vv.offsetTop`, applied as bottom padding, which shrinks the
  xterm host, which fires the ResizeObserver, which sends the resize escape so Ink redraws the input
  line above the keyboard (`web/src/lib/keyboard-inset.ts:1-27`, `KEYBOARD_INSET_MIN_PX = 80` at
  `:32-34`). In an Android WebView, `visualViewport` exists and behaves like Chrome; whether the
  RN-side keyboard (a native window inset, not a browser event) reaches the WebView's
  `visualViewport` the same way is the open question. [INFERENCE] It should, because the WebView is
  laid out by the RN view hierarchy, but this must be verified on device before committing to A.
  The RN side has its own tool for this (`react-native-keyboard-controller`, SDK 57 pin 1.21.9) if
  the WebView path does not cooperate.

What does *not* transfer, ever: a phone keyboard has no Esc, no Ctrl-C, no arrows, no Alt. The web
client only ever needed Ctrl-based chords that a hardware keyboard provides
(`pty-keyboard-shortcuts.ts:1-45` resolves copy / delete-word-backward / delete-word-forward from
`ctrlKey`/`metaKey`; the desktop additionally binds ⌘C/⌘V and Ctrl+Shift+C/V and intelligent Ctrl-C
at `apps/desktop/src/app/right-sidebar/terminal/clipboard.ts:1-16`). An RN terminal therefore needs a
a dedicated key row (Esc, Tab, Ctrl, arrows) that sends escape bytes, which is exactly the "software
keyboard that can send Esc, Ctrl-C, arrows" the prior art called out as the reason not to build it
(`/home/shameel/hermes-app/docs/PARITY-PLAN.md:141`).

### 1.10 Terminal recommendation

Do not ship a PTY pane in phase 1. If one is ever built, the ordering is:
1. Read-only agent-terminal tail over `/api/ws` `process.list` + `agent.terminal.output`. Days, not
   weeks, no emulator, no IME risk, no input modality problem.
2. `/api/console` as a *structured* command surface if the phone wants to issue commands; it is a
   JSON line protocol with confirmation frames, which is far better suited to a soft keyboard than a
   screen buffer, and it is gated by the same pre-accept checks.
3. Only then, option A (WebView + xterm.js) for the chat TUI, with the key row above. And note the
   prerequisite: the server must not be loopback-bound (`web_server_chat.py:144-161`), which is a
   security decision the user must make, not a client feature.

---

## 2. Preview

### 2.1 What the desktop previews

Everything the pane can show is a `PreviewTarget` in one list: kind `'artifact' | 'file' | 'url'`,
with `previewKind` in `'binary' | 'directory' | 'html' | 'image' | 'missing' | 'pdf' | 'text'` and a
`renderMode` of `'preview' | 'source'` for HTML
(`apps/desktop/src/store/preview.ts:36-72`). Artifact targets have nothing behind them on disk or on
the network: "`url` is an id into the artifact registry, which owns the content"
(`store/preview.ts:44-47`).

Render paths:

| Target | Renderer | Posture | Evidence |
|---|---|---|---|
| `url` (and file targets that resolve to a URL) | Electron `<webview>` in partition `persist:hermes-preview`, `webpreferences=contextIsolation=yes,nodeIntegration=no,sandbox=yes`, no `allowpopups` | one guest per preview kind, steered with `loadURL` across URL changes | `preview-pane.tsx:1137-1140`, `:1106-1112` |
| remote HTML file (data URL, > 16 MiB refused) | `<iframe sandbox="" srcDoc>` with a DOMPurify-sanitized, CSP-pinned document | scripts, iframes, frames, objects and embeds removed; `default-src 'none'`; `href`/`ping` attributes stripped; `meta refresh` removed | `preview-pane.tsx:1542-1549`, `lib/local-preview.ts:10-12`, `:150-191` |
| generated artifact, HTML or SVG | `<iframe sandbox="allow-scripts" srcDoc>` (SVG additionally DOMPurify'd with the SVG profile) | opaque origin, scripts allowed | `preview-artifact.tsx:82-105` |
| image / PDF | inline render, PDF via the browser's viewer, image files refused above 512 KiB unless forced | | `preview-file.tsx:792-810`, `:848`, `:1170-1180` |
| text / code / markdown | Streamdown + KaTeX for markdown, shiki for code, chunked fixed-row window | | `preview-file.tsx:1-20`, `:52-56` |

Spell that out for a phone: **rendering** is a Chromium problem and a phone has Chromium (the
WebView). The *hardening* is Electron-specific.

### 2.2 What the desktop hardening actually is

1. Deny every `window.open`/`target=_blank`, unconditionally:
   `createWindowOpenHandler` returns `{action:'deny'}` and never opens `details.url`
   (`apps/desktop/electron/window-open-policy.ts:63-...`), because
   GHSA-9f4c-93c8-jc8g (CVE-2026-70608): "a sandboxed iframe without `allow-popups` and without a
   user gesture can still reach this handler via the OpenURL navigation path. If the handler opens
   `details.url` as a side effect, a malicious artifact forces the user's OS browser to an attacker
   URL. There is no fixed Electron 40.x" (`window-open-policy.ts:11-30`).
2. Trusted-click bridge instead: a guest preload installed *only* on the
   `persist:hermes-preview` partition by `will-attach-webview`
   (`apps/desktop/electron/main.ts:13639-13661`) installs a capture-phase click listener that
   requires `event.isTrusted === true` and `button === 0` before forwarding a resolved absolute
   `a[target="_blank"]` href to the host
   (`apps/desktop/electron/preview-guest-preload.ts:26-56`), on channel
   `preview-open-external` (`lib/preview-external.ts:10`). The comment states the reason: page
   script can `dispatchEvent` a synthetic click, "but it cannot forge `isTrusted`"
   (`preview-guest-preload.ts:29-32`).
3. The host admits only http/https and then routes through the audited `hermes:openExternal`
   channel (`preview-pane.tsx:1142-1158`, `lib/preview-external.ts:12`).
4. Guest console output is captured from the webview's `console-message` event and surfaced in the
   pane's console strip (`preview-pane.tsx:1160-1190`).
5. The pane is also the agent's camera: `capturePreview` grabs a rect from the guest
   (`preview-pane.tsx:464`), and `preview.read` extracts page text with
   `PREVIEW_READ_MAX_CHARS = 24_000` (`preview-reader.ts:24`).
6. Agent control arrives as server-initiated JSON-RPC requests `preview.act` / `preview.read`,
   routed to the window that owns the session; a window not showing the session declines explicitly
   so the tool does not wait for its deadline (`server-requests.ts:100-119`, `:543-560`,
   `:703-713`). `drive_preview` is active-session-only by design: "a background turn must never
   reach into the page the user is working in" (`server-requests.ts:544-548`).
7. `SandboxedFrame` is the in-app iframe primitive for plugin embeds: allowlist token sanitizer
   (`allow-scripts` default, `allow-same-origin` deliberately absent) and a scheme allowlist of
   `data:`/`http:`/`https:` (`components/ui/sandboxed-frame.tsx:9-46`, `:60-70`).

### 2.3 The RN equivalent

`react-native-webview` gives the same Chromium on Android, but a different control surface. Mapping:

| Electron behaviour | RN `react-native-webview` | Notes |
|---|---|---|
| `setWindowOpenHandler` deny-all | no equivalent prop; there is an `onOpenWindow` callback fired for `window.open`/`target=_blank` that receives `targetUrl` | `onOpenWindow` exists (`docs/Reference.md:620-647`); it is an *observer*, so denying means not acting on it, i.e. the same policy but advisory rather than enforced by the host |
| keep popups impossible by default | `javaScriptCanOpenWindowsAutomatically` defaults to **false** | `docs/Reference.md:915-917` |
| `setSupportMultipleWindows(false)` as a bludgeon | available, but documented as a vulnerability: "Setting this to `false` can expose the application to this vulnerability" (CVE-2020-6506 UXSS, a malicious iframe escaping into the top layer DOM) | `docs/Reference.md:1573-1577`. Do **not** use it. |
| guest preload + `will-attach-webview` partition scoping | `injectedJavaScriptBeforeContentLoaded` + `onMessage` (`window.ReactNativeWebView.postMessage`) | `docs/Reference.md:165-167`, `:200-249`, `:572-574`; there is no partition-scoped *preload* concept, and injected JS runs in the page's JS context, so a guest page can in principle interact with anything the injection leaves in the global scope [INFERENCE] |
| audited `hermes:openExternal` allowlist | `onShouldStartLoadWithRequest` allowlist returning `false`, then `Linking.openURL` in RN | `docs/Reference.md:792-810` |
| `file:` reachability blocked | `allowFileAccess` default **false**, `allowFileAccessFromFileURLs` default **false** | `docs/Reference.md:1231-1233`, `:1313-1315` |
| mixed content blocked | `mixedContentMode` default `never` | `docs/Reference.md:941-948` |
| opaque-origin sandboxed frame | `originWhitelist` (origin-only match, default `http://_`,`https://_`) plus RN's own `sandbox`-less WebView | `docs/Reference.md:721-723`; **there is no `sandbox` attribute equivalent**: an RN WebView is either isolated by `incognito` (`docs/Reference.md:1303-1305`) or shares cookies |

Minimum posture for a phone preview pane, derived from the above:
- a dedicated WebView instance, separate from any terminal WebView and from the app's own content,
  with `incognito` on unless a "real profile" consent flow is implemented (the desktop gates that
  behind `RealProfileConsentDialog`, `preview-pane.tsx:1526-1528`);
- no dashboard token, no `postMessage` handler that forwards URLs into `Linking.openURL` without an
  http/https allowlist and a trusted-click test;
- remote HTML files must go through a DOMPurify-equivalent (see the package note below) or be
  refused, because RN has no `sandbox=""` to fall back on;
- `setSupportMultipleWindows` left at its default, `javaScriptCanOpenWindowsAutomatically` left
  false, `onOpenWindow` ignored (so nothing opens), `onShouldStartLoadWithRequest` allowlisting
  http/https only.

Two honesty notes. First, "the RN WebView has no `isTrusted` equivalent in injected JS" is only true
in the sense that there is no *separate isolated world*: `event.isTrusted` is a DOM property and is
just as unforgeable inside an injected script as inside the Electron guest preload, but the injection
itself is visible to page script, so a page could remove the listener. [INFERENCE] Treat the bridge
as best-effort and keep the real boundary in RN: never trust a message, validate scheme and shape on
the RN side. Second, DOMPurify is DOM-targeted (`apps/desktop/src/lib/local-preview.ts:163-168` uses
`DOMParser`); in RN it needs a DOM implementation. A WebView-hosted sanitizer, or doing the
sanitize server-side, is the honest path. [INFERENCE: no RN-native DOMPurify port was verified in
this pass]

### 2.4 Preview recommendation

Phase 1: artifacts + local files only. `expo-image` for images, `react-native-pdf` (+
`react-native-blob-util`) or `expo-web-browser` for PDFs, `expo-video`/`expo-audio` for
`/api/files/stream`, text/code via a monospace viewer, "open in system browser" via
`Linking`/`expo-web-browser` for URLs. That covers the artifacts page (`PARITY-PLAN.md:157`) and the
common preview cases with zero untrusted-HTML surface.
Phase 2+: URL/HTML browsing in a `react-native-webview`, only after the posture above is written
down as its own policy doc, and only alongside `preview.act`/`preview.read` handlers if
`drive_preview`/`read_preview` are expected to work in mobile sessions (`server-requests.ts:703-713`).

---

## 3. Files: the REST surface and what a phone can do

The desktop is already split: locally it runs fs through Electron IPC, on a remote gateway it
mirrors the same calls over REST, "so the coding rail, worktree lanes, review pane, and branch ops
then act on the BACKEND repo where sessions actually run" (`apps/desktop/src/lib/desktop-git.ts:11-17`,
same pattern in `desktop-fs.ts`). The phone is *always* in that remote branch, so the phone's file
surface is exactly the REST the desktop already exercises.

| Endpoint | Method | Purpose | Notes | Source |
|---|---|---|---|---|
| `/api/files` | GET | list a managed directory | returns `{path, parent, entries[]}`, sorted dirs-first | `files.py:507-527` |
| `/api/files/read` | GET | file as `{name,path,size,mime_type,data_url}` (base64) | guarded by existence + regular-file + sensitive denylist + max size | `files.py:560-574`, `:533-547` |
| `/api/files/download` | GET | attachment (or inline for audio/video subresources) | authenticated by **`?token=`** as well as the session header, so a shell/browser-opened download works | `files.py:598-615` |
| `/api/files/stream` | GET/HEAD | inline media with HTTP **Range** support | media extensions only (415 otherwise), `nosniff` | `files.py:618-625`, `:576-597` |
| `/api/files/upload` | POST | JSON data-URL write | `overwrite` honoured, 409 otherwise | `files.py:646-654` |
| `/api/files/upload-stream` | POST | multipart chunked upload | temp file + atomic rename, 413 over the cap, constant memory, "no base64 inflation ... unlike the JSON data-URL endpoint that trips proxy body-size limits on large archives" | `files.py:656-718` |
| `/api/files/mkdir` | POST | create dir | | `files.py:721-729` |
| `/api/files` | DELETE | delete file/dir (`recursive`) | refuses the managed root and the fs root | `files.py:731-756` |
| `/api/fs/list` | GET | **hosted** fs browse (any path, hidden entries filtered, sensitive paths skipped) | this is the desktop's file tree source in remote mode | `files.py:762-791`, `apps/desktop/src/lib/desktop-fs.ts:109` |
| `/api/fs/read-text` | GET | hosted text read | | `files.py:792-833`, `desktop-fs.ts:123` |
| `/api/fs/write-text` | POST | hosted text write | | `files.py:834+`, `desktop-fs.ts:141` |
| `/api/fs/read-data-url` | GET | hosted binary as data URL | used for image/PDF preview | `files.py:907`, `desktop-fs.ts:165` |
| `/api/fs/git-root`, `/api/fs/default-cwd` | GET | repo root, default cwd | | `desktop-fs.ts:204`, `:212` |
| `/api/media`, `/api/media/proxy` | GET | media read and remote-media proxy | | `files.py:329`, `:373` |

What a phone can do with that, and what it should add:

| Capability | Server | Phone-side |
|---|---|---|
| Browse | `/api/fs/list` or `/api/files` | recursive `FlatList` with breadcrumbs; the desktop's tree also layers gitignore + nested-repo detection client-side (`app/right-sidebar/files/ipc.ts:1-15`), which is *not* in the API and would need porting or dropping |
| Preview text/code | `/api/fs/read-text`, `/api/files/read` | monospace viewer; the 512 KiB text preview cap is a client rule (`preview-file.tsx:57`) |
| Preview image | `/api/fs/read-data-url`, `/api/files/read`, `/api/files/download?token=` | `expo-image`; the desktop already builds token-bearing download URLs for remote gateways (`apps/desktop/src/lib/media.ts:249-263`) |
| Download to the phone | `/api/files/download` | `expo-file-system`: `File.downloadFileAsync()` now takes `onProgress` + `AbortSignal`, and `File.createDownloadTask()` exists (SDK 57 changelog, `expo-file-system/CHANGELOG.md:121-122`), so a ranged/large download is first-class |
| Share / open with | - | `expo-sharing.shareAsync`, `expo-intent-launcher` for Android ACTION_VIEW, `expo-media-library` for gallery saves |
| Upload | `/api/files/upload` (small) or `/api/files/upload-stream` (large) | `expo-document-picker` / `expo-image-picker` then multipart via `FormData`; the base64 route is the desktop's chat-image path (`files.py:470`) |
| New folder | `/api/files/mkdir` | text prompt |
| Delete | `DELETE /api/files` | typed confirm; destructive (the Kotlin prior art flags the whole destructive family this way, `PARITY-PLAN.md:153`) |
| Copy path / relative path | - | the desktop's two context items (`app/right-sidebar/file-actions.tsx:82-90`) are pure client work, and `expo-clipboard` closes it |
| Reveal in file manager, drag-and-drop move, inline rename | local-only or absent | the desktop hides reveal/rename/delete on a remote backend and keeps download + copy-path (`file-actions.tsx:61-99`) |

The best argument for the phone Files pane is not "parity with the desktop tree": it is that the
artifacts page is built by *scraping session messages* on the client
(`apps/desktop/src/app/artifacts/artifact-utils.ts:34-50`, regexes over `MEDIA:` tags, markdown
links and tool payloads, then `/api/sessions` + `/api/sessions/{id}/messages`), while the Files pane
talks to a real API. A phone that can browse, preview and *save* the agent's output files gets the
useful half of both.

Verdict: **phase 1 yes**, scoped to browse / read / preview / download / share / upload / mkdir. Leave
out delete in the first cut (cheap to add later, expensive to get wrong early) and leave out
move/rename.

---

## 4. Review / diff

### 4.1 What the desktop renders

Data: `/api/git/review/list` returns `{files:[{path, added, removed, status, staged}], base}`
computed from `git status --porcelain -z` + `--numstat` (`hermes_cli/web_git.py:252-280`), with three
scopes: `uncommitted` (default), `branch` (vs the trunk merge-base), `lastTurn` (since the turn's
captured HEAD) (`store/review.ts:64-70`, `web_git.py:256-272`). Per-file diff text comes from
`/api/git/review/diff` as `{"diff": "<unified diff>"}` (`git.py:130-139`,
`web_git.py:308-319`) and from `/api/git/file-diff` for the working-tree-vs-HEAD case
(`git.py:141-147`, `web_git.py:322-332`). Mutations are separate POSTs: `/api/git/review/stage`,
`/unstage`, `/revert`, `/commit`, `/push`, `/create-pr` (`git.py:172-199`).

UI: a changed-file list with two layouts (flat list sorted by path, or a folder tree that aggregates
descendant add/remove counts, `review/tree-data.ts:1-60`), a churn bar whose width is the file's
share of the largest change and whose colour is green when additions dominate (`review/churn-bar.tsx:36-51`),
a scope row, a ship bar (commit / commit+push / PR), and the diff itself. The diff renderer parses
unified diff text into add/context/remove rows (`components/chat/diff-lines.tsx:165-210`), can render
either a compact hunk view or the full file with real line numbers
(`diff-lines.tsx:213-240`), syntax-highlights with shiki (dark and light themes,
`diff-lines.tsx:1-16`), and virtualizes with a fixed-row window
(`diff-lines.tsx:596-605`). The review pane uses that highlighter by default
(`review/index.tsx:163-207`).

### 4.2 What RN can render

Data is already text, so this is a pure rendering question:

| Layer | RN plan |
|---|---|
| Parse | `parse-diff@0.12.0` or the desktop's own parse loop ported (it is ~80 lines, `diff-lines.tsx:114-240`); `diff@9.0.0` (jsdiff) is the fallback if the app needs to *produce* diffs |
| Rows | `FlatList`/`FlashList` with a monospace `<Text>`, add/context/remove tints, and per-row line numbers taken from the `@@ -a,b +c,d @@` headers. This is the whole of the desktop's information density. |
| Virtualization | Free: `FlatList` `getItemLayout` with a fixed row height, the RN equivalent of `useFixedRowWindow` (`diff-lines.tsx:596-603`) |
| Syntax colours | Optional. `react-native-shiki-engine@0.3.12` is "Shiki syntax highlighting for React Native. Zero bridge overhead with native Oniguruma regex engine" (npm description, peer `react`/`react-native`), i.e. exactly the missing piece for the shiki path. It is a native module, so a dev client (already required for this app). `shiki@4.5.0` and `@shikijs/engine-javascript@4.5.0` also exist, but the JS engine path in shiki is designed around a DOM-free pipeline plus a wasm or JS regex engine, and was not verified on Hermes. [INFERENCE: prefer the native RN engine; treat plain `shiki` as unverified] |
| Churn bar | Reproducible but not trivial: it is a masked, low-opacity monospace "rain" fill behind the row whose width is the file's share of the largest change and whose colour is a token variable chosen by which side dominates (`churn-bar.tsx:36-51`) |
| Canvas/GPU fallback | `@shopify/react-native-skia` (SDK 57 pin 2.6.2) if a custom renderer is ever wanted; not needed for text diffs |

The contrast guard is the honest caveat: the desktop's diff colours are CSS variables
(`diff-lines.tsx:279-290`), so the RN port must re-derive them from the same token set rather than
eyeball them, or the pane stops being token-exact.

Verdict: **phase 1 yes, read-only.** A phone showing "what changed" with per-file churn and a
unified diff is genuinely useful (`PARITY-PLAN.md:158`); stage/commit/push/PR is where prior art
warned it becomes dangerous ("High-risk on mobile. Pushing from a phone with no diff review is how
you ship a mistake", `PARITY-PLAN.md:159`) and where a typed confirmation plus review step is
mandatory. Also drop revert from phase 1.

---

## 5. Cross-cutting items that bind all four panes

1. **Reachability.** A loopback-bound dashboard refuses the phone at the WS gate (4408,
   `web_server_chat.py:144-161`) and its Host guard only relaxes on `0.0.0.0` (`web_server.py:602-626`).
   REST is reachable only on the same terms. Whatever the app does, the deployment story is either
   "gated auth mode" or "bound to the LAN", and that is a server-side decision the app must surface
   clearly rather than fail obscurely.
2. **Auth shape.** REST uses `X-Hermes-Session-Token` (loopback) or a cookie/bearer (gated); WS uses
   `?token=`/`?ticket=`/`?internal=` (`web_server_chat.py:250-348`); file downloads additionally
   accept `?token=` (`files.py:598-615`). An RN client should standardise on the header for REST and
   the query param for WS, and must never put a token into a WebView URL that also loads untrusted
   content.
3. **Nothing here needs a new server route.** Every pane above is already reachable from a remote
   client: the desktop's own remote mode is the proof (`desktop-fs.ts:70-212`,
   `desktop-git.ts:15-113`).
4. **The one server-side gap worth filing**: `/api/pty` runs the chat TUI and there is no route that
   exposes the desktop's *shell* terminal, and `/api/pty` is absent from the OpenAPI surface
   (`/home/shameel/hermes-app/docs/PARITY-PLAN.md:141`). That is fine, and it is the reason the
   terminal verdict is "no" rather than "yes with caveats".

---

## 6. Registry-verified package list

Everything below was read from the live npm registry in this session (versions as of 2026-10-12),
not from memory. Expo SDK 57 is pinned by `expo@57.0.28`; its bundled native modules are read from
<https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json>. Expo
SDK 57 ships React Native 0.86 and React 19.2 (<https://expo.dev/changelog/sdk-57>).

| Package | Version | Why / evidence |
|---|---|---|
| `expo` | 57.0.28 | base SDK; RN 0.86 |
| `expo-dev-client` | 57.0.20 | required: PKCE loopback, native modules (shiki engine, blob-util) |
| `react-native-webview` | latest 14.0.1, **SDK 57 pin 13.16.1** | bundledNativeModules.json:116; use the pin |
| `@xterm/xterm` | 6.0.0 | identical to desktop/web pins (`apps/desktop/package.json:113`, `web/package.json:27`) |
| `@xterm/addon-fit` | 0.11.0 | same pin |
| `@xterm/addon-webgl` | 0.19.0 | WebGL2 renderer, `README.md:3` |
| `@xterm/addon-serialize` | 0.14.0 | desktop pin; used for scrollback restore |
| `@xterm/addon-unicode11` | 0.9.0 | same pin |
| `@xterm/addon-web-links` | 0.12.0 | same pin |
| `@fressh/react-native-xtermjs-webview` | 0.0.8 (2025-10-08) | peer-pinned to `react-native-webview 13.15.0` + `react 19.1.0`; reference only |
| `expo-file-system` | 57.0.7 | download, cache, share staging |
| `expo-sharing` | 57.0.23 | Android share sheet |
| `expo-document-picker` | 57.0.3 | upload source |
| `expo-image-picker` | 57.0.20 | upload source |
| `expo-media-library` | 57.0.5 | save to gallery |
| `expo-intent-launcher` | 57.0.1 | ACTION_VIEW "open with" |
| `expo-clipboard` | 57.0.2 | copy path |
| `expo-web-browser` | 57.0.3 | external URL handoff |
| `expo-image` | 57.0.5 | image preview + list thumbnails |
| `expo-video` / `expo-audio` | 57.0.5 | `/api/files/stream` playback |
| `expo-print` | 57.0.2 | PDF/HTML export path |
| `expo-secure-store` | 57.0.4 | token storage |
| `expo-auth-session` / `expo-crypto` | 57.0.15 / 57.0.4 | loopback + PKCE (app-wide prerequisite) |
| `react-native-pdf` | 7.0.5 | peer `react-native-blob-util >= 0.13.7` (verified) |
| `react-native-blob-util` | 0.25.1 | PDF + ranged downloads |
| `diff` (jsdiff) | 9.0.0 | produce diffs if needed |
| `parse-diff` | 0.12.0 | parse unified diffs |
| `react-native-shiki-engine` | 0.3.12 | native Oniguruma shiki for RN |
| `@shopify/react-native-skia` | latest 2.14.0, **SDK 57 pin 2.6.2** | optional custom rendering |
| `react-native-svg` | SDK 57 pin 15.15.4 | SVG artifact rendering |
| `react-native-marked` | 8.3.2 | peers `react-native >=0.76`, `react-native-svg >=12.3.0` (verified) |
| `@ronradtke/react-native-markdown-display` | 9.0.3 | alternative markdown renderer |
| `react-native-markdown-display` | 7.0.2 | older alternative |
| `shiki` / `@shikijs/engine-javascript` | 4.5.0 / 4.5.0 | web path only; unverified on Hermes |
| `@expensify/react-native-live-markdown` | 0.1.343 | live markdown composer (adjacent, not a pane) |
| `react-native-keyboard-controller` | SDK 57 pin 1.21.9 | if the WebView does not get keyboard insets |
| `com.github.termux:termux-app` (`terminal-emulator`, `terminal-view`, `termux-shared`) | JitPack `v0.119.0-beta.3` | native terminal view, **GPL-3.0**; Maven Central `com/termux/` is 404 (`https://repo1.maven.org/maven2/com/termux/`), so JitPack is the distribution channel |

## 7. Open questions (must be verified on device before committing)

1. Does an RN WebView's `visualViewport` track the Android soft keyboard the way Chrome does, so
   `keyboard-inset.ts` still produces a correct inset and the resize escape fires? [INFERENCE: probably,
   if the WebView is laid out by a resizing RN view; unverified]
2. Does xterm.js 6.0.0 + the WebGL2 addon initialise on a mid-range Android WebView, and does the
   `webglcontextlost` fallback reach the DOM renderer cleanly? Test with a WebGL capability report
   inside the shipped WebView, per the standing Android advice.
3. Does the gateway accept `process.list` + `agent.terminal.output` from the RN client's auth mode
   (no cookie, header/query token)? The event plumbing is session-scoped
   (`session_notifications.py:823-838`), so the phone must subscribe on the same session id it is
   viewing.
4. Is there an RN-usable DOMPurify (or a server-side sanitize route) for remote HTML previews, or
   must the phone refuse remote HTML entirely in phase 1? [Proposed default: refuse]
