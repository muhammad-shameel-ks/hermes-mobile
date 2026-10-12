# Mobile auth: what the Hermes server actually supports (read-only investigation)

Date: 2026-10-12. Sources: /home/shameel/.hermes/hermes-agent (server + desktop), /home/shameel/hermes-app (shipped Android app), live ~/.hermes and ~/.config/Hermes state, live https://hermes.shameel.dev.

NOTE ON THE FILE: this profile exposes only read/grep/glob/web_search/yield/generate_image - no write or shell tool - so /tmp/hermes-mobile-research/mobile-auth.md could not be created. The complete intended file content is this `report`; save it verbatim as that path. Nothing was written anywhere.

Unmarked statements are file/response facts. Anything reasoned rather than read is marked [INFERENCE].

---

## 0. Live topology (measured, not assumed)

- Live server: `GET https://hermes.shameel.dev/api/status` -> 200, `"version":"0.21.6"`, `"auth_required":true`, `"auth_providers":["basic"]`, `"auth_flows":["cookie","native_pkce"]`, `gateway_mode: multiplex`, `profiles: [default, bench-maxxer, pepper]` (fetched over TLS by a strict client; also `~/.hermes/logs/gateway.log:704` shows `dashboard-auth-basic: registered password provider (username=hermes-mobile)`).
- The phone account already exists: `~/.hermes/config.yaml` `dashboard.basic_auth` = username `hermes-mobile`, scrypt `password_hash`, and a STABLE `secret` (so tokens survive restarts; without that key the provider generates a random per-process key and every token dies on restart - `plugins/dashboard_auth/basic/__init__.py` `_settings`/`_resolve_secret`, docstring 30-33).
- Desktop client state: remote `https://hermes.shameel.dev` with `authMode: "oauth"` (`/home/shameel/.config/Hermes/connections.json`), `mode: "remote"` (`connection.json`), and `native-oauth-tokens.json` is `{}` - i.e. no PKCE tokens currently stored on this box; `secure-token-storage.json` = `{"on":false,"migrated":true}`.
- `/api/status` is deliberately public (not gated): `hermes_cli/dashboard_auth/public_paths.py:1-18` (`"Keep minimal: every entry must be safe for external uptime probes"`) and the gate's `_path_is_public` at `middleware.py:47-51`. This is the client's capability probe: read `auth_flows` / `auth_providers` BEFORE auth.

---

## 1. Q1 - Remote mode: the exact OAuth/PKCE flow the server supports

The gateway is BOTH the authorization server to the client and an OAuth client to the upstream IDP (`apps/desktop/electron/native-oauth.ts:24-32`; `hermes_cli/dashboard_auth/native_flow.py:1-12`). Endpoints (all three gate-exempt pre-auth: `middleware.py:39-43` `_GATE_PUBLIC_PREFIXES`):

### Flow A - native PKCE sign-in (the desktop's flow; the phone must use this)

