# prior-art.md - decision/gap inventory for hermes-mobile (Expo/RN port of Hermes Desktop)

Investigator note: this IS the file content for `/tmp/hermes-mobile-research/prior-art.md`. I had no write tool (read/grep/glob/web_search/yield only), so the main agent must write it verbatim. Line numbers come from grep anchors or from reads of the named file; section-only anchors are marked `§n`. `[INFERENCE]` marks reasoning I could not execute. No em dashes used.

---

## 0. TL;DR

- **A (Kotlin/Compose, `/home/shameel/hermes-app`) is the decision bank.** It shipped 6 versionCodes (0.1 -> 0.2.4), has a locked decision list, two verified wire documents (REST/RPC + PKCE), a 121-feature parity inventory with a 16-item ranked risk register, and a binding design spec with an explicit anti-slop list. Use it as the spec of record. Its *code* is Kotlin and does not port; its *research* does.
- **B (`/tmp/post-stash-src`, Expo/RN) is the code bank.** 28 files, ~5k lines of TypeScript, src-only (no manifest, no lockfile, no assets, no tests). It already replicates the desktop's theme resolution, all 21 loader curves, the gateway socket, and a real turn engine. It has three hard defects: the light palette is a stale revision, there is **no PKCE at all**, and the credential is never persisted.
- **The server API is already known.** Everything a client needs was captured live on 2026-10-03 in `PLATFORM-API.md` and `PKCE-SPIKE.md`. The one thing those docs call a blocker ("no auth provider configured") **is fixed on this machine today** (`~/.hermes/config.yaml:220-224`, username literally `hermes-mobile`).
- **Biggest risk for an Expo app is not the UI.** It is that the desktop's remote auth model is `cookie session + single-use ?ticket=` held in an **Electron cookie partition**; RN has no equivalent, and B did not port the PKCE alternative that A already built.

---

## 1. Effort A - what was already decided and shipped

### 1.1 Phase list and what each phase covered
Source: `docs/PARITY-PLAN.md:391-480` (phases), `:571-587` (effort table), `:606-629` (verdict).

| Phase | Scope | App days | Hermes days |
|---|---|---|---|
| 0 Foundations | PKCE sign-in, ws-ticket per connect, `session.events.since` replay, `GET /api/status` health, read-only cache, capability manifest | 18-24 | 2-4 (P-2) |
| 1 Chat depth | attachments (image/file/PDF), tool rows, reasoning collapse, grouped slash palette, scoped @-completion, reactions, undo, branch, compress, rename/archive/delete, search, export | 25-35 | - |
| 2 Live operations | out-of-band notifications, running rails + timers, `agents.list`/`process.*`, approvals inbox, goals/loops, background tasks, artifacts with Range | 22-30 | 0-10 (P-3) |
| 3 Bots + automation | bot CRUD, SOUL editing, capability editor, **group chats (18 methods)**, routines, messaging + pairing, cron lifecycle + blueprints + run history, webhooks | 30-42 | - |
| 4 Kanban | board-as-list, task detail, lifecycle verbs, comments, attachments, links, live run inspection | 20-28 | - |
| 5 Configuration | provider/model picker, credential entry, toolsets, skills + Skills Hub, MCP + MCP OAuth, plugins, memory, curator, config editor, env editor **without** secret reveal | 40-55 | 8-15 (P-1) |
| 6 Voice + ambient | voice input, TTS, wake word, image generation, Petdex | 28-40 | 1-2 (P-4) |
| 7 Reading-heavy admin | git read, checkpoints, doctor, logs, analytics, insights, command center, gateway control, backup, security audit, hooks, multi-connection | 35-48 | 2-3 (P-4) |
| 8 Out of scope forever | multi-pane tabs, in-app PTY, host FS browser, host self-update, local-model runtime, hover/tip chrome, Bot Screen RFB, Starmap constellation | - | - |

Total `218-302` app days (~11 engineer-months), `~13-36` Hermes days (`PARITY-PLAN.md:575-584`). Recommended commitment: **Option A = Phases 0-2 (65-89 app days, ~3.5 months)**, extending to B (Phases 0-4) if the phone becomes a primary client (`:622-629`). Parity definition is 6 testable conditions, not a feeling (`:463-479`).

### 1.2 What actually shipped (code, not plans)
Source: `RELEASE-NOTES.md:1-100`, `app/build.gradle.kts:12-18`, `.git/logs/refs/heads/master` (reflog = the full commit history, 27 commits).

| versionCode | Contents | Commit |
|---|---|---|
| 1 / 0.1 | MVP: Sessions list + detail transcript, Bots roster + detail sheet, Bot Chat with streaming + Stop, Connection screen (host/port/token), connection banner states, deep links `hermes://…` | `ad0187a` |
| 2 / 0.2 | chat-first redesign: drawer IA, ported desktop bot avatars, streaming overlay deleted | `02f2ad8` |
| 3 / 0.2.1 | Phase 1 **I1**: `ToolGroup` cap-3 + "N earlier tools" expander, `ReasoningRow`, `TranscriptEntry` | `7adbe17` |
| 4 / 0.2.2 | Phase 1 **I2**: `SessionActionSheet` rename/archive/delete, typed-confirm delete, 8s undo | `a1f9b7b` |
| 5 / 0.2.3 | Phase 1 **I3**: `SearchBar` + scope chips + `>>>…<<<` snippet rendering + four empty states | `802befe` |
| 6 / 0.2.4 | Phase 1 **I4**: composer strip + attachments (tray, rules, prefs) | `a060b45` |

Artifacts exist on disk: `dist/hermes-0.1-release-signed.apk` … `hermes-0.2.4-release-signed.apk` plus `.idsig` files and one unsigned 0.1 (`dist/` listing; sizes/SHA-256 in `RELEASE-NOTES.md:18-24` etc.). **`RELEASE-NOTES.md` documents only through 0.2.2** while dist holds 0.2.3/0.2.4 - the notes are two releases stale.

Beyond the release notes, the tree has PKCE auth work already committed: `data/auth/PkceAuthClient.kt`, `data/auth/CredentialStore.kt`, `ui/connection/{SignInPanel,SignInCoordinator,CallbackActivity,CredentialClock}.kt`, plus `ui/bots/{BotAvatar,BotAvatarSpec}.kt` and `ui/theme/`. Tests exist for all of it (`app/src/test/.../auth/PkceTest.kt`, `CredentialExpiryTest.kt`, `connection/ConnectionViewModelTest.kt`, `SignInFailureMappingTest.kt`, `bots/BotAvatarSpecTest.kt`, `gateway/EventReducerTest.kt`). Note `ui/connection/ConnectionScreen.kt` still exists on disk even though `DESIGN-SPEC.md:1067-1080` lists it as deleted - treat that dir as mid-migration, not settled.

