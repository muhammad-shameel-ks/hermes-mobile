#!/usr/bin/env node
/**
 * Vendors `@hermes/shared` from a Hermes checkout into vendor/hermes-shared/
 * (ADR 0002). Copies the package's non-test sources, rewrites the `.js`-suffixed
 * relative specifiers to `.ts` (Metro cannot resolve the former; Node's type
 * stripping and tsc's allowImportingTsExtensions accept the latter), and stamps
 * a manifest with the upstream commit, the contract hash and a hash per file.
 *
 * The generated gateway contract is taken as committed upstream; regenerating it
 * with the monorepo's Python generator is a later step.
 *
 *   node scripts/sync-hermes.mjs [--source <hermes-agent checkout>]
 *   node scripts/sync-hermes.mjs --check     # verify the vendored tree against its manifest
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, 'vendor', 'hermes-shared');
const manifestPath = join(target, 'MANIFEST.json');
const CONTRACT = 'gateway-contract.generated.ts';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function check() {
  if (!existsSync(manifestPath)) throw new Error('vendor/hermes-shared/MANIFEST.json is missing; run the sync first.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const onDisk = readdirSync(join(target, 'src')).sort();
  const listed = Object.keys(manifest.files).sort();
  const problems = [];
  for (const name of onDisk) if (!listed.includes(name)) problems.push(`unlisted file: ${name}`);
  for (const name of listed) {
    const path = join(target, 'src', name);
    if (!existsSync(path)) problems.push(`missing file: ${name}`);
    else if (sha256(readFileSync(path, 'utf8')) !== manifest.files[name]) problems.push(`modified file: ${name}`);
  }
  if (problems.length > 0) {
    console.error(`vendor/hermes-shared has drifted from ${manifest.upstream.commit}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`vendor/hermes-shared matches ${manifest.upstream.commit} (${listed.length} files).`);
}

function sync() {
  const source = resolve(arg('--source') ?? join(homedir(), '.hermes', 'hermes-agent'));
  const sharedSrc = join(source, 'apps', 'shared', 'src');
  if (!existsSync(sharedSrc)) throw new Error(`No @hermes/shared sources at ${sharedSrc}`);

  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', 'apps/shared');
  if (dirty !== '') throw new Error(`apps/shared has uncommitted changes in ${source}; vendor a clean commit.`);
  const commit = git('rev-parse', 'HEAD');
  const committedAt = git('log', '-1', '--format=%cI');

  const names = readdirSync(sharedSrc)
    .filter((name) => name.endsWith('.ts') && !/\.test(-d)?\.ts$/.test(name))
    .sort();

  rmSync(join(target, 'src'), { recursive: true, force: true });
  mkdirSync(join(target, 'src'), { recursive: true });

  const files = {};
  let rewritten = 0;
  for (const name of names) {
    const original = readFileSync(join(sharedSrc, name), 'utf8');
    const text = original.replace(/(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\.js\2/g, (_m, lead, quote, path) => {
      rewritten += 1;
      return `${lead}${quote}${path}.ts${quote}`;
    });
    writeFileSync(join(target, 'src', name), text);
    files[name] = sha256(text);
  }

  const manifest = {
    upstream: { repo: 'NousResearch/hermes-agent', path: 'apps/shared/src', commit, committedAt },
    contractSha256: sha256(readFileSync(join(sharedSrc, CONTRACT), 'utf8')),
    rewrittenSpecifiers: rewritten,
    files,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Vendored ${names.length} files from ${commit.slice(0, 12)} (${rewritten} specifiers rewritten).`);
}

try {
  if (process.argv.includes('--check')) check();
  else sync();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
