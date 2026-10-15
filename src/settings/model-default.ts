/**
 * Setting the profile's default model from Settings (desktop
 * store/model-assignment.ts `setMainModelAssignment` and api/models.ts): one
 * `POST /api/model/set` with scope `main`. A guarded model (expensive or
 * data-training tiers) comes back as a question; the caller asks, then retries
 * with `confirm_expensive_model`.
 */

import type { ModelSelection } from '../chat/models.ts';

export type ModelAssignmentRequest = {
  scope: 'main';
  provider: string;
  model: string;
  confirm_expensive_model?: true;
};

export type ModelAssignmentResponse = {
  ok: boolean;
  provider?: string;
  model?: string;
  confirm_required?: boolean;
  confirm_message?: string;
};

export type AssignmentOutcome =
  | { kind: 'saved' }
  | { kind: 'confirm'; message: string }
  | { kind: 'failed'; message: string };

/** desktop `modelAssignment` copy */
export const MODEL_ASSIGNMENT_COPY = {
  saveFailed: 'Hermes did not save that model change.',
  confirmTitle: 'Model Selection Warning',
  confirmDetail: 'Confirm only if you accept this trade-off.',
  confirmAction: 'Confirm',
  declined: 'Model change cancelled — you declined the data-training tier warning.',
} as const;

export function assignmentRequest(selection: Pick<ModelSelection, 'model' | 'provider'>, confirm = false): ModelAssignmentRequest {
  return { scope: 'main', provider: selection.provider, model: selection.model, ...(confirm ? { confirm_expensive_model: true as const } : {}) };
}

/** `acknowledged` is true on the retry that already carried the confirmation. */
export function interpretAssignment(result: ModelAssignmentResponse, acknowledged: boolean): AssignmentOutcome {
  const message = result.confirm_message?.trim() ?? '';
  if (result.confirm_required) {
    return acknowledged ? { kind: 'failed', message: message || MODEL_ASSIGNMENT_COPY.saveFailed } : { kind: 'confirm', message };
  }
  return result.ok === true ? { kind: 'saved' } : { kind: 'failed', message: message || MODEL_ASSIGNMENT_COPY.saveFailed };
}
