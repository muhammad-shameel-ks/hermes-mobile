/**
 * The REST surfaces behind Files, the preview viewer and Review, over the
 * authenticated client. `/api/files` is the dashboard files root (browse, mkdir);
 * `/api/fs/read-text` and `/api/fs/git-root` read one linked file, never a tree;
 * `/api/git/*` is the read-only half of the desktop's review routes. Nothing here
 * writes through `/api/fs`, deletes, or mutates git.
 */

import { ApiError, ApiUnreachableError, buildQuery, type GatewayApi } from '../gateway/api.ts';
import type { ReviewList, ReviewScope } from '../review/tree.ts';

export type ManagedFileEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  broken_link?: boolean;
  size: number | null;
  mtime: number | null;
  mime_type: string | null;
};

export type ManagedFilesResponse = {
  root: string | null;
  path: string;
  parent: string | null;
  locked_root: string | null;
  can_change_path: boolean;
  entries: ManagedFileEntry[];
};

export type ManagedFileWriteResponse = { ok: boolean; path: string; entry: ManagedFileEntry };

export type FsTextRead = {
  binary: boolean;
  byteSize: number;
  language: string;
  mimeType: string;
  path: string;
  text: string;
  truncated: boolean;
};

export type RepoStatus = { branch: string | null; detached: boolean; ahead: number; behind: number; changed: number } | null;

export type FilesRest = ReturnType<typeof createFilesRest>;

export function createFilesRest(api: GatewayApi, profile: () => string) {
  return {
    list: (path?: string) => api.get<ManagedFilesResponse>('/api/files', { path }),
    mkdir: (path: string) => api.post<ManagedFileWriteResponse>('/api/files/mkdir', { path }),
    readText: (path: string) => api.get<FsTextRead>('/api/fs/read-text', { path, profile: profile() }),
    gitRoot: async (path: string) => (await api.get<{ root: string | null }>('/api/fs/git-root', { path, profile: profile() })).root,
    defaultCwd: () => api.get<{ cwd: string; branch: string }>('/api/fs/default-cwd', { profile: profile() }),
    fileDiff: async (root: string, file: string) => (await api.get<{ diff: string }>('/api/git/file-diff', { path: root, file })).diff || '',
  };
}

export function createReviewRest(api: GatewayApi) {
  return {
    status: (path: string) => api.get<RepoStatus>('/api/git/status', { path }),
    list: (path: string, scope: ReviewScope, base?: string | null) =>
      api.get<ReviewList>('/api/git/review/list', { path, scope, base: scope === 'lastTurn' ? base : undefined }),
    diff: async (path: string, file: string, scope: ReviewScope, base: string | null | undefined, staged: boolean) =>
      (await api.get<{ diff: string }>('/api/git/review/diff', { path, file, scope, base: scope === 'lastTurn' ? base : undefined, staged })).diff || '',
    revParse: async (path: string, ref = 'HEAD') => (await api.get<{ sha: string | null }>('/api/git/review/rev-parse', { path, ref })).sha,
  };
}

export type ReviewRest = ReturnType<typeof createReviewRest>;

/** The server's `detail` when it sent one, else the error's own text. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const detail = (JSON.parse(error.body) as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail) return detail;
    } catch {
      // not JSON: fall through to the generic text
    }
    return error.message;
  }
  if (error instanceof ApiUnreachableError) return `The gateway could not be reached (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

export type DownloadSpec = { origin: 'files' | 'link'; path: string; profile?: string; sessionId?: string };

/** The authenticated GET that streams one file. */
export function downloadUrl(baseUrl: string, spec: DownloadSpec): string {
  return spec.origin === 'files'
    ? `${baseUrl}/api/files/download${buildQuery({ path: spec.path })}`
    : `${baseUrl}/api/fs/download${buildQuery({ path: spec.path, profile: spec.profile, session_id: spec.sessionId })}`;
}
