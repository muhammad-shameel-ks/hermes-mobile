# Contributing to Hermes Mobile

Thanks for helping out. Bug fixes, new features, and work that brings the mobile app closer to the Hermes desktop app are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Small fix** (typo, obvious bug, missing test): open a pull request directly.
- **New feature or larger change**: open an [issue](https://github.com/muhammad-shameel-ks/hermes-mobile/issues/new/choose) first so we can agree on the approach before you spend time on it.
- **Looking for something to do?** Check issues labelled [`good first issue`](https://github.com/muhammad-shameel-ks/hermes-mobile/labels/good%20first%20issue) or [`help wanted`](https://github.com/muhammad-shameel-ks/hermes-mobile/labels/help%20wanted).
- **Parity with desktop:** the goal is to reproduce the desktop app's behaviour and look. When porting something, name the desktop source file or behaviour in your PR. If the phone should deliberately differ, say so; the glossary calls that a *parity deviation*.

Read [GLOSSARY.md](GLOSSARY.md) for the project's vocabulary and skim [docs/adr/](docs/adr/) for decisions that touch the area you are changing.

## Set up

See [Develop in the README](README.md#develop) for prerequisites and how to run the app. In short:

```sh
git clone https://github.com/<your-username>/hermes-mobile.git
cd hermes-mobile
npm ci
npm run android   # or: npm run ios
```

## Workflow

`main` is protected. Nobody, including maintainers, pushes to it directly; every change lands through a pull request.

1. Fork the repository and create a branch from an up-to-date `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`.
2. Make your change. Keep it focused: one concern per pull request.
3. Run the checks locally:
   ```sh
   npm run typecheck
   npm test
   ```
4. Push your branch and open a pull request against `main`. Fill in the template.
5. CI must pass. A maintainer reviews, may ask for changes, and squash-merges.

### Every merge to `main` is a release

Merging to `main` triggers [the release workflow](docs/releasing.md): it bumps the version, builds an Android APK and publishes a GitHub release. The release notes and `CHANGELOG.md` are generated from the **squashed commit subject**, which is your pull request's title. So write the title as a user-facing line, in the imperative, in sentence case, without a trailing period:

- `Close the keyboard after a message is sent`
- `Add Open preview and Download buttons to delivered file cards`

Do not edit `CHANGELOG.md`, the version in `app.json` or `package.json`, or `android.versionCode`. The release workflow owns them.

## Code guidelines

- **TypeScript, strict.** `npm run typecheck` must pass with no errors.
- **Follow the surrounding code.** Match the naming, file layout and comment density of the module you are in. Use the terms in the glossary rather than inventing synonyms.
- **Keep logic out of components.** Pure logic lives in plain `.ts` files (`controller.ts`, `queue.ts`, `slash.ts`) so it can be tested without React Native. Components (`.tsx`) are thin.
- **Import with the `.ts` / `.tsx` extension**, as the existing code does.
- **Do not edit generated folders.** `android/` and `ios/` are produced by `expo prebuild`. Change `app.json` or add a config plugin under `plugins/` instead.
- **Do not edit `vendor/hermes-shared/` by hand.** It is a pinned copy of the Hermes monorepo's shared package. Refresh it with `node scripts/sync-hermes.mjs` (see [ADR 0002](docs/adr/0002-standalone-repo-vendored-shared.md)); `node scripts/sync-hermes.mjs --check` verifies it matches its manifest.
- **Add dependencies deliberately.** Prefer Expo SDK packages, use the version `npx expo install` picks, and explain new dependencies in the PR.
- **Patch a dependency only as a last resort.** Patches live in `patches/` and are applied by `patch-package` on every install. Make the change in `node_modules/<package>`, then run `npx patch-package <package> --exclude '^package\.json$|/\.cxx/|/build/|/\.gradle/'` so native build output stays out of the patch. Explain the bug and the upstream status in the PR, and drop the patch once a release fixes it. A patch is pinned to its package version, so bumping that package means regenerating or deleting the patch.
- **Record decisions.** A change that is hard to reverse or surprising without context deserves an ADR in `docs/adr/`.

## Tests

Tests use Node's built-in runner and live in `tests/*.test.ts`, one file per module. They import source directly and run without a device, so they cover logic, not rendering.

```sh
npm test                                            # everything
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/lru.test.ts   # one file
```

New behaviour and bug fixes should come with a test. Name tests for the behaviour (`a double tap zooms a fitted picture in`), not the function. For UI changes, say in the PR how you checked them on a device or emulator, and attach a screenshot or screen recording where it helps.

## Reporting bugs and suggesting features

Use the [issue templates](https://github.com/muhammad-shameel-ks/hermes-mobile/issues/new/choose). For a bug, include the app version (Settings → About), your platform and OS version, the gateway version if you know it, and steps to reproduce. Never paste tokens or private gateway addresses.

Security problems do not belong in public issues. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
