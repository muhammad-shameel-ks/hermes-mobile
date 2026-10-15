/**
 * Branch nesting for the sessions list: a /branch fork sits under its parent with a TUI-style stem,
 * and a compression chain collapses to one row (apps/desktop/src/lib/session-branch-tree.ts).
 */

import type { SessionInfo } from '../chat/controller.ts';

export type SessionEntry = { session: SessionInfo; branchStem?: string };

const recency = (session: SessionInfo) => session.last_active || session.started_at || 0;

/**
 * The parent to nest under, or undefined for a top-level sibling. `/new` and idle rotation keep
 * `parent_session_id` for lineage but stamp `_reset_from`: those are new conversations, not forks.
 */
export function forkParentId(session: SessionInfo): string | undefined {
  if (session._reset_from?.trim()) return undefined;
  const branchedFrom = session._branched_from?.trim();
  if (branchedFrom) return branchedFrom;
  return session.parent_session_id?.trim() || undefined;
}

const lineageKey = (session: SessionInfo) => `${(session.profile ?? '').trim() || 'default'}::${session._lineage_root_id?.trim() || session.id}`;

/** one row per compression lineage: the row nothing in its lineage continues from, then the freshest */
function collapseCompressionLineages(sessions: readonly SessionInfo[]): readonly SessionInfo[] {
  const groups = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const key = lineageKey(session);
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }
  if (groups.size === sessions.length) return sessions;

  const winners = new Set<SessionInfo>();
  for (const group of groups.values()) {
    const continuedIds = new Set(group.map((session) => session.parent_session_id?.trim()));
    const score = (session: SessionInfo) => (continuedIds.has(session.id) ? -Infinity : Math.max(session.last_active || 0, session.started_at || 0));
    winners.add(group.reduce((best, session) => (score(session) > score(best) ? session : best)));
  }
  return sessions.filter((session) => winners.has(session));
}

/**
 * The flat list with branch sessions nested under their parent. A group sorts by its freshest
 * member, so activity on a branch lifts the whole cluster; `preserveOrder` keeps the caller's roots.
 */
export function flattenSessionsWithBranches(input: readonly SessionInfo[], options: { preserveOrder?: boolean } = {}): SessionEntry[] {
  const sessions = collapseCompressionLineages(input);
  if (sessions.length < 2) return sessions.map((session) => ({ session }));

  const byVisibleId = new Map<string, SessionInfo>();
  for (const session of sessions) {
    byVisibleId.set(session.id, session);
    const rootId = session._lineage_root_id?.trim();
    if (rootId) byVisibleId.set(rootId, session);
  }
  const survivorByLineage = new Map(sessions.map((session) => [lineageKey(session), session]));
  for (const session of input) {
    const survivor = survivorByLineage.get(lineageKey(session));
    if (survivor && !byVisibleId.has(session.id)) byVisibleId.set(session.id, survivor);
  }

  const childrenByParent = new Map<string, SessionInfo[]>();
  const nestedIds = new Set<string>();
  for (const session of sessions) {
    const parentId = forkParentId(session);
    if (!parentId) continue;
    const parent = byVisibleId.get(parentId);
    // compression ancestry is not a branch: never nest a row under its own lineage
    if (!parent || lineageKey(parent) === lineageKey(session)) continue;
    nestedIds.add(session.id);
    const siblings = childrenByParent.get(parent.id) ?? [];
    siblings.push(session);
    childrenByParent.set(parent.id, siblings);
  }
  for (const siblings of childrenByParent.values()) siblings.sort((left, right) => recency(right) - recency(left));

  const groupRecencyMemo = new Map<string, number>();
  const groupRecency = (session: SessionInfo): number => {
    const cached = groupRecencyMemo.get(session.id);
    if (cached !== undefined) return cached;
    groupRecencyMemo.set(session.id, recency(session)); // cycle guard
    const max = (childrenByParent.get(session.id) ?? []).reduce((acc, child) => Math.max(acc, groupRecency(child)), recency(session));
    groupRecencyMemo.set(session.id, max);
    return max;
  };

  // depth-first so a branch of a branch renders under its own parent; the sweep after emits anything the walk missed
  const out: SessionEntry[] = [];
  const seen = new Set<string>();
  const emit = (session: SessionInfo, branchStem?: string) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    out.push(branchStem ? { branchStem, session } : { session });
    const children = childrenByParent.get(session.id);
    children?.forEach((child, index) => emit(child, index === children.length - 1 ? '└─ ' : '├─ '));
  };

  const roots = sessions.filter((session) => !nestedIds.has(session.id)).map((session, index) => ({ index, session }));
  if (!options.preserveOrder) roots.sort((a, b) => groupRecency(b.session) - groupRecency(a.session) || a.index - b.index);
  roots.forEach(({ session }) => emit(session));
  for (const session of sessions) if (!seen.has(session.id)) out.push({ session });
  return out;
}
