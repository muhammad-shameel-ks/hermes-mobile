# `@hermes/shared` from a standalone Expo app: resolution, structure, sync

Ticket: SharedPkg. Scope: `~/.hermes/hermes-agent/apps/shared` (`@hermes/shared`), its exports map,
its sources, and how `apps/desktop` + `web/` consume it. Target: a standalone Expo app
(Metro, React Native, TypeScript, no build step today).

Date of all version/registry facts: 2026-10-12.

---

## 1. Verdict

**Yes, a standalone Expo app can consume `@hermes/shared` directly - but not with the stock
`expo/metro-config` alone.** Exactly one Metro-level change is mandatory, plus one structural change
that depends on the linking model:

1. **MANDATORY: a `.js`-suffix resolver shim.** 12 relative import/export specifiers in the package (14
   counting test files) end in `.js` while the files are `.ts`, and 3 of those edges are value imports,
   so they survive type erasure. Metro appends entries from `sourceExts` to the
   literal specifier and never substitutes `.js` -> `.ts`; this is by design, is still an open upstream
   request (`facebook/metro#886`, open since 2022-11-01, "we advise not to enable this compiler option
   yet"), and I reproduced the failure on the **exact** Metro build Expo SDK 57 ships, both at the
   resolver API level and as a real bundle failure. A `resolver.resolveRequest` retry-after-strip is
   enough (verified working, bundle emitted).
2. **STRUCTURAL: the `exports` map is incomplete (10 modules unreachable as subpaths).** With Metro's
   exports support on by default, `@hermes/shared/translucency` (used 10 times in-tree) and 9 other
   subpaths fail. Metro's encapsulation is *lenient* (warn + fall back to file-based resolution), but the
   fallback looks for `<pkgRoot>/<subpath>.{ts,tsx,...}` and this package is `src/`-laid-out, so the
   fallback cannot rescue it. Two clean outs: import everything from the root barrel (which reaches all
   27 modules anyway), or add the 10 missing subpaths to `exports`.

Everything else is in good shape: **zero npm runtime dependencies** in the package (every non-test import
is intra-package), the whole barrel resolves to 27 local modules, and the only module-scope platform
global in the entire graph is a single `new TextDecoder()`, which exists on Hermes (RN 0.85+) and is also
installed by Expo's winter runtime.

### The exact Metro config required (verified end to end)

```js
// metro.config.js  -  Expo SDK 57 / RN 0.86.3 / metro-resolver 0.84.6
const fs = require('node:fs')
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')   // re-exports @expo/metro-config

const config = getDefaultConfig(__dirname)

// --- only for the `file:`-link model (package lives outside this repo) ---
// npm installs a `file:` directory dependency as a SYMLINK, so resolve to the real dir.
const sharedReal = fs.realpathSync(path.resolve(__dirname, 'node_modules/@hermes/shared'))
const sharedWorkspaceRoot = path.resolve(sharedReal, '../..')          // .../hermes-agent
config.watchFolders = [
  ...(config.watchFolders ?? []),
  sharedReal,                                                          // watch the linked sources
  path.join(sharedWorkspaceRoot, 'node_modules')                       // helpers the transform injects
]
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.resolve(__dirname, 'node_modules'),
  path.join(sharedWorkspaceRoot, 'node_modules')
]

// --- MANDATORY in every model that links the package (not needed for a vendored in-tree copy) ---
// Metro appends sourceExts to the specifier but never substitutes .js -> .ts (facebook/metro#886).
const jsSuffix = /^(\.{1,2}\/.*)\.(js|jsx|mjs|cjs)$/
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    const m = jsSuffix.exec(moduleName)
    if (!m) throw error
    return context.resolveRequest(context, m[1], platform)
  }
}

module.exports = config
```

Do **not** set `resolver.unstable_enablePackageExports = false`. It already defaults to `true`
(`metro-config@0.84.6/src/defaults/index.js:69`, verified in the published tarball), and the package has
**no `main` field**, so disabling exports makes even `import '@hermes/shared'` fail. Verified: with
exports off, resolution dies with "The package `.../node_modules/@hermes/shared/package.json` is invalid".

**Does Expo's default config handle it?** Partly. `@expo/metro-config@57.0.13` sets `sourceExts`,
`resolverMainFields: ['react-native','browser','main']`, `unstable_conditionsByPlatform` for
ios/android/tvos/macos, `watchFolders`/`nodeModulesPaths` from workspace detection, and explicitly does
**not** touch `unstable_enablePackageExports`, `unstable_conditionNames`, or `unstable_enableSymlinks`
(grep over `build/` returns no hits for any of them). So: exports honoured = yes, `.js` -> `.ts` =
**no**, and workspace auto-detection only fires when the app sits *inside* a workspace root that also owns
the shared package.

---

## 2. What I actually ran (reproduction)

All scratch work under `/tmp/hm`; no repo was modified.

| Artifact | Purpose |
| --- | --- |
| `/tmp/hm/probe/resolve-probe*.mjs`, `/tmp/hm/probe84/graphwalk*.mjs` | drive Metro's real `ModuleResolver` (metro 0.87.1 and **0.84.6**) over the real package via a `node_modules/@hermes/shared` symlink; walks the full module graph from one entry specifier |
| `/tmp/hm/m/{metro-config,metro-resolver}@{0.84.6,0.87.1}`, `@expo/metro-config@57.0.13`, `@expo/metro@56.1.0`, `@expo/config@57.0.10`, `expo@57.0.28` | unpacked published tarballs read as primary source |
| `/tmp/hm/probe/babeltest.mjs` | `@babel/preset-typescript@7.29.7` transform of the real files, to separate erased `import type` from surviving value imports |
| `/tmp/hm/expobundle/` | a real Metro app: `expo@57.0.28` toolchain, `react-native@0.86.3`, `@hermes/shared` installed with `"file:/home/shameel/.hermes/hermes-agent/apps/shared"`; built with `node node_modules/metro/src/cli.js build index.ts --platform android --dev false` |
| `/tmp/hm/vendored-all` + `/tmp/hm/expobundle/vendor/shared` | a copy of the package with all `.js` specifiers mechanically stripped, used to prove the no-config path |
| `/tmp/hm/fixed-shared` | a copy with the `exports` map completed (27 subpaths) and `main` added |

Pinned versions that matter (from the registry, today):

- `expo@57.0.28` (`latest`) -> `bundledNativeModules.json` `"react-native": "0.86.3"`; its own deps are
  `@expo/metro: ~56.0.2`, `@expo/metro-config: ~57.0.13`. `expo/metro-config.js` in the published package
  is literally `module.exports = require('@expo/metro-config')`, so the app-facing specifier in
  `metro.config.js` and the package I read are the same code.
- `@expo/metro@56.0.2` -> `metro`/`metro-resolver` **0.84.5**; `@expo/metro@56.1.0` -> **0.84.6**. The
  `@expo/metro` tarball contains no patches at all: `metro-resolver/index.js` is literally
  `module.exports = require("metro-resolver")`.
- `react-native@0.86.3` depends on `metro-runtime: ^0.84.3`, consistently in the 0.84 line.
- `expo` SDK 57's winter runtime and RN 0.86.3/0.87.1 both ship Hermes `hermes-v250829098.0.17`
  (`react-native@0.86.3/sdks/.hermesv1version`).

---

## 3. Metro resolution: what is actually required

### 3.1 The `.js`-suffixed relative imports (the real blocker)

Census of `apps/shared/src` (non-test files): **12 specifier lines, 14 including `*.test.ts`**:

```
billing-policy.ts:1    import type { KnownBillingRefusalCode } from './billing-types.js'         [type]
charge-settlement.ts:1 import { refusalPolicy } from './billing-policy.js'                       [VALUE]
charge-settlement.ts:2 import type { BillingChargeStatusResponse } from './billing-types.js'     [type]
billing-types.ts:23    export type { BillingBlock } from './gateway-contract.generated.js'       [type]
gateway-events.ts:15   import type { BackendGatewayEventMap } from './gateway-contract.generated.js' [type]
gateway-events.ts:17   export * from './gateway-contract.generated.js'                           [VALUE]
gateway-events.ts:58   export { GATEWAY_EVENT_TYPES as BACKEND_EVENT_NAMES } from './gateway-contract.generated.js' [VALUE]
json-rpc-gateway.ts:1  import type { GatewayEvent, GatewayEventName } from './gateway-events.js' [type]
json-rpc-gateway.ts:11 } from './json-rpc-channel.js'                                            [VALUE]
json-rpc-gateway.ts:13 export type { GatewayEvent, GatewayEventName } from './gateway-events.js' [type]
json-rpc-channel.ts:1  import type { ClientCapabilitiesResult } from './gateway-contract.generated.js' [type]
json-rpc-channel.ts:2  import type { GatewayEvent } from './gateway-events.js'                   [type]
```

`index.ts` is entirely extensionless, so the barrel itself is fine.

**Why Metro cannot resolve them.** `metro-resolver`'s file algorithm builds
`filePathPrefix = path.join(dirPath, fileName)` where `fileName` still carries `.js`
(`metro-resolver@0.87.1/src/resolve.js:571-590`), tries the literal path, then
`` `${context.filePathPrefix}${extension}` `` for each `sourceExts` entry
(`src/resolve.js:608-646`). It therefore probes `billing-policy.js.ts`, `billing-policy.js.jsx`, etc.
The published algorithm agrees: `docs/resolution.md` "RESOLVE_FILE" only ever *appends* platform and
extension variants, and `docs/package-exports.md` states Metro "will not expand `sourceExts` against the
import specifier" (that last line is about `exports` targets, but the appending-only rule is the same for
relative paths). Upstream position, verbatim from `facebook/metro#886` (opened 2022-11-01, still open,
updated 2026-02-27): "metro-resolver is intended to support multiple `sourceExts` and platform-specific
extensions only when resolving an **extensionless import** ... Extensions derived from `sourceExts` and
`platforms` are **appended**" and "Until we add support for TypeScript ES modules, we advise not to
enable this compiler option yet in a React Native project". A community package exists for the same
reason: `@stzhu/metro-ts-resolver@0.1.5` ("A custom Metro resolver that enables `.js` extensions for
TypeScript imports"), whose README dates from 2025-10-27 in the same issue thread.

**Empirical, end to end.** Real Metro 0.84.6 build of `import { JsonRpcGatewayClient, ... } from
'@hermes/shared'` with the stock config:

```
Error: Unable to resolve module ./gateway-contract.generated.js from
  /home/shameel/.hermes/hermes-agent/apps/shared/src/gateway-events.ts:
None of these files exist:
  * .../apps/shared/src/gateway-contract.generated.js(.android.ts|.native.ts|.ts|...|.cjs|...)
  > 17 | export * from './gateway-contract.generated.js'
```

Note the candidate list: it proves Metro probed `.js.android.ts`, `.js.ts`, ... and never `.ts`. That is
the same build, same package, same entry that succeeds with the shim (49 modules, 85,149-byte bundle).
The graph walk (resolver API, metro-resolver 0.84.6) gives the full picture: **9 unresolved edges without
the shim, 0 with it**, and the barrel reaches 27 local modules either way.

**Not all 9 edges matter at runtime.** Metro collects dependencies from the *transformed* AST.
`@babel/preset-typescript` (7.29.7, the plugin `babel-preset-expo@57.0.15` pulls in) erases `import type`,
so the runtime-fatal set is exactly **3 distinct edges / 4 occurrences**:

- `charge-settlement.ts:1` -> `./billing-policy.js`
- `gateway-events.ts:17` and `:58` -> `./gateway-contract.generated.js`
- `json-rpc-gateway.ts:11` -> `./json-rpc-channel.js`

Verified by transforming the real files and re-grepping for surviving `.js` specifiers: `charge-settlement.ts`
1, `gateway-events.ts` 2, `json-rpc-gateway.ts` 1, and 0 in `json-rpc-channel.ts` / `billing-types.ts` /
`billing-policy.ts`. The other 6 edges still break a syntactic resolver and any non-Metro bundler that
does not erase types the way Babel does, so a rewrite should cover all 12 occurrences, not just the 3.

**How the existing consumers get away with it.** They all substitute extensions, Metro alone does not:

- Vite 8.2.0 (desktop + web): `node_modules/vite/dist/node/chunks/node.js` has
  `knownTsOutputRE = /\.(?:js|mjs|cjs|jsx)$/`, `isPossibleTsOutput(url)` and, in `tryCleanFsResolve`,
  `fileExt.replace("js","ts")` - an explicit `.js` -> `.ts`/`.tsx` substitution.
- esbuild 0.28.1 (the Ink TUI bundle, `scripts/build/tui.mjs`): bundles
  `apps/shared/src/charge-settlement.ts` (which value-imports `./billing-policy.js`) without error -
  I ran it directly and it succeeds.
- Desktop additionally **bypasses the package boundary entirely** in dev/build:
  `apps/desktop/vite.config.ts:233-241` aliases `@hermes/shared` -> `../shared/src` (plus explicit
  aliases for `billing` and `color`). That is why desktop can import `@hermes/shared/translucency`
  (10 in-tree occurrences) even though the subpath is missing from `exports`: the alias rewrites the id
  before Vite ever consults `exports`. `apps/desktop/tsconfig.json:22-27` and
  `web/tsconfig.app.json:22-26` do the same for types. **Net: no in-repo consumer exercises the
  `exports` map.** Node/tsc/webpack-strict consumers would see the missing subpaths immediately.

### 3.2 The `exports` map: every subpath, and what breaks

`apps/shared/package.json` declares `"private": true`, `"version": "0.0.0"`, `"type": "module"`,
`"types": "./src/index.ts"`, **no `main`**, and 17 subpaths, all pointing at raw `.ts`:

| In `exports` | Target | Notes |
| --- | --- | --- |
| `.` | `./src/index.ts` | 189-line barrel, reaches all 27 modules |
| `./ansi` | `src/ansi.ts` | |
| `./billing` | `src/billing-types.ts` | types only |
| `./billing-policy` | `src/billing-policy.ts` | |
| `./charge-settlement` | `src/charge-settlement.ts` | has a runtime `.js` import |
| `./color` | `src/color.ts` | |
| `./format` | `src/format.ts` | |
| `./fuzzy` | `src/fuzzy.ts` | |
| `./gateway-events` | `src/gateway-events.ts` | has 2 runtime `.js` re-exports into the generated contract |
| `./i18n` | `src/i18n.ts` | |
| `./json-rpc-channel` | `src/json-rpc-channel.ts` | |
| `./model-search-text` | `src/model-search-text.ts` | |
| `./reasoning-effort` | `src/reasoning-effort.ts` | |
| `./reconnect-backoff` | `src/reconnect-backoff.ts` | |
| `./skin` | `src/skin.ts` | |
| `./slash` | `src/slash.ts` | |
| `./theme-presets` | `src/theme-presets.ts` | |

**Missing from `exports` (10 modules, all reachable only through the barrel):**

`./backend-scope`, `./catalog-install`, `./cron-trigger-controller`, `./data-url-read-max`,
`./gateway-contract.generated`, `./json-rpc-gateway`, `./skill-scaffold`, `./translucency`,
`./update-debt`, `./websocket-url`. Also absent: `./package.json` and any `./gateway-contract.openrpc.json`
entry (the JSON is a 990.7 KB data artefact, not imported by any TS file in the repo).

Repo-wide census of subpath specifiers (`apps`, `web`, `ui-tui`, `tests-js`, `scripts`):

```
28 gateway-events   28 color   20 ansi   18 i18n   10 translucency   8 skin   8 json-rpc-channel
 8 billing   4 slash   4 format   3 charge-settlement   2 fuzzy   2 billing-policy
 1 reconnect-backoff   1 reasoning-effort   1 model-search-text
```

`translucency` (10) is the **only** subpath in use anywhere that is not in `exports`. Everything else is
exported, and the two heaviest consumers work because of build-time aliases, not because of `exports`.

**What breaks for a bundler that honours `exports` strictly** (Node, webpack, esbuild with
`--packages=external` semantics, and Metro when its file fallback cannot succeed): every one of the 10
missing subpaths. Under **Metro** specifically the failure mode is friendlier than Node's but still fatal
here. `metro-resolver@0.84.6/src/resolve.js:494-529` catches `PackagePathNotExportedError`, logs
`resolver_warning`, and falls back to `resolveModulePath(context, absoluteCandidatePath, platform)`; the
docs say the same under "Package encapsulation is lenient ... Metro will log a warning and fall back to
file-based resolution". That fallback resolves `<pkgRoot>/<subpath>` + sourceExts, i.e.
`apps/shared/translucency.ts` - which does not exist (it is `apps/shared/src/translucency.ts`). Measured
with metro-resolver 0.84.6:

```
FAIL  app -> @hermes/shared/translucency        (1 resolver warning, then a hard resolution failure)
FAIL  app -> @hermes/shared/json-rpc-gateway
OK    app -> @hermes/shared                     -> .../src/index.ts
OK    app -> @hermes/shared/color               -> .../src/color.ts
OK    app -> @hermes/shared/gateway-events      -> .../src/gateway-events.ts
```

Adding the 10 subpaths to a copy of the package fixes all of them with **zero warnings**
(`/tmp/hm/fixed-shared`, verified). The alternative is `extraNodeModules: { '@hermes/shared': '<abs>/apps/shared/src' }`
which works but emits a `PackagePathNotExported` warning per import because it too rides the lenient
fallback (measured: 4 warnings for 4 subpath imports).

### 3.3 Metro settings, one at a time

| Setting | State today | Required? |
| --- | --- | --- |
| `resolver.sourceExts` | Expo default `["ts","tsx","mjs","js","jsx","json","cjs"]` + `scss/sass/css` when `isCSSEnabled` (default true). Measured via `@expo/config@57.0.10/build/paths/extensions.js#getBareExtensions([],{isTS:true,isReact:true,isModern:true})`. | **No change.** `ts`/`tsx` already present. |
| `resolver.unstable_enablePackageExports` | `true` by default in metro since 0.82 / RN 0.79 (`metro-config@0.84.6/src/defaults/index.js:69`; docs "Package Exports support has been enabled by default in Metro since 0.82 (or React Native 0.79)"). Expo does not override it. | **Leave true.** Setting it false breaks the bare import: the package has no `main`, so the fallback looks for `<pkgRoot>/index.ts`. |
| `resolver.unstable_conditionNames` / `unstable_conditionsByPlatform` | Metro `[]` + `{web:['browser']}`; Expo overrides to `{ios,android,tvos,macos:['react-native'], web:['browser']}`. | **No change.** Every `exports` target is a plain string, so no condition is ever consulted. |
| `resolver.nodeModulesPaths` / `watchFolders` | Expo derives both from `getMetroServerRoot(projectRoot)` (`@expo/config/build/paths/paths.js`) and returns `[]`/`[]` when the app is not inside a workspace that owns the package. Expo's monorepo helper adds `workspaceRoot/node_modules` plus each workspace package dir to `watchFolders` (`@expo/metro-config/build/getWatchFolders.js`). | **Yes, for the `file:`-link model**, and use the **realpath**, not the symlink: adding the symlinked path `node_modules/@hermes/shared` to `watchFolders` makes metro-file-map throw `Invariant Violation: Detected addition or modification of file node_modules/@hermes/shared, but it is tracked as a non-empty directory`. Adding the realpath works. |
| `resolver.extraNodeModules` | unset | **Optional.** Only as a substitute for the missing `exports` subpaths (with warnings), see 3.2. |
| `resolver.resolveRequest` | Expo leaves it `null` (no hits for `resolveRequest` in `@expo/metro-config@57.0.13/build/`) | **Yes, whenever the package is consumed as a package** (`file:` link or published tarball). Not needed for the vendored, specifier-rewritten copy of section 4.1. Use the shim in section 1; if another plugin ever sets one, capture and chain it instead of overwriting. |
| watcher/serializer | default | No change. |

### 3.4 Second-order finding: a linked package's dependency lookups go through Metro's file map

With a `file:` link, the shared package's real directory sits outside the app root. Metro's
`fileSystemLookup` consults its in-memory file map (docs: "A file 'exists' if and only if it is watched"),
so a hierarchical `node_modules` walk starting inside `…/hermes-agent/apps/shared/src/` cannot see
`…/hermes-agent/node_modules` unless that directory is a watched root. That is not theoretical: with only
`watchFolders: [sharedReal]` the build fails on a **transformer-injected** dependency, because
`babel-preset-expo`'s `@babel/plugin-transform-runtime` rewrites the out-of-root files and injects helpers:

```
Error: Unable to resolve module @babel/runtime/helpers/slicedToArray from
  .../apps/shared/src/i18n.ts: could not be found within the project or in these directories:
  ../../../home/shameel/.hermes/hermes-agent/node_modules
```

Both `/home/shameel/.hermes/hermes-agent/node_modules/@babel/runtime` and the app's own
`node_modules/@babel/runtime` existed; only the *watched* path mattered. Adding
`watchFolders: [sharedReal, <monorepo>/node_modules]` and `nodeModulesPaths: [<app>/node_modules,
<monorepo>/node_modules]` fixed it (this is exactly what Expo's own monorepo support adds). A vendored
copy inside the app tree never hits this: helpers resolve from the app's own `node_modules`.

---

## 4. Ranked linking structures (cheapest first)

Ranking = total work today + work per upstream change + failure surface. All three were exercised to the
point of a real Metro build where possible.

### 1. Vendored copy inside the app tree, with a mechanical specifier rewrite (cheapest, verified)

`cp -r apps/shared vendor/shared` + one rewrite of all `.js` relative specifiers, then import via
relative paths or a tsconfig/Babel alias. Proven: `/tmp/hm/vendored-all` with
`sed -E "s#(from ')\./([A-Za-z0-9._-]+)\.js'#\1./\2'#g"` over `src/*.ts` leaves **0** `.js` specifiers,
the full graph resolves with **0 unresolved edges and 0 resolution warnings**, and a real Metro build of
`import { JsonRpcGatewayClient } from './vendor/shared/src'` emits an 85,168-byte bundle with **zero
Metro resolver configuration** (no shim, no `watchFolders`, no `nodeModulesPaths`, no `extraNodeModules`).
The package boundary and the `exports` map stop mattering, so the missing 10 subpaths stop mattering too.

- Cost: one `sed` (12 occurrences) plus a re-sync script. ~220 KB of TS + the 990.7 KB OpenRPC JSON if
  you also copy it (`vendor/shared/src/*.test.ts` files can be dropped).
- Version skew: **silent**. Nothing forces a re-copy. Mitigation: keep a `VENDORED-FROM` line in the
  copy's header and diff `gateway-contract.generated.ts` (or its hash) against the monorepo in a check.
- Best when: the app must build on machines without `~/.hermes/hermes-agent`, or you want a hermetic repo.

### 2. `file:` link to the monorepo (`"@hermes/shared": "file:/home/shameel/.hermes/hermes-agent/apps/shared"`)

Verified working end to end (`/tmp/hm/expobundle`): `npm install` creates a **symlink**
(`node_modules/@hermes/shared -> ../../../…/apps/shared`, npm 11.19.0; the monorepo's own root
`node_modules/@hermes/shared -> ../../apps/shared` is the same model), Metro follows it, and with the
section-1 config the bundle emits (49 modules, 85,149 bytes).

- Cost: the ~30-line `metro.config.js` in section 1, plus the shim **forever** (until upstream lands
  `facebook/metro#886`, or until the monorepo drops the `.js` suffixes).
- Version skew: **none by construction** - every edit to the package is live, no reinstall, no version
  bump. That is also the risk: an unreviewed upstream change lands in the app on the next bundle. Nothing
  in the repo pins `@hermes/shared` to a version (`"version": "0.0.0"`), so there is no way to express
  "app expects contract vN".
- Extra requirements: the monorepo tree must exist at that absolute path; `watchFolders` +
  `nodeModulesPaths` must include the monorepo `node_modules` (section 3.4); the app should still import
  only exported subpaths or use the `extraNodeModules` alias.
- Best when: single-machine development against a moving source tree, which is exactly the desktop's
  model (`"@hermes/shared": "file:../shared"`).

### 3. Publish (npm package, tarball, or a `prepare`/`prepack` build)

Most work, and it does not remove either hard requirement on its own.

- Today there is **no build step**: `apps/shared/package.json` has only `lint`, `lint:fix`, `fix`,
  `typecheck`, `check`, no `build`, and `exports` points at `.ts`. `"private": true` blocks `npm publish`.
  Publishing raw `src/*.ts` with `.ts` targets "works" for Metro (Metro reads the exact target file) but
  is still broken for Metro on the `.js` specifiers and still broken for any tsc/Node consumer that has no
  `allowImportingTsExtensions` pipeline.
- A real publish means adding a `tsc` emit (ESM `.js` + `.d.ts`) or a tarball `prepack`, a version bump
  policy, and a release per contract change: the generated file changes whenever Python contracts change
  (section 5), so contract churn becomes release churn.
- Skew becomes explicit (semver + lockfile) instead of implicit. That is the only thing this buys over
  structure 1 or 2, and it is the wrong purchase for an app that is being built alongside the monorepo.
- `npm pack` of the raw source directory (no build) is a middle ground: it produces a tarball with the
  same `.ts` payload, so it buys nothing over `file:` except a pinned SHA.

**Recommendation.** Start with structure 2 while the two repos live on this machine (no copy to drift,
`file:` is already the proven model in-tree), and add a rewrite+copy step (structure 1) only when the app
must build without `~/.hermes/hermes-agent` present. In both cases open one upstream ask, because it is
three small edits that delete the shim entirely: complete the `exports` map (10 subpaths) and drop the
`.js` suffix on the 12 relative specifiers (or at least the 3 runtime ones).

---

## 5. Sync story for `gateway-contract.generated.ts`

Facts (generator/pipeline leg, with citations):

- **Single source of truth is Python**, not the TS file: `tui_gateway/contracts/*` Pydantic models
  registered into `METHODS` / `SERVER_REQUESTS` / `EVENTS`
  (`tui_gateway/contracts/registry.py:44-46`, `:58-70`; `base.py:1-9` "Python is the single source of
  truth"). `scripts/gen_gateway_contracts.py:24-41` imports them locally - no server, no socket, no DB.
- It emits exactly two files (`:43-44`, `render_all()` `:342-343`): `apps/shared/src/gateway-contract.generated.ts`
  and `apps/shared/src/gateway-contract.openrpc.json` (OpenRPC 1.3.2).
- Header of the generated TS tells the developer the command: `.venv/bin/python scripts/gen_gateway_contracts.py`
  (`gateway-contract.generated.ts:2`, same string in `tests/tui_gateway/contracts/test_generated.py:4`).
  A `--check` mode exists (`gen:346-363`, prints `stale: <path>` and exits 1) with **no caller in the repo**.
- Idempotent by construction: models de-duplicated into an `OrderedDict`, every emitted name list
  `sorted()`, and `main()` writes only when the bytes differ (`gen:350-358`).
- **The drift gate is a test, not a script**: `tests/tui_gateway/contracts/test_generated.py:30-33`
  re-renders both artefacts in memory and asserts byte equality with the committed files. CI routes it
  into the Python lane whenever either file changes (`scripts/ci/classify_changes.py:118-119`, pinned by
  `tests/ci/test_classify_changes.py:124-131`: a diff of either generated file forces
  `python=True, frontend=True, e2e_desktop_core=True`). Nothing in CI regenerates, it only compares.
- The frontend lane type-checks it as ordinary source (`apps/shared` `check` = `tsc -p . --noEmit`;
  desktop's tsconfig `include: ["src", "../shared/src"]`), and `skipLibCheck` does **not** exempt it
  (that skips `.d.ts` only).
- Shape and size: 6072 lines / 213.5 KB, **only 3 runtime values** -
  `RPC_METHODS` (`:5527`, 258 entries), `SERVER_REQUEST_METHODS` (`:5819`, 14),
  `GATEWAY_EVENT_TYPES` (`:5994`, 77) - plus ~749 type/value-shape declarations and no enums or classes.
  `gateway-contract.openrpc.json` is 990.7 KB; no TS/JS file imports it (only the Kotlin app's docs quote
  it, e.g. `~/hermes-app/docs/PLATFORM-API.md:522-527`, which already tells consumers to "vendor and
  assert against it").
- The only in-repo runtime seam is `gateway-events.ts:17` (`export *`) and `:58`
  (`export { GATEWAY_EVENT_TYPES as BACKEND_EVENT_NAMES }`), and `BACKEND_EVENT_NAMES` is itself unused
  by any consumer. `RPC_METHODS` / `SERVER_REQUEST_METHODS` are not used at all in-repo; every direct
  import of the generated module elsewhere is `import type`.

**So, for whichever structure you pick:**

- Vendoring: the copy is a snapshot. Re-copy `gateway-contract.generated.ts` whenever it changes upstream;
  the cheapest gate is a hash comparison in the re-sync script, and the strongest is to re-run the Python
  drift test in the monorepo before re-vendoring. You cannot run the generator inside the Expo repo (it
  imports `tui_gateway` and `tools`, and pydantic).
- `file:` link: zero sync work, and that is the point. The drift gate still runs only in the monorepo's
  Python lane, so a local uncommitted regeneration is invisible to the app until someone else's PR lands.
- Publish: every contract change becomes a release. Do not do this unless the app must be reproducible
  without the monorepo.
- Either way, the app should treat the contract as pinned by its lockfile/commit, and should not depend
  on the 3 runtime arrays (nothing in-tree does).

---

## 6. Portability inventory

Zero npm runtime dependencies in the package: every non-test import is relative and intra-package
(`index.ts:1-189`, `json-rpc-gateway.ts:1-11`, `json-rpc-channel.ts:1,2`, `gateway-events.ts:15,17,58`,
`billing-policy.ts:1`, `billing-types.ts:23`, `charge-settlement.ts:1,2`). The only externals are
`typescript` (dev) and `vitest` inside the test files.

| Module | Verdict for RN/Hermes | Notes |
| --- | --- | --- |
| `color.ts` | portable as-is | pure sRGB math + regex (`:20-31`, `:51-59`) |
| `ansi.ts` | portable as-is | regex + `String.fromCharCode` (`:5-38`) |
| `format.ts` | portable as-is | `Number`/`Math` only (`:7-30`); exports `compactNumber` |
| `slash.ts` | portable as-is | regex parse + switch (`:9-33`, `:78-120`) |
| `reasoning-effort.ts` | portable as-is | const arrays (`:4-23`) |
| `fuzzy.ts` | portable as-is | string/regex (`:31-38`, `:58-140`) |
| `model-search-text.ts` | portable as-is | alias table (`:10-36`) |
| `backend-scope.ts` | portable as-is | string math (`:17-39`) |
| `data-url-read-max.ts` | portable as-is | constants (`:17-33`) |
| `skill-scaffold.ts` | portable as-is | optional chaining (`:57`), Hermes-supported |
| `update-debt.ts` | portable as-is | string building (`:22-47`) |
| `reconnect-backoff.ts` | portable as-is | `Date.now` default param (`:36`), `Math.random/min` |
| `cron-trigger-controller.ts` | portable as-is | `Set` + `Promise` (`:14-40`) |
| `billing-policy.ts` | portable as-is | `Object.hasOwn` (`:40`), implemented in Hermes (`lib/VM/JSLib/Object.cpp:158-162`) |
| `billing-types.ts` | portable as-is | types only (`:1-8`) |
| `gateway-contract.generated.ts` | portable as-is | no globals; 3 runtime arrays (see section 5) |
| `gateway-events.ts` | portable as-is | value re-exports the generated module (`:17`, `:58`) |
| `catalog-install.ts` | portable as-is | `new URLSearchParams(obj)` (`:30`); RN polyfills it, Expo replaces it with `whatwg-url-minimum` |
| `i18n.ts` | portable with a guard | `applyDocumentLocale` early-returns on `typeof document === 'undefined'` (`:200`), so it is a **silent no-op on RN**; RTL must go through `I18nManager`. `LOCALE_ENDONYMS`/`RTL_LOCALES`/`mergeTranslations` are plain data/functions |
| `theme-presets.ts` | portable with a guard | palettes are hex, but `nousAltTint`/`nousAltTintTransparent` emit CSS `color-mix(in srgb, #0053FD N%, #FFFFFF)` (`:63-64`, used in the `nous` preset `:125-182`); RN `StyleSheet` cannot parse `color-mix`, so pre-resolve with `color.ts`'s `mix()` or override |
| `websocket-url.ts` | **needs a guard** | see section 8; the `typeof window` guard does not hold on RN |
| `json-rpc-channel.ts` | portable, one shim concern | module-scope `new TextDecoder()` (`:161`); `DOMException` on abort paths (`:262`, `:310`) |
| `json-rpc-gateway.ts` | portable as-is | global `WebSocket`, `WebSocket.OPEN`, `addEventListener`, `URL` - all present in RN |
| `skin.ts` | portable as-is (desktop-only payload) | pure token enums (`:17-83`); note `customCSS` (`:113`) is raw CSS for a scoped `<style>` tag - ignore on Android |
| `translucency.ts` | **desktop-only** | Electron window translucency: `translucencySupportedOn` false outside darwin/win32 (`:202-204`), `glassSupportedOn` same (`:211-215`, Windows floor 22621 at `:99`), `normalizeMode` then forces `'clear'` (`:238-241`). Android inherits only the clamp/math shell and no material |

**Every DOM/Node touch in the package** (grep over 27 non-test files):

- `i18n.ts:200` `typeof document === 'undefined'` guard, `:204-205` `document.documentElement.lang/dir`
  (test asserts the guard at `i18n.test.ts:119-122`).
- `websocket-url.ts:114` `typeof window === 'undefined'` guard, `:118` `window.location.host/.protocol`
  (guard is ineffective on RN - section 8).
- `json-rpc-channel.ts:161` `new TextDecoder()` **at module scope, unguarded**; `:169-170`
  `ArrayBuffer`/`isView` + `wireDecoder.decode`; `:262`, `:310` `new DOMException('Aborted','AbortError')`;
  `:252`, `:272`, `:313` `AbortSignal` + `addEventListener('abort', ...)`; `:145/:192/:288/:542/:583/:597/:606`
  `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`; `:176-178` the optional-chained `unref` probe,
  only reached when `unrefTimers` is true and it defaults to false (`:216`).
- `json-rpc-gateway.ts:16` `WebSocketLike = WebSocket` (type position); `:117` `socket.send`;
  `:206/:409/:491` `WebSocket.OPEN`; `:212` `new WebSocket(wsUrl)` with an optional `socketFactory` escape
  hatch (`:35`); `:217/:229/:250-252/:312-314` `addEventListener`/`removeEventListener`, reading
  `event.code`/`event.reason` on close (`:307`); `:67` `new URL(value).protocol`; `:243/:247/:317` timers.
- `catalog-install.ts:30`, `websocket-url.ts:140/:145/:150` `URLSearchParams`.
- Deliberately **absent** everywhere: `navigator`, `localStorage`, `sessionStorage`, `crypto`, `Buffer`,
  `process`, `require`, `__dirname`, `globalThis`, `queueMicrotask`, `structuredClone`, `atob`/`btoa`,
  `performance`, `TextEncoder`, `EventTarget`, `matchMedia`, `requestAnimationFrame`, `setImmediate`.

---

## 7. Failure modes: Hermes / RN global availability

Target runtime: Hermes `v250829098.0.17` (RN 0.86.3 and 0.87.1 both), Expo SDK 57 winter runtime.

| Global used by the package | Status | Consequence for `@hermes/shared` |
| --- | --- | --- |
| `TextDecoder` (json-rpc-channel.ts:161, module scope) | **PRESENT** (Hermes contrib extension, shipped RN 0.85+; Expo also installs its own: `expo/src/winter/runtime.native.ts:16`) | Import-safe. Would be an **import-time** `ReferenceError` on JSC or Hermes < RN 0.85, since the construction is not lazy |
| `TextEncoder` | PRESENT (Hermes core extension, RN 0.74+) | unused by the package |
| `AbortController` / `AbortSignal` | PRESENT (RN `setUpXHR.js:37-47`; RN implements `abort/any/timeout` natively) | only touched inside methods |
| `WebSocket` | PRESENT, adequate: `class WebSocket extends EventTarget`, `CONNECTING/OPEN/...` statics + `readyState`/`binaryType`/`send`/`close`, dispatches `MessageEvent('message')`/`Event('open')`/`CloseEvent('close',{code,reason})`/`Event('error')` | `JsonRpcGatewayClient` works. Android delivers binary frames as `ArrayBuffer` (no `binaryType` needed, and the package never sets it, which is correct) |
| `DOMException` | **PRESENT in Expo only** (`expo/src/winter/runtime.native.ts:24`); absent in bare RN | `json-rpc-channel.ts:262/:310` throw `ReferenceError` on abort in a bare-RN (non-Expo) build. Irrelevant for the Expo target |
| `crypto` (`getRandomValues`/`randomUUID`/`subtle`) | **ABSENT** in Hermes, RN, and Expo winter | the package never uses it; relevant only to the app's PKCE/token ladder (`expo-crypto@57.0.4` for `getRandomValues`/`randomUUID`/`digest('SHA-256')`; no `subtle` in SDK 57) |
| `Intl.DateTimeFormat` / `NumberFormat` / `Collator` | PRESENT (Hermes built with `-DHERMES_ENABLE_INTL=True`, `ReactAndroid/hermes-engine/build.gradle.kts:351-353`) | the package never calls `Intl.*`, so nothing breaks here. Desktop UI code does use `fractionalSecondDigits` and `notation:'compact'`, which Hermes Android lacks - a UI-port concern, not a shared-package one |
| `Intl.RelativeTimeFormat` / `PluralRules` | ABSENT | unused by the package |
| `setTimeout(...).unref?.()` | `unref` **ABSENT** (RN timers return numeric ids) | harmless: `json-rpc-channel.ts:176-178` uses optional chaining and `unrefTimers` defaults to `false` (`:216`); `JsonRpcGatewayClient` never enables it. Nothing to fix |
| `structuredClone` | Expo only | unused |
| `URL` / `URLSearchParams` / `fetch` / `performance.now` / `queueMicrotask` / `atob` / `btoa` | PRESENT | `URL` is used by `isGatewayWebSocketUrl`, `URLSearchParams` by `websocket-url.ts` and `catalog-install.ts` |
| `ArrayBuffer.isView` (json-rpc-channel.ts:169) | PRESENT | used for frame decoding |

### The one live bug: `buildHermesWebSocketUrl()` throws on RN

`websocket-url.ts:113-119` guards on `typeof window === 'undefined'`, but **RN defines `window`**:
`react-native/Libraries/Core/setUpGlobals.js:20-26` does `globalThis.window = globalThis` (configurable
false) and RN installs no `location`. So the guard is false, `readWindowLocation()` evaluates
`window.location.host`, and the call at `:133` throws before the `options.protocol ?? loc.protocol` /
`options.host ?? loc.host` fallbacks at `:134-135` can help. I confirmed it by simulating RN's global
shape in Node and importing the real module:

```
globalThis.window = globalThis
buildHermesWebSocketUrl({ path: '/api/ws', authParam: ['token','T'] })
  -> THREW: TypeError: Cannot read properties of undefined (reading 'host')
// control, no window global at all:
buildHermesWebSocketUrl({ path: '/api/ws', host: '127.0.0.1:8111', protocol: 'http:' })
  -> ws://127.0.0.1:8111/api/ws
```

**Passing `host`/`protocol` does not avoid the throw.** The app must not call this function as-is on RN;
either build the `ws://` URL locally (it is a template string plus `URLSearchParams`), or fix the guard
upstream to `typeof window !== 'undefined' && window.location`. Note the practical consequence for
`resolveGatewayWsUrl` too: its auth ladder is reachable only through this one entry, so any RN caller
needs the fix or a local equivalent.

Other residual gaps, lower severity:

- `json-rpc-gateway.ts` never sets `binaryType` and `wireFrameText` (`json-rpc-channel.ts:164-173`)
  returns `null` for a `Blob`, so a binary frame delivered as a Blob would be dropped silently. On
  Android binary frames arrive as `ArrayBuffer` regardless, and the gateway sends text frames, so this is
  a latent gap rather than an active bug.
- `index.ts` (the barrel) imports every sibling, so an app that only wants `compactNumber` still drags
  `json-rpc-channel.ts` (and therefore the module-scope `TextDecoder`) into its graph. 27 local modules,
  all small, and the generated contract's 749 interfaces erase at build time. The 3 runtime arrays are
  referenceable, so a non-minifying bundler would keep them; on the desktop Vite tree-shakes them.

---

## 8. Corrections to sibling research

- `/tmp/hermes-mobile-research/webclient.md:130` says the DOM references are "guarded" and concludes the
  package is "DOM-free in practice and consumable directly by React Native". The `i18n.ts` guard holds;
  the `websocket-url.ts` guard does **not** (RN defines `window` without `location`), so
  `buildHermesWebSocketUrl()` throws, and the same line's own parenthetical at `:69` ("RN must pass both
  explicitly or the URL becomes `ws:///api/ws`") understates it: passing both does not help.
- `/tmp/hermes-mobile-research/webclient.md:131` lists the `.js`-specifier and `exports` risks as
  `[INFERENCE]` "to verify". Both are now confirmed, and the `.js` one is fatal without the shim.
- `/tmp/hermes-mobile-research/toolchain.md:411-417` (R1) suggests the mitigation "add
  `resolver.unstable_enablePackageExports = true` plus `watchFolders`/`extraNodeModules`". Two
  corrections: exports is **already** true by default (and must stay true, since the package has no
  `main`), and neither `watchFolders` nor `extraNodeModules` touches the actual blocker, which is the
  `.js` -> `.ts` substitution. The shim in section 1 is the missing piece; it is verified against the
  same Metro build (`metro-resolver` 0.84.x, as pinned by `@expo/metro@56.x`).
- `/tmp/hermes-mobile-research/toolchain.md:412` infers the `@expo/metro@56.0.2` default from type
  declarations. Confirmed by reading the tarball: it wraps `metro`/`metro-resolver` **0.84.5**
  (56.1.0 -> 0.84.6) and ships no resolver patches.

## 9. Not verified

- The Android Hermes prebuilt tarball's CMake flags are not readable from npm; TextEncoder/TextDecoder
  availability is inferred from the Hermes source defaults (`HERMES_ENABLE_CORE_EXTENSIONS=ON`,
  `HERMES_ENABLE_CONTRIB_EXTENSIONS=ON`) plus RN 0.86.3/0.87.1's `hermes-v250829098.0.17`. Expo installs
  its own `TextDecoder`, so the Expo target does not depend on this.
- No `watchman` run: the Fast-Refresh consequence of `watchFolders` was reasoned from Expo's own monorepo
  handling and Metro's file-map docs, not observed on a device.
- `npx expo export --platform android` was not run (no Expo CLI project scaffolding here); the equivalent
  evidence is a real `metro build` with the identical toolchain versions.
