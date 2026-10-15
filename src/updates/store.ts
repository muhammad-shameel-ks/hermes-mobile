/**
 * The updater's state machine, shared by the launch prompt and Settings → About
 * so a download started in one shows its progress in the other. Native work
 * (the GitHub request, the download, the installer, storage) comes in through
 * `UpdaterDeps`, which keeps this file testable under node.
 */

import { isNewer, progressFraction, type Release } from './release.ts';

/** `auto` checks run at launch and on return to the foreground; only they raise the prompt. */
export type CheckOrigin = 'auto' | 'manual';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking'; origin: CheckOrigin }
  | { kind: 'current'; checkedAt: number; latest: string | null }
  | { kind: 'available'; origin: CheckOrigin; release: Release }
  | { kind: 'downloading'; origin: CheckOrigin; release: Release; progress: number | null }
  | { kind: 'ready'; origin: CheckOrigin; release: Release; fileUri: string }
  | { kind: 'error'; origin: CheckOrigin; message: string; release: Release | null };

export type UpdaterDeps = {
  currentVersion: string;
  fetchLatest: () => Promise<Release | null>;
  download: (release: Release, onProgress: (written: number, total: number) => void) => Promise<string>;
  install: (fileUri: string) => Promise<void>;
  loadSkipped: () => Promise<string | null>;
  saveSkipped: (version: string | null) => Promise<void>;
  now?: () => number;
};

/** how long a launch or foreground check stays fresh */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export class UpdateStore {
  private state: UpdateState = { kind: 'idle' };
  private listeners = new Set<() => void>();
  private lastAutoCheck: number | null = null;
  private skipped: string | null | undefined;
  private dismissed = new Set<string>();

  private deps: UpdaterDeps;

  constructor(deps: UpdaterDeps) {
    this.deps = deps;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  get currentVersion() {
    return this.deps.currentVersion;
  }

  private set(next: UpdateState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private busy() {
    return this.state.kind === 'checking' || this.state.kind === 'downloading';
  }

  /** Whether the launch prompt should show for the current state. */
  shouldPrompt(): boolean {
    const s = this.state;
    if (s.kind === 'idle' || s.kind === 'checking' || s.kind === 'current') return false;
    if (s.origin !== 'auto' || !s.release) return false;
    return !this.dismissed.has(s.release.version);
  }

  /** Ask GitHub for the latest release. Auto checks are throttled and quietly respect a skipped version. */
  async check(origin: CheckOrigin): Promise<void> {
    if (this.busy() || this.state.kind === 'ready') return;
    if (origin === 'auto') {
      if (this.lastAutoCheck !== null && this.now() - this.lastAutoCheck < AUTO_CHECK_INTERVAL_MS) return;
      this.lastAutoCheck = this.now();
    }
    const before = this.state;
    this.set({ kind: 'checking', origin });
    try {
      const release = await this.deps.fetchLatest();
      if (!release || !isNewer(release.version, this.deps.currentVersion)) {
        this.set({ kind: 'current', checkedAt: this.now(), latest: release?.version ?? null });
        return;
      }
      if (origin === 'auto') {
        if (this.skipped === undefined) this.skipped = await this.deps.loadSkipped().catch(() => null);
        if (this.skipped === release.version) {
          this.set(before.kind === 'checking' ? { kind: 'idle' } : before);
          return;
        }
      }
      this.set({ kind: 'available', origin, release });
    } catch (error) {
      // a failed background check stays silent; the next one retries
      if (origin === 'auto') {
        this.lastAutoCheck = null;
        this.set({ kind: 'idle' });
      } else {
        this.set({ kind: 'error', origin, message: message(error, 'Could not reach GitHub'), release: null });
      }
    }
  }

  /** Download the release's APK, then hand it to the system installer. */
  async update(): Promise<void> {
    const s = this.state;
    if (s.kind === 'ready') return this.install();
    if (s.kind !== 'available' && s.kind !== 'error') return;
    const release = s.release;
    if (!release) return;
    const origin = s.origin;
    this.set({ kind: 'downloading', origin, release, progress: null });
    let fileUri: string;
    try {
      fileUri = await this.deps.download(release, (written, total) => {
        if (this.state.kind !== 'downloading') return;
        this.set({ ...this.state, progress: progressFraction(written, total) });
      });
    } catch (error) {
      this.set({ kind: 'error', origin, message: message(error, 'The download failed'), release });
      return;
    }
    this.set({ kind: 'ready', origin, release, fileUri });
    await this.install();
  }

  /** Re-open the installer for a finished download (after the reader backed out of it). */
  async install(): Promise<void> {
    const s = this.state;
    if (s.kind !== 'ready') return;
    try {
      await this.deps.install(s.fileUri);
    } catch (error) {
      this.set({ kind: 'error', origin: s.origin, message: message(error, 'Could not open the installer'), release: s.release });
    }
  }

  /** "Later": hide the prompt for this release until the next launch. */
  dismiss(): void {
    const s = this.state;
    if ('release' in s && s.release) this.dismissed.add(s.release.version);
    this.set({ ...s });
  }

  /** "Skip this version": no more launch prompts for it; a newer release prompts again. */
  async skip(): Promise<void> {
    const s = this.state;
    if (!('release' in s) || !s.release) return;
    this.skipped = s.release.version;
    this.dismissed.add(s.release.version);
    this.set({ ...s });
    await this.deps.saveSkipped(s.release.version).catch(() => undefined);
  }
}
