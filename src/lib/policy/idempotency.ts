/**
 * Idempotency key generator for policy actions.
 * Keys are stable — identical for identical inputs on every call.
 */

import type { RuleAction, ActionType } from './types';

/**
 * Generate a stable idempotency key for an action.
 * Format: event:<eventId>:action:<type>:policy:<policyId>@<version>:v1
 */
export function generateIdempotencyKey(
  eventId: string,
  actionType: ActionType,
  policyId: string,
  policyVersion: string
): string {
  return `event:${eventId}:action:${actionType}:policy:${policyId}@${policyVersion}:v1`;
}

/**
 * Enrich a rule action with its idempotency key.
 * Returns the action with idempotencyKey and requiresApproval set.
 */
export function resolveAction(
  action: RuleAction,
  eventId: string,
  policyId: string,
  policyVersion: string
): RuleAction & { idempotencyKey: string; requiresApproval: boolean } {
  const idempotencyKey = generateIdempotencyKey(eventId, action.type, policyId, policyVersion);

  // DRAFT_REPLY always requires approval — cannot be overridden by config
  const requiresApproval =
    action.type === 'DRAFT_REPLY' ? true : (action.requiresApproval ?? false);

  return {
    ...action,
    idempotencyKey,
    requiresApproval,
  };
}
