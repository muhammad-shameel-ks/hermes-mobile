/**
 * The About page's pure half: the build identity the phone stamps in every gate
 * receipt (issue "App repository, toolchain and distribution": app version,
 * vendored Hermes commit, contract hash, live server version). Labels follow the
 * desktop's version-details block (`updates.versionDetails*`).
 */

export type BuildIdentity = {
  appVersion: string;
  /** vendor/hermes-shared/MANIFEST.json `upstream.commit` */
  commit: string;
  contractSha256: string;
  /** the live gateway's `/api/status` version, once it answers */
  serverVersion: string | null;
};

export type AboutRow = { label: string; value: string; mono?: boolean };

export const REPO_COMMIT_URL = 'https://github.com/NousResearch/hermes-agent/commit/';

/** desktop lib/version-label.ts: `0.21.5+1913.gabc` reads as `0.21.5+1913` */
export function shortVersion(version: string): string {
  return version.replace(/^v/, '').replace(/(\+\d+)\.g[0-9a-f]+(?:\.dirty)?$/i, '$1');
}

type Manifest = { upstream?: { commit?: unknown }; contractSha256?: unknown };

export function buildIdentity(appVersion: string, manifest: Manifest, serverVersion: string | null): BuildIdentity {
  return {
    appVersion,
    commit: typeof manifest.upstream?.commit === 'string' ? manifest.upstream.commit : '',
    contractSha256: typeof manifest.contractSha256 === 'string' ? manifest.contractSha256 : '',
    serverVersion,
  };
}

export function aboutRows(identity: BuildIdentity): AboutRow[] {
  const rows: AboutRow[] = [{ label: 'Version', value: `v${shortVersion(identity.appVersion)}` }];
  if (identity.commit) rows.push({ label: 'Hermes commit', value: identity.commit.slice(0, 14), mono: true });
  if (identity.contractSha256) rows.push({ label: 'Contract', value: identity.contractSha256.slice(0, 12), mono: true });
  rows.push({ label: 'Gateway', value: identity.serverVersion ? `v${shortVersion(identity.serverVersion)}` : 'Version unavailable' });
  return rows;
}
