#!/usr/bin/env node
// Builds the release notes for a version from commit subjects.
//
// Prepends a section to CHANGELOG.md (which is committed) and writes the same
// notes to RELEASE_NOTES.md for `gh release create --notes-file` (which is not).
//
// Usage: node scripts/changelog.mjs <version>

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CHANGELOG = "CHANGELOG.md";
const RELEASE_NOTES = "RELEASE_NOTES.md";
// The very first release has no previous tag, so cap the history it lists.
const FIRST_RELEASE_LIMIT = 50;

const PREAMBLE = `# Changelog

All notable changes to Hermes Mobile are recorded here. Each section is
generated from the commit subjects since the previous release tag.
`;

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/changelog.mjs <version>");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function lastTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const tag = lastTag();
const range = tag ? `${tag}..HEAD` : "HEAD";
const slug = repoSlug();

const total = Number(git(["rev-list", "--no-merges", "--count", range]).trim());
const limit = tag ? total : Math.min(total, FIRST_RELEASE_LIMIT);

const commits = git([
  "log",
  range,
  `--max-count=${limit}`,
  "--no-merges",
  "--pretty=format:%h%x09%s",
])
  .split("\n")
  .filter((line) => line.includes("\t"))
  .map((line) => {
    const [hash, ...rest] = line.split("\t");
    return { hash, subject: rest.join("\t") };
  })
  // A release's own version bump is housekeeping, not a user-facing change,
  // and a stray "Merge ..." subject is noise even when it is not a merge commit.
  .filter(({ subject }) => !/^chore\(release\):/.test(subject))
  .filter(({ subject }) => !/^Merge /.test(subject));

const bullets = commits.map(({ hash, subject }) => {
  const link = slug ? ` ([${hash}](https://github.com/${slug}/commit/${hash}))` : ` (${hash})`;
  return `- ${subject}${link}`;
});

if (total > commits.length) {
  bullets.push(`- …and ${total - commits.length} earlier changes`);
}

const date = process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10);
const body = bullets.length ? bullets.join("\n") : "- No user-facing changes.";
const section = `## [${version}] - ${date}\n\n${body}\n`;

const compareUrl = slug && tag ? `https://github.com/${slug}/compare/${tag}...v${version}` : null;
const notes = [
  "### What's changed",
  "",
  body,
  compareUrl ? `\n**Full changelog:** ${compareUrl}` : "",
  "",
].join("\n");

writeFileSync(RELEASE_NOTES, notes);

// Drop any existing section for this version so re-runs stay idempotent.
function withoutSection(text) {
  const header = `## [${version}]`;
  const start = text.indexOf(header);
  if (start === -1) return text;
  const afterHeader = text.slice(start + header.length);
  const nextSection = afterHeader.search(/^## \[/m);
  const end = nextSection === -1 ? text.length : start + header.length + nextSection;
  return text.slice(0, start) + text.slice(end);
}

const existing = existsSync(CHANGELOG) ? withoutSection(readFileSync(CHANGELOG, "utf8")) : PREAMBLE;
const firstSection = existing.search(/^## \[/m);
const preamble = (firstSection === -1 ? existing : existing.slice(0, firstSection)).trimEnd();
const older = firstSection === -1 ? "" : existing.slice(firstSection).trimStart();

const changelog = older
  ? `${preamble}\n\n${section.trimEnd()}\n\n${older.trimEnd()}\n`
  : `${preamble}\n\n${section.trimEnd()}\n`;
writeFileSync(CHANGELOG, changelog);

console.log(`wrote ${CHANGELOG} and ${RELEASE_NOTES} for ${version} (${commits.length} commits)`);