QA history worth keeping: the first emulator QA (`qa/REPORT.md`) found **BLOCKER-1** (no Connection screen, `TokenStore.save()` had zero callers, so the app could never be configured - `qa/REPORT.md` section "BLOCKER-1") and **BLOCKER-2** (a dead bot-card tap caused by chaining `hermesPress(onClick=…)` then `combinedClickable(onClick={})` outside it, so the empty handler won every gesture - root cause quoted in `qa/REPORT.md` under BLOCKER-2, regression re-pinned in `app/src/androidTest/.../BotRowGestureTest.kt:1-18`). Both were fixed in later commits (`1039bcc`, `564f0ce`, `d72ba14`).

### 1.3 Locked decisions (SPEC.md D1-D10)
`docs/SPEC.md:19-32`. Distilled:

- **D1 Transport**: WebSocket JSON-RPC straight to `hermes serve` `/api/ws`. Rejected REST polling and any companion proxy.
- **D2 Auth (v1, superseded)**: `X-Hermes-Session-Token` pasted by the user; works only on an ungated loopback bind. Superseded by PKCE after `PKCE-SPIKE.md`.
- **D3 Layout**: single `:app` Gradle module, 3 layers by package (`ui -> domain <- data`).
- **D4 State**: `StateFlow` + one immutable `…UiState` data class per screen + a one-shot event channel. No Hilt, no Ktor, no Compose `remember` caches.
- **D5 WS client**: OkHttp `WebSocket`, hand-rolled JSON-RPC envelope.
- **D6 JSON**: `kotlinx.serialization` with `ignoreUnknownKeys = true` (**not optional** - Hermes adds fields without version negotiation).
- **D7 Bots = profiles.** No app-side Bot entity.
- **D8 Bot chat**: `bot_relay.deliver` for one-turn, `prompt.submit` + WS events for real sessions.
- **D9 Material 3 `1.5.0-alpha29`** - the only version with the real Expressive API (verified by unpacking AARs).
- **D10 Read-only cache, no offline write queue** - a queued prompt lands in a different conversation state; visible failure beats a wrong answer.

Two behaviours A deliberately froze after live testing, both worth inheriting: params are validated strictly (`additionalProperties: false`), so the client may send **only** documented fields (`SPEC.md:190-213`, rule encoded in `data/rpc/Dto.kt:1-9`); and `started_at` is a **float epoch** while `session.history`'s `count` over-reports the message array (`SPEC.md` §4, echoed in `data/mapper/Mappers.kt:1-8`).

### 1.4 Accepted endpoint/protocol findings (PLATFORM-API.md)
All verified live on 2026-10-03 against `hermes serve` (build `vgit.0a374d1`, upstream `c54637da`).

- **Surface**: REST `299` paths / `341` operations from `/openapi.json`, **44** namespaces; JSON-RPC `251` methods / `66` namespaces from `apps/shared/src/gateway-contract.openrpc.json`; `75` notification types; `13` server->client request types (`PLATFORM-API.md:14-46`, `PARITY-PLAN.md:35-72`).
- **Two modes**: gated (`auth_required: true`) and ungated loopback. Ungated = the process-scoped session token is minted at startup and **rotates on every restart** (`PLATFORM-API.md:85-113`).
- **Ungated acceptance matrix** (`PLATFORM-API.md:100-103`): `X-Hermes-Session-Token` header 200; `Authorization: Bearer` 200; `?token=` on REST **401**; cookie 401; `?token=` on the **WS** 200.
- **Gated auth** (`PLATFORM-API.md:115-150`): `POST /auth/password-login` with `{"provider":"basic","username","password"}` -> 200 + 3 cookies (`hermes_session_at`, `_rt`, `_provider`); omitting `provider` gives 422. Then `POST /api/auth/ws-ticket` -> `{"ticket":…,"ttl_seconds":30}` and `WS /api/ws?ticket=…`. Tickets are **single-use, 30 s** - mint immediately before every socket open, never cache.
- **Public allowlist** (`PLATFORM-API.md:120-130`): `/api/health`, `/api/status`, `/api/config/defaults`, `/api/config/schema`, `/api/model/info`, `/api/dashboard/themes`, `/api/dashboard/plugins`, `/api/cron/fire`. `/api/status` is the readiness probe.
- **Session store** (`PLATFORM-API.md:175-310`): one SQLite file **per profile** (`~/.hermes/state.db`, `~/.hermes/profiles/<name>/state.db`), `schema_version = 31`, FTS5 (`messages_fts`, `messages_fts_trigram`) with `>>>…<<<` snippet markers. `?profile=` is **mandatory** on `/api/sessions/{id}/messages` for non-default profiles (else 404), and REST exposes worker/kanban sessions that RPC hides.
- **Bots** (`PLATFORM-API.md:312-344`): a bot **is** a profile; the roster is `GET /api/profiles`; the canonical `Bot Chat` session is `hidden=1` and omitted unless `include_hidden: true`; `bot_relay.deliver {profile,message,from_profile?,from_handle?}` -> `{reply}` is a blocking single turn (measured 6.0 s).
- **Connectivity** (`PLATFORM-API.md:346-369`): `hermes serve` binds `127.0.0.1`, so a phone cannot reach it. Recommended: Tailscale + `hermes serve --host <tailscale-ip>`; `adb reverse` for dev only; cloudflared/ngrok rejected.
- **Hard constraints** (`PLATFORM-API.md:453-497`): code `4090 SESSION_OWNED_BY_OTHER_WINDOW` (the app may *watch* any session but may only *write* to its own); RPC `session.list` hides worker sources while REST does not; ticket TTL 30 s; `/api/status` is the only readiness probe; `?token=` is WS-only; WS close codes `4401` (ticket failed) and `4403` (request guard) are contract; never read `state.db` from the phone (WAL + torn snapshots).
- **Explicitly unverified** (`PLATFORM-API.md:498-519`): `bot_relay.outbox.*`, `hermes peer dm`, `groups.*` with 2+ bots, `/api/sessions/{id}/timeline` (404s), `/api/pty`, streaming-render fidelity, rate/body limits, soak stability. Risk of lock-in: `/api/ws` is a Hermes-internal generated contract (`:520-545`).

### 1.5 Accepted PKCE findings (PKCE-SPIKE.md)
**Verdict: the PKCE round trip works end to end, unmodified, and the token is unscoped.**

