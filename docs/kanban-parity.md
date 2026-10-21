# Kanban parity

How the phone's Kanban surface (`src/kanban/`) follows the desktop's Kanban plugin
(`apps/desktop/src/plugins/kanban/`). Both talk to the same backend: the plugin's REST router at
`/api/plugins/kanban/*` (`plugins/kanban/dashboard/plugin_api.py`), reached with the phone's bearer and the active
profile as `?profile=`. No new backend.

## The phone's layout

The desktop lays nine lanes side by side and drags cards between them. A phone fits one lane:

- **One lane per page.** The board is a horizontal pager; swipe between lanes. Opening the board lands on the first
  lane with cards, and the reader's lane is kept across polls.
- **Lane strip.** A pipeline ribbon (each lane's share of the board, in its tone) over a row of chips (dot, label,
  count). Tapping a chip turns to that lane. An empty lane's chip is dimmed, the phone's version of the desktop
  folding an empty column to a rail (nothing dims on a board with no work, as on the desktop).
- **Drop dock.** Holding a card for 320 ms lifts it and lays a grid of every lane over the top of the board. Drag
  onto a lane and let go to move the card there. The dispatcher's lanes (Running, Review, Scheduled) are in the
  grid but closed, with the reason shown, like the desktop's no-drop cursor. Letting go without moving opens the
  card's actions (Open, Select, Move to…, Delete), the desktop's right-click menu.
- **Selection.** "Select" in a card's actions starts a selection. While one is open, taps toggle cards, holding no
  longer lifts them, and the bulk bar (move, assign, archive, delete) sits along the bottom. This replaces the
  desktop's ⌘-click.

## Ported

| Phone | Desktop source |
|---|---|
| Lane order, labels, help text and tones; the locked lanes and their reasons | `types.ts` `COLUMN_META`, `i18n.ts` `en`, `ui.tsx` `LOCKED_COLUMNS` |
| Card: tone edge, title, summary or body, footer (attached agent, run clock, no heartbeat, block kind, won't run, priority, progress, comments, links, warnings, age, short id) | `board.tsx` `Card`, `CardFooter` |
| Travelling border while a worker is on the card; a slow amber crawl once its heartbeat has been gone 2 minutes | `kanban.css` `.kanban-arc`, `ui.tsx` `arcState` |
| Optimistic move and delete, rolled back with the server's reason | `board.tsx` `moveCard`, `removeCard`, `moveMut`, `deleteMut` |
| Search over title, body and id; profile and tenant filters; show archived; Running grouped by profile | `board.tsx` `FilterMenu`, page `filtered` |
| Bulk move, assign (reclaims first), archive and delete, with failed cards left selected | `board.tsx` `SelectionBar` |
| Board switcher with card counts, the server's current board as the bare selection, New board (name → slug) | `board-switcher.tsx` |
| Selected board, intro dismissal and "Group Running" remembered (the board per gateway) | `api.ts` `$boardSlug`, `$introDismissed`, `$lanesByProfile` |
| The intro ("You don't run the cards — agents do…") | `board.tsx` `Intro` |
| New task: title, description, assignee (default, profile, parked), priority, workspace kind and path override, skills, parent, goal mode, estimate; lands in the requested lane; the dispatcher-presence warning | `board.tsx` `NewTaskDialog` |
| Task screen: status picker, actions (copy id, copy title, archive, delete), ready-but-unassigned callout, diagnostics and their actions, description (editable), result, latest summary, properties, dependencies, estimate, attachments, comments / activity / runs / worker log, comment composer with "Requeue with note" | `drawer.tsx` `TaskDrawer` |
| Every write nudges the dispatcher, debounced | `api.ts` `nudged` |

## Parity deviations

- **No events socket.** The board polls every 8 s, a task every 5 s and its worker log every 3 s while running (15 s
  otherwise), and only while the screen is open and the app is in the foreground. Writes refresh at once.
- **No completion notifications.** The desktop raises a system notification when a task finishes or blocks; the
  phone shows the change the next time the board is open.
- **The model override is read-only** on the task screen and absent from the new-task form: the phone has no
  per-task model catalog picker yet.
- **Attachments** download into the cache and open the share sheet rather than a save dialog.
- **Hover tips become text.** Lane help is a line at the top of each lane; the card footer's tips (who is attached,
  why a card won't run) are not shown on the card, and the task screen's callouts carry the important ones.
- **Touch sizing.** Chips, rows and buttons are at least 32-44 dp; cards keep the desktop's density.
- **The drawer row is always there.** The desktop adds its nav row only when the plugin is on. The phone always
  shows "Kanban", and a gateway with the plugin off answers with an explanation instead of a board.

## Left out by decision

- Orchestration settings (orchestrator profile, default assignee, auto-decompose, profile descriptions): they
  configure the gateway, not the board.
- Board rename, settings (project scope, default workdir), delete, export and import: the last two exchange
  file paths on the host machine.
- The statusbar count, the ⌘K row and the ⌘⌥N keybind: there is no statusbar, palette or keyboard on a phone.
