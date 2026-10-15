import { createElement, type ComponentType } from 'react';

type Scalable = ComponentType<{ allowFontScaling?: boolean }> & { displayName?: string };

const isPlainFunction = (value: unknown): value is (props: { allowFontScaling?: boolean }) => unknown =>
  typeof value === 'function' && !(value as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent;

/**
 * A plain function component (RN's Text and TextInput are) is called in the wrapper's own render, so
 * the wrapper adds no fibre of its own: its hooks are the original's, in the same order every render.
 * Anything else (a class, a forwardRef object) gets an element of the original beneath the wrapper.
 */
export function fontScalingOff(original: Scalable): Scalable {
  const wrapped = (isPlainFunction(original)
    ? (props: { allowFontScaling?: boolean }) => (props.allowFontScaling === undefined ? original({ ...props, allowFontScaling: false }) : original(props))
    : (props: { allowFontScaling?: boolean }) => createElement(original, { ...props, allowFontScaling: props.allowFontScaling ?? false })) as Scalable;
  Object.assign(wrapped, original);
  wrapped.displayName = original.displayName;
  return wrapped;
}

/** Replace `exports[name]` with a wrapper; false when the export can't be redefined. */
export function wrapExport(exports: object, name: string, wrap: (original: Scalable) => Scalable): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(exports, name);
  if (!descriptor?.configurable) return false;
  const original = (exports as Record<string, Scalable>)[name];
  if (typeof original !== 'function' && typeof original !== 'object') return false;
  const wrapped = wrap(original);
  Object.defineProperty(exports, name, { configurable: true, enumerable: descriptor.enumerable, get: () => wrapped });
  return true;
}