- The single question and answer: `POST /auth/native/token` -> `200 {access_token, refresh_token, token_type, expires_at, provider, user_id}` with **no `scope` field**, and that bearer then reaches `/api/config`, `/api/files` (arbitrary filesystem), `/api/profiles`, `/api/sessions` (`PKCE-SPIKE.md:13-29`, `:202-241`).
- `/openapi.json` declares **zero** security schemes, zero authorization scopes, zero per-operation requirements; the 4 `"scope"` strings are git-diff and model-assignment fields (`PKCE-SPIKE.md:31-65`).
- Full `/auth/native/*` surface (`:67-118`):
  - `GET /auth/native/authorize` requires `code_challenge`, `code_challenge_method=S256` (validated first), `redirect_uri` **must be `http://` on a loopback IP literal** - `localhost`, custom schemes, userinfo, fragments all 400. Optional `state`, optional `provider`.
  - `POST /auth/native/token` body is **JSON only**: `{code, code_verifier}`. Form-encoded -> 422. No `client_id`, no `grant_type`, no `redirect_uri`.
  - `POST /auth/native/refresh`: `{refresh_token, provider?}` -> new pair.
  - Codes are single-use; replay -> `400 Invalid or expired authorization code.`
- Captured round trip + loopback listener hit with matching `state` (`:120-201`). `state` and the verifier never reach the browser; the server sets `hermes_session_pkce` (Max-Age 600) and returns a `broker` handle.
- **Two traps stated flatly**: `X-Hermes-Session-Token` **does not work** under the gate (401) - only `Authorization: Bearer` or cookies; and testing on a loopback bind gives a **false negative** because the gate does not engage there (`:202-252`).
- Root cause of unscopedness (`:254-304`): `_bearer_payload()` (`routes.py:110`) has no scope to populate; `Session` has no scope field; the gate's bearer branch never checks one. **The primitive already exists** - `TokenPrincipal(principal, provider, scopes: tuple[str,...] = ())` in `base.py:23` - so P-1 is "wire the existing primitive through the interactive path", not "invent scopes".
- TTL facts: access 12 h, refresh 30 d; `revoke_session()` is a documented **no-op** (stateless tokens), so "revoke one device" is impossible today; an unset `HERMES_DASHBOARD_BASIC_AUTH_SECRET` makes tokens die on restart (`:351-376`).
- **Revised P-1: 5-8 Hermes days.** Item (1) PKCE = free/DONE; the cost is scope enforcement + `client_id` + a revocation store (`:351-376`).
- Interface to code against, verbatim (`:306-349`): loopback `http://127.0.0.1:<port>/callback`, S256 only, JSON redeem, `Authorization: Bearer`, ws-ticket per socket, `expires_at` is an **absolute epoch second**, `401 session_expired` vs `401 unauthenticated`, password-login rate limit 10/min/IP, and **no `403` is ever returned for authorization**.
- Not verified even there (`:408-420`): real Android intent + 127.0.0.1 listener, a real system browser walking `/login`, non-`basic` providers, the multi-provider HTML chooser, soak.

### 1.6 Parity gap list and its ranking
The inventory is 121 features with an evidence grade each (A ran it, B contract read, C source/doc read, U unverified): chat core `#1-33`, sessions/projects/files `#34-45`, bots `#46-58`, automation `#59-71`, config/capabilities `#72-100`, media/ambient `#101-108`, ops/platform `#109-121` (`PARITY-PLAN.md:98-262`). Totals: **59 AS-IS, 56 ADAPTED (11 also BACKEND), 6 DESKTOP-ONLY**; 43 S / 63 M / 9 L (`:264-291`).

The 6 DESKTOP-ONLY exclusions are the ranking that matters most for a phone: multi-pane tabs (`#31`), in-app PTY (`#32`), host filesystem browser (`#42`), host self-update (`#118`), local-model runtime (`#119`), hover/tip chrome (`#120`), plus Bot Screen RFB (`#54`, revisit-only) and the Starmap constellation (`#107`, timeline instead) (`PARITY-PLAN.md:244-262`, `:457-462`).

The 12 BACKEND rows are `#15,#28,#54,#66,#77,#85,#87,#90,#92,#95,#102,#108`; four are hard blockers of their own phase - **#66 approvals**, **#87 MCP OAuth**, **#92 memory files**, **#108 billing** (`:264-291`). Hermes-side work resolves into **P-1** scoped auth (`:298-331`), **P-2** a capability manifest that covers WebSocket routes (`:332-350`), **P-3** an out-of-band delivery channel (`:351-373`), **P-4** per-feature gaps - RFB docs, skill bundles, MEMORY.md/USER.md, streaming TTS, a `client_kind` denial for secret endpoints, documented rate/size limits, non-ANSI rollback diffs (`:375-389`).

Risk register, ordered by likelihood x blast (`:526-550`): **R1** no scoped auth (critical), **R2** parity abandoned mid-way (high), **R3** no out-of-band channel (critical), **R4** 30 s ticket TTL + 4401/4403 on flaky mobile networks, **R5** the RPC contract is internal and can change, **R6** `openapi.json` lies by omission about WS routes (confirmed), **R7** 384 MiB WS frame cap vs camera photos, **R8** group chats barely exercised, **R9** no Android RFB client exists, **R10** voice duplex is a real audio-app problem, **R11** design erosion across 8 phases, **R12** per-profile DB sprawl, **R13** config schema churn (49 today), **R14** secrets on a phone screen, **R15** review/approval spam, **R16** multi-connection invalidates the MVP state model.

---

## 2. Effort B - what the stashed Expo attempt actually contains

Location `/tmp/post-stash-src`. **28 files total, no hidden files** (verified with a gitignore-off, hidden-on glob). No `package.json`, `app.json`, `tsconfig.json`, `babel.config.js`, lockfile, `assets/` or `dist/`. No test file of any kind. It is a src-only dump taken mid-work.

### 2.1 Inventory

