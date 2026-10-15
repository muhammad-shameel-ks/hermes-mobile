/**
 * The sessions list's time maths, as the desktop's sidebar does it: the compact
 * row age, the calendar buckets under the date dividers, and the unlabelled
 * "recent head" run (apps/desktop/src/lib/time.ts `calendarBucket`,
 * `sessionBucketLabel`, `coarseElapsed`; lib/session-date-groups.ts
 * `groupEntriesByRecency`, `hideCollapsedGroupRows`).
 */

import { compactAge } from '../bots/roster.ts';
import type { SessionEntry } from './sessionTree.ts';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** the human day ends when you sleep: the day boundary sits at 4 AM local (desktop `DAY_ROLLOVER_HOUR`) */
export const DAY_ROLLOVER_HOUR = 4;

export type SessionBucketKind = 'lastWeek' | 'month' | 'monthYear' | 'thisMonth' | 'thisWeek' | 'today' | 'yesterday';
export type SessionBucket = { at: number; key: string; kind: SessionBucketKind };

/** desktop `sidebar.dateDivider` */
export const DATE_DIVIDER_LABELS = {
  today: 'Earlier today',
  yesterday: 'Yesterday',
  thisWeek: 'Earlier this week',
  lastWeek: 'Last week',
  thisMonth: 'Earlier this month',
} as const;

/** desktop `sidebar.statusDivider` */
export const STATUS_DIVIDER_LABELS = { working: 'Working', done: 'Done' } as const;

const startOfLocalDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export const nominalDayStart = (ms: number) => startOfLocalDay(ms - DAY_ROLLOVER_HOUR * HOUR);

/** JS `getDay()` convention (0 = Sunday); the locale's first day when the engine reports one, else Monday */
export function localeWeekStartDay(): number {
  try {
    const locale = new Intl.Locale(new Intl.DateTimeFormat().resolvedOptions().locale) as unknown as {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return typeof firstDay === 'number' ? firstDay % 7 : 1;
  } catch {
    return 1;
  }
}

function startOfLocalWeek(ms: number, weekStartsOn: number) {
  const d = new Date(startOfLocalDay(ms));
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

/** a coarse calendar range for a Unix-seconds timestamp; granularity coarsens with age */
export function calendarBucket(seconds: number, nowMs = Date.now(), weekStartsOn = localeWeekStartDay()): SessionBucket {
  const nominal = nominalDayStart(seconds * SECOND);
  const todayNominal = nominalDayStart(nowMs);
  const dayDiff = Math.round((todayNominal - nominal) / DAY);
  if (dayDiff <= 0) return { at: nominal, key: 'today', kind: 'today' };
  if (dayDiff === 1) return { at: nominal, key: 'yesterday', kind: 'yesterday' };

  const weekStart = startOfLocalWeek(todayNominal, weekStartsOn);
  if (nominal >= weekStart) return { at: nominal, key: 'this-week', kind: 'thisWeek' };
  const ws = new Date(weekStart);
  if (nominal >= new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() - 7).getTime()) return { at: nominal, key: 'last-week', kind: 'lastWeek' };

  const d = new Date(nominal);
  const now = new Date(todayNominal);
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear && d.getMonth() === now.getMonth()) return { at: nominal, key: 'this-month', kind: 'thisMonth' };
  const ym = `${d.getFullYear()}-${d.getMonth()}`;
  return sameYear ? { at: nominal, key: `m-${ym}`, kind: 'month' } : { at: nominal, key: `my-${ym}`, kind: 'monthYear' };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(at: number, withYear: boolean) {
  try {
    return new Intl.DateTimeFormat(undefined, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' }).format(at);
  } catch {
    const d = new Date(at);
    return withYear ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()]!;
  }
}

/** the divider's text: the fixed relative strings, Intl month and month-year for the rest */
export function sessionBucketLabel(bucket: SessionBucket): string {
  if (bucket.kind === 'month') return monthName(bucket.at, false);
  if (bucket.kind === 'monthYear') return monthName(bucket.at, true);
  return DATE_DIVIDER_LABELS[bucket.kind];
}

/** a session's own clock, which the row's age and its divider both read */
export const sessionTime = (session: { last_active?: number | null; started_at: number }) => session.last_active || session.started_at || 0;

/** desktop `formatAge`: "now" under a minute, then 5m, 3h, 2d; the sidebar never ticks seconds */
export const sessionAge = (seconds: number, nowSeconds: number) => compactAge(seconds, nowSeconds) || 'now';

// ─── the date-grouped list ───────────────────────────────────────────────────

export type ListRow =
  | { kind: 'session'; entry: SessionEntry }
  | { kind: 'divider'; key: string; label: string };

const recencyMs = (entry: SessionEntry) => sessionTime(entry.session) * SECOND;

// Aim the head at "the most recent handful". A break shorter than MIN_RUN_BREAK_MS never counts as one,
// and a silence longer than MAX_RUN_GAP_MS always ends the run.
const TARGET_HEAD_SESSIONS = 5;
const MIN_RUN_BREAK_MS = 30 * MINUTE;
const MAX_RUN_GAP_MS = 8 * HOUR;

/**
 * The unlabelled head is the newest run of sessions, cut at a real break in activity (desktop
 * `headRunCutoffMs`). Returns the oldest timestamp (ms) still inside the head; -Infinity means the
 * whole list is one run, +Infinity means no head.
 */
function headRunCutoffMs(entries: readonly SessionEntry[], nowMs: number, weekStartsOn: number): number {
  const times = entries
    .filter((entry) => !entry.branchStem)
    .map(recencyMs)
    .sort((a, b) => b - a);

  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let runEnded = false;

  for (let i = 1; i < times.length; i++) {
    const gap = times[i - 1]! - times[i]!;
    const endsRun = gap > MAX_RUN_GAP_MS;
    if (gap >= MIN_RUN_BREAK_MS || endsRun) {
      const score = Math.abs(Math.log(i / TARGET_HEAD_SESSIONS));
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
        runEnded = endsRun;
      }
    }
    if (endsRun) break;
  }

  if (bestIdx === -1) return Number.NEGATIVE_INFINITY;

  // the cut at the run's end, with the sessions below sharing the head's bucket: the head adds nothing, dissolve it
  if (runEnded && calendarBucket(times[0]! / SECOND, nowMs, weekStartsOn).key === calendarBucket(times[bestIdx]! / SECOND, nowMs, weekStartsOn).key) {
    return Number.POSITIVE_INFINITY;
  }
  return times[bestIdx - 1]!;
}

