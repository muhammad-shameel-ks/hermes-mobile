/**
 * What the inline cards need from the rest of the app, set once per sign-in. A
 * module slot rather than a provider: one connection is live at a time, the
 * transcript rows read it at render, and a row outside the signed-in tree (a
 * test, a preview) simply finds the defaults - http(s) media only, no review
 * door, no live subagents - and degrades.
 */

import type { SubagentProgress } from '../delegate.ts';
import type { MediaResolver } from '../mediaResolver.ts';

export type CardEnv = {
  media: MediaResolver | null;
  /** open the Review surface, at a file when given; absent until that surface lands */
  openReview?: (path?: string) => void;
  /** open a delegated child's own session */
  openSession?: (sessionId: string) => void;
  /** a hook returning the open session's live subagents */
  useSubagents?: () => readonly SubagentProgress[];
};

let env: CardEnv = { media: null };

export function setCardEnv(next: Partial<CardEnv>): void {
  env = { ...env, ...next };
}

export const cardEnv = (): CardEnv => env;

const noSubagents: readonly SubagentProgress[] = [];
export const useLiveSubagents = (): readonly SubagentProgress[] => (env.useSubagents ? env.useSubagents() : noSubagents);
