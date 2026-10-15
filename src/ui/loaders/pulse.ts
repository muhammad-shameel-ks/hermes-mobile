/**
 * The 5 s status-pulse clock, ported from the desktop's components/ui/status-pulse.tsx:
 * every pulse shares one timer so all play in one aligned beat and the app sleeps
 * between them. Timers and pausing are injected so the clock is testable without RN.
 */

export const PULSE_DURATION_MS = 400;
export const PULSE_PERIOD_MS = 5_000;

export type PulseSubscriber = { play: () => void; cancel: () => void };

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export function createPulseClock(timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as never) }) {
  const subscribers = new Set<PulseSubscriber>();
  let timer: unknown = null;
  let paused = false;

  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const beat = () => {
    timer = null;
    if (paused || subscribers.size === 0) return;
    for (const subscriber of subscribers) subscriber.play();
    timer = timers.set(beat, PULSE_PERIOD_MS);
  };

  return {
    /** The first subscriber, or one joining mid-sleep, plays at once and starts the beat; later joiners wait for the next one. */
    subscribe(subscriber: PulseSubscriber): () => void {
      subscribers.add(subscriber);
      if (timer === null && !paused) {
        subscriber.play();
        timer = timers.set(beat, PULSE_PERIOD_MS);
      }
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) stop();
      };
    },
    /** Backgrounded: cancel in-flight pulses and sleep. Foregrounded: beat at once. */
    setPaused(next: boolean) {
      if (paused === next) return;
      paused = next;
      stop();
      if (paused) {
        for (const subscriber of subscribers) subscriber.cancel();
        return;
      }
      beat();
    },
    get size() {
      return subscribers.size;
    },
  };
}
