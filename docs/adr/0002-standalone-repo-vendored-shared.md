# The app is a standalone repo that vendors `@hermes/shared`

`hermes-mobile` stays its own repository, with the Expo project at the root, rather than becoming an
`apps/mobile` package inside the Hermes monorepo: `@hermes/shared` is `private: true` and source-only
(no `main`, 17 export subpaths pointing at raw `.ts`), its in-tree consumers alias it to `../shared/src`
rather than exercise it as a package, and this account holds only pull rights on `NousResearch/hermes-agent`,
so living in the monorepo would mean tracking a fork that adds the first React Native project to a repo
with no Expo precedent. Instead the package is vendored into `vendor/hermes-shared/` by `scripts/sync-hermes.mjs`,
which pins a Hermes commit, runs the monorepo's Python contract generator, copies the sources in, rewrites
the twelve `.js`-suffixed relative specifiers that Metro cannot resolve, and records the upstream SHA and
contract hash in a manifest.

## Consequences

- Updating shared code is an explicit, pinned act rather than a dependency bump; the manifest is the only
  place drift is visible, so CI compares it against the vendored tree.
- No Metro `resolveRequest` shim is needed, because the specifiers are fixed at copy time.
- Refreshing the generated gateway contract needs Python plus a Hermes checkout, not just npm.
- There is no distribution channel yet: builds reach devices over adb, and choosing one (EAS, a sideloaded
  signed APK, Play, a self-hosted feed) is deferred until the app is worth installing by someone other than
  its author. No release keystore exists, so that decision also brings signing with it.
