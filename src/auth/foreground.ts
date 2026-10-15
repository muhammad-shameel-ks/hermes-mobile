/**
 * Waiting for the app to be in front. The loopback callback lands while the
 * browser is still on screen, and Android blocks network access for background
 * apps (surfacing as UnknownHostException), so network work that follows a
 * browser hand-off waits until the user is back in the app.
 */

export type AppStateSource = {
  currentState: string | null | undefined;
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void };
};

export class ForegroundAbortedError extends Error {
  constructor() {
    super('stopped waiting for the app to return to the foreground');
    this.name = 'ForegroundAbortedError';
  }
}

export function waitForForeground(source: AppStateSource, signal?: AbortSignal): Promise<void> {
  if (source.currentState === 'active') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ForegroundAbortedError());
      return;
    }
    const subscription = source.addEventListener('change', (state) => {
      if (state !== 'active') return;
      finish();
      resolve();
    });
    const onAbort = () => {
      finish();
      reject(new ForegroundAbortedError());
    };
    function finish() {
      subscription.remove();
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort);
  });
}
