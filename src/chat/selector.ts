/**
 * The pure core of `useChatSelector`: a selector memo that keeps the previous selection whenever
 * the new one is equal, so a subscriber re-renders only when the slice it reads changed - not on
 * every store notification (which, while a turn streams, is every token).
 */

export type Equality<T> = (a: T, b: T) => boolean;

/**
 * One memoised read of a store. Returns the cached selection while the state, selector and
 * equality are the same; otherwise runs the selector and, when the result equals the previous
 * selection, hands the previous one back so its identity (and every memo keyed on it) survives.
 */
export function createMemoSelect<S, T>() {
  let has = false;
  let state: S;
  let select: (state: S) => T;
  let equal: Equality<T>;
  let value: T;

  return (next: S, selector: (state: S) => T, isEqual: Equality<T> = Object.is): T => {
    if (has && next === state && selector === select && isEqual === equal) return value;
    const selected = selector(next);
    state = next;
    select = selector;
    equal = isEqual;
    if (has && isEqual(value, selected)) return value;
    has = true;
    value = selected;
    return selected;
  };
}

/** every own field `Object.is`-equal: the right comparison for a slice built as a flat object of references */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) return false;
  }
  return true;
}

/** same length and `Object.is`-equal items */
export function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}