/**
 * A date divider before each labelled group (desktop `groupEntriesByRecency`): the newest run stays
 * unlabelled, below it one divider per coarse calendar range, never one per day. A branch child rides
 * its parent's group; the very first rendered row is never labelled.
 */
export function groupEntriesByRecency(
  entries: readonly SessionEntry[],
  nowMs = Date.now(),
  weekStartsOn = localeWeekStartDay(),
  maxGroups = Number.POSITIVE_INFINITY,
): ListRow[] {
  const rows: ListRow[] = [];
  const emitted = new Set<string>();
  const cutoff = headRunCutoffMs(entries, nowMs, weekStartsOn);
  let lastKey: string | null = null;
  let groups = 1;

  for (const entry of entries) {
    if (entry.branchStem) {
      rows.push({ kind: 'session', entry });
      continue;
    }
    const ms = recencyMs(entry);
    if (ms >= cutoff) {
      rows.push({ kind: 'session', entry });
      lastKey = '__recent__';
      continue;
    }
    const bucket = calendarBucket(ms / SECOND, nowMs, weekStartsOn);
    if (bucket.key !== lastKey) {
      lastKey = bucket.key;
      const alreadyEmitted = emitted.has(bucket.key);
      emitted.add(bucket.key);
      if (rows.length > 0 && !alreadyEmitted) {
        if (groups >= maxGroups) break;
        groups++;
        rows.push({ kind: 'divider', key: bucket.key, label: sessionBucketLabel(bucket) });
      }
    }
    rows.push({ kind: 'session', entry });
  }
  return rows;
}

/** wrap entries as plain session rows, so the ungrouped path shares the grouped one's shape */
export const toSessionRows = (entries: readonly SessionEntry[]): ListRow[] => entries.map((entry) => ({ kind: 'session', entry }));

/** drop the session rows under a closed divider; the divider stays so it can be opened again */
export function hideCollapsedGroupRows(rows: readonly ListRow[], isOpen: (key: string) => boolean): ListRow[] {
  const out: ListRow[] = [];
  let hiding = false;
  for (const row of rows) {
    if (row.kind === 'divider') {
      hiding = !isOpen(row.key);
      out.push(row);
      continue;
    }
    if (!hiding) out.push(row);
  }
  return out.length === rows.length ? (rows as ListRow[]) : out;
}
