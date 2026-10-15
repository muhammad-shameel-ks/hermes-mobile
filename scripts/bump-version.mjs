#!/usr/bin/env node
// Bumps the app version for an automated release.
//
// The latest `vX.Y.Z` git tag is the source of truth:
//   - with a previous tag, the version is patch-bumped (0.1.0 -> 0.1.1)
//   - with no tag yet, the version already in app.json is adopted as-is,
//     so the first automated release is whatever `expo.version` says today
//
// Writes `app.json` (`expo.version`, `expo.android.versionCode`) and
// `package.json` (`version`), and prints the new version so CI can read it
// back through `$GITHUB_OUTPUT`.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const APP_JSON = "app.json";
const PACKAGE_JSON = "package.json";

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value).replace(/^v/, ""));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function latestTagVersion() {
  try {
    const tag = execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return parseSemver(tag);
  } catch {
    return null;
  }
}

const appJson = JSON.parse(readFileSync(APP_JSON, "utf8"));
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));

const current = parseSemver(appJson.expo?.version);
if (!current) {
  console.error(`app.json expo.version is not a plain x.y.z version: ${appJson.expo?.version}`);
  process.exit(1);
}

const tagged = latestTagVersion();

// With a previous tag, patch-bump it — but never rewind past what app.json
// already says, which can happen when an earlier run bumped the files and then
// failed before it could tag and publish.
const release = tagged
  ? { ...tagged, patch: tagged.patch + 1 }
  : current;
const chosen = compareSemver(release, current) >= 0 ? release : current;

const version = formatSemver(chosen);
// Android's versionCode must strictly increase, so derive it from the version.
// 0.1.0 -> 100, 0.1.1 -> 101, 1.2.3 -> 10203.
const versionCode = chosen.major * 10000 + chosen.minor * 100 + chosen.patch;

appJson.expo.version = version;
appJson.expo.android = { ...appJson.expo.android, versionCode };
packageJson.version = version;

writeFileSync(APP_JSON, `${JSON.stringify(appJson, null, 2)}\n`);
writeFileSync(PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`version ${formatSemver(current)} -> ${version} (versionCode ${versionCode})`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nversion_code=${versionCode}\n`);
}