| Path | Role |
|---|---|
| `theme/tokens.ts` (356) | resolved nous palette (light+dark), `space`, `radius`, `fonts`, `type`, `metrics`, `motion`, `shadows` |
| `theme/index.tsx` | `ThemeProvider`, appearance resolution, `useTheme`, `monoText`, bundled font assets |
| `app/_layout.tsx` | expo-router `Stack` + SafeArea + Theme + Hermes providers |
| `app/index.tsx` | sign-in screen (server/username/password) |
| `app/chat.tsx` | the chat surface: Sidebar + SidebarDrawer + Transcript + Composer + ApprovalCard + StatusBar |
| `app/settings.tsx` | appearance setting (list row + segmented control) |
| `store/hermes.tsx` (1759) | the whole client state and every action |
| `lib/gateway.ts` (406) | the real `/api/ws` socket |
| `lib/api.ts` (537) | REST client + a **dead duplicate** `GatewaySocket` (`:380-537`) |
| `lib/markdown.ts` | hand-rolled subset (paragraphs, h1-h4, lists, fences, quotes, hr, GFM tables, inline) |
| `lib/blobatar.ts`, `lib/bot-shape.ts`, `lib/profile-color.ts` | desktop avatar vocabulary (7 `AVATAR_SHAPES`, `hash31`-derived hue, blobatar silhouettes) |
| `lib/placeholders.ts` | the 7+7 composer placeholder pools (upstream-verbatim) |
| `lib/tool-titles.ts`, `model-label.ts`, `reasoning-effort.ts`, `error-copy.ts`, `time.ts`, `format.ts` | desktop string/format ports |
| `lib/preferences.ts`, `use-reduced-motion.ts`, `use-elapsed.ts` | AsyncStorage appearance, reduce-motion probe, 1 Hz timer |
| `components/ui/{loader,button,badge,status-dot,search-field,section-label}.tsx` | chrome |
| `components/chat/{transcript,tool-row,thinking-disclosure,turn-status,error-card,approval-card,composer,status-bar,intro,bot-face}.tsx` | transcript anatomy, one-to-one with desktop files |
| `components/sidebar/{sidebar,sidebar-drawer,rows}.tsx` | the SESSIONS \| BOTS rail and its slide-over |

### 2.2 Which desktop behaviours it already replicates

- **Theme resolution.** `tokens.ts:1-55` documents the whole derivation and `theme/index.tsx` resolves `system|light|dark` with `useColorScheme()`, matching the desktop's `modePref` vocabulary (`lib/preferences.ts:6-8`). `useFonts` gates first paint so the wordmark never flashes in system sans (`theme/index.tsx`, `ThemeProvider`).
- **Loader variants.** `LOADER_TYPES` has **all 21** desktop curves (`components/ui/loader.tsx:26-48`) with the exact maths: `progress = ((t + phase*duration) % duration)/duration`, `detailScale = 0.52 + ((sin(pulse + 0.55)+1)/2)*0.48`, `rotation = -progress*360`, particle `opacity = 0.04 + fade*0.96`, `r = (0.9 + fade*2.7)*strokeScale`, `fade = (1 - tailOffset)**0.56`; defaults `durationMs 5400`, `particleCount 72`, `pulseDurationMs 4600`, `rotationDurationMs 36000`, `trailSpan 0.32`, and a repaint cap `frameMs = 33` / `pathSteps = 220` / `size = 40`. `GlyphSpinner` ports the 10-frame braille cycle at 80 ms (`:528-562`).
- **Gateway client.** `lib/gateway.ts` handles the `gateway.ready` first frame (extracting `change_events`, `heartbeat`, `replay_epoch` at `:254-258`), advertises `client.capabilities {server_requests:true}` once per connection (`:264`), runs the 15 s `gateway.ping` heartbeat with a 45 s silence deadline and max 8 outstanding pings (`:5-9`, `:325-335`), classifies `4401/4403` as auth closes (`isAuthClose`), and dispatches server->client requests with a `DEFERRED` escape hatch plus a `-32601` refusal when unimplemented (`answerServerRequest`).
- **Store / turn engine** (`store/hermes.tsx`): turns are typed (`user | assistant | notice`) with ordered `TurnSegment`s (`text | reasoning | tool`) and `appendStream`/`seal` helpers (`:256-277`); content events that may open a turn are enumerated (`:243-254`); steer while busy goes through `session.redirect` and marks the previous turn `interim` (`:1336-1360`); `prompt.submit` is only sent when idle, with `queued: true` for drained queue entries (`:1338-1383`); the queue and last session are persisted (`QUEUE_KEY`, `LAST_SESSION_KEY`, `:34-36`, `:394-396`); reconnect is `800/2000/5000/10000` ms (`:38`) with a 45 s silence probe; `resumeAndReplay` does `session.resume` then `session.events.since {last_seen}` and resets the watermark on an epoch change (`:998-1075`); model/effort changes go through `command.dispatch` (`:890-903`).
- **Transcript anatomy.** `components/chat/transcript.tsx:25-48` reimplements the desktop's three gap tokens (`scaffold 4 / paragraph 11 / turn-block 12`) as a function of segment kind, plus the `Response stopped` notice; `tool-row.tsx` ports the tool glyph set and pending/done titles; `thinking-disclosure.tsx` ports `ThinkingDisclosure`; `turn-status.tsx` ports `StatusRow` + the dither `StatusPulse` with the reduced-motion freeze; `error-card.tsx` ports the destructive 35/7 fill and 78 % text rule; `approval-card.tsx` ports the `assistant.approval.*` copy.

### 2.3 How complete and correct it is

**Verified correct (do not re-derive):**
- **`darkColors` matches the desktop's resolved dark ladder exactly.** `/tmp/hermes-light-verify.ts` recomputes every token from `apps/shared/src/theme-presets.ts` + `apps/desktop/src/styles.css` + `themes/context.tsx` using premultiplied `color-mix` semantics, then asserts against `src/theme/tokens.ts`; `/tmp/hermes-light-verify.out` records **86 tokens checked, 0 mismatches**, and every dark value in that output equals the dark block at `tokens.ts:112-173` (chrome `#0d1015`, sidebar `#010409`, editor `#0e0f12`, elevated `#16181d`, widget `#0c0d10`, bubble `#0f1621`, the four text alphas, the four strokes, five fills, row/control fills, solid composites, error-card triple).
- The gateway frame handling above is a direct read of the desktop's own contract comments, and is consistent with A's independent live findings.

**Verified STALE (must re-derive):**
- **`lightColors` is an older revision** (`tokens.ts:175-237`). Its own header comment says light base is `#17171a` and its light literals are `chrome #f8f9fe`, `sidebar #f3f7ff`, `editor #fdfdfd`, `widget #fdfdfd`, `success #1f8a65`, `warning #c08532`, `errorCardText #b33556` and a different solid set. The verifier's recorded truth (computed from the desktop, and asserted against the live working tree) is `chrome #fefefe`, `sidebar #f6f8fa`, `editor #fbfbfc`, `widget #fbfbfc`, `success #059669`, `warning #d97706`, `errorCardText #b52f39`, and different solids (`/tmp/hermes-light-verify.out`, light section) - i.e. the light block predates the fix that set the light foreground seed to `#1f2328` and the glyph inks to emerald-600/amber-600. `lightPalette` (`:84-110`) already carries the correct seeds, so the fix is mechanical: re-run the verifier and paste its light expectations.

