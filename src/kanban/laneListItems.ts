/**
 * One lane page's flat cell model: its cards, and with "Group Running by profile" on, an assignee heading
 * before each worker's run (the desktop column's `lanes`, sorted by name, unassigned under its own heading).
 * Pure, so the list renders from a stable array a poll only replaces when the lane changed.
 */

import type { KanbanTask } from './types.ts';

export const UNASSIGNED_GROUP = 'unassigned';

export type LaneItem =
  | { kind: 'group'; key: string; assignee: string; count: number }
  | { kind: 'card'; key: string; task: KanbanTask };

export function buildLaneItems(lane: string, tasks: readonly KanbanTask[], groupRunning: boolean): LaneItem[] {
  if (!groupRunning || lane !== 'running' || tasks.length === 0) return tasks.map((task) => ({ kind: 'card', key: task.id, task }));
  const groups = new Map<string, KanbanTask[]>();
  for (const task of tasks) {
    const key = task.assignee || UNASSIGNED_GROUP;
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }
  const items: LaneItem[] = [];
  for (const [assignee, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    items.push({ kind: 'group', key: `group:${assignee}`, assignee, count: group.length });
    for (const task of group) items.push({ kind: 'card', key: task.id, task });
  }
  return items;
}
