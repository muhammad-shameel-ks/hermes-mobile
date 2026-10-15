/**
 * The sessions tab as one flat list of cells, so a virtualised list can window it: section headers,
 * rows, date dividers, the placeholders a section shows instead of rows and the footers that hang off
 * a section's end. Spacing lives on the cells: a row after another carries the stack gap on top, and a
 * section's last cell carries the section's bottom padding.
 */

import type { SessionInfo } from '../chat/controller.ts';
import type { ListRow } from './sessionDates.ts';
import { sessionRowKey } from './sessionIndex.ts';

export type FoldTarget = 'pins' | 'recents' | { platform: string };
export type StateKind = 'skeletons' | 'load-error' | 'empty' | 'empty-tall' | 'pinned-hint';
export type MoreTarget = 'sessions' | { platform: string; loaded: number; more: boolean };

type Spacing = { end: boolean };

export type ListItem =
  | ({ kind: 'header'; key: string; label: string; open: boolean; fold?: FoldTarget; platform?: string } & Spacing)
  | ({ kind: 'row'; key: string; session: SessionInfo; branchStem?: string; gap: boolean } & Spacing)
  | ({ kind: 'divider'; key: string; label: string; groupKey: string; open: boolean; gap: boolean } & Spacing)
  | ({ kind: 'state'; key: string; state: StateKind; text?: string } & Spacing)
  | ({ kind: 'more'; key: string; loading: boolean; step?: number; target: MoreTarget } & Spacing);

type Draft<T> = T extends unknown ? Omit<T, 'end'> : never;
type Cell = Draft<ListItem>;

/** the rows of one list: the first has no gap above it, every later one has the stack gap */
function rowCells(section: string, rows: readonly ListRow[], isOpen: (groupKey: string) => boolean): Cell[] {
  return rows.map((row, index): Cell =>
    row.kind === 'divider'
      ? { kind: 'divider', key: `${section}:d:${row.key}`, label: row.label, groupKey: row.key, open: isOpen(row.key), gap: index > 0 }
      : { kind: 'row', key: `${section}:r:${sessionRowKey(row.entry.session)}`, session: row.entry.session, branchStem: row.entry.branchStem, gap: index > 0 },
  );
}

function finish(cells: readonly Cell[]): ListItem[] {
  return cells.map((cell, index) => ({ ...cell, end: index === cells.length - 1 }) as ListItem);
}

export type SectionModel = {
  key: string;
  label: string;
  open?: boolean;
  fold?: FoldTarget;
  platform?: string;
  /** what the section shows when open */
  body: Cell[];
};

/** a section's header, then its body when open; the last cell closes the section */
function section(model: SectionModel): ListItem[] {
  const open = model.open ?? true;
  const header: Cell = { kind: 'header', key: `h:${model.key}`, label: model.label, open, fold: model.fold, platform: model.platform };
  return finish(open ? [header, ...model.body] : [header]);
}

const stateCell = (key: string, state: StateKind, text?: string): Cell => ({ kind: 'state', key: `${key}:state`, state, text });
const moreCell = (key: string, loading: boolean, target: MoreTarget, step?: number): Cell => ({ kind: 'more', key: `${key}:more`, loading, target, step });

export type SessionListInput = {
  /** the trimmed query; non-empty swaps every section for Results */
  query: string;
  results: { rows: readonly ListRow[]; pending: boolean };
  pinsOpen: boolean;
  recentsOpen: boolean;
  closedGroups: readonly string[];
  pinned: readonly ListRow[];
  recents: { rows: readonly ListRow[]; skeletons: boolean; loadError: boolean; allPinned: boolean; footer: { loading: boolean } | null };
  platforms: ReadonlyArray<{
    sourceId: string;
    label: string;
    open: boolean;
    rows: readonly ListRow[];
    footer: { loading: boolean; step: number; loaded: number; more: boolean } | null;
  }>;
};

export function buildSessionListItems(input: SessionListInput): ListItem[] {
  const isOpen = (groupKey: string) => !input.closedGroups.includes(groupKey);
  const always = () => true;

  if (input.query) {
    const { rows, pending } = input.results;
    const body: Cell[] = rows.length > 0 ? rowCells('results', rows, always) : pending ? [stateCell('results', 'skeletons')] : [stateCell('results', 'empty-tall', `No sessions match “${input.query}”.`)];
    return section({ key: 'results', label: 'Results', body });
  }

  const { recents } = input;
  const recentsBody: Cell[] = recents.skeletons
    ? [stateCell('recents', 'skeletons')]
    : recents.loadError
      ? [stateCell('recents', 'load-error')]
      : recents.rows.length === 0
        ? [stateCell('recents', 'empty', recents.allPinned ? 'Everything here is pinned. Unpin a chat to show it in recents.' : 'No sessions yet')]
        : rowCells('recents', recents.rows, isOpen);
  if (!recents.skeletons && recents.footer) recentsBody.push(moreCell('recents', recents.footer.loading, 'sessions'));

  return [
    ...section({
      key: 'pins',
      label: 'Pinned',
      open: input.pinsOpen,
      fold: 'pins',
      body: input.pinned.length > 0 ? rowCells('pins', input.pinned, always) : [stateCell('pins', 'pinned-hint')],
    }),
    ...section({ key: 'recents', label: 'Sessions', open: input.recentsOpen, fold: 'recents', body: recentsBody }),
    ...input.platforms.flatMap((group) => {
      const key = `p:${group.sourceId}`;
      const body = rowCells(key, group.rows, always);
      if (group.footer) body.push(moreCell(key, group.footer.loading, { platform: group.sourceId, loaded: group.footer.loaded, more: group.footer.more }, group.footer.step));
      return section({ key, label: group.label, open: group.open, fold: { platform: group.sourceId }, platform: group.sourceId, body });
    }),
  ];
}
