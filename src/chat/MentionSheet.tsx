/**
 * The `@` sheet: whatever the gateway's `complete.path` lists for the typed
 * token (files, folders, `@diff`, `@staged`, ...), the same call and the same
 * `@kind:value` text the desktop's popover inserts.
 *
 * Tab and Backspace become taps: a folder row walks into the folder, and the
 * breadcrumb above the list walks back out one segment at a time. A folder
 * itself is attached with the check on its row.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CompletePathParams, CompletionItemsResult } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';
import { Empty, GroupHeader, Panel, Row } from './CompletionPanel.tsx';
import { ascendToken, descendInsertText, DIRECTIVE_SCOPES, mentionInsertText, mentionRows, starterRows, type MentionRow } from './slash.ts';
import type { ComposerSheet, SheetScope } from './useComposerTriggers.ts';

const CACHE_LIMIT = 80;
const DEBOUNCE_MS = 60;
const cache = new Map<string, MentionRow[]>();
const NO_ROWS: MentionRow[] = [];

const remember = (key: string, rows: MentionRow[]) => {
  cache.set(key, rows);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
};

/**
 * Rows for a query. A cached query skips the debounce and the spinner, which is
 * what makes walking a tree feel instant; the cache key carries the session so a
 * listing never serves another tree.
 */
function useMentions(query: string, { request, sessionId, profile }: SheetScope): { rows: MentionRow[]; loading: boolean } {
  const key = `${profile}|${sessionId ?? ''}|${query}`;
  const [state, setState] = useState<{ key: string; rows: MentionRow[] } | null>(null);
  // a caller that rebuilds `request` each render must not restart the debounce on every one
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (cache.has(key)) return;
    let live = true;
    const word = (DIRECTIVE_SCOPES as readonly string[]).includes(query) ? `@${query}:` : `@${query}`;
    const params: CompletePathParams = { word, ...(sessionId ? { session_id: sessionId } : {}), profile };
    const timer = setTimeout(() => {
      requestRef.current<CompletionItemsResult>('complete.path', params as Record<string, unknown>)
        .then((result) => {
          const rows = mentionRows(result.items ?? [], query);
          remember(key, rows);
          if (live) setState({ key, rows });
        })
        .catch(() => {
          if (live) setState({ key, rows: starterRows(query) });
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, query, sessionId, profile]);
  const rows = cache.get(key) ?? (state?.key === key ? state.rows : null);
  return { rows: rows ?? NO_ROWS, loading: rows === null };
}

type Props = {
  sheet: ComposerSheet;
  scope: SheetScope;
  bottom: number;
  maxHeight: number;
};

export function MentionSheet({ sheet, scope, bottom, maxHeight }: Props) {
  const t = useTokens();
  const { trigger } = sheet;
  const { rows, loading } = useMentions(trigger.query, scope);
  const browsing = Boolean(trigger.scope) || trigger.value.includes('/');

  // memoised elements, with the handlers reading the latest props through a ref: the composer re-renders this sheet
  // on every keystroke and streamed delta, and an unchanged listing must not be rebuilt for it
  const latest = useRef({ sheet, scope: trigger.scope });
  latest.current = { sheet, scope: trigger.scope };
  const list = useMemo(() => {
    const pick = (row: MentionRow) => {
      const { sheet: current, scope: scoped } = latest.current;
      if (row.starter) return current.insert(row.raw);
      if (row.folder) return current.insert(descendInsertText(row, scoped));
      current.insert(`${mentionInsertText(row)} `, { close: true });
    };
    return rows.map((row) => (
      <Fragment key={row.raw}>
        <Row
          kind={row.kind}
          title={row.display}
          meta={row.meta}
          onPress={() => pick(row)}
          trailing={
            row.folder ? (
              <Pressable
                onPress={() => latest.current.sheet.insert(`${mentionInsertText(row)} `, { close: true })}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Attach ${row.display}`}
                style={styles.attach}
              >
                <Codicon name="check" size={14} color={t.uiTextSecondary} />
              </Pressable>
            ) : null
          }
        />
      </Fragment>
    ));
  }, [rows, t]);

  return (
    <Panel
      bottom={bottom}
      maxHeight={maxHeight}
      onDismiss={sheet.dismiss}
      header={
        browsing ? (
          <Pressable
            onPress={() => sheet.insert(ascendToken(trigger))}
            accessibilityRole="button"
            accessibilityLabel="Up one level"
            style={({ pressed }) => [styles.crumb, pressed && { backgroundColor: t.uiControlActiveBackground }]}
          >
            <Codicon name="chevron-left" size={16} color={t.uiTextTertiary} />
            <Text style={[styles.crumbText, { color: t.uiTextSecondary }]} numberOfLines={1}>
              {`@${trigger.scope ? `${trigger.scope}:` : ''}${trigger.value}`}
            </Text>
          </Pressable>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Empty
          loading={loading}
          title="No matches."
          hint={
            <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>
              Try <Text style={{ color: t.uiTextSecondary }}>@file:</Text> or <Text style={{ color: t.uiTextSecondary }}>@folder:</Text>.
            </Text>
          }
        />
      ) : (
        <>
          {trigger.scope ? <GroupHeader label={trigger.scope} /> : null}
          {list}
        </>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12 },
  crumbText: { flex: 1, fontSize: 12 },
  attach: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
