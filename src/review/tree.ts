/**
 * The Review surface's changed-file model: the REST shapes, the desktop's
 * always-excluded paths, and the file tree (desktop `review/tree-data.ts`):
 * directories aggregate their descendants' churn so a collapsed folder still
 * shows its total, and single-child chains compact into one `a/b/c` row.
 */

export type ReviewScope = 'uncommitted' | 'branch' | 'lastTurn';

export const REVIEW_SCOPES: ReadonlyArray<{ id: ReviewScope; label: string }> = [
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'branch', label: 'Branch' },
  { id: 'lastTurn', label: 'Last turn' },
];

export type ReviewFile = {
  path: string;
  added: number;
  removed: number;
  /** M(odified) A(dded) D(eleted) R(enamed) C(opied) U(nmerged) ?(untracked) */
  status: string;
  staged: boolean;
};

export type ReviewList = { files: ReviewFile[]; base: string | null };

const ALWAYS_EXCLUDED = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.tox', '.gradle', '.idea', 'dist', 'build', 'out', 'target', 'vendor', 'Pods', '.next',
  '.nuxt', '.svelte-kit', '.output', '.turbo', '.parcel-cache', '.cache', '.terraform', '.expo', '.angular', 'coverage',
  '.DS_Store', 'Thumbs.db',
]);

/** desktop `isExcludedPath`: any segment of a repo-relative path is dependency, build or OS noise. */
export const isExcludedPath = (relPath: string): boolean => relPath.split(/[/\\]/).some((segment) => ALWAYS_EXCLUDED.has(segment));

export type ReviewTreeNode = {
  id: string;
  name: string;
  isDir: boolean;
  added: number;
  removed: number;
  /** a flat-list file row's parent directory, shown dimmed */
  dir?: string;
  file?: ReviewFile;
  children?: ReviewTreeNode[];
};

export function buildReviewFlatList(files: readonly ReviewFile[]): ReviewTreeNode[] {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const segments = file.path.split('/').filter(Boolean);
      const name = segments.pop() ?? file.path;
      return { id: file.path, name, dir: segments.join('/'), isDir: false, added: file.added, removed: file.removed, file };
    });
}

type MutableDir = { id: string; name: string; added: number; removed: number; dirs: Map<string, MutableDir>; files: ReviewTreeNode[] };

const makeDir = (id: string, name: string): MutableDir => ({ id, name, added: 0, removed: 0, dirs: new Map(), files: [] });

export function buildReviewTree(files: readonly ReviewFile[], compact = true): ReviewTreeNode[] {
  const root = makeDir('', '');
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    const fileName = segments.pop() ?? file.path;
    let dir = root;
    dir.added += file.added;
    dir.removed += file.removed;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let child = dir.dirs.get(segment);
      if (!child) {
        child = makeDir(prefix, segment);
        dir.dirs.set(segment, child);
      }
      child.added += file.added;
      child.removed += file.removed;
      dir = child;
    }
    dir.files.push({ id: file.path, name: fileName, isDir: false, added: file.added, removed: file.removed, file });
  }

  const finalize = (dir: MutableDir): ReviewTreeNode[] => {
    const dirNodes = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        let node: ReviewTreeNode = { id: child.id, name: child.name, isDir: true, added: child.added, removed: child.removed, children: finalize(child) };
        while (compact && node.children?.length === 1 && node.children[0].isDir) {
          const only: ReviewTreeNode = node.children[0];
          node = { ...only, name: `${node.name}/${only.name}` };
        }
        return node;
      });
    const fileNodes = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...dirNodes, ...fileNodes];
  };
  return finalize(root);
}

export type ReviewRow = { node: ReviewTreeNode; depth: number };

/** The rows currently visible: a directory contributes its children only while `isOpen(id)`. */
export function flattenReviewRows(nodes: readonly ReviewTreeNode[], isOpen: (id: string) => boolean, depth = 0, rows: ReviewRow[] = []): ReviewRow[] {
  for (const node of nodes) {
    rows.push({ depth, node });
    if (node.isDir && node.children && isOpen(node.id)) flattenReviewRows(node.children, isOpen, depth + 1, rows);
  }
  return rows;
}

/** The changed file matching a tool-reported path (absolute or repo-relative), matched on the tail. */
export function matchReviewFile(files: readonly ReviewFile[], path: string): ReviewFile | undefined {
  const target = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!target) return undefined;
  return files.find((file) => {
    const candidate = file.path.replace(/\\/g, '/');
    return candidate === target || target.endsWith(`/${candidate}`) || candidate.endsWith(`/${target}`);
  });
}

/** Per git status letter: the diff codicon and which palette colour tints it. */
export const STATUS_GLYPH: Record<string, { icon: 'diff-added' | 'diff-modified' | 'diff-removed' | 'diff-renamed' | 'warning'; tone: 'green' | 'yellow' | 'red' | 'blue' | 'muted' }> = {
  A: { icon: 'diff-added', tone: 'green' },
  C: { icon: 'diff-added', tone: 'green' },
  D: { icon: 'diff-removed', tone: 'red' },
  M: { icon: 'diff-modified', tone: 'yellow' },
  R: { icon: 'diff-renamed', tone: 'blue' },
  U: { icon: 'warning', tone: 'red' },
  '?': { icon: 'diff-added', tone: 'muted' },
};

/**
 * Last-turn baselines: HEAD per repo cwd, captured when a turn starts in it.
 * Capped like the desktop's `$reviewTurnBase`, least recently captured out first.
 */
const MAX_TURN_BASES = 8;
let turnBases: Array<[string, string]> = [];

export function recordTurnBase(cwd: string, sha: string): void {
  const key = cwd.trim();
  if (!key || !sha) return;
  const rest = turnBases.filter(([existing]) => existing !== key);
  while (rest.length >= MAX_TURN_BASES) rest.shift();
  rest.push([key, sha]);
  turnBases = rest;
}

export const turnBaseFor = (cwd: string): string | null => turnBases.find(([key]) => key === cwd.trim())?.[1] ?? null;

export function resetTurnBases(): void {
  turnBases = [];
}
