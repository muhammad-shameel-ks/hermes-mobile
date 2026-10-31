/**
 * The Wordmark's fit maths and what it remembers between mounts. The word is measured once at a reference
 * size and scaled to the box's width. Both inputs survive a remount, so a Wordmark that mounts again (every
 * visit to the empty chat) sizes itself on its first render instead of rendering nothing for two layout passes.
 */

export const REFERENCE = 100;
export const FIT_MIN = 44;
export const TRACKING = 0.08;

/** a hair under the exact fit: line widths round differently across sizes, and a 1px overflow would ellipsize */
export function fitSize(width: number, measured: number): number {
  return width && measured ? Math.max(FIT_MIN, (REFERENCE * width * 0.98) / measured) : 0;
}

export type Fit = { width: number; measured: number };

const CAPACITY = 32;

export type FitMemo = {
  /** what the last mount of `text` learned; `measured` is 0 until a trustworthy measure was recorded */
  recall(text: string): Fit;
  /** the box width a mount of `text` was laid out at */
  noteWidth(text: string, width: number): void;
  /** the reference width of `text`, only once the face it was measured in is the real one */
  noteMeasured(text: string, measured: number): void;
};

export function createFitMemo(): FitMemo {
  const known = new Map<string, Fit>();
  const write = (text: string, patch: Partial<Fit>) => {
    const previous = known.get(text);
    known.delete(text);
    known.set(text, { width: 0, measured: 0, ...previous, ...patch });
    if (known.size > CAPACITY) known.delete(known.keys().next().value as string);
  };
  return {
    recall: (text) => known.get(text) ?? { width: 0, measured: 0 },
    noteWidth: (text, width) => {
      if (width > 0 && known.get(text)?.width !== width) write(text, { width });
    },
    noteMeasured: (text, measured) => {
      if (measured > 0 && known.get(text)?.measured !== measured) write(text, { measured });
    },
  };
}
