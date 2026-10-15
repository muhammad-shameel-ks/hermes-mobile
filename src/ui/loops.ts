/**
 * The shared-loop registry behind clock.ts, pure so it tests without React Native.
 *
 * A decorative loop (a shimmer sweep, a glyph spinner's steps, the running arc) is one
 * repeating 0..1 timeline per distinct spec, not one per component: every consumer of a
 * spec reads the same value and derives its own transform from it. The timeline runs only
 * while someone holds it and the app is in the foreground and nobody has held it still.
 */

export type LoopSpec = {
  durationMs: number;
  /** a stepped timeline (a glyph spinner's frames); linear when absent */
  steps?: number;
};

export const loopKey = (spec: LoopSpec): string => `${spec.durationMs}:${spec.steps ?? 0}`;

export type LoopDriver<V> = {
  create: () => V;
  /** begin the repeat from 0 */
  start: (value: V, spec: LoopSpec) => void;
  stop: (value: V) => void;
};

type Entry<V> = { value: V; spec: LoopSpec; refs: number; running: boolean };

export function createLoopRegistry<V>(driver: LoopDriver<V>) {
  const entries = new Map<string, Entry<V>>();
  let foreground = true;
  let holds = 0;

  const sync = (entry: Entry<V>) => {
    const want = entry.refs > 0 && foreground && holds === 0;
    if (want === entry.running) return;
    entry.running = want;
    if (want) driver.start(entry.value, entry.spec);
    else driver.stop(entry.value);
  };
  const syncAll = () => {
    for (const entry of entries.values()) sync(entry);
  };
  const entryFor = (spec: LoopSpec): Entry<V> => {
    const key = loopKey(spec);
    let entry = entries.get(key);
    if (!entry) {
      entry = { value: driver.create(), spec: { durationMs: spec.durationMs, steps: spec.steps }, refs: 0, running: false };
      entries.set(key, entry);
    }
    return entry;
  };
  const once = (fn: () => void) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      fn();
    };
  };

  return {
    /** the spec's timeline value, whether or not it is running */
    value: (spec: LoopSpec): V => entryFor(spec).value,
    /** hold the timeline running until the returned release is called */
    acquire(spec: LoopSpec): () => void {
      const entry = entryFor(spec);
      entry.refs += 1;
      sync(entry);
      return once(() => {
        entry.refs -= 1;
        sync(entry);
      });
    },
    /** the app left or re-entered the foreground */
    setForeground(next: boolean) {
      if (foreground === next) return;
      foreground = next;
      syncAll();
    },
    /** freeze every timeline until the returned release is called (holds stack) */
    hold(): () => void {
      holds += 1;
      syncAll();
      return once(() => {
        holds -= 1;
        syncAll();
      });
    },
    /** how many timelines are running right now */
    get running() {
      let count = 0;
      for (const entry of entries.values()) if (entry.running) count += 1;
      return count;
    },
  };
}