1. Probe: `GET {base}/api/status` -> confirm `auth_flows` contains `"native_pkce"` (`native-oauth.ts:35`, `76-81`). Live value on the remote: `["cookie","native_pkce"]`.
2. Generate PKCE material locally: verifier = 32 random bytes base64url-no-pad (43 chars), `code_challenge = base64url(SHA256(ascii(verifier)))`, `state` = 24 random bytes base64url (`native-oauth.ts:60-70`). Android mirror: `Pkce` object, `PkceAuthClient.kt:59-110`.
3. Open the SYSTEM browser at `GET {base}/auth/native/authorize?code_challenge=<cc>&code_challenge_method=S256&redirect_uri=<percent-encoded http://127.0.0.1:PORT/callback>&state=<s>[&provider=<name>]` (`native-oauth.ts:114-138` builds exactly this; Android mirror `PkceAuthClient.kt:360-370`).
4. Validations, in this order, all 400: method must be `S256` (checked FIRST); `code_challenge` required; then `_validate_loopback_redirect_uri` (`routes.py:289-337`, validator at `routes.py:242-277`). Success for a password provider = `302 -> /login` plus `Set-Cookie: hermes_session_pkce=<opaque>; HttpOnly; Max-Age=600; SameSite=lax` (`routes.py:325-334`; cookie TTL `cookies.py:39` `_PKCE_MAX_AGE = 10*60`; over HTTPS it becomes `SameSite=None; Secure`, `cookies.py:3-11`). With >1 session provider: 200 HTML chooser (`routes.py:300-320`). Non-password providers: `_start_upstream_login` 302s to the IDP with the broker handle riding in that cookie (`routes.py:175-193`).
5. User signs in on `/login`. The page's own JS posts `POST /auth/password-login {"provider":"basic","username":…,"password":…}` and then assigns `window.location = data.next` (`login_page.py:419-428`); the route is `routes.py:447-495`, rate-limited 10/min/IP (`routes.py:406-437`). Server-side, `_complete_login` sees the `broker` in the PKCE cookie and calls `_finish_native_login` (`routes.py:119-133`, `162-172`), which mints a ONE-TIME code and answers `200 {"ok":true,"next":"http://127.0.0.1:PORT/callback?code=…&state=…"}` - an absolute redirect to the CLIENT'S OWN loopback, not the server's.
6. The phone's browser follows that URL; the app's listener (or intent filter) receives `?code=&state=`. The app MUST compare `state` (`native-oauth.ts:162-190` throws on mismatch; Android `classifyCallback` uses constant-time compare, `PkceAuthClient.kt:120-150`).
7. Redeem: `POST {base}/auth/native/token` with a JSON body `{"code":…,"code_verifier":…}` ONLY - form-encoded yields 422 (`routes.py:569-587`). Response 200: `{"access_token","refresh_token","token_type":"Bearer","expires_at","provider","user_id"}` (`_bearer_payload`, `routes.py:111-117`). Code is single-use, popped before the PKCE check (`native_flow.py:145-158`), TTL 120 s; pending broker entry TTL 600 s; global cap 256 entries, 8 pending per IP -> 503 (`native_flow.py:28-33`, `101-119`).
8. Authenticate REST with `Authorization: Bearer <access_token>`; cookies are never set on the native path (`middleware.py:166-181` is the bearer branch of the gate). `X-Hermes-Session-Token` does NOT authenticate under the gate -> 401 `{"error":"unauthenticated","detail":"Unauthorized","reason":…,"login_url":"/login"}` (`middleware.py:72-87`; PKCE-SPIKE.md §4 finding 1).
9. Live channel: `POST {base}/api/auth/ws-ticket` with the bearer -> `{"ticket":…,"ttl_seconds":30}` (`routes.py:556-566`, `ws_tickets.py:20-21` `TTL_SECONDS = 30`), then open `wss://{host}/api/ws?ticket=<ticket>`. One ticket per socket.

### Redirect-URI policy (the hard constraint for Expo)

`_validate_loopback_redirect_uri` (`routes.py:242-277`) rejects, with 400 detail strings:
- any scheme != `http` -> `"native redirect_uri must be http:// on the loopback interface"`;
- host not in {`127.0.0.1`, `[::1]`} -> `"native redirect_uri host must be a loopback IP literal (127.0.0.1 / ::1)"` (so `localhost` is rejected, RFC 8252 §8.3);
- non-canonical netloc/authority, userinfo, fragments, backslashes, controls, non-ASCII, empty.

Consequences: a reverse-DNS scheme (`dev.hermes.android://…`, `hermes://…`) is NOT accepted; no custom scheme of any kind is accepted; loopback IS required; the PATH is free (empty path is normalised to `/`), the PORT is free (any port on 127.0.0.1/::1). The desktop uses `http://127.0.0.1:<ephemeral>/callback`; the Android app pins `http://127.0.0.1:9527/callback` (`PkceAuthClient.kt:54-55`, `AndroidManifest.xml:82-125`).

### Token lifetimes and revocation

- Access TTL 12 h, refresh TTL 30 d (`plugins/dashboard_auth/basic/__init__.py:30-33`), overridable via `dashboard.basic_auth.session_ttl_seconds` / `HERMES_DASHBOARD_BASIC_AUTH_TTL_SECONDS` (`__init__.py:220-253`).
- `expires_at` is an ABSOLUTE epoch second, not `expires_in` (`base.py:18`, `native-oauth.ts:190-207`).
- Refresh rotation: `POST {base}/auth/native/refresh {"refresh_token":…,"provider":""}` -> new pair, or `401 {"error":"session_expired", …}` (re-login), or 503 when the provider is unreachable (`routes.py:589-617`).
- The gate does NOT rotate bearers server-side - the client must call refresh itself (`middleware.py:120-124` comment; Android `CredentialStore.kt:205-250` does exactly one attempt, no retry loop).
- `revoke_session()` is a stateless no-op (`plugins/dashboard_auth/basic/__init__.py:165-167`): per-device revocation is impossible today. `refresh_singleflight` (`refresh_singleflight.py`) coalesces concurrent refreshes server-side for the cookie path; the native path goes through `refresh_session_coalesced` too (`routes.py:594-610`).

