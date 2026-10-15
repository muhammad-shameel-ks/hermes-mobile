/**
 * The in-app updater's pure half: reading GitHub's "latest release" answer,
 * comparing versions and the copy the prompt and the About page show. CI
 * publishes every build as a `vX.Y.Z` release with one `hermes-X.Y.Z.apk`
 * attached (docs/releasing.md); that APK is what the phone installs.
 */

export const RELEASES_REPO = 'muhammad-shameel-ks/hermes-mobile';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

export type Release = {
  version: string;
  tag: string;
  notes: string;
  pageUrl: string;
  apkUrl: string;
  apkName: string;
  /** bytes; 0 when GitHub did not say */
  apkSize: number;
  publishedAt: string | null;
};

type GithubAsset = { name?: unknown; browser_download_url?: unknown; size?: unknown };
type GithubRelease = {
  tag_name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** `v0.1.6` → `[0, 1, 6]`; null when it is not a dotted version */
export function parseVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, '').split(/[+-]/)[0];
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split('.').map(Number);
}

/** positive when `a` is newer than `b`, negative when older, 0 when equal or unreadable */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const isNewer = (candidate: string, current: string) => compareVersions(candidate, current) > 0;

/** The release the phone could install, or null when it has no readable version or no APK. */
export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null;
  const raw = json as GithubRelease;
  if (raw.draft === true || raw.prerelease === true) return null;
  const tag = str(raw.tag_name);
  if (!parseVersion(tag)) return null;
  const assets = Array.isArray(raw.assets) ? (raw.assets as GithubAsset[]) : [];
  const apk = assets.find((asset) => str(asset.name).toLowerCase().endsWith('.apk') && str(asset.browser_download_url));
  if (!apk) return null;
  return {
    version: tag.replace(/^v/i, ''),
    tag,
    notes: str(raw.body).trim(),
    pageUrl: str(raw.html_url),
    apkUrl: str(apk.browser_download_url),
    apkName: str(apk.name),
    apkSize: typeof apk.size === 'number' && apk.size > 0 ? apk.size : 0,
    publishedAt: str(raw.published_at) || null,
  };
}

/** `48.2 MB`; empty when the size is unknown */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** 0..1, or null while the total is unknown */
export function progressFraction(written: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.min(1, Math.max(0, written / total));
}

/**
 * The release notes CI writes (scripts/changelog.mjs) are a heading, commit
 * subjects as bullets with a linked short hash, and a compare link. The prompt
 * keeps the first few subjects as plain `• ` lines.
 */
export function notesPreview(notes: string, maxLines = 6): string {
  const all = notes.split('\n').map((line) => line.trim());
  const bullets = all.filter((line) => /^[-*]\s+/.test(line));
  const lines = (bullets.length ? bullets : all.filter((line) => line && !/^#+\s/.test(line) && !/^\*\*Full changelog/i.test(line))).map((line) =>
    line
      .replace(/^[-*]\s+/, bullets.length ? '• ' : '')
      .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/gi, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
  );
  if (lines.length <= maxLines) return lines.join('\n');
  return [...lines.slice(0, maxLines), `…and ${lines.length - maxLines} more`].join('\n');
}
