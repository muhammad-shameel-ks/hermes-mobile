# hermes-mobile: build + verification toolchain

Measured on this workstation (omarchy/Arch, x64) on 2026-10-12. Every line marked **(measured)** is raw
output from this machine today; registry facts are `npm view <pkg>@<version>` / `api.npmjs.org` reads
taken today. `[INFERENCE]` marks reasoning that is not directly measured.

Repo under plan: `/home/shameel/workspace/hermes-mobile` (empty, must stay untouched by this report).

---

## 0. Decisions up front

| Question | Decision | Why |
|---|---|---|
| Expo SDK | **SDK 57**: `expo@57.0.28`, `react-native@0.86.3`, `react@19.2.3` | current stable (`npm view expo dist-tags` -> `latest: 57.0.28`); pairing read from `expo-template-blank@sdk-57` |
| Build mode | dev client + **CNG** (`expo prebuild`), never Expo Go | Expo Go cannot hold a custom native module (loopback listener) |
| JDK | **21.0.2** (`$(mise where java@21.0.2)`), pinned with `org.gradle.java.home` | system `java` is **26.0.2.1**; Gradle 9.3.1 (the SDK 57 wrapper) cannot run on Java 26 (needs Gradle >= 9.4.0) |
| Wrapper Gradle | **9.3.1** (whatever the template pins) | already in `~/.gradle/wrapper/dists/gradle-9.3.1-bin` (measured), so no download |
| Loopback listener | **`react-native-nitro-http-server@1.10.0`** + `react-native-nitro-modules@^0.37.1` | only candidate that is an actual HTTP server with a JS request handler, new-architecture native (Nitro), `start(port, handler, {host:'127.0.0.1'})` with `port 0` = OS-assigned |
| Device loop | `adb reverse tcp:9119 tcp:9119` (device/emulator) and `http://10.0.2.2:9119` (emulator) | mechanism measured today on ports 8899/8901 against a loopback-only server; 9119 is the `hermes serve` default, not currently listening locally |
| Harness | 3 levels: bun/Jest headless, emulator, device; mock gateway revived as the fixture | mock re-verified today (21 WS frames, scripted tool path) |

---

## 1. Environment inventory (all measured)

### 1.1 Runtimes

| Tool | Version / path | Notes |
|---|---|---|
| node | `v26.7.0` (`~/.local/share/mise/installs/node/26.7.0/bin/node`) | also installed: `24.20.0` |
| npm | `11.19.0` | |
| pnpm | `11.3.0` (`/usr/bin/pnpm`) | |
| bun | `1.4.2` (`~/.local/share/mise/installs/bun/latest/bin/bun`) | runs the mock gateway today (measured) |
| yarn | absent (`command not found`) | |
| java (default) | OpenJDK **26.0.2.1** via mise shim | **unusable for AGP** (see 1.2) |
| java (usable) | OpenJDK **21.0.2** at `~/.local/share/mise/installs/java/21.0.2` | `JAVA_HOME` currently **unset** |
| gradle (cli) | 9.8.1 (`~/.local/share/mise/installs/gradle/latest/gradle-9.8.1/bin`) | only relevant for non-wrapper builds |
| gradle wrapper cache | `~/.gradle/wrapper/dists`: `gradle-9.1.0-all`, `gradle-9.3.1-all`, `gradle-9.3.1-bin`, `gradle-9.8.0-all` | 9.3.1 = the Expo 57 template wrapper |
| gradle caches | `~/.gradle/caches` 13 GB, `caches/modules-2` 2.7 GB | most RN/AGP artifacts are already local |
| gradle-provisioned JDK | `~/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2` | evidence a JDK-17 toolchain build already succeeded here |

`react-native@0.86.3` declares `engines.node = ^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`, so both
26.7.0 and 24.20.0 satisfy it. `[INFERENCE]` safest pin for a new repo: node 24.20.0 (already installed)
because 26.x is the newest major; 26.7.0 also currently satisfies the declared range.

### 1.2 Java / Gradle / AGP constraint (this is the "missing" piece)