### Q1 answers, stated plainly

- Authorize URL: `GET {base}/auth/native/authorize` (params above).
- Redirect URIs allowed: `http://127.0.0.1:<port>/<any-path>` or `http://[::1]:<port>/<any-path>`; nothing else.
- Token endpoint: `POST {base}/auth/native/token` (JSON only).
- Refresh: `POST {base}/auth/native/refresh` (JSON only).
- Expiry: 12 h / 30 d, absolute epoch; no revocation.
- Custom scheme / reverse-DNS deep link accepted? NO. Loopback required? YES.

---

## 2. Q2 - Local / LAN mode without OAuth

### The three local artifacts (what they actually are)

- `gateway.sock` (`~/.hermes/gateway.sock`) = the gateway CONTROL socket, buf if the home path is too long a temp-dir socket + `gateway.sock.path` pointer; Windows named pipe `\\.\pipe\hermes-gateway-<hash>`. Wire contract: ONE request per connection, one JSON line in, one out, then close; verbs are `identify` and `status`; counters `CONTROL_PROTOCOL_VERSION = 1`, 64 KiB request / 512 KiB response caps (`gateway/control_socket.py:1-8`, `28-33`). The module docstring is explicit: "Never a TCP port: filesystem/pipe ACLs are the auth boundary." It is NOT the chat/RPC surface and it is not reachable from a phone.
- `gateway.pid` and `gateway.lock` = the same JSON identity record (`{"pid":665847,"kind":"hermes-gateway","argv":[…,"gateway","run"],"start_time":…,"hermes_home":…}` on this box). The flock on `gateway.lock` is authoritative - "The PID file is advisory beside a HELD lock" (`gateway/status.py:2087-2090`), `_GATEWAY_LOCK_FILENAME = "gateway.lock"` (`status.py:43`), pid path `home/gateway.pid` (`status.py:307-311`); cleanup refuses while the lock is held (`hermes_cli/data_cleanup_holders.py:133-136`). Only the OWNER gateway process holds them: a profile SERVED by a multiplexer owns neither (`status.py:1319-1321`, `hermes_cli/profiles.py:822-826`). Live proof: `~/.hermes/gateway_state.json` says `"gateway_mode":"multiplex"` with 9 `served_profiles`.
- Implication: pid/lock/sock prove a live local host process; they carry NO client credential and give a phone nothing (the phone has no access to the host filesystem, and the unix socket is not proxied over TCP).

### How a client reaches the dashboard without OAuth

Two distinct seams, both loopback-scoped:

- Per-process SESSION TOKEN. `_resolve_session_token()` = `HERMES_DASHBOARD_SESSION_TOKEN` env or `secrets.token_urlsafe(32)`; header name `X-Hermes-Session-Token` (`web_server.py:382-387`, `457-474`). REST accepts header or `Authorization: Bearer <same token>`; `?token=` is WS-only (`_has_valid_query_token`, `web_server.py:476-480`, `_QUERY_TOKEN_API_PATHS`). On a loopback bind the token is readable at `GET /` (token-only HTML page carrying `window.__HERMES_SESSION_TOKEN__`; PLATFORM-API.md:22, 107-110).
- THE TOKEN PATH EXISTS ONLY WHEN THE GATE IS OFF. `auth_middleware` skips token checks entirely when `request.app.state.auth_required` is true (`web_server.py:710-719`), and `auth_required` is `should_require_auth(host) or any(non-loopback public_url)` (`web_server.py:522-543`), i.e. ANY non-loopback bind engages it and `--insecure` is a documented no-op (`web_server.py:1191-1197`). There is also a desktop-only exemption: loopback bind + `HERMES_DESKTOP=1` + an operator-minted credential (`web_server.py:546-564`).

### What the desktop itself does (the seam a phone cannot copy)

