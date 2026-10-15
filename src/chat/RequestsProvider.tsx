/**
 * Feeds the open chat's requests to its transcript cards and mounts the prompt
 * sheet, so a chat screen needs this one wrapper and nothing else.
 */

import { useMemo, type ReactNode } from 'react';

import { outcome } from '../ui/haptics.ts';
import { openEntry } from './chatSlices.ts';
import type { ChatController, ChatSnapshot } from './controller.ts';
import { PromptSheet } from './PromptSheet.tsx';
import { RequestsContext, type RequestActions } from './RequestsContext.tsx';
import { approvalActivity } from './requests.ts';
import { shallowEqualArray } from './selector.ts';
import { useChatSelector } from './useChatSelector.ts';

const selectKey = (snapshot: ChatSnapshot) => openEntry(snapshot).key;
const selectRequests = (snapshot: ChatSnapshot) => openEntry(snapshot).requests;
const selectActivity = (snapshot: ChatSnapshot) => approvalActivity(openEntry(snapshot).transcript.messages);

/**
 * Subscribes to the open chat's requests itself, so a token landing in its transcript does not move the
 * context value: `activity` is a fresh array per read but equal item-for-item until a terminal or code call changes.
 */
export function RequestsProvider({ controller, children }: { controller: ChatController; children: ReactNode }) {
  const key = useChatSelector(controller, selectKey);
  const requests = useChatSelector(controller, selectRequests);
  const activity = useChatSelector(controller, selectActivity, shallowEqualArray);
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

  const value = useMemo(() => ({ requests, actions, activity }), [requests, actions, activity]);

  return (
    <RequestsContext.Provider value={value}>
      {children}
      <PromptSheet />
    </RequestsContext.Provider>
  );
}