**Wrong or missing (real defects, ranked):**
1. **No PKCE anywhere.** A grep for `code_challenge|pkce|native/authorize|native/token` across all 28 files returns **no matches**. `app/index.tsx` does `GET /api/status` -> `GET /api/auth/providers` -> `POST /auth/password-login` -> `GET /api/auth/me`, and `lib/api.ts:174-241` is a cookie client with a `credentials:'include'` fetch and a one-shot explicit `Cookie:` header fallback (`:160-172`, `:180`, `:184-200`). The desktop never does this for remote: `oauth` mode is a browser window writing into a cookie partition, and the WS upgrade is `?ticket=` (`/tmp/hermes-agent/apps/desktop/electron/connection-config.ts:16-18,88-97`). A already solved this with `PkceAuthClient.kt`; B had not caught up.
2. **The credential is never persisted by the app.** `cookies` is an in-memory instance field (`lib/api.ts:177-180`), read back only from that field (`:337-341`); the only persisted keys are the origin and the last session id (`store/hermes.tsx:34-36`, `:1118`, `:1183`). A relaunch therefore depends entirely on the platform cookie jar. `[INFERENCE]` React Native's socket-level cookie store is in-memory per run, so "kill and relaunch, still signed in" (`DESIGN-SPEC.md` G4) is not met. Whether it survives is the single cheapest thing to test and the most important to know.
3. **REST reads are not profile-scoped.** `sessions({limit, order, minMessages})` (`lib/api.ts:343-352`) and `messages(sessionId, {limit})` (`:354-362`) never send `?profile=`. Per `PLATFORM-API.md:175-188` and `:474-483` every non-default profile lives in a different SQLite file, so the Expo app can only ever see the default profile's sessions - it silently drops 9 of this machine's 10 profile stores.
4. **The sign-in copy contradicts the accepted setup.** `app/index.tsx` instructs `hermes serve --host 0.0.0.0` with `HERMES_BASIC_AUTH_USERNAME`/`HERMES_BASIC_AUTH_PASSWORD`. The documented variables are `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` / `_PASSWORD_HASH` / `_SECRET` (`PLATFORM-API.md:427-449`) and the live config path is `dashboard.basic_auth.username` / `password_hash` / `secret` (`~/.hermes/config.yaml:220-224`). The `0.0.0.0` advice also contradicts both `PLATFORM-API.md:346-369` (bind Tailscale) and `RELEASE-NOTES.md` ("Do not work around this with `hermes serve --host 0.0.0.0`").
5. **It answers the requests a mobile client should refuse.** `ANSWERABLE_REQUESTS` includes `secret`, `sudo`, `vault.code`, `vault.save_login`, `vault.unlock_prompt` (`store/hermes.tsx:41-50`, dispatched at `:871-874`). `PARITY-PLAN.md:375-389` and R14 (`:544`) specifically call for a `client_kind`-gated **denial** of those on mobile tokens. B is on the wrong side of that decision.
6. **Dead duplicate transport.** `lib/api.ts:380-537` re-declares a second, weaker `GatewaySocket` (no heartbeat, no close codes, no server requests) while the real one lives in `lib/gateway.ts` and imports only `gatewaySocketUrl` from `api.ts` (`lib/gateway.ts:1`, `:406`). Delete the class on revival.
7. **Light-mode bug in the sign-in screen.** The wordmark hardcodes `rgba(230,237,243,0.9)` (`app/index.tsx`) instead of a token, so it is near-white on the light palette.
8. **Loader cost on device is unmeasured.** Up to 104 SVG circles plus a 220-step path are rebuilt through React state every 33 ms on the JS thread (`components/ui/loader.tsx:390-500`). The motion harness proves the 33 ms cap and the reduced-motion hold; it does not prove frame rate on a mid-range Android device.
9. **Persistence gaps**: no turn/transcript cache at all (A had a read-only snapshot cache, `SPEC.md` D10), and no secure storage - the origin sits in plain AsyncStorage (`store/hermes.tsx:1183`).

### 2.4 Why it may have been abandoned
Evidence, then inference:

- **Evidence - the workspace was emptied of app code.** `/home/shameel/workspace/hermes-mobile` today contains only agent scaffolding (`AGENTS.md`, `skills-lock.json`, `.agents/skills/**`, `.commandcode/**`, `.git`) and **no** `package.json`, `app.json`, `src/`, or `dist/` (glob with hidden+gitignore off). `/tmp/hermes-gateway-mock.ts` serves `DIST = '/home/shameel/workspace/hermes-mobile/dist'` and will answer `not built` (404) today. `/tmp/post-stash-src` is a *src-only* subset, and it cannot run: `theme/index.tsx` requires `../../assets/fonts/Collapse-Bold.ttf`, `Collapse-Regular.ttf`, `JetBrainsMono-Regular.ttf`, `JetBrainsMono-Bold.ttf`, and no `assets/` tree exists anywhere on disk now.
- **Evidence - the work was mid-revision when stashed.** The light palette is behind the verifier that had already been run against the live tree (`/tmp/hermes-light-verify.out`), so the stash froze before the light-mode fix landed.
- **Evidence - auth was still the old model.** No PKCE, cookie/password sign-in, and instructions naming non-existent env vars: this is a pre-`PKCE-SPIKE` client, while A had already shipped `PkceAuthClient.kt`.
- **`[INFERENCE]`** The abandonment is best explained by the auth seam plus light-mode token drift - not by the UI, which is substantially complete and faithful. An RN client cannot reuse Electron's cookie partition, so the desktop-parity auth model is not portable, and the portable alternative (PKCE + a 127.0.0.1 loopback listener) is exactly the part that was never written. I found no commit, stash record, README or TODO in `/tmp` that states a reason; this is reasoning from the artifacts, not testimony.

---

## 3. Everything already known about the server API/auth (no new research needed)

