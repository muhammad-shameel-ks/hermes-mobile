/**
 * The `/` sheet: the phone's curated command list (src/chat/slash.ts) plus the
 * live catalog's skills, filtered as the composer's text changes. Tapping a row
 * accepts it into the composer as the desktop's Tab does; a command that only
 * opens a picker (`/model`, `/resume`, `/profile`) opens it straight away, since
 * a second Send to reach a picker is a desktop keyboard habit.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import type { CommandsCatalogResult, CompleteSlashResult } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { Empty, GroupHeader, Panel, Row } from './CompletionPanel.tsx';
import type { ComposerSheet, SheetScope } from './useComposerTriggers.ts';
import { argumentRows, gatewayArgumentRows, resolveCommand, slashArgStage, slashCommandToken, slashRows, type SlashRow, type SlashUi } from './slash.ts';

const CATALOG_TTL_MS = 60_000;
const catalogs = new Map<string, { at: number; value: CommandsCatalogResult }>();
const NO_ROWS: SlashRow[] = [];

/** the catalog for a scope, shared across sheet openings so a bare `/` is instant after the first */
function useCatalog({ request, sessionId, profile }: SheetScope): CommandsCatalogResult | null {
  // a caller that rebuilds `request` each render must not refetch on every one
  const requestRef = useRef(request);
  requestRef.current = request;
  const key = `${profile}|${sessionId ?? ''}`;
  const [catalog, setCatalog] = useState<CommandsCatalogResult | null>(() => catalogs.get(key)?.value ?? null);
  useEffect(() => {
    const cached = catalogs.get(key);
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
      setCatalog(cached.value);
      return;
    }
    let live = true;
    requestRef.current<CommandsCatalogResult>('commands.catalog', sessionId ? { session_id: sessionId } : { profile })
      .then((value) => {
        catalogs.set(key, { at: Date.now(), value });
        if (live) setCatalog(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, sessionId, profile]);
  return catalog;
}

/** the gateway's completions for a command's argument, when the phone has no list of its own */
function useGatewayArguments(query: string, { request, sessionId, profile }: SheetScope, enabled: boolean): { rows: SlashRow[]; loading: boolean } {
  const [state, setState] = useState<{ query: string; rows: SlashRow[] } | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const text = `/${query}`;
    const timer = setTimeout(() => {
      requestRef.current<CompleteSlashResult>('complete.slash', { text, ...(sessionId ? { session_id: sessionId } : { profile }) })
        .then((result) => {
          if (live) setState({ query, rows: gatewayArgumentRows(text, result.items ?? [], result.replace_from) });
        })
        .catch(() => {
          if (live) setState({ query, rows: [] });
        });
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, sessionId, profile, enabled]);
  return { rows: enabled && state?.query === query ? state.rows : NO_ROWS, loading: enabled && state?.query !== query };
}

type Props = {
  sheet: ComposerSheet;
  scope: SheetScope;
  bottom: number;
  maxHeight: number;
  onUi: (ui: SlashUi) => void;
};

export function SlashSheet({ sheet, scope, bottom, maxHeight, onUi }: Props) {
  const { trigger } = sheet;
  const catalog = useCatalog(scope);
  const argStage = !trigger.inline && slashArgStage(trigger.query);
  const staticArgs = useMemo(() => (argStage ? argumentRows(trigger.query) : []), [argStage, trigger.query]);
  const command = argStage ? resolveCommand(slashCommandToken(trigger.query)) : null;
  const wantsGateway = argStage && !command?.options && command?.argumentMode !== 'text';
  const remote = useGatewayArguments(trigger.query, scope, wantsGateway);
  const rows = useMemo(
    () => (argStage ? (command?.options ? staticArgs : remote.rows) : slashRows({ query: trigger.query, inline: trigger.inline, catalog })),
    [argStage, command, staticArgs, remote.rows, trigger.query, trigger.inline, catalog],
  );

  // the rows are memoised elements: the composer re-renders this sheet on every keystroke and streamed delta,
  // and an unchanged list must not be rebuilt for it, so the handler reads the latest props through a ref
  const latest = useRef({ sheet, onUi, inline: trigger.inline });
  latest.current = { sheet, onUi, inline: trigger.inline };
  const list = useMemo(() => {
    const pick = (row: SlashRow) => {
      const { sheet: current, onUi: openUi, inline } = latest.current;
      const surface = row.command?.surface;
      if (!inline && surface?.kind === 'ui') {
        current.insert('', { close: true });
        openUi(surface.ui);
        return;
      }
      // an argument row commits; a command row expands to its argument stage or commits as typed
      current.insert(`${row.text} `, { close: row.group === 'Options' });
    };
    let lastGroup: string | null = null;
    return rows.map((row) => {
      const header = row.group !== lastGroup ? <GroupHeader label={row.group} /> : null;
      lastGroup = row.group;
      return (
        <Fragment key={row.text}>
          {header}
          <Row kind={row.group === 'Skills' ? 'skill' : 'command'} title={row.display} meta={row.meta} onPress={() => pick(row)} />
        </Fragment>
      );
    });
  }, [rows]);

  return (
    <Panel bottom={bottom} maxHeight={maxHeight} onDismiss={sheet.dismiss}>
      {rows.length === 0 ? <Empty loading={remote.loading} title={argStage ? 'No matching options.' : 'No commands match.'} /> : list}
    </Panel>
  );
}
