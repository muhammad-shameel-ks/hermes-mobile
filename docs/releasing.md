# Releasing

`main` is the release branch. There is no separate release branch and no manual
release step for Android.

## How a release happens

Pushing to `main` triggers `.github/workflows/android-release.yml`, which:

1. runs `npm run typecheck` and `npm test` — a failure stops the release before
   anything is published;
2. patch-bumps the version (`scripts/bump-version.mjs`), writing `expo.version`,
   `expo.android.versionCode` and the `package.json` version;
3. regenerates `CHANGELOG.md` and `RELEASE_NOTES.md` from the commit subjects
   since the last tag (`scripts/changelog.mjs`);
4. regenerates the native project with `expo prebuild` (`android/` is gitignored
   and generated, never edited by hand);
5. builds `assembleRelease` for **arm64-v8a only** (modern phones; the APK does
   not install on 32-bit ARM phones or x86 emulators), reusing the Gradle cache
   and a ccache of the native C++ from earlier runs;
6. commits the version bump and changelog back to `main` as
   `chore(release): vX.Y.Z [skip ci]`, tags it `vX.Y.Z`, and publishes a GitHub
   release with `hermes-X.Y.Z.apk` attached.

Because the build runs *before* the bump commit, a failed build leaves no tag,
no release and no version change — the next push retries the same version.

You can also run it by hand from **Actions → Android Release → Run workflow**.

## Versioning

The latest `vX.Y.Z` tag is the source of truth:

- with a previous tag, the version is patch-bumped (`0.1.0` → `0.1.1`);
- on the very first run, whatever `app.json` already says is used as-is.

To force a minor or major bump, edit `expo.version` in `app.json` and push; the
next release will adopt it if it is ahead of the last tag. `versionCode` is
derived from the version (`0.1.1` → `101`) so it always increases.

## In-app updates

Installed release builds check
`https://api.github.com/repos/muhammad-shameel-ks/hermes-mobile/releases/latest`
when the app opens and when it comes back to the foreground (at most once
every 6 hours). If that release's `vX.Y.Z` tag is newer than the app's
`expo.version`, a sheet offers to download the attached `.apk` and hands it to
Android's package installer. You can also check by hand from **Settings →
About → Updates**. Dev clients never check on their own, and iOS never shows
updates. The code lives in `src/updates/`.

This depends on two things in the workflow above: every release must attach
exactly one `.apk`, and every build must be signed with the same key, because
Android will not install an update signed with a different key. The first time
someone installs an update, Android asks them to let Hermes "install unknown
apps".

## Signing

Release builds are currently signed with the debug keystore (`android/` is
generated, so `assembleRelease` picks up the generated `debug.keystore`). This
is fine for sideloading test builds but is **not** suitable for the Play Store —
before publishing there, generate a real keystore and expose it to CI as
repository secrets.

## iOS

Not wired up yet. When it is, it will be a separate workflow; nothing here
depends on Xcode.
