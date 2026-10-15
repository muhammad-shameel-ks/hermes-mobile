# Drawer parity

How the phone's drawer follows the desktop's sidebar (`apps/desktop/src/app/chat/sidebar/`), within the
decisions in issues #12 (shell), #15 and #16 (what is deferred or dropped) and #17 (Bot roster).

## Ported

| Phone | Desktop source |
|---|---|
| Panel surface, edge line (`--sidebar-edge-border`), 10 dp content inset | `index.tsx`, `styles.css` |
| SESSIONS \| BOTS tab strip: sidebar surface, 2 px underline in the skin's primary, 11 px medium uppercase label | `components/ui/pane-tab.tsx` |
| Row geometry: lead cell 14, gap 6, pad 8, label 13 / 1.35, age 10, `gap-px` stack (`rowGeometry.ts`) | `row-geometry.ts` |
| Nav rows (robot, symbol-misc glyphs at 72%, 13 px medium) | `index.tsx` `SidebarMenuButton` |
| Borderless search field resting at 30% (roster: 50%), glyph, busy spinner, clear | `components/ui/search-field.tsx` |
| Section header: 8 dp dither square, 10.24 px semibold uppercase at 0.16em in the skin's primary, caret | `app/shell/sidebar-label.tsx`, `sessions-section.tsx` |
| Date dividers (Earlier today, Yesterday, Earlier this week, Last week, Earlier this month, month, month + year), the 4 AM day, the unlabelled recent head run, collapsible | `lib/time.ts`, `lib/session-date-groups.ts`, `chrome.tsx` |
| Branch nesting with `├─` / `└─` stems, one row per compression chain | `lib/session-branch-tree.ts` |
| Status dot: needs-input (amber), working (accent), background (hollow), unread (success), draft (hollow, quieter), idle (4 px) | `session-status-dot.tsx`, `store/session-dot-state.ts` |
| Running row: travelling arc on the border, brighter title | `styles.css` `.arc-border.arc-row`, `session-row.tsx` |
| Pinned section with the empty hint; Sessions; "everything is pinned" / "No sessions yet" | `sessions-section.tsx`, `section-states.tsx` |
| Loading skeletons (`animate-pulse`), load-error state with retry, damaged-store notice | `section-states.tsx` |
| Paging: the batched `/api/profiles/sessions/sidebar` route, window raised by 50 per "Load more", plain `/api/sessions` fallback | `api/sessions.ts`, `use-session-list-actions.ts` |
| Messaging platform sections (collapsed by default, 3 rows, +10 per tap) | `index.tsx` `messagingGroups` |
| Server-side search: 200 ms debounce, local matches while pending, ranked reply, FTS markers stripped | `use-server-session-search.ts`, `index.tsx` `mergeSearchResults` |
| Relative time (now, 5m, 3h, 2d) | `session-row.tsx` `formatAge` |
| Unread: the backend's read watermark, a turn finished while away, cleared on open | `session-unread-remote.ts` `clearUnreadOnOpen` |
| Bot roster: heading with add, 50% search, 34 dp face rows with the canonical chat's status dot, pinned and hidden marks, "Hidden N" disclosure, empty panels | `plugins/hermes-bots/bot-row.tsx`, `roster-pane-*.tsx` |
| Footer chips: connection glyph per kind, profile glyph (home for the default, tinted initial otherwise), chevron | `connection-glyph.tsx`, `profile-dropdown-switcher.tsx`, `components/ui/profile-glyph.tsx` |

## Parity deviations

- **Touch sizing.** Rows, nav rows, tabs, chips and the search field are at least 40 dp (the desktop's session row is 26,
  its nav row 28, its tab strip 28). Section headers and dividers are 28-32 dp and borrow the rest from `hitSlop`. The load-more
  ellipsis keeps the desktop's 20 dp button inside a 40 dp hit area.
- **Long-press for hover.** The kebab, the hover caret on headers and dividers, and the shift-click pin hint become long-press
  (row actions) and an always-visible caret.
- **Age on every row.** The desktop's compact row shows no age unless "Updated" is on; the phone shows it (#12: dot, title, relative time).
- **Running arc.** Drawn as four hairline strips that slide one gradient (no mask, UI-thread transforms) rather than the desktop's
  masked gradient; reduced motion draws nothing. `stalled` (the stream watchdog's hollow accent dot) is not ported: a running session is `working`.
- **Unread** has no persisted seen-count watermarks and no "mark all as read" or per-row "mark as unread"; the backend watermark and one
  in-memory "finished while away" mark carry it.
- **Platform sections** use a monogram chip in the platform's colour, the desktop's own fallback where a brand has no glyph.
- **Folds are in memory.** Pinned, Sessions, platform sections, date groups and Hidden reset when the app restarts; the desktop persists them.
- **No virtual list.** Sessions render in one scroll view; the window grows by 50 on request up to the route's 500.
- **Roster.** No mute bell, filter menu, group chats, user sections or gateway headings (#17); search placeholder is "Search bots…".

## Left out by decision

- Projects, worktrees, project filters and the coding row (#16 and the panes ticket), the cron-jobs section and its nav row (#12),
  the Messaging and Artifacts nav rows until their surfaces land (#12 amendment, #15), terminal (#12), drag reorder and
  split/tab gestures (no panes, #12), card/inbox row styles, sort and group menus, profile rail and fleet roster (single
  connection, #12), session export, branch-from and open-in-window actions.
