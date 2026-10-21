/**
 * Entry points for the Kanban surface. Each pushes a full-screen route onto the overlay stack, so hardware
 * back leaves a task for its board and the board for the chat; call them with `useOverlay()`:
 *
 *   openKanban(overlay)        the selected board
 *
 * The board opens a task (`kanban:task:<board>:<id>`, and from a task its dependencies) and the new-task form.
 */

import type { OverlayApi } from '../app/overlay.tsx';
import { lazyScreen } from '../ui/lazy.tsx';

const KanbanScreen = lazyScreen(() => require('./KanbanScreen.tsx') as typeof import('./KanbanScreen.tsx'));
const TaskScreen = lazyScreen(() => require('./TaskScreen.tsx') as typeof import('./TaskScreen.tsx'));
const NewTaskScreen = lazyScreen(() => require('./NewTaskScreen.tsx') as typeof import('./NewTaskScreen.tsx'));

export type TaskTarget = {
  id: string;
  /** the board the task lives on ('' = the server's current board) */
  board: string;
  /** the board's lanes in order, for the status picker */
  columns: readonly string[];
};

export type NewTaskTarget = {
  board: string;
  /** the lane the task should land in */
  lane: string;
  /** the board's cards, offered as the parent */
  parents: ReadonlyArray<{ id: string; title: string }>;
};

export function openKanban(overlay: OverlayApi): void {
  overlay.push('kanban', (close) => (
    <KanbanScreen onClose={close} onOpenTask={(target) => openKanbanTask(overlay, target)} onNewTask={(target) => openNewTask(overlay, target)} />
  ));
}

export function openKanbanTask(overlay: OverlayApi, target: TaskTarget): void {
  overlay.push(`kanban:task:${target.board}:${target.id}`, (close) => (
    <TaskScreen
      taskId={target.id}
      board={target.board}
      columns={target.columns}
      onClose={close}
      onOpenTask={(id) => openKanbanTask(overlay, { ...target, id })}
    />
  ));
}

function openNewTask(overlay: OverlayApi, target: NewTaskTarget): void {
  overlay.push('kanban:new', (close) => <NewTaskScreen board={target.board} lane={target.lane} parents={target.parents} onClose={close} />);
}
