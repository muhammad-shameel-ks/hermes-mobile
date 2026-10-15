/**
 * The row dots' inputs, held stable. A live chat's activity (running, waiting on you, background
 * work) changes a few times a turn, while the snapshot's `entries` object is replaced on every
 * streamed delta. The lists read activity through `stableActivities`, which hands back the previous
 * map while no chat's activity changed, so a memo keyed on it does not run on every delta.
 */

import type { ChatEntry, SessionInfo } from '../chat/controller.ts';
import { chatActivity, IDLE_ACTIVITY, resolveDotState, type Activity, type DotState } from './sessionStatus.ts';

export type Activities = Readonly<Record<string, Activity>>;

const sameActivity = (a: Activity, b: Activity) => a.running === b.running && a.needsInput === b.needsInput && a.background === b.background;

export const NO_ACTIVITIES: Activities = {};

export function stableActivities(prev: Activities, entries: Readonly<Record<string, ChatEntry | undefined>>): Activities {
  const next: Record<string, Activity> = {};
  let same = true;
  let count = 0;
  for (const key in entries) {
    const entry = entries[key];
    if (!entry) continue;
    const activity = chatActivity(entry);
    count += 1;
    const before = prev[key];
    if (before && sameActivity(before, activity)) next[key] = before;
    else {
      next[key] = activity;
      same = false;
    }
  }
  if (same && count === Object.keys(prev).length) return prev;
  return next;
}

/** the status a session row paints: the live chat's activity, else the backend's read watermark */
export function rowDotState(activities: Activities, openKey: string, finishedAway: Readonly<Record<string, true>>, session: Pick<SessionInfo, 'id' | 'unread'>): DotState {
  const open = openKey === session.id;
  return resolveDotState({
    activity: activities[session.id] ?? IDLE_ACTIVITY,
    // a session on screen is read; anything else is unread by the backend's watermark or a turn that ended while away
    unread: !open && (session.unread === true || finishedAway[session.id] === true),
  });
}
