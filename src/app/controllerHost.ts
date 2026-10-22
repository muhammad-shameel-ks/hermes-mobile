/**
 * One signed-in stack per connection, shared by every surface that shows it. On Android the app and
 * the assistant card are two activities on one React host, so they run in the same JS runtime: the
 * card asks through the app's controller and socket instead of dialling a second one, and a card that
 * hands off to the app leaves the chat it opened on screen.
 *
 * A stack is built on first `get` and lives while a surface holds it. When the last holder lets go it
 * goes idle (the socket closes) and is disposed after a grace period, so the app opening straight
 * after the card, or the card straight after the app, picks up the same controller. A stack whose
 * credentials died (reauth, sign-out) is never handed out again and is disposed once nobody holds it.
 */

export type HostDeps<C> = {
  /** the stack has no holder left: close what runs in the background */
  idle: (value: C) => void;
  dispose: (value: C) => void;
  graceMs: number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

export type Hosted<C> = {
  readonly id: string;
  readonly value: C;
  /** keeps the stack alive; `onReauthRequired` hears its credentials being rejected while held. Returns the release. */
  hold: (onReauthRequired: (reason: string) => void) => () => void;
};

type Entry<C> = Hosted<C> & {
  holders: Set<(reason: string) => void>;
  dead: boolean;
  disposed: boolean;
  timer: unknown;
};

export type ControllerHost<C> = {
  /** the live stack for `id`, built by `create` when there is none; `create` gets the stack's reauth handler */
  get: (id: string, create: (onReauthRequired: (reason: string) => void) => C) => Hosted<C>;
  /** the live stack, if one is running: a surface that has not restored a connection yet starts from it */
  current: () => Hosted<C> | null;
  /** the connection's credentials are gone: never hand the stack out again */
  end: (id: string) => void;
};

export function createControllerHost<C>(deps: HostDeps<C>): ControllerHost<C> {
  let live: Entry<C> | null = null;

  const dispose = (entry: Entry<C>) => {
    if (entry.disposed) return;
    entry.disposed = true;
    if (entry.timer !== null) deps.clearTimer(entry.timer);
    entry.timer = null;
    if (live === entry) live = null;
    deps.dispose(entry.value);
  };

  const expire = (entry: Entry<C>) => {
    entry.timer = deps.setTimer(() => {
      entry.timer = null;
      dispose(entry);
    }, deps.graceMs);
  };

  /** the last holder let go: dead stacks go now, live ones idle through the grace period */
  const unheld = (entry: Entry<C>) => {
    if (entry.dead) {
      dispose(entry);
      return;
    }
    deps.idle(entry.value);
    expire(entry);
  };

  const kill = (entry: Entry<C>) => {
    if (entry.dead) return;
    entry.dead = true;
    if (live === entry) live = null;
    if (entry.holders.size === 0) dispose(entry);
  };

  return {
    get(id, create) {
      if (live && live.id === id) return live;
      // one connection is active at a time; a stack nobody holds gives way at once
      if (live && live.holders.size === 0) dispose(live);
      // the handler fires only after `get` returns, once `entry` exists
      const value = create((reason) => {
        const holders = [...entry.holders];
        kill(entry);
        for (const holder of holders) holder(reason);
      });
      const entry: Entry<C> = {
        id,
        value,
        holders: new Set(),
        dead: false,
        disposed: false,
        timer: null,
        hold(onReauthRequired) {
          if (entry.timer !== null) deps.clearTimer(entry.timer);
          entry.timer = null;
          // a callback per hold, so the same function held twice is released twice
          const holder = (reason: string) => onReauthRequired(reason);
          entry.holders.add(holder);
          return () => {
            if (!entry.holders.delete(holder) || entry.disposed) return;
            if (entry.holders.size === 0) unheld(entry);
          };
        },
      };
      live = entry;
      // built during a render that may never commit: it expires unless a surface holds it
      expire(entry);
      return entry;
    },
    current: () => live,
    end(id) {
      if (live && live.id === id) kill(live);
    },
  };
}
