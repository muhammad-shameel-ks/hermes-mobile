/**
 * Element keys for one markdown block's renderer that hold while the block streams.
 *
 * react-native-marked's parser builds an element's children before the element, so a plain counter
 * hands keys out in post-order: a paragraph, list item, list or table takes its key after all of its
 * content, and every inline run the stream adds inside it (a `**bold**`, a link, a table cell) moves
 * that key. React then remounts the element: the open list or table rebuilt all of its native views
 * on most beats, and a table being written snapped back to its first column.
 *
 * Here an element made from children takes its first keyed child's key, and only the others (leaves)
 * draw from the counter. Appending text never changes the leaves before it, so every element keeps its
 * key while the block grows. Siblings cannot collide: each one's key comes from a leaf inside its own
 * subtree. A parent and its first child share a key, which React allows (keys are per sibling list).
 *
 * Pure: React elements only, so the policy is tested in Node.
 */

import { isValidElement } from 'react';

/** the key of the first keyed element in `children` (nested arrays included), or null */
export function firstKey(children: unknown): string | null {
  if (Array.isArray(children)) {
    for (const child of children) {
      const key = firstKey(child);
      if (key !== null) return key;
    }
    return null;
  }
  return isValidElement(children) && children.key !== null ? children.key : null;
}

export class BlockKeys {
  private counter = 0;
  private inherited: string | null = null;

  /** start a parse: the same text gets the same keys */
  reset(): void {
    this.counter = 0;
    this.inherited = null;
  }

  /** the key for the element being made: the one `around` lent it, else a fresh leaf key */
  next(): string {
    const inherited = this.inherited;
    if (inherited !== null) {
      this.inherited = null;
      return inherited;
    }
    this.counter += 1;
    return `md-${this.counter}`;
  }

  /** `make` an element from `children`; the first key it asks for is its first child's */
  around<T>(children: unknown, make: () => T): T {
    return this.lend(firstKey(children), make);
  }

  /** `make` an element whose first key request gets `key` (a fresh one when null) */
  lend<T>(key: string | null, make: () => T): T {
    this.inherited = key;
    try {
      return make();
    } finally {
      this.inherited = null;
    }
  }
}
