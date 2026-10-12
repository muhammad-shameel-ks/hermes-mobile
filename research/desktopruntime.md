# Desktop runtime map for a mobile Hermes client

> Provenance: all claims read from `/home/shameel/.hermes/hermes-agent` (source) and live state in `~/.hermes` / `~/.config/Hermes` on 2026-10-12. `path:line` cited for every non-obvious claim. No em dashes.
>
> DELIVERABLE NOTE: this environment exposes no write tool (read/grep/glob/web_search/yield only), so `/tmp/hermes-mobile-research/desktop-runtime.md` could not be created by this agent. Persist this file body verbatim at that path.

---

## 0. TL;DR for the mobile client

1. **Chat is WS-only.** One endpoint: `GET <base>/api/ws` upgraded with `?token=` (ungated/loopback) or `?ticket=` (OAuth-gated). JSON-RPC 2.0, newline-delimited text frames. `tui_gateway/ws.py:1-4`.
2. **REST is not a chat API.** It serves session lists, stored transcripts, config/models/cron/skills/media. There is **no REST endpoint to create a live session or submit a turn** (see `hermes_cli/web_routers/sessions.py` route set: only GET/PATCH/DELETE plus bulk/import/prune/owner-backfill POSTs).
3. **Renderer never does HTTP itself** in Electron: every REST call is `window.hermesDesktop.api(req)` -> IPC `hermes:api` -> main-process `fetchJsonForBackend` (`apps/desktop/electron/preload.ts:341`, `apps/desktop/electron/main.ts:17648`, `main.ts:17600`).
4. **Renderer does own the WS.** `HermesGateway extends JsonRpcGatewayClient` (`apps/desktop/src/api/client.ts:20-38`) and dials with `new WebSocket(wsUrl)` (`apps/shared/src/json-rpc-gateway.ts` connect path), wsUrl minted fresh by main before each dial (`apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts:997,1509`).
5. **`gateway.sock` is irrelevant.** It is a local admin control socket, one JSON line per connection, POSIX filesystem ACL as the auth boundary (`gateway/control_socket.py:3-6,28-31`). No desktop code references it.

---

## 1. Process model: Electron main vs renderer

### 1.1 Responsibilities

| Concern | Owner | Evidence |
|---|---|---|
| Spawn/attach `hermes serve` child, pool/reap | Electron main | `apps/desktop/electron/backend-command.ts:20-27`, `backend-discovery.ts:112-137` |
| HTTP to backend (all REST) | Electron main | `main.ts:17648` (`ipcMain.handle('hermes:api')`), `main.ts:17600-17620` |
| Credentials (tokens, cookies, safeStorage, native OAuth tokens) | Electron main | `main.ts:7848-7864`, `apps/desktop/electron/hardening.ts:156-196` |
| Fresh WS URL minting (ticket per dial) | Electron main | `main.ts:8096` (`freshGatewayWsUrl`), `main.ts:8077` (`mintGatewayWsTicket`) |
| Connection registry (local/remote/ssh/cloud) | Electron main | `~/.config/Hermes/connections.json`, `main.ts:16584-16595` |
| WebSocket dial + JSON-RPC + event fan-out + reconnect | Renderer | `apps/desktop/src/store/gateway.ts:1090-1131`, `apps/shared/src/json-rpc-gateway.ts` |
| Request routing across (connection, profile) | Renderer store + main | `apps/desktop/src/api/client.ts:84-140`, `apps/desktop/src/store/session-request-router.ts` |
| UI/state | Renderer | `apps/desktop/src/store/*` |

### 1.2 IPC channels a client-equivalent would need to replace

Renderer-facing bridge (`apps/desktop/electron/preload.ts`):

| Channel | preload line | Purpose | Mobile equivalent |
|---|---|---|---|
| `hermes:connection` | `preload.ts:39` | Resolve/dial a backend descriptor `{baseUrl, wsUrl, token, authMode, mode, ...}` | own discovery + credential store |
| `hermes:connection:for` | `preload.ts:43` | Registry-scoped dial `{connectionId, profile}` | own multi-backend map |
| `hermes:connection:revalidate` | `preload.ts:44` | Drop a stale cached remote descriptor | re-probe |
| `hermes:backend:touch` | `preload.ts:45` | Keepalive so the idle reaper spares an active backend | n/a |
| `hermes:pool-limits:get` / `:set` | `preload.ts:47-48` | Backend pool sizing | n/a |
| `hermes:gateway:ws-url` | `preload.ts:49` | Mint fresh WS URL for a profile | required (ticket mint) |
| `hermes:gateway:ws-url-for` | `preload.ts:52` | Same, for `{connectionId, profile}` | required for multi-source |
| `hermes:api` | `preload.ts:341` | Any-method REST proxy | required (plain HTTP) |
| `hermes:notify` | `preload.ts:342` | OS notification | platform equivalent |
| `hermes:agents:roster` | `preload.ts:54` | Union agent roster across connections | n/a |
| `hermes:connections:{list,save,remove,setPrimary,test,updateManaged,updateAll,onChanged}` | `preload.ts` (bridge block, `src/global.d.ts` `connections:`) | Registry CRUD | own UI |
| `hermes:probeConnectionConfig`, `hermes:oauthLoginConnectionConfig`, `hermes:oauthLogoutConnectionConfig`, `hermes:cloud:*` | `preload.ts` block + `src/global.d.ts` | Pre-login probes + OAuth login/logout + cloud discovery | required (re-implement flow) |
| `hermes:profile:{get,set,getDefault,setDefault,remember,onDefaultChanged}` | `preload.ts` block | Profile preference + relaunch local backend under new HERMES_HOME | partial |
| `hermes:secret-storage:*` | `src/global.d.ts` | safeStorage opt-in for stored secrets | platform keystore |
| `hermes:translucency:support`, `hermes:hud:windowing`, `hermes:feature-flags`, `hermes:skin:local` | `preload.ts:14-27` | **sync** `sendSync` bootstrap reads before first paint | drop |
| `hermes:fs:reveal`, `hermes:fs:rename`, `hermes:fs:trash`, `hermes:plugin:probe` | `electron/fs-ipc.ts:47,149,183,236` | Local filesystem mutations | drop (mobile uses `/api/fs/*`) |
| `hermes:git:review:*` (14 channels) | `electron/git-ipc.ts:70-101` | Local git in the desktop's own process | drop (use `/api/git/*`) |
| `hermes:machine:profile` | `electron/machine-profile.ts:18` | Host facts | platform equivalent |
| window/pet/HUD/quickEntry/screenshot/wake-indicator/tray | `preload.ts` blocks | Electron shell features | drop |
| `hermes:uninstall:*`, `hermes:updates:*`, `hermes:bootstrap:*` | `electron/desktop-uninstall.ts:84,106`, `main.ts:3698` | Installer/updater | platform store |

### 1.3 HTTP/WS endpoints the *renderer* touches

HTTP: none directly (except unrelated `fetch('./emojibase/...')` for emoji data, `src/app/chat/composer/hooks/use-emoji-completions.ts:33`).

WS, opened directly by the renderer:

| Endpoint | Opened at | Auth in URL |
|---|---|---|
| `<base>/api/ws` | `apps/shared/src/json-rpc-gateway.ts` (connect), minted by `main.ts:8096` | `?token=` or `?ticket=` (+ `&profile=` for shared remotes) |
| `<base>/api/plugins/<id><suffix>?token=` | `apps/desktop/src/api/plugins.ts:113-115` | `?token=` |
| `<base>/api/audio/speak-stream` | `src/lib/voice-playback.ts:182-186` | inherits the `/api/ws` credential |
| `<base>/api/audio/transcribe-stream` | `src/lib/voice-stream.ts:36` | same |
| `<base>/api/display/ws?display_ticket=` | `src/plugins/hermes-bots/screen-pane.tsx:225` | 30s single-use display ticket from `display.observe` |

