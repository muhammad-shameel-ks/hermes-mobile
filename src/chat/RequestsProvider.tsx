/**
 * Feeds the open chat's requests to its transcript cards and mounts the prompt
 * sheet, so a chat screen needs this one wrapper and nothing else.
 */

import { useMemo, type ReactNode } from 'react';

import { outcome } from '../ui/haptics.ts';
import type { ChatController, ChatEntry } from './controller.ts';
import { PromptSheet } from './PromptSheet.tsx';
import { RequestsContext, type RequestActions } from './RequestsContext.tsx';
import { approvalActivity } from './requests.ts';

export function RequestsProvider({ controller, entry, children }: { controller: ChatController; entry: ChatEntry; children: ReactNode }) {
  const { key } = entry;
  const router = controller.serverRequests;

  const actions = useMemo<RequestActions>(
    () => ({
      answerApproval: async (requestId, choice) => {
        const answered = await router.answerApproval(key, requestId, choice);
        if (answered) outcome(choice === 'deny' ? 'cancel' : 'submit');
        return answered;
      },
      skipClarify: () => router.skipClarify(key),
      confirmClarify: async (answers) => {
        const sent = await router.confirmClarify(key, answers);
        if (sent) outcome('submit');
        return sent;
      },
      answerPrompt: (prompt, value) => {
        const error = router.answerPrompt(key, prompt, value);
        if (!error) outcome(value === '' ? 'cancel' : 'submit');
        return error;
      },
      redeliver: () => router.redeliver(key),
    }),
    [router, key],
  );

  const { messages } = entry.transcript;
  const activity = useMemo(() => approvalActivity(messages), [messages]);
  const value = useMemo(() => ({ requests: entry.requests, actions, activity }), [entry.requests, actions, activity]);

  return (
    <RequestsContext.Provider value={value}>
      {children}
      <PromptSheet />
    </RequestsContext.Provider>
  );
}