### 3.1 Auth
| Fact | Value | Source |
|---|---|---|
| Public readiness probe | `GET /api/status` (`auth_required`, `auth_providers`, gateway state, version) | `PLATFORM-API.md:120-130`, `:485-487` |
| Ungated loopback token | per-process, rotates on restart, `X-Hermes-Session-Token` (REST) or `?token=` (WS only) | `PLATFORM-API.md:85-113` |
| Gated login | `POST /auth/password-login {provider:"basic",username,password}` -> 3 cookies; missing `provider` = 422 | `PLATFORM-API.md:115-150` |
| WS credential | `POST /api/auth/ws-ticket` -> single-use ticket, `ttl_seconds: 30`; `WS /api/ws?ticket=` | `PLATFORM-API.md:26-27`, `:148-150` |
| Under the gate | only `Authorization: Bearer` or cookies; `X-Hermes-Session-Token` = 401 | `PKCE-SPIKE.md:202-241` |
| PKCE start | `GET /auth/native/authorize` with `code_challenge`, `code_challenge_method=S256`, loopback `redirect_uri` | `PKCE-SPIKE.md:73-104` |
| PKCE redeem | `POST /auth/native/token` JSON `{code, code_verifier}` -> `{access_token, refresh_token, token_type, expires_at, provider, user_id}` | `PKCE-SPIKE.md:105-118` |
| PKCE refresh | `POST /auth/native/refresh {refresh_token, provider}`; access 12 h, refresh 30 d; `revoke_session()` is a no-op | `PKCE-SPIKE.md:111-118`, `:351-376` |
| Scopes | none exist; `securitySchemes: {}`; `TokenPrincipal` is the unused seam | `PKCE-SPIKE.md:31-65`, `:254-304` |
| Desktop equivalent | `authMode: 'oauth' \| 'token'`; oauth = cookie session + `?ticket=` WS; token = `?token=` WS | `/tmp/hermes-agent/apps/desktop/electron/connection-config.ts:16-18,88-97` |
| Live host today | `dashboard.basic_auth.username: hermes-mobile` + `password_hash` (scrypt, 86-char shape) + stable `secret` | `~/.hermes/config.yaml:220-224` |
| Desktop target today | primary = remote, `https://hermes.shameel.dev`, `authMode: "oauth"` | `~/.config/Hermes/connections.json:11-19`, `connection.json:3-6` |

**New today vs the docs:** `PLATFORM-API.md:152-173` says no auth provider is registered and a non-loopback bind refuses to start. That is **no longer true on this machine**: `~/.hermes/config.yaml:220-224` registers a `basic` provider under the username `hermes-mobile`. A provider is required for the PKCE/bearer path to engage at all (`PKCE-SPIKE.md:243-252`), so this unblocks building against the real host. Also `_config_version: 50` (`config.yaml:143`) while the docs say 49 (`PARITY-PLAN.md:126`, R13).

### 3.2 REST surface (everything a client needs to start)
`GET /api/health`, `/api/status`, `/api/auth/me`, `/api/auth/providers`, `POST /api/auth/ws-ticket`, `POST /auth/password-login`, `GET/POST /api/profiles`, `/api/profiles/active`, `/api/profiles/sessions`, `/api/profiles/sessions/sidebar`, `GET /api/sessions` (`?profile=`, `limit`, `order`, `archived`, `min_messages`), `/api/sessions/search?q=`, `/api/sessions/stats`, `/api/sessions/{id}`, `/api/sessions/{id}/messages` (**`?profile=` mandatory**), `/messages/around`, `/timeline` (404s), `/latest-descendant`, `DELETE /api/sessions/{id}`, `/export`, `PATCH /api/sessions/{id}` (`web_models.py:268`), `/api/model/options`, `/api/model/set`, `GET/PUT /api/config`, `/api/config/schema` (119 KB), `/api/dashboard/themes`, `/api/skills`, `/api/mcp/*`, `/api/cron/*`, `/api/plugins/kanban/*` (37 paths), `/api/files/*`, `/api/media`, `/api/logs` (`PLATFORM-API.md:48-81`, `PARITY-PLAN.md:98-262`).

### 3.3 JSON-RPC surface (the live channel)
Envelope `{"jsonrpc":"2.0",id,method,params}`; response `{result|error}`; events arrive as `{method:'event',params:{type,session_id,seq,payload}}` with a per-session monotonic `seq` and a per-connection `replay_epoch` (`SPEC.md:166-188`, `lib/gateway.ts:11-20`). Methods the MVP needs: `ping`, `gateway.capabilities` (returns only `{per_session_exclusive_submit}`), `gateway.ping`, `profiles.list`, `session.list` (hides worker sources), `session.active_list`, `session.history`, `session.resume` (returns `inflight`), `session.create`, `prompt.submit` (`status: streaming | queued | steered | redirected`), `session.redirect`, `session.interrupt`, `session.events.since`, `bot_relay.deliver`, `message.react`, `session.undo`, `session.branch`, `session.compress`, `session.archive`, `command.dispatch`, `commands.catalog`, `complete.path` (must NOT be called on a phone), `model.options`, `client.capabilities` (`SPEC.md:190-213`, `PARITY-PLAN.md:106-178`, `PHASE1-DESIGN.md:27-45`).

### 3.4 Error/constraint contract
`4000` invalid params (extra fields rejected - `additionalProperties: false`), `4001` session not found, `4003` unauthorized, `4004x` other app codes, `4090 SESSION_OWNED_BY_OTHER_WINDOW`, `4040` message not in this session's resume lineage, WS `4401`/`4403`, HTTP `401 unauthenticated` vs `401 session_expired`, `429` password rate limit, `503` provider unreachable, and **no 403 for authorization** (`PLATFORM-API.md:453-497`, `PKCE-SPIKE.md:306-349`, `PHASE1-DESIGN.md:200-245`, `app/src/main/java/dev/hermes/android/data/rpc/RpcError.kt:11-18`).

---

## 4. What is still missing or unverified for an Expo app, ranked by risk

