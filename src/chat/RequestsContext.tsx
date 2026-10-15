/**
 * What the cards in a chat's transcript and its prompt sheet read: the open
 * chat's pending requests and the actions that answer them. Provided by
 * RequestsProvider.
 */

import { createContext, useContext } from 'react';

import { emptyRequests, type ApprovalChoice, type PromptRequest, type Requests } from './requests.ts';
import type { ToolPart } from './transcript.ts';

export type RequestActions = {
  /** true once the backend has the decision */
  answerApproval: (requestId: string | undefined, choice: ApprovalChoice) => Promise<boolean>;
  skipClarify: () => void;
  confirmClarify: (answers: ReadonlyArray<{ qid: string; answer: string | null }>) => Promise<boolean>;
  /** an error to show in the sheet, or null once the answer is on its way */
  answerPrompt: (prompt: PromptRequest, value: string) => string | null;
  /** ask the server to re-deliver open requests; true when a clarify is parked afterwards */
  redeliver: () => Promise<boolean>;
};

export type RequestsValue = {
  requests: Requests;
  actions: RequestActions;
  /** the current turn's terminal and code calls: what the approval stack summarises above its card */
  activity: ToolPart[];
};

const IDLE: RequestsValue = {
  requests: emptyRequests(),
  activity: [],
  actions: {
    answerApproval: async () => true,
    skipClarify: () => undefined,
    confirmClarify: async () => false,
    answerPrompt: () => null,
    redeliver: async () => false,
  },
};

export const RequestsContext = createContext<RequestsValue>(IDLE);

export const useRequests = () => useContext(RequestsContext);