* `java -version` -> `openjdk version "26.0.2.1" 2026-08-18` (measured).
* Gradle compatibility matrix (https://docs.gradle.org/current/userguide/compatibility.html): "JVM 26 -> 9.4.0 and after". The SDK 57 template wrapper is **9.3.1**
  (`/tmp/tplcheck/package/android/gradle/wrapper/gradle-wrapper.properties:5`, measured from
  `expo-template-bare-minimum@57.0.30`), so Java 26 cannot run the build.
* AGP is 8.x here (see 2.1), and "Android Gradle Plugin version 8.x requires JDK 17"
  (https://developer.android.com/build/jdks).
* Prior art on this exact machine: `/home/shameel/hermes-app/build.sh:6-10` ("The system default `java`
  is JDK 26, which AGP 8.7.3 does NOT support"), `/home/shameel/hermes-app/gradle.properties:3`
  (`org.gradle.java.home=/home/shameel/.local/share/mise/installs/java/21.0.2`),
  `/home/shameel/hermes-app/docs/TOOLCHAIN.md` ("JDK 21.0.2 ... Gradle 9.8.0 ... BUILD SUCCESSFUL").
* Therefore: pin `org.gradle.java.home` to the 21.0.2 path in `android/gradle.properties` **and**
  export `JAVA_HOME` in any helper script. Do not rely on the shim.

### 1.3 Android SDK

`ANDROID_HOME=/home/shameel/Android/Sdk` (set); `ANDROID_SDK_ROOT` unset; no `local.properties` needed
once `ANDROID_HOME` is exported. `sdkmanager --list_installed` (measured):

| Package | Version |
|---|---|
| build-tools | 34.0.0, 35.0.0, **36.0.0** |
| platforms | android-34, android-35, **android-36**, android-37.0 |
| sources | android-37.0 |
| ndk | 27.1.12297006, 28.2.13676358 |
| cmake | 3.22.1 |
| platform-tools | 37.0.1 (`adb` 1.0.41, `Version 37.0.1-15733141`) |
| cmdline-tools | 16.0 (`latest` is a second copy of 16.0) |
| emulator | 37.1.11.0 |
| system-images | **only** `android-37.1;google_apis_playstore_ps16k;x86_64` |

SDK-manager warnings seen (measured, harmless but real): `cmdline-tools;16.0` is "in inconsistent
location .../cmdline-tools/latest"; "This version only understands SDK XML versions up to 3 but an SDK
XML file of version 4 was encountered". Consequence: `avdmanager list avd` printed **nothing** while
`emulator -list-avds` printed `Medium_Phone` (measured).

Emulator capability:

* `/dev/kvm` present (`crw-rw-rw- root kvm`), 24 vmx/svm CPU flags (measured).
* AVD `Medium_Phone` (measured from `~/.android/avd/Medium_Phone.avd/config.ini`): `target=android-37.1`,
  `abi.type=x86_64`, `PlayStore.enabled=true`, `hw.ramSize=2048`, `disk.dataPartition.size=10G`,
  `image.sysdir.1=system-images/android-37.1/google_apis_playstore_ps16k/x86_64/`, `hw.gpu.mode=auto`.
* Booted headless today with `-no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect`:
  `sys.boot_completed=1` within ~10 s; `ro.build.version.sdk=37`, `ro.build.version.release=17`,
  `ro.product.cpu.abi=x86_64`, `getconf PAGE_SIZE=16384` (measured).
* The image is a **16 KB page size** image. `[INFERENCE]` RN 0.86/AGP 8.12 native libs must be built
  16 KB aligned or the app dies at `dlopen`; no non-16K image is installed to fall back on (see risk R7).
* No physical device is attached: `adb devices -l` -> empty list (measured).

### 1.4 Hermes server side (this machine)

* Defaults: `hermes serve`/`dashboard` -> `--port 9119`, `--host 127.0.0.1`
  (`/home/shameel/.hermes/hermes-agent/hermes_cli/subcommands/dashboard.py:18,20`).
* Nothing hermes-ish listens on this shell's loopback right now: `ss -ltn` shows only 53, 631, 39001,
  39831, 5037; `curl http://127.0.0.1:9119/api/status` -> "Failed to connect"; the same for 38223
  (port used by the earlier Kotlin-app investigation, `/home/shameel/hermes-app/docs/PLATFORM-API.md:353`)
  (measured).
* Yet `https://hermes.shameel.dev/api/status` -> HTTP 200 over Cloudflare (`remote_ip=104.21.52.249`),
  and its `install_id` is `3da35c96d59a4792b2d4af29ed77fe8b`, **identical to `~/.hermes/install_id`**
  (measured), so the tunnel-fronted server *is* this machine's install even though its HTTP socket is not
  visible in this namespace. `[INFERENCE]` the systemd unit `hermes-gateway.service` runs sandboxed
  (its properties are not readable as a normal user: `systemctl show` returns `MainPID=0`).
* Public status payload advertises `auth_required: true`, `auth_providers: ["basic"]`, `version 0.21.6`
  (`curl .../api/status`, measured). `/api/ws` without credential -> HTTP 401 (measured).
* WS auth model (`/home/shameel/.hermes/hermes-agent/apps/desktop/electron/connection-config.ts:13-18`):
  `token` mode -> REST `X-Hermes-Session-Token`, WS `?token=`; `oauth` mode -> session cookie, WS
  `?ticket=` minted at `POST /api/auth/ws-ticket` (30 s TTL, single use,
  `hermes_cli/dashboard_auth/ws_tickets.py:22`). Legacy loopback servers need no credential.
* Host/Origin guard for WS upgrades: `Host` must equal the bound host or a `dashboard.public_url`
  hostname; a **missing** `Origin` header is allowed, a wrong one is refused with close code 4403
  (`hermes_cli/web_server_chat.py:167-194`, `hermes_cli/web_server.py:602-626`).
* Desktop client state (measured): `~/.config/Hermes/connection.json` = `{"mode":"remote","remote":
  {"url":"https://hermes.shameel.dev","authMode":"oauth"}}`; `connections.json` v2 lists `local` and
  `omarchy-zeus` (the tunnel).

### 1.5 What is actually missing for a local `expo run:android`

Nothing blocking. The gaps to close explicitly:

1. `JAVA_HOME` is unset and the default JDK is 26 -> must pin JDK 21.0.2 (1.2).
2. No `local.properties`/`ANDROID_SDK_ROOT`: fine because `ANDROID_HOME` is exported; keep it exported in
   `~/.zshrc`-equivalent so `expo run:android` finds the SDK.
3. No device attached; only one AVD and it is a 16 KB-page-size Play Store image (1.3).
4. `build-tools 36.0.0` + `platform android-36` are present, matching RN 0.86.3's pinned
   `compileSdk 36` / `buildTools 36.0.0` (see 2.1) - no SDK download needed.

---

## 2. SDK 57 and the loopback-listener requirement

### 2.1 The version matrix, and where each number comes from

| Piece | Version | Source |
|---|---|---|
| expo | `57.0.28` (dist-tag `latest`, `sdk-57` = 57.0.28) | `npm view expo dist-tags`, measured |
| react-native | `0.86.3` | `expo-template-blank@sdk-57` deps; template `expo-template-bare-minimum@57.0.30` |
| react | `19.2.3` | same |
| react-dom / react-native-web | `19.2.3` / `~0.21.0` | `expo-template-default@sdk-57` |
| typescript / @types/react | `~6.0.3` / `~19.2.2` | `expo-template-default@sdk-57` devDeps |
| expo-status-bar | `~57.0.1` | template |
| minSdk / targetSdk / compileSdk / buildTools | 24 / 36 / 36 / 36.0.0 | `react-native@0.86.3` `gradle/libs.versions.toml:1-7` (measured) |
| ndkVersion | 27.1.12297006 (installed) | same file |
| AGP / Kotlin | 8.12.0 / 2.1.20 | same file |
| Gradle wrapper | 9.3.1 | `expo-template-bare-minimum@57.0.30` `android/gradle/wrapper/gradle-wrapper.properties` |
| hermes-compiler | `250829098.0.17` (Hermes V1 pin) | `react-native@0.86.3` dependencies + `sdks/.hermesv1version` |
| newArchEnabled / hermesEnabled / edgeToEdge | `true` / `true` / `true` | template `android/gradle.properties` |

Expo resolves the Android SDK numbers from RN's own version catalog
(`expo-modules-autolinking@57.0.15` `ExpoAutolinkingSettingsExtension.kt:100-135` reads
`react-native/gradle/libs.versions.toml`; `ExpoRootProjectPlugin.kt:52-59` is only the fallback:
buildTools 35.0.0, minSdk 24, compileSdk 35, targetSdk 35, NDK 27.1.12297006, Kotlin 2.0.21).

### 2.2 Config plugins / CNG / prebuild compatibility

* The app must be a **prebuild + CNG** project: `expo prebuild` generates `android/`, and
  `expo run:android` builds the dev client. The listener library needs **no** config plugin: it is a
  normal autolinked native module (nitro package README: "Android Configuration: No extra configuration
  needed, autolinking is supported").
* Native knobs we may need are all covered by first-party plugins:
  `expo-build-properties@~57.0.22` exposes `android.usesCleartextTraffic`, `buildToolsVersion`,
  `compileSdkVersion`, `targetSdkVersion`, `minSdkVersion`, `kotlinVersion`, `packagingOptions`,
  `extraMavenRepos` (`expo-build-properties@57.0.22` `build/pluginConfig.d.ts:64-183`, measured).
  Version comes from `expo@57.0.28` `bundledNativeModules.json`.
* `android/` should stay **gitignored** (CNG), because `org.gradle.java.home` and cleartext tweaks belong
  in `app.json`/plugins or a checked-in `app.config.ts` plus `expo-build-properties`.
  `[INFERENCE]` if `android/gradle.properties` is generated, the JDK pin has to be re-applied every
  prebuild, so prefer exporting `JAVA_HOME` in the dev script and only use the plugin knobs in config.
* SDK-57-pinned native packages to install with `npx expo install` (so versions match the SDK):
  `expo-dev-client ~57.0.20`, `expo-crypto ~57.0.4`, `expo-web-browser ~57.0.3`, `expo-linking ~57.0.12`,
  `expo-constants ~57.0.21`, `expo-secure-store ~57.0.4`, `expo-file-system ~57.0.7`,
  `expo-build-properties ~57.0.22`, `expo-splash-screen ~57.0.10`, `expo-system-ui ~57.0.4`,
  `react-native-safe-area-context ~5.7.0`, `react-native-screens ~4.26.0`,
  `react-native-gesture-handler ~2.32.0`, `react-native-reanimated 4.5.1` + `react-native-worklets 0.10.1`,
  `react-native-svg 15.15.4`, `react-native-webview 13.16.1` (all read from
  `expo@57.0.28/bundledNativeModules.json`, measured).

### 2.3 Loopback listener candidates (registry-checked today)

The requirement: an HTTP listener on `http://127.0.0.1:<port>/callback` inside the app, able to
**read the query string of one GET** (`code`, `state`) and answer with HTML - RFC 8252 loopback redirect
validation happens server-side, `redirect_uri` must be `http://` on `127.0.0.1`/`::1`
(`hermes_cli/dashboard_auth/routes.py:239,271`; the same rejection is recorded in
`/home/shameel/hermes-app/docs/PKCE-SPIKE.md:98`).

| Package | Latest (measured) | Downloads/wk | Android + new-arch status | Verdict |
|---|---|---|---|---|
| `react-native-nitro-http-server` | **1.10.0** (2026-09-22) | 223 | Rust/actix + **Nitro Modules** (`peer react-native-nitro-modules ^0.35.0`); `codegenConfig: null` but Nitro-native; `start(port, handler, {host})`, default `host = 127.0.0.1`, `port 0` = OS-assigned, `autoRestart` for foreground return | **primary** |
| `react-native-tcp-socket` | 6.4.3 (2026-09-10) | **103 287** | classic Java `ReactPackage` (no codegen); works only through RN's legacy-module interop layer; gives a raw TCP server (`TcpSocket.createServer(...)`, `socket.on('data')`) so we would hand-write an HTTP/1.1 request parser | fallback |
| `@dr.pogodin/react-native-static-server` | 0.28.0 (2026-08-13) | 6 604 | has `codegenConfig` (TurboModule), lighttpd-based; serves **files** from a directory, no request callback in the exported API (`lib/typescript/src`) -> cannot hand the `?code=` to JS | reject |
| `react-native-http-bridge-refurbished` | 1.2.9 (2024-01-24) | 900 | legacy bridge; last publish 2024-01; depends on `react@18.2.0`; peer `react-native >=0.72` | reject (unmaintained) |
| app-local Expo Module (own Kotlin `ServerSocket`) | n/a | n/a | always possible with `expo-modules-core`, ~100 lines, zero third-party risk, but it is our code to maintain and needs a native build anyway | escape hatch |

Evidence for the recommendation (`react-native-nitro-http-server@1.10.0` tarball, measured):
`lib/HttpServer.nitro.d.ts:125` `start(port: number, handler: RequestHandler, host?: string): Promise<number>`,
`lib/index.d.ts:23` `host?: string  // 默认 127.0.0.1`, `lib/index.d.ts:45`
`start(port, handler, hostOrOptions?: string | ServerOptions): Promise<number>` with
`ServerOptions.autoRestart`, plus `react-native-nitro-modules` latest `0.37.1` (2026-08-27, 2 109 282
downloads/wk) satisfying `^0.35.0`.

Legacy-interop evidence for the fallback: `react-native@0.86.3` still ships
`ReactAndroid/src/main/java/com/facebook/react/ReactPackage.kt`,
`.../ReactPackageTurboModuleManagerDelegate.kt` (`getModule(moduleName)` iterating
`ReactPackage.createNativeModules(...)` when `shouldSupportLegacyPackages()` is true, and
`unstable_isLegacyModuleRegistered` / `getLegacyModule`), and `ReactContextBaseJavaModule.kt` (measured
from the npm tarball). `[INFERENCE]` prefer the Nitro module anyway: the interop path is a
compatibility surface, and a hand-rolled HTTP parser is more code to verify than one native call.

**Must-verify-first (blocking) caveat for `react-native-nitro-http-server`:** the JS handler receives
`request.path`, and the compatibility layer copies it byte-for-byte into `req.url`
(`src/http.ts:138` `this.url = request.path`); the only `query` field in the API belongs to the
**WebSocket** open event (`src/HttpServer.nitro.ts:141` "查询字符串 (仅 open 事件)"), and `path` is filled
from a prebuilt Rust struct (`cpp/HybridHttpServer.cpp:209` `request.path = std::string(cRequest->path)`).
The Rust source is **not** shipped in the tarball, so whether `path` includes `?code=...&state=...`
(actix's `req.path()` would drop it) is unverified. Before committing to this package, prove it on the
emulator with one GET:

```bash
# in a scratch screen:  start(0, req => ({ statusCode: 200, body: JSON.stringify({ path: req.path, url: (req as any).url }) }), '127.0.0.1')
adb reverse tcp:8799 tcp:8799
printf 'GET /callback?code=abc&state=def HTTP/1.0\r\n\r\n' | adb shell "nc -w 2 127.0.0.1 8799"
# accept only if the echoed path/url contains "code=abc"
```

If the query is stripped, the fallbacks are, in order: (a) the same package's `createServer` Node-compat
API is no help (same `path`), so (b) `react-native-tcp-socket@6.4.3` plus a ~40-line request-line parser
(`TcpSocket.createServer` + `socket.on('data')`, `README.md:224-236`), or (c) a local Expo Module binding
a Kotlin `ServerSocket` (~100 lines, no third-party dependency). (b) is the cheap proven path: the
protocol we need to parse is exactly one request line.

Rejected alternative: handling the redirect with an `http://127.0.0.1:<port>/callback` **intent filter**
(no listener). Expo can emit intent filters, and the earlier Kotlin spike mentions it
(`/home/shameel/hermes-app/docs/PKCE-SPIKE.md:310`), but `expo-web-browser@57.0.3` on Android has **no**
client-side redirect interception - the Android sources only use `CustomTabsIntent`
(`android/src/main/java/expo/modules/webbrowser/WebBrowserModule.kt`, `.../BrowserProxyActivity.kt`,
measured), so the redirect would have to be resolved by Chrome handing an unverified `http` URL to our
app. The listener is deterministic; keep it.

---

## 3. Verification harness

### 3.1 The stashed mock gateway is worth keeping (re-verified today)

`/tmp/hermes-gateway-mock.ts:1-20` documents it: a Bun server that speaks the real protocol - JSON-RPC
2.0 on `/api/ws`, `gateway.ready` first, per-session `seq` (`:212-217`), `message.start` ... `message.complete`
with a settled `session.info`, server->client requests for approval/sudo/secret/clarify/setup_choose,
`todo.updated` frames, and a `/tools` path carrying stdout/stderr/diff. REST surface:
`/api/ws`, `/api/status`, `/api/auth/providers`, `POST /auth/password-login` (password `hermes`),
`/api/auth/me`, `/api/auth/ws-ticket`, `/api/sessions`, `/api/profiles`, `/api/model/options`,
`/api/sessions/:id/messages`, then static files from `/home/shameel/workspace/hermes-mobile/dist`
(`:221-303`). Auth is `?token=` or the `hermes_session_at` cookie (`:177-179`). Prompt text selects the
scripted path (`:11-17`).

Measured today with `bun 1.4.2`:

```
$ bun /tmp/hermes-gateway-mock.ts 8899 &      # log: "mock hermes serve on http://127.0.0.1:8899"
$ ss -ltn | grep 8899                          -> LISTEN 0 512 *:8899 *:*      # binds ALL interfaces
$ curl -s http://127.0.0.1:8899/api/status     -> {"status":"ok",...,"auth_required":true,"auth_providers":["basic"],...}
$ curl -s "http://127.0.0.1:8899/api/sessions?token=x"   -> {"sessions":[...]}   # token accepted
$ curl -s -X POST "http://127.0.0.1:8899/api/auth/ws-ticket?token=x" -> {"ticket":"smoke-ticket","expires_in":30}
```

and a 25-line Bun WebSocket client (`session.resume` then `prompt.submit` with `/tools`) produced:

```
rpc 1 ok
rpc 2 ok
events: event:gateway.ready,event:message.start,event:status.update,event:reasoning.delta,
        event:tool.generating,event:tool.start,event:tool.complete,event:message.delta,
        event:session.usage,event:message.complete
frames: 21
```

Verdict: **worth reviving as the fixture.** It is dependency-free, deterministic, covers the failure and
approval branches an LLM-backed server cannot reproduce, and - because Bun binds `0.0.0.0` - it is
reachable from the emulator at `http://10.0.2.2:8899` and from a phone on the LAN without `adb reverse`
(useful when Metro debugging eats the USB link). Its two liabilities: the hardcoded absolute `DIST` path
(`:24`) is only used for the web-build smoke and the mock binds every interface, so it must never be
pointed at real credentials.

### 3.2 Level 0 - headless (no device, no emulator)

| Check | Command | Notes |
|---|---|---|
| dependency sanity | `npx expo install --check` / `npx expo-doctor@1.20.4` | versions vs SDK 57 |
| typecheck | `npx tsc -p . --noEmit` | |
| lint | `npx expo lint` (eslint-config-expo `57.0.2`) | |
| unit/component tests | `npx jest --ci` with `jest-expo@~57.0.6`, `jest@~29.7.0`, `@testing-library/react-native@^14.1.0`, `test-renderer@^1.3.1` | jest-expo 57.0.6 depends on `babel-jest ^29.2.1` / `@jest/globals ^29.2.1` and bundles `react-test-renderer 19.2.3` (measured) -> stay on Jest 29 |
| pure-logic harness (proven pattern here) | `bun --tsconfig-override /tmp/omp-tsconfig.json /tmp/hermes-motion-smoke.ts` | the earlier attempt ran real modules against stubbed `react`/`react-native`/`@/theme` (`/tmp/omp-tsconfig.json`, `/tmp/hermes-motion-smoke.ts:1-30`) and a token verifier (`/tmp/hermes-light-verify.ts`, `/tmp/hermes-success.ts`; `hermes-light-verify.out` ends "86 tokens checked, 0 mismatches") |
| protocol smoke (mock) | `bun /tmp/hermes-gateway-mock.ts 8899 &` then the Bun WS client above | this is the only LLM-free end-to-end of the turn protocol; keep the client in the repo (`tools/mock-ws-smoke.ts`) |
| Hermes compile gate | `npx expo export --platform android --output-dir /tmp/hermes-bundle` then `HERMESC_DIR="$(node -p "require('path').dirname(require.resolve('hermes-compiler/package.json',{paths:[require.resolve('react-native/package.json')]}))")"; "$HERMESC_DIR/hermesc/linux64-bin/hermesc" -emit-binary -out /tmp/app.hbc /tmp/hermes-bundle/_expo/static/js/android/*.js` | `hermes-compiler@250829098.0.17` is a dependency of `react-native@0.86.3` and ships `hermesc/linux64-bin/hermesc` (measured); the resolver expression is the same one the template's `android/app/build.gradle` uses, and the `node -p` form was verified locally. **`hermesc` cannot execute** (`-exec` unsupported, measured) so this catches syntax/compile gaps only |

What headless **cannot** prove: Hermes *runtime* behaviour. Jest/jest-expo run on Node, so `Intl`,
`Date`/locale formatting, regex lookbehind, `crypto`, `URLSearchParams` gaps and native module presence
are all invisible there. Anything token-visual or engine-sensitive needs Level 1.

### 3.3 Level 1 - emulator (available now)

```bash
export PATH=/home/shameel/Android/Sdk/platform-tools:/home/shameel/Android/Sdk/emulator:$PATH
export ANDROID_HOME=/home/shameel/Android/Sdk
export JAVA_HOME=$(mise where java@21.0.2); export PATH=$JAVA_HOME/bin:$PATH

emulator -avd Medium_Phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done   # ~10 s measured

bun /tmp/hermes-gateway-mock.ts 8899 &            # fixture
adb reverse tcp:8899 tcp:8899                     # app -> fixture via 127.0.0.1
npx expo run:android                              # builds + installs the dev client
adb reverse tcp:8081 tcp:8081                     # Metro, so the dev client can load the bundle
adb exec-out screencap -p > /tmp/shot.png         # visual parity artifact
```

Measured today on this AVD: `emulator-5554 device product:sdk_gphone16k_x86_64 model:sdk_gphone16k_x86_64
device:emu64xa16k`; `adb install` and `expo run:android` were not exercised (nothing to build yet), but
the same AVD is the one the Kotlin app was QA'd on (`/home/shameel/hermes-app/qa/REPORT.md:5`).

### 3.4 Level 2 - device (needs the phone plugged in; none attached now)

```bash
adb devices -l                                     # currently empty (measured)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081                      # Metro
adb reverse tcp:9119 tcp:9119                      # gateway
adb reverse tcp:<PKCE_PORT> tcp:<PKCE_PORT>        # only if the browser must reach a host listener
adb logcat -s ReactNativeJS ReactNative HermesRpc  # app-side protocol log
```

One-command-per-level summary: L0 `npx jest --ci && npx tsc -p . --noEmit`; L1 `npx expo run:android`
(+ `adb reverse tcp:8899 tcp:8899` against the fixture); L2 `adb -d install -r <apk>` + the `adb reverse`
pair above.

---

## 4. Device loop: how a phone reaches this machine's Hermes

### 4.1 Measured reachability matrix

Server under test: a **loopback-only** listener (`python3 -m http.server 8901 --bind 127.0.0.1`,
`ss` shows `127.0.0.1:8901`), plus the mock (bound `*:8899`). Client: API 37.1 emulator, `sh` + `nc`.

| From the device | To | Result | Evidence |
|---|---|---|---|
| emulator | `10.0.2.2:8901` (host loopback alias), no reverse | **200 OK** | host log line `127.0.0.1 - - "GET / HTTP/1.0" 200`; QEMU NAT sources it from host loopback |
| emulator | `127.0.0.1:8901` with `adb reverse tcp:8901 tcp:8901` | **200 OK** | probe `(printf 'GET / HTTP/1.0\r\n\r\n'; sleep 2) \| adb shell "nc -w 5 127.0.0.1 8901"`; host log shows a second 200 |
| emulator | `127.0.0.1:8901` **without** reverse | `nc: connect: Connection refused` | |
| emulator | host LAN IP `10.42.0.72:8901` | `Connection refused` | correct: the server is loopback-only |
| emulator | `10.0.2.2:8899` (mock, all-interfaces) | 200 OK | |
| emulator | `127.0.0.1:8899` with reverse | 200 OK | both paths work |
| phone (USB) | `127.0.0.1:9119` + `adb reverse tcp:9119 tcp:9119` | not re-measured today (no device) | same mechanism, verified on the emulator; `adb reverse --list` shows `<serial> tcp:PORT tcp:PORT` |

`adb reverse` notes from the measurement: the device-side socket is opened by adbd (visible in
`/proc/net/tcp` as a `::` listener, state `0A`, plus `0100007F:<port>` TIME_WAIT entries), the host sees
the connection **from 127.0.0.1**, and `adb reverse --list` prints a `host-NN` label rather than the
device serial - do not read that as failure. A `printf | adb shell "nc ..."` probe prints nothing unless
stdin stays open (`nc` exits at EOF before reading the reply); append `sleep 2` or use the app itself.

### 4.2 What changes when the server binds loopback only

* `hermes serve` defaults to `--host 127.0.0.1 --port 9119`
  (`hermes_cli/subcommands/dashboard.py:18,20`), and there is **no** `--insecure` escape any more: as of
  the June 2026 hardening a non-loopback bind always requires an auth provider (same file, `--insecure`
  help text). So a phone cannot reach it over LAN at all.
* Consequences by transport: (a) `adb reverse` preserves it exactly - the app dials `127.0.0.1` and the
  server sees a loopback peer, no auth needed on legacy loopback servers; (b) the emulator can use
  `10.0.2.2` (measured above) which is a host-loopback alias, so no LAN exposure; (c) plain LAN IP is
  refused (measured); (d) a tunnel publishes it, which is what `https://hermes.shameel.dev` is.
* Host/Origin guard interaction: through `adb reverse` the app's `Host` header is `127.0.0.1:9119`, which
  passes while the server is loopback-bound (`_is_accepted_host`, `hermes_cli/web_server.py:602-626`).
  Through the tunnel the `Host` is `hermes.shameel.dev`, which passes only because the server's
  `dashboard.public_url`/`trusted_public_hosts` contains it (`web_server.py:506-518,1173`). RN's
  WebSocket sends **no** `Origin` header, and a missing Origin is explicitly allowed
  (`hermes_cli/web_server_chat.py:183-185`), so no Origin workaround is required.
* `https://hermes.shameel.dev` is therefore the same code path with a different base URL: HTTPS/WSS,
  `auth_required: true`, `auth_providers: ["basic"]` (measured), `POST /api/auth/ws-ticket` -> `?ticket=`
  on the upgrade, bearer or cookie for REST. The dev loop must still keep the **loopback listener** for
  the PKCE redirect: the authorize endpoint rejects any non-`http://127.0.0.1|::1` redirect regardless of
  whether the gateway is local or behind the tunnel.
* Also reachable in principle: Tailscale (`tailscale` binary installed, `tailscaled.service` running, but
  `tailscale status` -> "Tailscale is stopped", measured) and plain LAN if someone binds `0.0.0.0` - the
  earlier Kotlin work rejected LAN as "same Wi-Fi only" and cloudflared/ngrok as public exposure of an
  interface that also serves config, files and credentials
  (`/home/shameel/hermes-app/docs/PLATFORM-API.md:355-363`).

### 4.3 Cleartext, and why the dev build is fine

`expo-template-bare-minimum@57.0.30` ships a debug-only manifest with
`android:usesCleartextTraffic="true"` (`android/app/src/debug/AndroidManifest.xml`, same in
`debugOptimized`), while the main manifest does not set it, so debug dev clients can talk plain
`http://127.0.0.1`, `ws://`, `http://10.0.2.2`. Android 9+ blocks cleartext by default, so any
**release** build that must reach a dev host needs `expo-build-properties` `usesCleartextTraffic` or a
debug-only network security config. Note the exception to remember: `10.0.2.2` is not a loopback address
as far as Android policy is concerned.

---

## 5. Risk list

**R1. Metro resolving `@hermes/shared` (raw TS, `exports`-only, `private: true`).**
`apps/shared/package.json` has no `main`, only `exports: {".": "./src/index.ts", ...}` and
`"private": true` (measured), i.e. TypeScript source pulled straight into the bundle. Metro's
`unstable_enablePackageExports` defaults to **true** (`metro-config@0.84.0` `src/defaults/index.js:69`,
measured), and Expo's resolver extends `@expo/metro/metro-config`
(`@expo/metro-config@57.0.13/build/ExpoMetroConfig.js:150`), so exports-only should resolve; that the
vendored `@expo/metro@56.0.2` sets the same default is `[INFERENCE]` (only the type declarations mention
the flag in that tarball). Mitigation if the first bundle fails: consume the shared package through a
relative/tested path, or add `resolver.unstable_enablePackageExports = true` plus
`watchFolders`/`extraNodeModules` for the package in `metro.config.js`. Verify with
`npx expo export --platform android` (a resolution failure is loud there, not at runtime).

**R2. WebSocket auth shape.** RN supports query credentials (`?token=`, `?ticket=`) with no headers, which
is exactly what the desktop does (`apps/shared/src/websocket-url.ts:99-108` "Query auth pair, usually
[`token`, value] or [`ticket`, value]"), so no header hacks are needed; RN's `WebSocket` does accept
`new WebSocket(url, protocols, {headers})` if ever required
(`react-native@0.86.3` `Libraries/WebSocket/WebSocket.js:98-148`). Two real hazards: tickets expire in
30 s and are single-use, so mint immediately before the upgrade and re-mint on every reconnect; and a
legacy loopback server accepts an empty credential while a gated one answers 403/401
(`/home/shameel/hermes-app/qa/REPORT.md:36-45` records 403 for empty/absent tokens), so a reconnecting
client must not cache a stale ticket.

**R3. Hermes runtime gaps that Jest cannot see.** jest-expo runs on Node. Anything using `Intl`
(collation, `toLocaleString`, timezone names), `crypto`, or newer regex/`URL` features must be exercised
on device/emulator; `hermesc` can only compile, not run (measured). Budget one emulator pass specifically
for formatting/date/token-rendering code that the desktop implements with CSS/Intl.

**R4. Android background/Doze suspends the socket.** When the app is backgrounded, Android freezes the
process and the WS is dropped; RN timers stop. `expo-background-task` / `expo-task-manager` are WorkManager
based (minimum ~15 minute cadence) and cannot hold a live socket. Plan: reconnect-on-resume (AppState ->
re-mint ticket -> resubscribe/replay via `seq`), not a foreground service, unless the product wants a
persistent "live" notification. Treat any `message.delta` gap as "resync by stored session, not by
replay".

**R5. Host/Origin and hallucinated auth modes.** The gateway refuses WS upgrades whose `Host` is neither
the bound host nor `dashboard.public_url` (close 4403). `adb reverse` (Host `127.0.0.1:9119`) and the
tunnel (Host `hermes.shameel.dev`) both pass today; a hand-entered LAN IP with a loopback-bound server
will 403 before the app can explain why. Surface the gateway's `/api/status` (`auth_required`,
`auth_providers`) in the connection screen and map 401/403 to a re-auth prompt.

**R6. Legacy-bridge native module (only if the tcp-socket fallback is used).** RN 0.86.3 loads legacy
`ReactPackage` modules through `ReactPackageTurboModuleManagerDelegate` only while
`shouldSupportLegacyPackages()` is true; there is no codegen spec, so any new-arch behaviour change
(interop removal) would break it silently at runtime, not at build time. Prefer the Nitro-based server.

**R7. 16 KB page size emulator image.** The only installed system image is
`google_apis_playstore_ps16k` and `getconf PAGE_SIZE` on the booted AVD returned 16384 (measured). If any
native library in the final APK is not 16 KB aligned, the app dies at load on this image with no
non-16K image to fall back on. Check with the alignment tool when the first APK exists, or install an
`android-36` x86_64 `google_apis` image as a second AVD.

**R8. JDK drift.** Any Gradle invocation that inherits the shim `java` (26.0.2.1) fails before it compiles
anything. Pin `org.gradle.java.home` when `android/` is committed, and always export `JAVA_HOME` in the
outer dev script, because `expo run:android` shells out to `gradlew` and prebuild regenerates files.

**R9. Node/Expo CLI churn.** `expo@57.0.28` pulls `@expo/cli ^57.0.29` and `@expo/metro ~56.0.2`
(Expo's vendored Metro with an offset major) while RN pins `metro-runtime ^0.84.3`; mixing a second
`metro`/`react-native` copy (a common pnpm mistake with two RN versions in one workspace) breaks bundling
in ways that look like UI bugs. Keep one `react-native@0.86.3` in the lockfile and let `npx expo install`
own every native package version.

**R10. Cleartext and TLS assumptions.** Debug builds allow cleartext (template debug manifest), release
builds do not; `ws://` on `https://` gateways is impossible and `wss://` against the local server needs a
TLS terminating proxy. Do not let a release build be the first place this is discovered; add the
network-security-config in the debug source set only.

**R11. Unverified native listener semantics (small dependency, 223 downloads/wk).** The chosen HTTP
server's Rust core is prebuilt and undocumented for our case: query-string visibility in `path`
(§2.3 must-verify), whether `start(0, ...)` really returns a bound port on Android, and what `autoRestart`
does to an in-flight request after a foreground return. Budget one emulator session (about 10 minutes)
before the sign-in screen is written against it; if any of the three fails, switch to the raw-TCP
fallback, which has no such unknowns (we own the parser).

---

## Appendix A: scratch files produced while measuring (not part of the repo)

* `/tmp/tcscratch/ws-smoke.ts` - Bun WebSocket client used for the 21-frame protocol check.
* `/tmp/tcscratch/probe.sh` - device-side TCP/HTTP probe pushed to `/data/local/tmp/probe.sh`.
* `/tmp/hermes-gateway-mock.ts` (pre-existing) - run as `bun /tmp/hermes-gateway-mock.ts 8899`; the copy
  started for these measurements was stopped again (`pkill -f hermes-gateway-mock.ts`), as were the
  emulator (`adb emu kill`) and the two probe servers on 8901/8902. Nothing is left listening.
* Templates analyzed offline: `/tmp/tplcheck` (expo-template-bare-minimum 57.0.30), `/tmp/expopkg`
  (expo 57.0.28), `/tmp/emc57` (@expo/metro-config 57.0.13), `/tmp/expometro` (@expo/metro 56.0.2),
  `/tmp/expoautolink` (expo-modules-autolinking 57.0.15), `/tmp/rnpkg` (react-native 0.86.3),
  `/tmp/loopbackpkgs` (the four listener candidates), `/tmp/hermesc` (hermes-compiler),
  `/tmp/ecrypt` (expo-crypto 57.0.4), `/tmp/ebp` (expo-build-properties 57.0.22), `/tmp/ewb`
  (expo-web-browser 57.0.3).

## Appendix B: key upstream citations

* `/home/shameel/.hermes/hermes-agent/hermes_cli/subcommands/dashboard.py:18,20` (serve defaults, inactive `--insecure`).
* `/home/shameel/.hermes/hermes-agent/hermes_cli/dashboard_auth/routes.py:1-20,239,271,556` (auth surface, loopback redirect validation, ws-ticket mint).
* `/home/shameel/.hermes/hermes-agent/hermes_cli/dashboard_auth/ws_tickets.py:1-30` (30 s single-use tickets).
* `/home/shameel/.hermes/hermes-agent/hermes_cli/web_server_chat.py:167-204` (Host/Origin guard, 4403).
* `/home/shameel/.hermes/hermes-agent/apps/desktop/electron/connection-config.ts:13-18` (token vs oauth connection models).
* `/home/shameel/.hermes/hermes-agent/apps/shared/src/websocket-url.ts:99-108` (`?token=`/`?ticket=` construction).
* `/home/shameel/hermes-app/docs/TOOLCHAIN.md`, `/home/shameel/hermes-app/build.sh:1-20`, `/home/shameel/hermes-app/gradle.properties:1-10` (proven JDK 21 + Gradle 9.8 + AGP build on this machine).
* `/home/shameel/hermes-app/docs/PKCE-SPIKE.md:98,140-167,245-250,309-310` (loopback redirect requirement, loopback listener, bind-address effects on auth).
* `/home/shameel/hermes-app/docs/PLATFORM-API.md:353-363,448` (reachability table, adb reverse as the clean dev loop).
* `/home/shameel/hermes-app/qa/REPORT.md:5,36-45` (the same AVD, token-auth failure modes).
* https://docs.gradle.org/current/userguide/compatibility.html (Java 26 requires Gradle >= 9.4.0; Java 21 usable since 8.5).
* https://developer.android.com/build/jdks ("Android Gradle Plugin version 8.x requires JDK 17").
* https://developer.android.com/studio/run/emulator-networking (emulator network capability table; the legacy `10.0.2.2` text is gone from this page, hence the measured proof in 4.1).
