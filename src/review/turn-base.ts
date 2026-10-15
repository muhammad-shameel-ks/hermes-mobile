/**
 * The last-turn scope diffs against HEAD as it stood when the turn began. The
 * desktop captures that when a session flips to busy; call `noteTurnStart(cwd)`
 * at the same edge (best effort, a failure just leaves the scope without a base).
 */

import { gateway } from '../files/gateway.ts';
import { createReviewRest } from '../files/rest.ts';
import { recordTurnBase } from './tree.ts';

export async function noteTurnStart(cwd: string): Promise<void> {
  const dir = cwd.trim();
  if (!dir) return;
  try {
    const sha = await createReviewRest(gateway().api).revParse(dir, 'HEAD');
    if (sha) recordTurnBase(dir, sha);
  } catch {
    // not a repo, or the gateway is away: last turn stays empty for this cwd
  }
}
