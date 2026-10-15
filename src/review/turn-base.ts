/**
 * The last-turn scope diffs against HEAD as it stood when the turn began. The
 * desktop captures that when a session flips to busy; the chat controller calls
 * `noteTurnStart(cwd)` at the same edge (best effort, a failure just leaves the
 * scope without a base).
 */

import { gateway } from '../files/gateway.ts';
import { createReviewRest } from '../files/rest.ts';
import type { GatewayApi } from '../gateway/api.ts';
import { recordTurnBase } from './tree.ts';

export async function noteTurnStart(cwd: string, api?: GatewayApi): Promise<void> {
  const dir = cwd.trim();
  if (!dir) return;
  try {
    const sha = await createReviewRest(api ?? gateway().api).revParse(dir, 'HEAD');
    if (sha) recordTurnBase(dir, sha);
  } catch {
    // not a repo, or the gateway is away: last turn stays empty for this cwd
  }
}

type Turning = { transcript: { running: boolean }; cwd: string | null };

/** the working directories of the sessions that went from idle to running between two snapshots (desktop: `$sessionStates` busy edges) */
export function startedTurnCwds(before: Record<string, Turning>, after: Record<string, Turning>): string[] {
  if (before === after) return [];
  const cwds: string[] = [];
  for (const [key, entry] of Object.entries(after)) {
    if (entry.transcript.running && entry.cwd && !before[key]?.transcript.running) cwds.push(entry.cwd);
  }
  return cwds;
}