- Local connection: spawn `hermes --profile X serve --host 127.0.0.1 --port 0` (ephemeral port), then `waitForHermes(http://127.0.0.1:<port>, token)` and probe `ws://127.0.0.1:<port>/api/ws?token=<authToken>` (`apps/desktop/electron/main.ts:12196-12198`, `12331-12350`).
- SSH remote: spawn a detached remote `--isolated --port 0` dashboard, scrape its `HERMES_DASHBOARD_READY port=<n>` line, adopt the SERVED token, and reach it through an SSH tunnel (`apps/desktop/electron/remote-lifecycle.ts:1-30`, `main.ts:11730-11735`).
- Public HTTPS remote: PKCE bearer (Flow A).
So there is NO pairing code and NO trust-on-first-use: `~/.hermes/pairing/` and `platforms/pairing/` are messaging-platform user approvals (Telegram/DM pairing), not device credentials (`hermes_cli/backup.py:1073-1077`).

### Ports that matter

| Port | What | Binding rule |
|---|---|---|
| 9119 | Dashboard REST + `/api/ws` (`start_server(host="127.0.0.1", port=9119)`, `web_server.py:1591-1593`) | loopback = no gate, token auth; non-loopback = gate ON, refuses to start with no provider (`PLATFORM-API.md:152-171`) |
| ephemeral | Desktop-spawned local backend (`--port 0`, `main.ts:12197`) | 127.0.0.1 only |
| 8642 | Gateway `api_server` platform: OpenAI-compatible `/v1/...` + `/api/jobs` + `/health`, `DEFAULT_HOST=127.0.0.1`, `DEFAULT_PORT=8642`, `API_SERVER_KEY` bearer (`gateway/platforms/api_server.py:4-6`, `216-217`) | On this box the live `/api/status` reports `metrics.host=0.0.0.0, port=8642`, so it is LAN-reachable here. It is a DIFFERENT API from the desktop's RPC surface and is not what a UI mirror should use. |
| 9527 (client side) | The Android app's loopback redirect listener (`PkceAuthClient.kt:54`) | the phone's own 127.0.0.1; a fixed port is required because an Android intent filter cannot carry a dynamic one (`AndroidManifest.xml:110-118`) |

WhatsApp/webhook ports (8644/8645/8646/8765/8080/8090/3978) are gateway platform receivers (`hermes_cli/web_server_gateway.py:70-75`) - irrelevant to client auth.

### Q2 answer, stated plainly

Without OAuth a phone can reach the server only by (a) a LOOPBACK-BOUND dashboard published by a tunnel/proxy it trusts (Tailscale `serve`, SSH tunnel, `adb reverse`) plus the session token scraped from `GET /`, or (b) a NON-loopback bind with the gate ON and a real provider (password login / PKCE) - which is not "without OAuth" at all, just without a browser round trip. The unix socket is control-only; there is no pairing code; trust-on-first-use does not exist.

---

## 3. Q3 - Transport security

- Remote endpoint: `https://hermes.shameel.dev` answered a strict-TLS client (this investigation) with a valid public chain; the desktop connects to the same URL with Chromium defaults, and there is NO certificate bypass anywhere in `apps/desktop/electron/`: grep for `certificate-error|setCertificateVerifyProc|rejectUnauthorized|ignore-certificate|allowInsecure` returns no matches. The only TLS code is trust-WIDENING to the OS store on Windows/macOS: `installSystemCaTrust` merges `tls.getCACertificates('system')` into the defaults and explicitly skips Linux (`system-ca.ts:11-17`).
- Desktop HSTS state exists but hostnames are hashed: `~/.config/Hermes/TransportSecurity` holds 4 `force-https` STS entries (not resolvable to names by design).
- The desktop's real LAN workaround is not TLS at all: it keeps the far side loopback-bound and puts plain HTTP inside SSH (`main.ts:11730-11735`), or relies on Tailscale for the phone route (`docs/SPEC.md:501-514`).
- Android: `android:usesCleartextTraffic="false"` plus an explicit allowlist - `100.108.38.30` (Tailscale), `127.0.0.1`, `localhost`, `10.0.2.2`, `192.168.1.35` (`app/src/main/res/xml/network_security_config.xml`; rationale `docs/SPEC.md:485-499`). A NEW LAN IP (e.g. `192.168.1.42`) is blocked on the shipped app until an entry is added; that is the whole "LAN IP breaks on Android" story, and it is a config fact, not a TLS one.
- The loopback redirect itself is plain `http://127.0.0.1:PORT/callback` by server rule; that is safe (device-local) but the BROWSER must be able to reach the phone's own loopback, which both the socket path and the manifest intent filter handle (`CallbackActivity.kt:1-27`, `AndroidManifest.xml:110-125`).
- iOS [INFERENCE, no iOS code in either repo]: `ASWebAuthenticationSession` takes a custom callback SCHEME and cannot capture an `http://` redirect, and the server rejects custom schemes - so iOS would need either an in-app WKWebView with navigation interception or a system browser + an in-process loopback listener, plus ATS exceptions (`NSAllowsLocalNetworking`) for plain-HTTP LAN hosts and the iOS 14+ local-network permission. These are platform rules, not verified in this repo.

