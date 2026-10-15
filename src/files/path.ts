/**
 * Path and size handling for the Files surface and the preview viewer. Ported
 * from the dashboard's FilesPage (`joinPath`, `formatBytes`) and the desktop's
 * `lib/display-path.ts`; free of native imports so it runs under plain node.
 */

export function joinPath(base: string, name: string): string {
  const cleanName = name.trim().replace(/^[\\/]+/, '');
  if (!cleanName) return base;
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  if (!base || base.endsWith('/') || base.endsWith('\\')) return `${base}${cleanName}`;
  return `${base}${separator}${cleanName}`;
}

export function normalizePath(raw: string): string {
  let path = (raw || '').trim().replace(/\\/g, '/');
  if (!path) return '';
  path = path.startsWith('//') ? `//${path.slice(2).replace(/\/{2,}/g, '/')}` : path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/') && !/^[A-Za-z]:\/$/.test(path)) path = path.replace(/\/+$/, '');
  return path;
}

export function baseName(raw: string): string {
  const path = normalizePath(raw);
  if (!path || path === '/') return path;
  return path.split('/').filter(Boolean).pop() || path;
}

export function parentPath(raw: string): string | null {
  const path = normalizePath(raw);
  const cut = path.lastIndexOf('/');
  if (cut < 0 || path === '/') return null;
  return cut === 0 ? '/' : path.slice(0, cut);
}

/** `path` is `root` or sits somewhere below it. */
export function isUnder(root: string, path: string): boolean {
  const a = normalizePath(root);
  const b = normalizePath(path);
  if (!a || !b) return false;
  if (a === '/') return b.startsWith('/');
  return b === a || b.startsWith(`${a}/`);
}

/** The path below `root`, or `.` for the root itself. */
export function relativeTo(root: string, path: string): string {
  const a = normalizePath(root);
  const b = normalizePath(path);
  if (b === a) return '.';
  return isUnder(a, b) ? b.slice(a === '/' ? 1 : a.length + 1) : b;
}

function inferredHome(path: string): string {
  const match = path.match(/^(\/Users\/[^/]+)(?:\/|$)/) ?? path.match(/^(\/home\/[^/]+)(?:\/|$)/) ?? path.match(/^([A-Za-z]:\/Users\/[^/]+)(?:\/|$)/);
  return match ? match[1] : '';
}

/** desktop `displayPath`: collapse a home directory to `~`; paint only, never sent back to the server. */
export function displayPath(raw: string | null | undefined, home?: string | null): string {
  const path = normalizePath(raw || '');
  if (!path) return '';
  if (path === '~' || path.startsWith('~/')) return path;
  const prefix = home ? normalizePath(home).replace(/\/+$/, '') : inferredHome(path);
  if (!prefix) return path;
  if (path === prefix) return '~';
  return path.startsWith(`${prefix}/`) ? `~${path.slice(prefix.length)}` : path;
}

/** The desktop's "Enter a single folder name, without slashes." check; null when the name is fine. */
export function folderNameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Folder name required';
  if (/[\\/]/.test(name) || name === '.' || name === '..') return 'Enter a single folder name, without slashes.';
  return null;
}

export function formatBytes(size: number | null | undefined): string {
  if (size === null || size === undefined) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** desktop preview `formatBytes`: whole numbers from 10 up, one decimal below. */
export function formatPreviewBytes(bytes: number | undefined): string {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** `mtime` is epoch seconds, as the files endpoint reports it. */
export function formatModified(mtime: number | null | undefined): string {
  if (mtime === null || mtime === undefined || !Number.isFinite(mtime)) return '-';
  const date = new Date(mtime * 1000);
  try {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * A transcript link as an absolute server path: `file://` URLs unwrapped, a
 * relative path joined onto the session's working directory when one is known.
 * The server resolves what is left (`~`, `..`), so nothing is canonicalised here.
 */
export function linkedPath(raw: string, cwd?: string | null): string {
  let path = raw.trim();
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch {
      return path;
    }
  }
  if (/^(?:\/|~(?:\/|$)|[a-z]:[\\/])/i.test(path) || !cwd) return path;
  return `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`;
}