| # | Open item | Why it is risky | Cheapest way to settle it |
|---|---|---|---|
| 1 | **Cookie-session auth in React Native** | The desktop's oauth mode is an Electron cookie partition (`connection-config.ts:16-18`); RN has no such partition, `credentials:'include'` is a no-op there, and B never persisted the credential (`lib/api.ts:177-180`, `store/hermes.tsx:34-36`). Sign-in + relaunch (DESIGN-SPEC G4) is unproven. | Two-run test against the live host: sign in, kill the app, relaunch, call `/api/auth/me`. |
| 2 | **PKCE not ported; 127.0.0.1 loopback listener on Android** | The accepted decision (`PKCE-SPIKE.md:306-349`) and A's shipped `PkceAuthClient.kt` are not in B. `redirect_uri` must be `http://127.0.0.1:<port>/callback` with an intent filter; PKCE-SPIKE explicitly never ran this on a device (`:408-412`). Expo needs `expo-auth-session`/`expo-web-browser` plus a local listener (`expo-http-server`-class module or a dev-build native module). | Build the smallest dev-build that completes authorize -> login -> token against the live host. |
| 3 | **Credential is root-equivalent** | No scopes exist (`PKCE-SPIKE.md:31-65`); a stolen bearer reaches `/api/files`, `/api/config`, `/api/env/reveal`. Expo cannot fix it. | Decide policy now: tailnet-only bind, a dedicated `basic` account for the phone (one exists: `hermes-mobile`), and refuse secret/vault surfaces in the client. |
| 4 | **No out-of-band notification channel** | All 75 notifications and 13 server requests are WS-only, so a backgrounded phone misses approvals (`PARITY-PLAN.md:351-373`, R3). Expo Notifications needs a push service or a webhook consumer. | Register a Hermes webhook target that forwards to a relay, and test with the screen off. |
| 5 | **Profile scoping is absent in the client** | `lib/api.ts:343,354` send no `?profile=`, so 9 of 10 stores are invisible and `/messages` for a non-default profile 404s (`PLATFORM-API.md:175-188`). | Add a `profile` param to every read and test with `librarian`. |
| 6 | **30 s ticket TTL + reconnect on mobile networks** | Tickets are single-use/30 s (`PLATFORM-API.md:408`); B's backoff is `800/2000/5000/10000` with a 45 s silence probe (`store/hermes.tsx:37-38`) and it treats `session.events.since` as mandatory - none of this is proven across a radio handover (R4, `:536`). | Soak on a real phone on the tailnet with airplane-mode toggles. |
| 7 | **Light palette drift** | `tokens.ts:175-237` is a stale revision; reusing it ships the wrong light theme. | Copy `/tmp/hermes-light-verify.out` light values in, then re-run the verifier. |
| 8 | **Scope-vs-capability declaration** | `gateway.capabilities` returns only `{per_session_exclusive_submit}` (`PHASE1-DESIGN.md:53-79`), and `openapi.json` omits every WS route (P-2/R6), so the app cannot feature-detect. | Fail closed: probe a method and render a named disabled state on method-not-found. |
| 9 | **Loader frame rate on a real device** | up to 104 SVG circles rebuilt every 33 ms through React state (`loader.tsx`), unmeasured on hardware. | Profile one curve on a mid-range Android device; consider a single `react-native-reanimated` driver or a reduced particle count on `compact`. |
| 10 | **Nothing renders the desktop's richer surfaces** | No markdown tables/code-block horizontal scroll parity beyond the hand-rolled subset, no artifacts page, no image/PDF attachments, no search, no reactions. | Treat as scope, not risk: A's Phase 1 inventory is the checklist. |
| 11 | **Expo SDK/RN/deps are unknown** | The stash pins no versions; the desktop-parity UI depends on `react-native-svg`, `@tabler/icons-react-native`, `expo-router`, `expo-font`, `expo-status-bar`, `async-storage`, `react-native-safe-area-context`. Dev-build vs Expo Go is undecided. | Pick the current Expo SDK and re-add deps explicitly; nothing in the stash records the originals. |
| 12 | **Untested surfaces from A** | groups with 2+ bots, `bot_relay.outbox.*`, `/api/pty`, rate/size limits, `/timeline`, voice duplex, multi-provider chooser (`PLATFORM-API.md:498-519`, `PARITY-PLAN.md:660-688`, `PKCE-SPIKE.md:408-420`). | Defer; do not build on them. |

---

## 5. Reusable assets, with a verdict per artifact

### 5.1 Reuse AS-IS

| Artifact | What it gives you | Verdict notes |
|---|---|---|
| `/tmp/hermes-light-verify.ts` + `.out` | A correct `color-mix` + premultiplied-alpha implementation and the **verified truth table for both appearances** (86 tokens) | Run it against any revived `tokens.ts`; it exits non-zero on drift. It is also the only place the light numbers are correct. |
| `/tmp/hermes-success.ts` | The desktop's OKLCH `harmonize()` and the proof that `--ui-success` is harmonized from `#10b981` (light `#059669`, dark `#34d399`) | Explains why B's light success was wrong. |
| `/tmp/hermes-gateway-mock.ts` | A complete fake `hermes serve` on bun: `/api/status`, `/api/auth/providers`, `/auth/password-login`, `/api/auth/me`, `/api/auth/ws-ticket`, `/api/sessions`, `/api/profiles`, `/api/model/options`, plus a real `/api/ws` with `gateway.ready` (heartbeat + `replay_epoch`), per-session `seq`, `session.create/resume/history/active_list/events.since`, `model.options`, `config.set` with a confirm-required path, scripted `/fail /approve /sudo /secret /clarify /setup /todo /tools` turns, and static dist serving | Note `DIST` points at the now-empty `hermes-mobile/dist`; `/tmp/hermes-mock.log` shows it ran on `http://127.0.0.1:8899`. |
| `/tmp/hermes-motion-smoke.ts` + `/tmp/omp-stub-react.ts` + `/tmp/omp-stub-rn.ts` + `/tmp/omp-stub-svg.ts` + `/tmp/omp-stub-theme.ts` + `/tmp/omp-stub-jsx.ts` + `/tmp/omp-tsconfig.json` | A harness that mounts the **real** components under a fake React/RN and diffs placeholder + intro strings against upstream `en.ts` / `intro-copy.jsonl` at run time | Requires `/tmp/hermes-agent` (present). It is the pattern to copy for any string/behaviour parity test. |
| `/tmp/hermes-agent` | A pinned read-only copy of the desktop source used as upstream truth (`apps/desktop/src/styles.css`, `i18n/en.ts`, `plugins/hermes-bots/avatar.tsx`, `electron/connection-config.ts`) | Prefer this or `~/.hermes/hermes-agent` over re-cloning. |
| `tokens.ts` **dark** block (`/tmp/post-stash-src/theme/tokens.ts:112-173`) | Verified dark nous ladder + `space`, `radius`, `fonts`, `type`, `metrics`, `motion`, `shadows` (`:239-356`) | Keep the ladders and metrics. `shadows.nous` is a desktop overlay elevation; DESIGN-SPEC's Android rules ban shadows, so check the intended Expo look before adopting it. |
| `components/ui/loader.tsx` | All 21 curves with exact constants and the trail maths + braille spinner | Verified by the motion harness for the 33 ms cap and reduced-motion hold. Re-check device frame rate. |
| `lib/gateway.ts` | Correct `/api/ws` framing, heartbeat, close-code classification, `client.capabilities`, server-request dispatch with `DEFERRED` | Delete the duplicate in `lib/api.ts:380-537` when adopting. |
| `lib/{placeholders,tool-titles,model-label,reasoning-effort,error-copy,time,format,profile-color,bot-shape,blobatar}.ts` | Verbatim desktop string/format/identity ports with citations in the headers | `tool-titles` and `placeholders` are quoted from `en.ts`; `bot-shape`/`blobatar` are hashes/geometry that must not be regenerated. |
| `components/chat/{transcript,tool-row,thinking-disclosure,turn-status,error-card,approval-card,intro,bot-face,status-bar}.tsx` and `components/sidebar/*` | A working desktop-shaped chrome with the desktop's own gaps and class names recorded in comments | Independent of the auth problem; reusable once tokens are corrected. |
| A's docs (all 9) | The decision bank: decisions, wire facts, gap inventory, risk register, design tokens, phase plan, UX research | Bind to them; do not re-litigate. `DESIGN-SPEC.md` and `PHASE1-DESIGN.md` are declared binding rather than advisory. |
| A's `qa/*.py` probes + `_scratch/pkce_*.py`, `_scratch/dump_*.py` | Reproducible live probes (ws token matrix, PKCE round trip, RPC, presence truth, contract dump) | Untracked by design (`/home/shameel/hermes-app/.gitignore:11-16`) but present on disk. |
| `app/src/main/java/dev/hermes/android/data/auth/PkceAuthClient.kt`, `CredentialStore.kt` | The PKCE constants, body shapes, failure names and the refresh-vs-reauth policy | Kotlin, but the logic and the failure taxonomy transfer directly. |

