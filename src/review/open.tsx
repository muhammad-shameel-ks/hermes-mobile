/**
 * Entry point for the Review surface: the changed-files card's "Review changes"
 * and its per-file rows, and tool-card diffs. There is no session-level door.
 *
 *   openReview(overlay, { cwd })                      the working tree's changes
 *   openReview(overlay, { cwd, path: '/abs/or/rel' }) the same, landing on that file's diff
 */

import type { OverlayApi } from '../app/overlay.tsx';
import { openPreview } from '../files/open.tsx';
import ReviewDiffScreen from './ReviewDiffScreen.tsx';
import ReviewScreen, { type ReviewTarget } from './ReviewScreen.tsx';
import type { ReviewFile, ReviewScope } from './tree.ts';

export type OpenReviewOptions = {
  /** the repository's working directory; the gateway's default when omitted */
  cwd?: string;
  scope?: ReviewScope;
  /** the last-turn baseline commit; the one `noteTurnStart` recorded for `cwd` when omitted */
  base?: string | null;
  /** a changed file to open on, absolute or repo-relative */
  path?: string;
};

function pushDiff(overlay: OverlayApi, file: ReviewFile, target: ReviewTarget) {
  const openFile = (absolutePath: string, cwd: string) => openPreview(overlay, { kind: 'file', origin: 'link', path: absolutePath, cwd });
  overlay.push(`review-diff:${target.cwd}:${target.scope}:${file.path}`, (close) => (
    <ReviewDiffScreen file={file} target={target} onClose={close} onOpenFile={openFile} />
  ));
}

export function openReview(overlay: OverlayApi, options: OpenReviewOptions = {}): void {
  const openFile = (absolutePath: string, cwd: string) => openPreview(overlay, { kind: 'file', origin: 'link', path: absolutePath, cwd });
  overlay.push('review', (close) => (
    <ReviewScreen
      cwd={options.cwd}
      scope={options.scope}
      base={options.base}
      focusPath={options.path}
      onClose={close}
      onOpenDiff={(file, target) => pushDiff(overlay, file, target)}
      onOpenFile={openFile}
    />
  ));
}
