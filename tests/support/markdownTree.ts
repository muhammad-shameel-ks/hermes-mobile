/**
 * react-native-marked's Parser walk (src/lib/Parser.tsx), reduced to the element tree and its keys, for
 * Node tests and the perf bench: the real Parser and renderer import React Native. It calls the key
 * source in the same order the real renderer does: an element's children are built before the element
 * asks for its key, and an element made from children goes through `around` (TranscriptRenderer).
 */

import { createElement, type ReactElement, type ReactNode } from 'react';
import { lexer, type Token, type Tokens } from 'marked';

export type KeySource = { next(): string; around<T>(children: unknown, make: () => T): T };

/** a key source that is only a counter, as react-native-marked's own renderer (reset per parse) */
export function counterKeys(): KeySource & { reset(): void } {
  let counter = 0;
  return {
    reset: () => void (counter = 0),
    next: () => `md-${(counter += 1)}`,
    around: (_children, make) => make(),
  };
}

type Node = ReactElement<{ children?: ReactNode }>;

function leaf(keys: KeySource, type: string, text: string): Node {
  return createElement(type, { key: keys.next() }, text);
}

function made(keys: KeySource, type: string, children: string | ReactNode[]): Node {
  if (typeof children === 'string') return leaf(keys, type, children);
  return keys.around(children, () => createElement(type, { key: keys.next() }, children));
}

/** a token whose only child is text renders that text directly (Parser.hasDuplicateTextChildToken) */
const plain = (token: Token) => 'tokens' in token && token.tokens?.length === 1 && token.tokens[0].type === 'text';

function parseList(tokens: readonly Token[] | undefined, keys: KeySource): ReactNode[] {
  return (tokens ?? []).map((token) => parseToken(token, keys)).filter((node) => node !== null);
}

/** inline runs wrapped in one text element (Parser.getNormalizedSiblingNodesForBlockAndInlineTokens, without images) */
function inline(tokens: readonly Token[] | undefined, keys: KeySource): ReactNode[] {
  const parsed = parseList(tokens, keys);
  return parsed.length > 0 ? [made(keys, 'text', parsed)] : [];
}

function parseToken(token: Token, keys: KeySource): ReactNode {
  switch (token.type) {
    case 'paragraph':
      return made(keys, 'paragraph', inline(token.tokens, keys));
    case 'blockquote':
      return made(keys, 'blockquote', parseList(token.tokens, keys));
    case 'heading':
      return plain(token) ? leaf(keys, 'heading', token.text) : made(keys, 'heading', parseList(token.tokens, keys));
    case 'code':
      return leaf(keys, 'code', token.text);
    case 'hr':
      return leaf(keys, 'hr', '');
    case 'list': {
      const li = (token as Tokens.List).items.map((item) =>
        made(
          keys,
          'listItem',
          item.tokens.flatMap((child) => (child.type === 'text' ? inline((child as Tokens.Text).tokens, keys) : [parseToken(child, keys)])),
        ),
      );
      return made(keys, 'list', li);
    }
    case 'table': {
      const table = token as Tokens.Table;
      const header = table.header.map((cell) => parseList(cell.tokens, keys));
      const rows = table.rows.map((row) => row.map((cell) => parseList(cell.tokens, keys)));
      return keys.around([header, rows], () => createElement('table', { key: keys.next() }, header.flat(), rows.flat(2)));
    }
    case 'link':
      if (token.text.trim().length < 1 || !token.tokens) return null;
      return plain(token) ? leaf(keys, 'link', token.text) : made(keys, 'link', parseList(token.tokens, keys));
    case 'strong':
    case 'em':
    case 'del':
      return plain(token) ? leaf(keys, token.type, token.text) : made(keys, token.type, parseList(token.tokens, keys));
    case 'escape':
    case 'codespan':
    case 'image':
    case 'br':
    case 'text':
    case 'html':
      return leaf(keys, token.type, token.raw);
    default:
      return null;
  }
}

/** the top-level elements markdown `text` renders to, keyed by `keys` */
export function markdownTree(text: string, keys: KeySource & { reset(): void }): ReactNode[] {
  keys.reset();
  return parseList(lexer(text, { gfm: true }), keys);
}