### 5.2 Re-derive (do not copy)

| Artifact | Why |
|---|---|
| `tokens.ts` **light** block | Stale revision; rebuild from `lightPalette` + `/tmp/hermes-light-verify.out`. |
| Auth (`app/index.tsx`, `lib/api.ts` login/cookie plumbing) | Wrong model (cookie/password) and wrong setup copy. Replace with PKCE + loopback, porting A's flow and `PKCE-SPIKE.md` §6. |
| `lib/api.ts` REST methods | Missing `?profile=`; wrong param defaults vs the contract; carries a dead duplicate socket. |
| Persistence | Nothing persists turns; the credential is not persisted at all. A's D10 (read-only snapshot cache, no write queue) is the decision to port, plus `expo-secure-store` for the token. |
| `store/hermes.tsx` shape | The behaviour is good but it is one 1759-line context holding transport, turn state, queue, roster, model, approval and preferences. Split before extending it to Phase 1+ surfaces. |
| `lib/markdown.ts` | A bounded subset; the desktop renders tables, nested lists, code with horizontal scroll and copy. Decide: `assistant-ui`-equivalent library or extend this. |
| A's Kotlin design tokens | M3 role names (`surfaceContainer`, `signalLive`, `caution`) and 4dp grid are Android vocabulary; the Expo app already has a desktop-derived token set that is closer to the target. Keep A's *rules* (one radius per role, rails carry state, no shadows, no overlays) and B's *values*. |
| A's toolchain doc | JDK/AGP/Compose specifics; irrelevant to Expo except as a warning about pinned-version churn. |

### 5.3 Token ladders, loader maths and fixtures, in one place
- **Token ladder (dark, verified)**: `chrome #0d1015`, `sidebar #010409`, `editor #0e0f12`, `elevated #16181d`, `widget #0c0d10`, `bubble #0f1621`, `input #0d1015`; text `qebf3` at 94/74/54/36 % and scaffold 64/44 %; strokes = accent at 24/16/10/6 % mixed over base at 10/7/5/3 % -> `rgba(112,157,251,.316)/rgba(116,160,251,.219)/rgba(122,165,251,.145)/rgba(124,166,250,.088)`; fills at 16/11/8/5/3 % over base 10/7/5/4/3 %; rows accent 4/8 % over base 3/5 %; `accent #4a84fe`, `destructive #f85149`, `success #34d399`, `warning #fbbf24`, error card `35/7 %` destructive + text `#e86762`, `sidebarEdge rgba(230,237,243,.12)` (`tokens.ts:112-173`, confirmed by `/tmp/hermes-light-verify.out` dark section).
- **Token ladder (light, target)**: `chrome #fefefe`, `sidebar #f6f8fa`, `editor #fbfbfc`, `widget #fbfbfc`, `bubble #fcfcfc`, `input #fcfcfc`; text base `#1f2328`; `accent #0053fd`, `destructive #cf222e`, `success #059669`, `warning #d97706`, error card text `#b52f39`, `sidebarEdge rgba(31,35,40,.075)` (`/tmp/hermes-light-verify.out` light section).
- **Loader maths**: see §2.2; constants live at `loader.tsx:26-48` (types) and `:50-300` (curves), the render/paint loop at `:390-520`, braille at `:528-562`.
- **Motion budgets** (Android spec, useful as intent): tap 100-150 ms, state 150-200 ms, list 200-300 ms staggered ~40 ms, push 300-350 ms; two hand-written animations `livePulseAlpha` 1.0->0.40/1600 ms and `shimmerOffset` 1400 ms linear (`DESIGN-SPEC.md:196-226`). Expo equivalents: `motion.control 100 / overlay 180 / drawer 220` (`tokens.ts:323-337`).
- **Fixtures**: the mock gateway's fixtures are the only ones that exist - `STORED_ID 20261009_142233_a17b3c9d`, profiles `hermes`/`pepper` with `ui_meta.group/subgroup/color`, two sessions, two messages, an `INFO` payload with `desktop_contract: 21`, `version 0.21.6+131`, and a three-provider model catalog (`/tmp/hermes-gateway-mock.ts:1-100`). A's `qa/*.py` probes carry the real-host ground truth (9 profiles, session rows with `source`, presence derivation).

---

## 6. Limits of this investigation

- I did not re-verify any live endpoint; every wire claim above is quoted from `PLATFORM-API.md` / `PKCE-SPIKE.md` (both measured on 2026-10-03) or from the desktop's own source. The only *new* live facts I read are `~/.hermes/config.yaml:220-224`, `_config_version: 50`, and `~/.config/Hermes/{connections,connection}.json`.
- I did not read every line of A's 1,271-line PHASE1-DESIGN or 1,143-line DESIGN-SPEC; I read the decision-bearing sections and used heading anchors for the rest.
- I did not read the bodies of most of B's components; I read their headers (via a citation grep), their imports, and the three files that carry the parity risk (`tokens.ts`, `gateway.ts`, `api.ts`) plus the store's structure and key paths.
- `[INFERENCE]` items are limited to: RN cookie-jar persistence semantics, the abandonment explanation, and the loader's device frame rate.