Server side mounts: `/api/ws` `hermes_cli/web_routers/chat_ws.py:701`; `/api/pty` `chat_ws.py:538`; `/api/console` `chat_ws.py:299`; `/api/pub` `chat_ws.py:740`; `/api/events` `chat_ws.py:752`; `/api/audio/transcribe-stream` `web_routers/audio.py:515`; `/api/audio/speak-stream` `audio.py:592`; `/api/display/ws` `web_routers/display.py:74`.

---

## 2. Backend discovery + connection

### 2.1 Attach-first local discovery

- Every backend registers itself in a machine-root `spawn-ledger.json` **after** its socket binds: `hermes_cli/process_identity.py::register_self`, called from `web_server.py` with `detail={host, port, profile}` (`apps/desktop/electron/backend-discovery.ts:7-12`).
- Record shape parsed: `{pid, create_time, purpose, host, port, profile, isolated, registered_at}` (`backend-discovery.ts:24-34`, `parseSpawnLedger` at `:60-107`).
- Attachable purposes: `dashboard`, `serve` (`backend-discovery.ts:39`). Dialable hosts: `''`, `0.0.0.0`, `127.0.0.1`, `::`, `::1`, `localhost` (`:42`).
- `isolated: true` records are skipped (owned by another client, e.g. a remote Desktop's SSH backend) (`:88-96`).
- Decision: `spawnOrAttach` picks the **newest** live record by `registered_at`; `HERMES_DESKTOP_ISOLATED_BACKEND` forces `spawn` (`backend-discovery.ts:112-130`).
- Base URL: `http://127.0.0.1:<port>` (`backend-discovery.ts:135-137`).
- Spawn race gate: `classifyHostSpawnGate` (`backend-discovery.ts:145-160`) - a gate whose owner is dead or older than `staleAfterMs` is taken over.
- Single-flight dial per scope key across windows: `BackendDialClaims` (`electron/backend-dial-claim.ts:16-56`).
- Live proof: `~/.hermes/spawn-ledger.json` currently holds three `purpose: "serve"` records, `argv: "-c serve --host 127.0.0.1 --port 0"`, ports **37423** (home `~/.hermes`), **42921** (`profiles/orchestrator`), **41327** (`profiles/architect`), all `isolated: false`.

### 2.2 Spawn command

`serveBackendArgs(profile)` -> `['--profile', <name>?, 'serve', '--host', '127.0.0.1', '--port', '0']` (`electron/backend-command.ts:20-27`); older runtimes fall back to `dashboard --no-open` (`:40-62`). Port 0 = OS-assigned. `hermes_cli/subcommands/dashboard.py:17-19` documents the same defaults (`--port` default 9119, `--host` default 127.0.0.1) for a non-Desktop launch.

### 2.3 Validation boundary (never trust the ledger)

1. HTTP probe, then 2. token handshake, then 3. WS probe. `host-backend-attach.ts:50-52` (deps), `:116-118` (`wsUrlFor` -> `ws://host/api/ws?token=`), `:202-206` (reject log).
- Token source of truth is the **served** token: `GET /` HTML contains `window.__HERMES_SESSION_TOKEN__` (`electron/dashboard-token.ts:31-45`); a served token differing from the spawn token while our child is dead means a foreign backend -> refuse (`dashboard-token.ts:88-97`).
- Readiness loop: `GET /api/health`, falling back to credentialed `GET /api/status`; `DEFAULT_BACKEND_READY_TIMEOUT_MS = 180_000`, poll `500ms`, health probe timeout `5_000` (`electron/backend-health.ts:5-12`). A confirmed 401/403 from a credentialed probe fails fast into reauth (`backend-health.ts` `waitForHermesReady`).
- WS probe rejects a backend whose `/api/ws` refuses the token even when HTTP is healthy (`gateway-ws-probe.ts:9-13,171-176`).

### 2.4 Identity files under HERMES_HOME

| File | Written by | Read by desktop for | Live state |
|---|---|---|---|
| `spawn-ledger.json` | backend after bind (`process_identity.register_self`) | attach discovery | 3 records (above) |
| `gateway.pid` | gateway process (`gateway/status.py:307-308`) | profile migration / "running gateway" detection (`electron/profile-migration.ts:46-47,99-103`) | `{"pid":665847,"kind":"hermes-gateway","argv":[".../hermes_cli/main.py","gateway","run"],"hermes_home":"/home/shameel/.hermes"}` |
| `gateway.lock` | gateway process (`gateway/status.py:43,311`) | close/stop lock cleanup (`main.ts:4259-4263`) | present, 190B |
| `gateway.sock` (+ `gateway.sock.path` pointer) | `gateway/control_socket.py:4-5,28-31` | **nothing in desktop** | not present in this install |
| `host rendezvous` record | `web_server.py:1461-1465` | multiplex attach | published after bind |

`gateway.sock` wire contract, for completeness: POSIX `$HERMES_HOME/gateway.sock`, Windows named pipe `\\.\pipe\hermes-gateway-<hash>`, **ONE request per connection**, one JSON line in and one out, then the server closes; `CONTROL_PROTOCOL_VERSION = 1` (`gateway/control_socket.py:3-6,28-33`). Used by CLI/update/status, not by any client UI.

### 2.5 Local vs remote mode (live config)

`~/.config/Hermes/connections.json`:
```json
{ "version": 2, "primary": "omarchy-zeus", "launchMode": "last-used", "lastUsed": "omarchy-zeus",
  "connections": [
    { "id": "local", "kind": "local", "label": "This device" },
    { "id": "omarchy-zeus", "kind": "remote", "label": "Omarchy(Zeus)", "url": "https://hermes.shameel.dev", "authMode": "oauth" } ] }
```
`~/.config/Hermes/connection.json` (legacy v1, still present): `{ "mode": "remote", "remote": { "url": "https://hermes.shameel.dev", "authMode": "oauth" }, "profiles": {} }`.

Config semantics: `authMode` lives on the remote sub-object; `'cloud'` saved configs resolve to a `'remote'` connection (`src/global.d.ts:976-1020`). Token secrets and custom headers are stored per-connection as `{encoding: 'plain' | 'safeStorage', value}` (`electron/connection-config.ts:354-396`).

---

## 3. API surface actually used

### 3.1 WS wire protocol

- Path: `/api/ws`. Text frames only, one JSON object per frame, newline-delimited (`tui_gateway/ws.py:1-4`).
- First server frame is always `gateway.ready` with `{skin, change_events, heartbeat, replay_epoch}` (`ws.py:366-370`).
- Frame kinds (`apps/shared/src/json-rpc-channel.ts:11-62`):
  - client->server request `{jsonrpc:'2.0', id:number|string, method, params}`
  - server response `{jsonrpc:'2.0', id, result}` or `{jsonrpc:'2.0', id, error:{code,message,data}}`
  - server notification `{jsonrpc:'2.0', method:'event', params:{type, session_id?, payload?, seq?}}`
  - server->client request `{jsonrpc:'2.0', id:<string>, method, params:{session_id?, ...}}` (detected by string `id` + `method !== 'event'`, `json-rpc-channel.ts:61-62`)
- Client must answer a server request; refusing is a first-class answer: `respond(result)`, `fail(code,message)`, `decline(message)` -> code **4404** `NOT_SHOWN_CODE` when no window shows the session (`tui_gateway/server_requests.py:110-115`, `json-rpc-channel.ts:36-59`).
- Error codes: `-32601` method not found (`json-rpc-channel.ts:71`), `-32603` handler crashed (`:74`), `4404` not-shown (`:77`).
- Heartbeat: `{jsonrpc:'2.0', id:'heartbeat-N', method:'gateway.ping', params:{}}` every `DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000`, deadline `DEFAULT_HEARTBEAT_DEADLINE_MS = 45_000` (`json-rpc-channel.ts:154-155,555-572`). Desktop counts **any inbound frame** as liveness (`json-rpc-gateway.ts`, `heartbeatLiveness: 'any-inbound'`); server answers `ping` on the WS reader thread even mid-turn (`tui_gateway/contracts/liveness.py:17`).
- Capability handshake: after `gateway.ready` the client sends `client.capabilities` (`json-rpc-channel.ts:489-492`; contract `liveness.py:46`) which returns the server->client request methods the backend may send.
- Reconnect replay: client sends `session.events.since {session_id, last_seen}` per session; server returns recorded event objects with `seq > last_seen` plus `truncated` (`tui_gateway/event_replay.py:131-148`). Ring: `_REPLAY_BUFFER_MAX = 512` events, `_REPLAY_BUFFER_BYTES_MAX = 4 MiB` per session, `_REPLAY_SESSIONS_MAX = 64`, `_REPLAY_PROCESS_BYTES_MAX = 64 MiB` process-wide (`event_replay.py:29-35`). `replay_epoch` is a per-process uuid; a changed epoch means the server restarted and seq watermarks must reset (`event_replay.py:22-25,48-50`).

### 3.2 Event frame types (75)

Full list at `apps/shared/src/gateway-contract.generated.ts:5994-6068`. The ones a chat client needs:

| Frame | Meaning |
|---|---|
| `gateway.ready` | connection established, carries `replay_epoch` |
| `message.start` | turn began (no payload) |
| `message.delta` `{text}` | assistant text chunk |
| `message.interim` `{text}` | sealed interim commentary segment |
| `message.complete` | final text + usage + outcome |
| `reasoning.delta` / `reasoning.available` `{text}` | reasoning stream / completed block |
| `thinking.delta` `{text}` | legacy thinking text (also provider-wait notices) |
| `tool.start` / `tool.complete` / `tool.generating` / `tool.output_risk` | tool lifecycle |
| `todo.updated` | authoritative todo snapshot |
| `session.info` | live session snapshot (also the `info` of create/resume/activate) |
| `session.usage`, `session.title`, `status.update` | mid-turn ticks |
| `error` | terminal error frame (`status: 'error'`, `error`, `partial`, `error_surface`) |
| `approval.cancelled` | pending approvals dropped by interrupt/reap (resolved as deny) |
| `session.reclaimed` | backend reclaimed a live session; client must re-resume |
| `request.cancel` `{id, method, reason}` | a server->client request was cancelled |
| `subagent.*`, `moa.*`, `notification.show`, `skin.changed` | peripheral |

### 3.3 RPC methods by flow

**Connect**
- `ping {}` -> `PingResult` (`contracts/liveness.py:17`)
- `gateway.capabilities {}` (`liveness.py:25`)
- `client.capabilities {}` (`liveness.py:46`)

**List sessions (WS alternative to REST)**
- `session.list` (`contracts/sessions.py:249`), `session.active_list` (`:291`), `session.most_recent` (`:264`)

**Open session**
- `session.create` params `{profile?, cols?, source?, cwd?, cwd_explicit?, messages?, parent_session_id?, title?, model?, provider?, reasoning_effort?, fast?, service_tier?, close_on_disconnect=false, hidden=false, idempotency_key?}` -> `{session_id, stored_session_id, message_count, messages[], info}` (`contracts/sessions.py:105-151`). `session_id` is the **runtime** id; `stored_session_id` is the durable one.
- `session.resume` params `{session_id (STORED id or exact title), cols?, source?, lazy=false, defer_history=false, omit_messages=false, eager_build=false, close_on_disconnect=false, inline_images=true}` -> `LiveSessionSnapshot` (`contracts/sessions.py:183-205`). Desktop sends `{session_id, cols: 96, omit_messages: true, source: 'desktop'}` (`src/app/hooks/use-session-tile-delegate.ts:409-412`, `src/app/chat/session-tile-actions.test.ts:157`).
- `session.activate {session_id, cols?, omit_messages?}` (`sessions.py:215`), `session.history` (`:499`), `session.close` (`:399`), `session.title` (`:320`), `session.archive` (`:355`), `session.branch` (`:421`), `session.undo` (`:459`), `session.delete` (`:306`).

**Send turn**
- `prompt.submit` params `{session_id, text, display_kind?, interrupted?, queued?, surface?, voice_context?, voice_turn?, title_preview?, truncate_before_row_id?, truncate_before_message_id?, truncate_before_user_ordinal?, confirm_truncate?, confirm_empty_truncate?, confirm_deep_truncate?, rebind_survivor_row_ids?}` -> `{status: 'streaming'|'queued'|'steered'|'redirected', voice_stopped?, user_row_id?, survivor_row_ids?, survivor_row_id_map?, turn_isolation?}` (`contracts/prompt_voice.py:26-77`). `_hosted_task` / `_turn_author` are in-process only and rejected from clients (4124).
- Client timeout for the ACK must be 30 minutes: `PROMPT_SUBMIT_REQUEST_TIMEOUT_MS = 1_800_000` (`apps/desktop/src/api/client.ts:23`, rationale at `:18-22`: matches `agent.gateway_timeout = 1800s`).

**Stream turn**
- No RPC; the turn streams as `event` notifications on the same socket (section 3.2). Desktop handler: `src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts:150-300`.
- Mid-turn corrections: `session.steer`, `session.redirect`, `session.control`, `session.control.read` (`contracts/config_free_tier_control.py:700-752`).

**Tool approval**
- Server asks the client with a server->client request; the desktop's request registry answers it. Related RPCs:
  - `approval.pending {session_id}` -> `{approvals: [PendingApproval]}` (`contracts/prompt_voice.py:300-303`) - replay after reconnect/poll.
  - `approval.received {session_id, request_id}` -> `{acknowledged}` (`:306-315`) - tells the backend the card is on screen, starting its timeout clock.
  - `approval.respond {session_id, choice?, all?, request_id?}` -> `{resolved}` (`:318-334`); `choice` is one of the offered approval choices (once / session / always / deny); neither `all` nor `request_id` means "oldest".
  - Client-side timeout must match the backend's window: `APPROVAL_RESPOND_TIMEOUT_MS = 300_000` (`apps/shared/src/json-rpc-gateway.ts:56`, rationale `:44-55`).
  - `approval.cancelled` event = interrupt/reap/teardown dropped the queue (resolved as deny, not a user refusal) (`contracts/events.py:407-424`).

**Cancel**
- `session.interrupt {session_id, expected_hosted_task_id?}` (`contracts/sessions.py:604`).
- Desktop pattern: interrupt the runtime id, and on a stale id `session.resume` the stored id then retry (`src/app/chat/session-tile-actions.ts:381-386`, test `session-tile-actions.test.ts:154-158`).
- Also used at Stop: `process.stop` for owned background processes (`src/app/session/hooks/use-prompt-actions/index.test.tsx:244-246`).

### 3.4 REST endpoints used by `src/api/*`

All go through `hermesApi({path, method, body, profile?, connectionId?, timeoutMs?, upload?, passive?, priority?})` -> IPC `hermes:api`. Request shape: `src/global.d.ts:1512-1548`.

**Health / status / auth**
| Method + path | Client | Server |
|---|---|---|
| `GET /api/health` | readiness probe `electron/backend-health.ts:239` | `hermes_cli/web_routers/status.py:116` |
| `GET /api/status` | `src/api/config.ts:89-90` | `status.py:466` (body: `version, release_date, config_version, can_update_hermes, gateway_running, gateway_state, gateway_platforms, active_agents, gateway_busy, active_sessions, auth_required, auth_providers, auth_flows, nous_session_valid, install_id, shared_profile_warning, components, overall`) |
| `GET /api/auth/providers` | `main.ts:6330-6333`, `main.ts:10622` | `dashboard_auth/routes.py:203` |
| `POST /api/auth/ws-ticket` | `electron/oauth-rest-request.ts:134-138` | `routes.py:556-564` -> `{ticket, ttl_seconds}` |
| `POST /auth/native/token` / `POST /auth/native/refresh` / `GET /auth/native/authorize` | `electron/native-oauth.ts:126-131` | `routes.py:574,594,289` |
| `GET /auth/login`, `GET /auth/callback`, `POST /auth/password-login`, `POST /auth/logout`, `GET /api/auth/me` | embedded login window | `routes.py:217,338,447,496,524` |

**Sessions**
| Method + path | Client line | Server line |
|---|---|---|
| `GET /api/sessions?limit&offset&min_messages&archived&order` | `src/api/sessions.ts:110-113` | `web_routers/sessions.py:177` |
| `GET /api/profiles/sessions?limit&offset&min_messages&archived&order&profile&source&exclude_sources` | `sessions.ts:153-156` | `web_routers/profiles.py:453` (cap `le=500`) |
| `GET /api/profiles/sessions/sidebar?recents_profile&recents_limit&cron_limit&messaging_limit&recents_exclude&messaging_exclude` | `sessions.ts:334-336` | `profiles.py:514` (404 -> legacy fallback `sessions.ts:346-352`) |
| `POST /api/profiles/sessions/pull-requests {ids}` | `sessions.ts:303-307` | `profiles.py:768` |
| `GET /api/sessions/search?q=&profile=` | `sessions.ts:438-439` | `sessions.py:284` |
| `GET /api/sessions/{id}?profile=` | `sessions.ts:455-456` | `sessions.py:562` |
| `GET /api/sessions/{id}/messages?profile&limit&offset&order&include_compacted` | `sessions.ts:498-500` | `sessions.py:723` |
| `GET /api/sessions/{id}/timeline?limit&after_row_id` | `src/api/session-transcript-paging.test.ts` references | `sessions.py:785` |
| `GET /api/sessions/{id}/messages/around?row_id&limit` | ditto | `sessions.py:807` (limit `le=120`) |
| `PATCH /api/sessions/{id} {title|archived|pinned|unread, profile}` | `sessions.ts:385-425,739-742` | `sessions.py:892` |
| `DELETE /api/sessions/{id}?profile=` | `sessions.ts:725-727` | `sessions.py:830` (already-absent is idempotent success) |
| `POST /api/sessions/owner-backfill {profile?}` | `src/lib/legacy-session-owner-backfill.ts:70-74` | `sessions.py:853` |

Paging contract: `LATEST_SESSION_MESSAGES_LIMIT = 120` (`sessions.ts:522`); `order: 'latest'` pages with `offset` measured **back from the newest** row, returned chronologically (`sessions.ts:676-690`); a response with no `pagination` field means the backend ignored paging and returned the whole transcript (`sessions.ts:521-560`, `:698-712`).

**Config / env / models / analytics**
`GET /api/config` (`src/api/config.ts:134`), `GET /api/config?include_defaults=false` (`:161`), `GET /api/config/defaults` (`:167`), `GET /api/config/schema` (`:175`), `PUT /api/config` (`:186-188`, optional `preserve_language=true`), `GET /api/env` (`:207`), `PUT /api/env` (`:221`), `DELETE /api/env` (`:230`), `POST /api/env/reveal` (`:239`), `POST /api/providers/validate` (`:259`), `GET/POST /api/providers/custom-endpoints` (`:268,278`), `POST /api/providers/custom-endpoints/validate` (`:290`), `POST /api/providers/custom-endpoints/{id}/activate` (`:302`), `DELETE /api/providers/custom-endpoints/{id}` (`:310`), `GET /api/providers/oauth` (`:318`), `DELETE /api/providers/oauth/{providerId}` (`:328`), `GET /api/logs?<suffix>` (`:127`).
Models: `GET /api/model/info` (`src/api/models.ts:23`), `GET /api/analytics/usage?days=` (`:31`), `GET /api/model/options?...` (`:59`), `GET /api/model/recommended-default?provider=` (`:77`), `POST /api/model/set {scope:'main',...}` (`:87-98`), `GET /api/model/auxiliary` (`:100`), `GET/PUT /api/model/moa` (`:107,117`).

**Cron** (`src/api/cron.ts`)
`GET /api/cron/jobs` (`:36`), `GET /api/cron/jobs/{id}` (`:45`), `GET /api/cron/jobs/{id}/runs?limit=` (`:53`), `GET /api/cron/delivery-targets` (`:75`), `POST /api/cron/jobs` (`:85`), `PUT /api/cron/jobs/{id} {updates}` (`:95`), `POST /api/cron/jobs/{id}/pause` (`:105`), `.../resume` (`:114`), `.../trigger` (`:123`, long timeout), `DELETE /api/cron/jobs/{id}` (`:133`), `GET /api/cron/blueprints?profile=` (`:152`), `POST /api/cron/blueprints/instantiate?profile=` (`:164`). Server: `web_routers/cron.py:668-880`.

**Capabilities / skills / tools / mcp / messaging / profiles / local-models / plugins**
`GET /api/skills` (`src/api/skills.ts:17`), `GET /api/skills/content?name=` (`:29`), `PUT /api/skills/toggle {name,enabled}` (`:40`), `GET /api/learning/graph` (`:51`, path intentionally kept as `learning`), `GET/PUT/DELETE /api/learning/node` (`:65,72,85`), `GET /api/skills/hub/official|sources|search|preview|scan`, `POST /api/skills/hub/install|uninstall|update` (`:105-170`).
`GET /api/tools/toolsets`, `PUT /api/tools/toolsets/{name} {enabled}`, `GET .../config`, `GET .../models`, `PUT .../model`, `PUT .../provider`, `POST .../post-setup`, `GET /api/tools/terminal/backends`, `PUT /api/tools/terminal/backend`, `GET /api/tools/computer-use/status`, `POST /api/tools/computer-use/permissions/grant` (`src/api/toolsets.ts:20-142`).
`GET/POST/PUT /api/mcp/servers`, `DELETE /api/mcp/servers/{name}`, `POST /api/mcp/servers/{name}/test`, `PUT /api/mcp/servers/{name}/enabled`, `GET /api/mcp/catalog`, `POST /api/mcp/catalog/install` (`src/api/mcp.ts:30-133`; server `web_routers/mcp.py:94-473`).
`GET /api/messaging/platforms`, `PUT /api/messaging/platforms/{id}`, `POST .../test`, telegram onboarding trio, `GET /api/pairing`, `POST /api/pairing/approve|revoke`, `GET/POST /api/webhooks`, `POST /api/webhooks/enable`, `DELETE /api/webhooks/{name}`, `PUT /api/webhooks/{name}/enabled` (`src/api/messaging.ts:21-198`).
`GET/POST /api/profiles`, `PATCH/DELETE /api/profiles/{name}`, `GET/PUT /api/profiles/{name}/soul`, `GET .../setup-command`, `POST .../export`, `POST /api/profiles/import` (`src/api/profiles.ts:14-116`; server `web_routers/profiles.py:806-1145`).
`/api/local-models/{status,hardware,catalog,runtime/install,quickstart,download,download/pause,download/resume,activate,eject,server,jobs,jobs/{id},search,search/files,download-browsed,sideload}` + `DELETE /api/local-models/models/{id}` (`src/api/local-models.ts:16-207`).
Plugin doors: REST `hermesApi({path: '/api/plugins/<pluginId><suffix>'})` (`src/api/plugins.ts:66-83`) and WS `/api/plugins/<pluginId><suffix>?token=` (`:89-115`).

**Audio / voice** (`src/api/system.ts`)
`POST /api/audio/transcribe` (`:189`), `POST /api/audio/speak {text}` (`:211`), `POST /api/audio/tts-lease {active,lease}` (`:234`), `POST /api/audio/stt-lease` (`:256`), `GET /api/audio/elevenlabs/voices` (`:265`), `GET /api/audio/voice-config` (`src/lib/voice-client-direct.ts:94`), `POST /api/audio/voice-live/session` (SDP offer/answer, timeout `45_000`, `src/lib/voice-live.ts:333-335`), `GET /api/audio/voice-live/status` (`:85`). Streams: `/api/audio/transcribe-stream`, `/api/audio/speak-stream` (raw int16 PCM frames, `web_routers/audio.py:515,592`).

**Memory / curator / system**
`GET/PUT /api/memory/providers/{provider}/config?surface=declared` (`src/api/system.ts:63,74`), `POST .../oauth/start` (`:88`), `GET .../oauth/status` (`:99`), `GET /api/memory` (`:110`), `POST /api/memory/reset {target}` (`:117`), `GET /api/curator` (`:126`), `PUT /api/curator/paused` (`:133`), `POST /api/curator/run` (`:142`), `POST /api/gateway/restart` (`:151`), `POST /api/hermes/update` (`:159`), `GET /api/hermes/update/check?force=` (`:170`), `GET /api/actions/{name}/status?lines=` (`:177`), `GET /api/git/gh-auth?refresh=` (`:276`).

**Filesystem / media**
`GET /api/fs/list|read-text|read-data-url|git-root|default-cwd`, `POST /api/fs/write-text`, `POST /api/files/mkdir`, `GET /api/git/file-diff`, `GET /api/media/proxy?url=` (`src/lib/desktop-fs.ts:57,141,149,212,259`, `src/lib/media.ts:134,350`; server `web_routers/files.py:762-984`, `:373`).

**Git (server side)**
`GET /api/git/status|worktrees|branches|base-branches|review/list|review/diff|file-diff|review/commit-context|review/rev-parse|review/ship-info`, `POST /api/git/review/pr-list|stage|unstage|revert|commit|push|create-pr|worktree/add|worktree/remove` (`web_routers/git.py:50-215`). Desktop prefers local git IPC (`electron/git-ipc.ts`) and only falls back to these over REST.

### 3.5 Constants a client must match

| Constant | Value | Where |
|---|---|---|
| `STARTUP_REQUEST_TIMEOUT_MS` | `60_000` | `src/api/client.ts:17` |
| default RPC/request timeout | `30_000` | `src/api/client.ts:18` |
| `PROMPT_SUBMIT_REQUEST_TIMEOUT_MS` | `1_800_000` | `src/api/client.ts:23` |
| `APPROVAL_RESPOND_TIMEOUT_MS` | `300_000` | `apps/shared/src/json-rpc-gateway.ts:56` |
| WS connect timeout | `15_000` | `apps/shared/src/json-rpc-gateway.ts` (`DEFAULT_CONNECT_TIMEOUT_MS`) |
| heartbeat interval / deadline | `15_000` / `45_000` | `apps/shared/src/json-rpc-channel.ts:154-155` |
| WS ticket TTL | 30s, single use | `dashboard_auth/routes.py:558-564` |
| OAuth access / refresh token TTL | ~15 min / 24h rotating, reuse-detected | `electron/connection-config.ts:29-36` |
| backend ready budget / poll / health probe | `180_000` / `500` / `5_000` | `electron/backend-health.ts:5-12` |
| transcript tail page | `120` rows | `src/api/sessions.ts:522` |
| replay ring | 512 events, 4 MiB/session, 64 sessions, 64 MiB process | `tui_gateway/event_replay.py:29-35` |
| server WS send deadline | `30.0s` (client heartbeat deadline is 45s) | `tui_gateway/ws.py:52-57` |
| token coalescing | `0.033s` (~30fps) for `message.delta`/`reasoning.delta`/`thinking.delta` | `tui_gateway/ws.py:33-35` |

---

## 4. Auth

### 4.1 Local / loopback (desktop-spawned)

- Mode is **token**. `_SESSION_TOKEN = HERMES_DASHBOARD_SESSION_TOKEN or secrets.token_urlsafe(32)` (`hermes_cli/web_server.py:382-386`).
- REST: header `X-Hermes-Session-Token: <token>` (`web_server.py:387`, validation `:457-497`).
- WS: `?token=` compared with `hmac.compare_digest` against `_SESSION_TOKEN` (`hermes_cli/web_server_chat.py:376-379`).
- A desktop-owned loopback backend is **not** behind the OAuth gate (`web_server.py:547-565` `_desktop_loopback_auth_exempt`, requiring `HERMES_DESKTOP=1` plus a per-spawn credential), so `GET /` serves the token and the desktop reads `window.__HERMES_SESSION_TOKEN__` (`electron/dashboard-token.ts:31-45`). On a **gated** serve the token is deliberately withheld (`web_server_dashboard.py:124-128`).
- No unix socket auth path exists for the API. The unix socket (`gateway.sock`) is admin-only and unused by the desktop.

### 4.2 Remote token mode

Same shape: static token stored (optionally safeStorage-encrypted) in the connection config -> REST header, WS `?token=` (`electron/connection-config.ts:82-88`).

### 4.3 Remote OAuth mode (the live `https://hermes.shameel.dev`)

- Detection: `GET /api/status` -> `auth_required: true` means gated; `authModeFromStatus` maps that to `'oauth'` (`electron/connection-config.ts:1116-1118`). Flows advertised as `auth_flows: ['cookie', 'native_pkce']` plus `auth_providers` (`web_routers/status.py:367-390`).
- REST, preferred leg: `Authorization: Bearer <native access token>` (`main.ts:5640-5645`, `:6364-6366`, `media-protocol.ts:176-182`).
- REST, fallback leg: the Electron session partition's HttpOnly cookies. Cookie names, in deploy-shape order: `__Host-hermes_session_at` / `__Secure-hermes_session_at` / `hermes_session_at` for the access token, and the `_rt` variants for the 24h rotating refresh token (`electron/connection-config.ts:23-36`). Liveness is proven by minting a ticket (which triggers server-side rotation), not by cookie presence (`main.ts:7279-7283`).
- WS: `POST /api/auth/ws-ticket` (cookie- or bearer-authed) -> `{ticket, ttl_seconds: 30}`; then `wss://<host>/api/ws?ticket=<ticket>` (`electron/connection-config.ts:91-97`; server `dashboard_auth/routes.py:556-564`, `dashboard_auth/ws_tickets.py:4-11`). One ticket per socket; minted immediately before each dial (`apps/shared/src/websocket-url.ts:12-16`, `main.ts:8096`). Gated servers also accept `?token=<user session access token>` on the upgrade (verified via the same `verify_session` seam as the bearer REST leg) but reject the legacy in-process `_SESSION_TOKEN` (`web_server_chat.py:326-375`).
- Native PKCE (RFC 8252), chosen when `auth_flows` contains `native_pkce` and at least one non-password provider exists (`electron/native-oauth.ts:22-35,85-93`):
  1. `GET /auth/native/authorize?provider=&code_challenge=<S256>&code_challenge_method=S256&redirect_uri=http://127.0.0.1:<port>/callback&state=` in the system browser (`native-oauth.ts:126-131`; server `routes.py:289`).
  2. Loopback listener captures `code`; `POST /auth/native/token {code, code_verifier, ...}` -> `{access_token, refresh_token, token_type:'Bearer', expires_at, provider, user_id}` (`routes.py:574`).
  3. Refresh via `POST /auth/native/refresh {refresh_token}` (`routes.py:594`); the desktop refreshes before expiry (`main.ts:7852-7854`).
  4. Persistence: `userData/native-oauth-tokens.json`, keyed by gateway base URL, values safeStorage-encrypted (`main.ts:7862-7865`, `electron/native-token-store.ts:4-11`).
- Embedded-webview fallback (all-password providers or an older gateway): `GET /auth/login?provider=&next=` -> provider -> `GET /auth/callback` sets the session cookie; `POST /auth/password-login` for the dashboard form; `POST /auth/logout`; `GET /api/auth/me` (`routes.py:217,338,447,496,524`).
- Per-connection custom headers (e.g. Cloudflare Access) are supported and stored per connection as `{name: {encoding: 'plain'|'safeStorage', value}}` (`electron/connection-config.ts:354-396`); `Authorization` and `Cookie`/`Host` are reserved (`connection-config.test.ts:88-91`).
- SSH mode (desktop-only): the backend is started with `--ssh-session-token-file <path>` and `--ssh-owner-nonce <nonce>`; the token file is read then unlinked (`hermes_cli/subcommands/dashboard.py:53-58`, `hermes_cli/main_dashboard.py:723-727`).

### 4.4 What is public without any credential

Exactly nine paths (`hermes_cli/dashboard_auth/public_paths.py:12-27`): `/api/health`, `/api/status`, `/api/config/defaults`, `/api/config/schema`, `/api/model/info`, `/api/dashboard/themes`, `/api/dashboard/plugins`, `/api/cron/fire` (self-authenticating JWT).

---

## 5. Flow-ordered endpoint/frame table (acceptance)

Ordered by the user-visible flow. "WS" rows are JSON-RPC frames on `/api/ws`.

| # | Flow step | Transport | Endpoint / frame | Params -> result | Source `path:line` |
|---|---|---|---|---|---|
| 1 | Probe reachability | HTTP GET | `/api/health` | `{}` -> liveness body | `electron/backend-health.ts:239`; `hermes_cli/web_routers/status.py:116` |
| 2 | Learn auth shape | HTTP GET | `/api/status` | `{}` -> `{auth_required, auth_flows, auth_providers, version, ...}` | `src/api/config.ts:89-90`; `status.py:466`; gate fields `status.py:367-390` |
| 3 | Discover providers | HTTP GET | `/api/auth/providers` | `{}` -> `{providers:[...]}` | `main.ts:6330-6333`; `dashboard_auth/routes.py:203` |
| 4 | Mint WS credential (oauth only) | HTTP POST | `/api/auth/ws-ticket` | `{}` (cookie/bearer authed) -> `{ticket, ttl_seconds:30}` | `electron/oauth-rest-request.ts:134-138`; `routes.py:556-564` |
| 5 | Open the socket | WS | `GET /api/ws?token=` (token) or `?ticket=` (oauth); `&profile=` for a shared remote | upgrade -> first frame `gateway.ready {skin, change_events, heartbeat, replay_epoch}` | `electron/connection-config.ts:82-97`; `tui_gateway/ws.py:366-370`; `web_server_chat.py:250-375` |
| 6 | Declare client capabilities | WS | `client.capabilities {}` | -> server->client request methods the backend may send | `apps/shared/src/json-rpc-channel.ts:489-492`; `contracts/liveness.py:46` |
| 7 | Keepalive | WS | `gateway.ping {}` every 15s | -> pong; 45s deadline, any inbound frame counts | `json-rpc-channel.ts:154-155,555-572` |
| 8 | List sessions (sidebar) | HTTP GET | `/api/profiles/sessions/sidebar?recents_profile&recents_limit&cron_limit&messaging_limit&recents_exclude&messaging_exclude` | -> `{recents, cron, messaging, errors?, storage?}` | `src/api/sessions.ts:334-336`; `hermes_cli/web_routers/profiles.py:514` |
| 9 | List sessions (single profile) | HTTP GET | `/api/sessions?limit&offset&min_messages&archived&order` | -> `PaginatedSessions` | `sessions.ts:110-113`; `web_routers/sessions.py:177` |
| 10 | List sessions (all profiles) | HTTP GET | `/api/profiles/sessions?...&profile=all&source=&exclude_sources=` | -> `PaginatedSessions` | `sessions.ts:153-156`; `profiles.py:453` |
| 11 | Search sessions | HTTP GET | `/api/sessions/search?q=&profile=` | -> `SessionSearchResponse` | `sessions.ts:438-439`; `sessions.py:284` |
| 12 | Open session: hydrate tail | HTTP GET | `/api/sessions/{id}/messages?limit=120&order=latest&include_compacted=true[&profile=]` | -> `{session_id, messages[], pagination?}` | `sessions.ts:498-560`; `sessions.py:723` |
| 13 | Open session: older pages | HTTP GET | `/api/sessions/{id}/messages?limit=&offset=<back from newest>&order=latest&include_compacted=true` | -> next older page | `sessions.ts:676-690`; `sessions.py:723` |
| 14 | Open session: attach live runtime | WS | `session.resume {session_id:<stored>, cols:96, omit_messages:true, source:'desktop'}` | -> `LiveSessionSnapshot {session_id:<runtime>, stored_session_id, messages, info, inflight?, queued?, pending_approval?, open_requests?, todo_state?}` | `src/app/hooks/use-session-tile-delegate.ts:409-412`; `contracts/sessions.py:183-205` |
| 15 | Open session: fallback attach | WS | `session.activate {session_id, cols?, omit_messages?}` | -> `LiveSessionSnapshot` | `contracts/sessions.py:215`; dispatcher test `src/contrib/session-rpc-dispatcher.test.ts:198-203` |
| 16 | New chat | WS | `session.create {profile?, source:'desktop', model?, provider?, cwd?, ...}` | -> `{session_id, stored_session_id, message_count, messages, info}` | `contracts/sessions.py:105-151`; `src/app/session/hooks/default-new-session.test.tsx:172-176` |
| 17 | Send turn | WS | `prompt.submit {session_id, text, ...}` | -> `{status:'streaming'|'queued'|'steered'|'redirected', user_row_id?, ...}`; client timeout 1_800_000 ms | `contracts/prompt_voice.py:26-77`; `src/api/client.ts:23` |
| 18 | Stream turn | WS event | `message.start` -> `message.delta {text}`* -> `message.interim {text}`? -> `tool.*`? -> `message.complete` | `event` notifications with `{type, session_id, payload, seq}` | `apps/shared/src/gateway-contract.generated.ts:5994-6068`; handler `src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts:150-300` |
| 19 | Stream reasoning | WS event | `reasoning.delta {text}` / `reasoning.available {text}` / `thinking.delta {text}` | same envelope | `gateway-contract.generated.ts` (event list); `message-stream.ts:250-290` |
| 20 | Tool progress | WS event | `tool.start` / `tool.generating` / `tool.complete` / `tool.output_risk` / `todo.updated` | same envelope | `tui_gateway/contracts/events.py:280-324` |
| 21 | Tool approval: card appears | WS server->client request | backend request `{id:<string>, method, params:{session_id, ...}}` | client answers `respond(result)` / `fail(code,msg)` / `decline()` (4404) | `apps/shared/src/json-rpc-channel.ts:11-59`; `tui_gateway/server_requests.py:110-115` |
| 22 | Tool approval: ack on screen | WS | `approval.received {session_id, request_id}` | -> `{acknowledged}` (starts the backend timeout clock) | `contracts/prompt_voice.py:306-315` |
| 23 | Tool approval: replay after reconnect | WS | `approval.pending {session_id}` | -> `{approvals:[PendingApproval]}` | `contracts/prompt_voice.py:300-303` |
| 24 | Tool approval: decide | WS | `approval.respond {session_id, choice, request_id?|all?}` | -> `{resolved}`; client timeout must be 300_000 ms | `contracts/prompt_voice.py:318-334`; `json-rpc-gateway.ts:56` |
| 25 | Tool approval: cancelled | WS event | `approval.cancelled` | payload marks interrupt/reap/teardown deny | `contracts/events.py:407-424` |
| 26 | Cancel turn | WS | `session.interrupt {session_id:<runtime>}` | -> interrupt result; on a stale id `session.resume` the stored id then retry | `contracts/sessions.py:604`; `src/app/chat/session-tile-actions.ts:381-386` |
| 27 | Cancel background work | WS | `process.stop {}` (plus `process.list` for the status stack) | -> stop result | `src/app/session/hooks/use-prompt-actions/index.test.tsx:244-246`; `contracts/tools_commands.py:118` |
| 28 | Reconnect replay | WS | `session.events.since {session_id, last_seen:<seq>}` | -> recorded event objects with `seq > last_seen` + `truncated`; compare `replay_epoch` to detect a server restart | `tui_gateway/event_replay.py:131-153`; `apps/shared/src/json-rpc-gateway.ts` (fetchReplay) |
| 29 | Session mutations | HTTP PATCH/DELETE | `PATCH /api/sessions/{id} {title|archived|pinned|unread, profile}`; `DELETE /api/sessions/{id}?profile=` | -> `{ok, title}` / `{ok}` | `sessions.ts:385-425,725-742`; `sessions.py:830,892` |
| 30 | Model / config read | HTTP GET | `/api/model/info`, `/api/model/options`, `/api/config`, `/api/config/defaults`, `/api/config/schema` | -> typed bodies | `src/api/models.ts:23,59`; `src/api/config.ts:134,161,167,175` |
| 31 | Cron list/manage | HTTP | `/api/cron/jobs`, `/api/cron/jobs/{id}[/runs|/pause|/resume|/trigger]`, `/api/cron/delivery-targets` | -> job bodies | `src/api/cron.ts:36-166`; `web_routers/cron.py:668-880` |

---

## 6. Hard blockers for a mobile client

Ordered by severity.

1. **Chat is WS-only; there is no REST session-create or turn-submit.** `hermes_cli/web_routers/sessions.py` exposes only list/search/detail/messages/timeline/around (GET), rename (PATCH), delete (DELETE), plus bulk-delete/import/prune/owner-backfill POSTs. Creating a live session and sending a turn exist only as `session.create` / `prompt.submit` RPCs. A mobile client MUST implement the JSON-RPC WS client (including server->client request handling for approvals) to be a chat client at all.
2. **Local backends are unreachable from a phone.** Electron spawns `hermes serve --host 127.0.0.1 --port 0` (`electron/backend-command.ts:20-27`) and discovers existing ones through machine-local `spawn-ledger.json` (`electron/backend-discovery.ts:60-137`). A mobile app cannot spawn that child and cannot read that file. It must either use a remote gateway (`https://hermes.shameel.dev` style) or the user must re-expose a LAN gateway with `--host` and a TLS/auth posture the desktop never sets up.
3. **Local backend credentials are per-spawn and only readable in-process.** The session token is `HERMES_DASHBOARD_SESSION_TOKEN` or a fresh `secrets.token_urlsafe(32)` (`hermes_cli/web_server.py:382-386`), and a **gated** server withholds it from `GET /` (`web_server_dashboard.py:124-128`). A mobile client cannot bootstrap a local token the way Electron does unless the backend is desktop-owned loopback (which it cannot be on the phone).
4. **Electron-main-only routing semantics have no server equivalent.** `hermes:api` request fields `profile`, `connectionId`, `priority: 'foreground'`, `passive`, `upload` (ArrayBuffer over IPC), `timeoutMs` (`src/global.d.ts:1512-1548`) drive backend pool selection, registry routing, and remote-splice rewriting inside `main.ts:17600-17720`. A mobile client gets none of that; it must pick one backend per request itself and map `profile` to a `?profile=` query param (the server accepts it on most handlers, e.g. `web_routers/sessions.py:723`, `audio.py:535,624`).
5. **Profile multiplexing on a shared backend is a request-scope convention, not a connection concept.** `/api/ws` itself does not read `?profile=` (no reference in `tui_gateway/ws.py` or `hermes_cli/web_server.py`); profile selection rides per-RPC `profile` params (`ProfileParams`, `contracts/common.py:231-234`) and per-request `?profile=`. The desktop additionally appends `&profile=` for shared remotes (`electron/plugin-profile-routes.ts`, asserted in `plugin-profile-routes.test.ts:258-263`). Mobile must replicate the convention exactly or it will read the wrong profile's data.
6. **`?ticket=` is single-use with a 30s TTL.** Each WS (re)connect needs a fresh `POST /api/auth/ws-ticket`. Any reconnect logic that caches a URL will fail on the second dial (`dashboard_auth/routes.py:558-564`, `apps/shared/src/websocket-url.ts:12-16`).
7. **Approval semantics require answering server->client requests, and declining is stateful.** A client that ignores a request gets `-32601` answered for it; a client that says "not shown" must send `decline` -> 4404, and the request only settles when every attached client declined (`tui_gateway/server_requests.py:25-28,110-115`). Getting this wrong wedges turns until timeout.
8. **Heartbeat + replay contract must be implemented or long turns look dead.** 15s ping / 45s deadline, and any inbound frame counts as liveness (`json-rpc-channel.ts:154-155,448-450`). Replay watermarks are per-session `seq` and must reset when `replay_epoch` changes (`event_replay.py:22-25`).
9. **Electron-only features have no mobile path.** Backend spawn/pool/reap, registry lifecycle pushes, pet overlay, HUD, quick entry, tray, native screenshot gesture, terminal PTY, local git review IPC, uninstall, updater, safeStorage, window chrome, `hermes:fs:reveal`/`rename`/`trash`.
10. **Media/FS endpoints are shaped for the desktop's IPC proxy.** `/api/fs/*`, `/api/files/*`, `/api/media`, `/api/media/proxy` return data URLs and base64 payloads designed to cross IPC (`src/lib/desktop-fs.ts:57-260`, `src/lib/media.ts:134,350`); large attachments will be heavy on mobile and `read-data-url` semantics differ from HTTP streaming (`/api/files/stream` exists with Range support at `web_routers/files.py:618-620`, which is the better mobile choice).
11. **TLS trust and custom headers.** Remote OAuth flows assume an Electron session partition with a cookie jar (`electron/oauth-rest-request.ts`, `remote-session-cookies.ts`); a native client must implement its own cookie jar for the cookie leg, or use the native PKCE bearer leg (`Authorization: Bearer`) which is cookie-free (`main.ts:7848-7854`). Cloudflare-style custom headers are per-connection config (`connection-config.ts:354-396`).
12. **Plugin doors assume the token-in-query-string pattern** (`/api/plugins/<id><suffix>?token=`, `src/api/plugins.ts:113-115`); for an OAuth-gated remote, `pluginSocket` resolves null and callers fall back to polling (`plugins.ts:89-93`). A mobile client must keep the same fallback.

---

## 7. Use unchanged vs must change

**Use unchanged (server contracts, verified above)**
- `/api/ws` JSON-RPC transport: frame shapes, `gateway.ready`, `gateway.ping`, `client.capabilities`, `session.events.since` replay.
- Chat RPCs: `session.create`, `session.resume`, `session.activate`, `prompt.submit`, `session.interrupt`, `session.close`, `session.history`, `session.steer`, `session.redirect`.
- Approval RPCs: `approval.pending`, `approval.received`, `approval.respond` + server->client request handling.
- Session REST: lists, sidebar, search, detail, messages/timeline/around paging, PATCH/DELETE.
- Config/model/cron/skills/toolsets/mcp/messaging/profiles/local-models REST.
- Auth REST: `/api/health`, `/api/status`, `/api/auth/providers`, `POST /api/auth/ws-ticket`, native PKCE trio (`/auth/native/authorize|token|refresh`).
- WS sibling streams: `/api/audio/transcribe-stream`, `/api/audio/speak-stream`, `/api/plugins/*`, `/api/display/ws?display_ticket=`.

**Electron/unix-socket-only (do not port)**
- `gateway.sock` control socket (CLI/admin only; unused by desktop).
- Backend spawn/attach/pool/reap, `spawn-ledger.json` discovery, `gateway.pid`/`gateway.lock` reads, host rendezvous.
- SSH mode (`--ssh-session-token-file`, `--ssh-owner-nonce`, remote lifecycle, control masters).
- The whole `hermes:api` scoping model (`profile`, `connectionId`, `passive`, `priority`, `upload`).
- `hermes:fs:*`, `hermes:git:review:*`, `hermes:uninstall:*`, `hermes:updates:*`, `hermes:bootstrap:*`, safeStorage, sync bootstrap channels.
- pet overlay / HUD / quick entry / tray / native screenshot / window controls / translucency.
- `/api/pty`, `/api/console`, `/api/pub`, `/api/events` (terminal + dashboard-chrome surfaces; not needed for a chat client).

---

## 8. Evidence index (path:line)

Desktop
- `apps/desktop/electron/preload.ts:14-27` (sync bootstrap reads), `:39-55` (connection + ws-url bridges), `:341-342` (api/notify)
- `apps/desktop/electron/main.ts:8077` (`mintGatewayWsTicket`), `:8096` (`freshGatewayWsUrl`), `:7848-7865` (native token store), `:10585-10630` (public status/providers probe), `:15710` (`hermes:gateway:ws-url`), `:16593` (`hermes:gateway:ws-url-for`), `:17600-17720` (`handleHermesApiRequest` + `hermes:api`), `:12349-12364` / `:13344-13359` (HTTP + WS double probe), `:4259-4263` (gateway.lock cleanup)
- `apps/desktop/electron/backend-discovery.ts:24-160`
- `apps/desktop/electron/backend-command.ts:3-62`
- `apps/desktop/electron/backend-health.ts:5-12,239-300`
- `apps/desktop/electron/backend-dial-claim.ts:16-56`
- `apps/desktop/electron/backend-connection-state.ts:1-40` (generation bookkeeping)
- `apps/desktop/electron/connection-config.ts:13-36,82-97,1112-1118,354-396`
- `apps/desktop/electron/dashboard-token.ts:31-97`
- `apps/desktop/electron/gateway-ws-probe.ts:9-18,171-176`
- `apps/desktop/electron/host-backend-attach.ts:50-52,116-118,202-206`
- `apps/desktop/electron/native-oauth.ts:22-35,85-93,126-131`; `native-token-store.ts:4-11`
- `apps/desktop/electron/oauth-rest-request.ts:129-138`
- `apps/desktop/electron/git-ipc.ts:70-101`; `fs-ipc.ts:47,149,183,236`; `desktop-uninstall.ts:84,106`
- `apps/desktop/src/api/client.ts:17-23,84-140,262-300`
- `apps/desktop/src/api/sessions.ts:110-156,303-336,385-425,438-560,676-742`
- `apps/desktop/src/api/{config,cron,models,skills,toolsets,mcp,messaging,profiles,local-models,plugins,system}.ts` (paths cited inline in section 3.4)
- `apps/desktop/src/lib/gateway-ws-url.ts:5-19`; `src/lib/sibling-ws-url.ts:1-90`; `src/lib/voice-playback.ts:182-186`; `src/lib/voice-stream.ts:36`
- `apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts:514-518,845-849,997,1509-1546`
- `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts:150-300`
- `apps/desktop/src/global.d.ts:976-1020` (HermesConnection), `:1512-1548` (HermesApiRequest)
- `apps/desktop/src/store/gateway.ts:473-550,841-843,1090-1131,1567-1700`

Shared
- `apps/shared/src/json-rpc-gateway.ts:44-64,150-200` (timeouts, event hub)
- `apps/shared/src/json-rpc-channel.ts:11-77,154-156,435-500,520-586`
- `apps/shared/src/websocket-url.ts:1-60` (auth-mode resolution, ticket re-mint)
- `apps/shared/src/gateway-events.ts:1-60` (envelope + client-local events)
- `apps/shared/src/gateway-contract.generated.ts:5836-6068`

Server
- `tui_gateway/ws.py:1-4,33-57,295-370`
- `tui_gateway/event_replay.py:22-35,48-50,131-153`
- `tui_gateway/server_requests.py:25-28,106-115`
- `tui_gateway/contracts/{sessions.py,prompt_voice.py,events.py,liveness.py,common.py,tools_commands.py,config_free_tier_control.py}`
- `hermes_cli/web_routers/chat_ws.py:161-172,299,538,701-724,740,752`
- `hermes_cli/web_server_chat.py:250-380,505-516`
- `hermes_cli/web_server.py:381-397,453-497,547-565,1160-1180,1461-1465,1606-1680`
- `hermes_cli/web_server_dashboard.py:124-128`
- `hermes_cli/dashboard_auth/routes.py:195-600`; `ws_tickets.py:4-11`; `public_paths.py:12-27`
- `hermes_cli/web_routers/status.py:116,149,157,366-390,466-543`
- `hermes_cli/web_routers/sessions.py:177,284,453-514,562,585,723,785,807,830,853,892,929,965`
- `hermes_cli/web_routers/profiles.py:453,514,768,806-1145`
- `hermes_cli/web_routers/{audio.py,display.py,files.py,git.py,cron.py,mcp.py,models.py,ops.py,skills.py,local_models.py}`
- `hermes_cli/subcommands/dashboard.py:17-19,53-58`; `hermes_cli/main_dashboard.py:723-727`
- `gateway/control_socket.py:3-6,28-33`; `gateway/status.py:43,307-328`

Live state
- `~/.config/Hermes/connections.json`, `~/.config/Hermes/connection.json`
- `~/.hermes/spawn-ledger.json` (3 serve records, ports 37423/42921/41327)
- `~/.hermes/gateway.pid` (pid 665847), `~/.hermes/gateway.lock` (present), no `~/.hermes/gateway.sock`