---

## 4. Q4 - What the shipped Android app concluded and shipped

Repo `/home/shameel/hermes-app` (package `dev.hermes.android`, minSdk 26, targetSdk 35, versionName 0.2.4 / versionCode 6, `app/build.gradle.kts`).

- SHIPPED v0.1 (documented, `RELEASE-NOTES.md`): connection = host + port + PASTED SESSION TOKEN, stored in EncryptedSharedPreferences; transport = Tailscale (100.108.38.30) with cleartext allowlisted; the release notes explicitly reject `--host 0.0.0.0` because a non-loopback bind engages the gate and refuses the session token on WS. Same ruling in `docs/SPEC.md:501-514` and `803`. APKs `dist/hermes-0.1..0.2.4-release-signed.apk` exist; documented releases stop at 0.2.2.
- CONCLUSION SHIPPED NEXT (in-tree, with tests, not in any documented release): the full PKCE design - system browser (never a WebView: `SignInCoordinator.kt:1-30` "Nothing is typed into the app"), fixed loopback port 9527 (`AndroidManifest.xml:82-125`), dual receiver (socket + `exported=false` intent filter), constant-time `state` check, JSON-only token bodies, `Authorization: Bearer` on REST, 30 s ws-ticket for the socket, single-attempt refresh, named failure states incl. `CallbackPortBusy` (`DESIGN-SPEC.md:772-776`), and the reasoning quoted clause-by-clause from PKCE-SPIKE.md §6 in `PkceAuthClient.kt:1-11`.
- Evidence it is only just implemented: `app/build/test-results/testDebugUnitTest/` is timestamped 2026-10-04T11:14Z with green suites `PkceTest` (22), `CredentialExpiryTest` (16), `ConnectionViewModelTest` (30), `SignInFailureMappingTest` (25); the git reflog's last entry is 2026-10-03T21:04Z (epoch 1791107919), i.e. after that commit history the PKCE build/test ran. [INFERENCE] the PKCE sources are uncommitted working-tree work and are in no signed APK yet; I cannot run git to prove it (read-only profile).
- Gap that matters most for an Expo port: `authorizeUrl`/`post`/`wsTicket` hardcode `"http://$host:$port"` (`PkceAuthClient.kt:360-370`, `430-470`) - the shipped Android client CANNOT talk to the HTTPS remote (`hermes.shameel.dev:443`); it only ever speaks cleartext to a tailnet/LAN host. An Expo client mirroring the desktop must make the scheme/port explicit (https/443 for remote mode).
- Security conclusion the Android docs state plainly: the PKCE bearer is unscoped and root-equivalent (full `/api/files`, `/api/config`, ...), so the phone credential is treated as root (`PKCE-SPIKE.md` §4-§5, `PHASE1-DESIGN.md:55-58`) and the mitigation shipped is a single-purpose `basic` account (the `hermes-mobile` username now in the live config).

---

## 5. Transport table (mobile verdict)

| Transport | How it authenticates | Works on a phone? | Notes / caveats |
|---|---|---|---|
| `~/.hermes/gateway.sock` (unix socket / Windows named pipe) | filesystem/pipe ACLs; verbs `identify`, `status` only | NO | On-device OS-level access only; one JSON line per connection; not the RPC/chat surface (`control_socket.py:1-8`) |
| Loopback dashboard behind `tailscale serve` / SSH tunnel / `adb reverse` (bind 127.0.0.1:9119) | gate OFF; `X-Hermes-Session-Token` (or `Authorization: Bearer <same>`) and `?token=` on WS | YES (the shipped Android v0.1 route) | Token is per-process random unless `HERMES_DASHBOARD_SESSION_TOKEN` is pinned -> re-enter after each host restart; token readable at `GET /`; Tailscale gives a REAL cert (MagicDNS/LE) so no cleartext exception is needed if https is used |
| LAN TCP `hermes serve --host <LAN-IP> --port 9119` | gate ON -> password login (cookies) or native PKCE; session-token header 401s | YES, but the worst option | Plain http needs an Android cleartext allowlist entry (shipped app lists 192.168.1.35 only) and iOS ATS exceptions [INFERENCE]; exposes all 299 REST paths (config, files, env) to the LAN; password login limited to 10/min/IP; bind refuses to start at all with no provider |
| Remote HTTPS (hermes.shameel.dev) | gate ON -> native PKCE bearer, or cookie session | YES - the recommended mobile route | Real trusted cert; `auth_flows` advertises `native_pkce`; needs a client-side loopback listener on a fixed port; token unscoped/root-equivalent; no revocation |
| Remote HTTPS + password login only (no listener) | `POST /auth/password-login {"provider":"basic",…}` then cookies; refresh is automatic server-side | YES if the runtime keeps cookies and the WS ticket is minted with them | No loopback listener needed at all; must handle `Set-Cookie` (`hermes_session_at/_rt/_provider`, `Secure` over https); `_require_session` accepts cookie sessions for `POST /api/auth/ws-ticket` (`routes.py:556-566`); 429 rate limit is the operational risk |
| Gateway `api_server` 8642 (OpenAI-compatible) | `API_SERVER_KEY` bearer | Technically reachable when bound 0.0.0.0 (as here) | Different API (`/v1/...`), not the desktop RPC surface; only for jobs/inference, not UI parity |

---

## 6. The concrete decision a mobile client faces (ranked)

1. RECOMMENDED - mirror the desktop exactly: remote HTTPS + native PKCE + a client-side loopback listener (fixed port) + `Authorization: Bearer` + ws-ticket + refresh. Server support is proven live (`auth_flows`, PKCE-SPIKE captured round trip) and needs zero server change. Costs: the client must (a) run an HTTP listener on 127.0.0.1 (not possible in Expo Go - needs a dev build/config plugin, or an Android http+port intent filter, or an in-app WebView with navigation interception), (b) hold the port across process death, (c) live with a root-equivalent unscoped token and no revocation. iOS capture of the http redirect is the open risk [INFERENCE].
2. Fallback with no loopback listener at all: remote HTTPS + password login + cookie session (POST /auth/password-login), then REST with cookies and `POST /api/auth/ws-ticket` for the socket. Fewest moving parts, server-side auto-refresh, but requires cookie persistence in the JS runtime and re-uses the `hermes-mobile` password (no per-device credential, 429 risk).
3. Tailnet route (what Android v0.1 shipped): `tailscale serve` in front of a loopback-bound dashboard + session token. No auth server involvement, real TLS, but a host-side dependency and a per-restart token paste.
4. LAN bind + provider: works, but cleartext exceptions, full surface exposure, and rate limits make it a dev-only escape hatch.
5. Anything involving `gateway.sock`/pairing codes/TOFU: does not exist for remote clients. Do not design around it.

### Explicit open decisions

1. Where the loopback redirect is captured on each platform: (a) in-JS/new-native TCP+HTTP listener, (b) Android http+port intent filter (Expo config plugin; impossible in Expo Go), (c) WKWebView/WebView navigation interception, (d) skip loopback entirely and use decision 2.ios specifics unverified.
2. Fixed vs ephemeral loopback port and its collision copy (Android pinned 9527 and made collision a named failure, `DESIGN-SPEC.md:772-776`).
3. Transport scheme handling: one base URL per connection with explicit scheme/port (https:443 vs http:LAN) - the shipped Android client's hardcoded `http://` is a known limitation to avoid repeating.
4. Credential model: accept the unscoped root-equivalent bearer (as Android did, mitigated by the `hermes-mobile` account) vs requiring the P-1 scope work server-side (not started: no `scope` field, no `client_id`, `revoke_session()` a no-op).
5. Refresh policy: exactly one attempt above a 60 s skew (desktop parity, `native-oauth.ts:242-250`) vs retry/backoff; and 401 `session_expired` vs `unauthenticated` (refresh vs re-login) must be distinguished (`routes.py:589-617`, `SignInFailureMappingTest`).
6. LAN posture for the new client: `tailscale serve` (real cert, gate off, token) vs gated non-loopback bind (password/PKCE over cleartext) - a product decision, since both work.
7. Session-token pinning on the host (`HERMES_DASHBOARD_SESSION_TOKEN`) if option 3/2 is chosen, otherwise the token changes on every host restart.
8. Whether the beta should prefer password-login cookies over PKCE when no loopback listener is available on a given platform, with the same UI states.
