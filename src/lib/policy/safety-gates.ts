/**
 * Safety gates — post-evaluation pass over PolicyDecision actions.
 * Applied after all rules have been evaluated; before conflict resolution.
 * All gate applications are recorded in the trace as GateOutcome entries.
 */

import type {
  PolicyDecision,
  Policy,
  ResolvedAction,
  GateOutcome,
  RuleTraceEntry,
  ActionType,
} from './types';
import { resolveAction } from './idempotency';

/**
 * Apply all safety gates to a PolicyDecision.
 * Mutates the decision in-place (adds actions and gate outcomes).
 * Returns the modified decision.
 */
export function applySafetyGates(decision: PolicyDecision, policy: Policy): PolicyDecision {
  const gates: GateOutcome[] = [];

  // Gate 1: Low-confidence gate
  // If confidence < approvalThreshold and no ASK_HUMAN already present,
  // append ASK_HUMAN unless there's an explicit override (not yet implemented — no explicit override in v1)
  const { approvalThreshold } = policy.defaults;
  const hasAskHuman = decision.actions.some((a) => a.type === 'ASK_HUMAN');

  if (decision.classification.confidence < approvalThreshold && !hasAskHuman) {
    const gate: GateOutcome = {
      gate: 'low_confidence',
      applied: true,
      reason: `Confidence ${(decision.classification.confidence * 100).toFixed(0)}% < threshold ${(approvalThreshold * 100).toFixed(0)}%`,
    };
    gates.push(gate);

    const askHumanAction = resolveAction(
      {
        type: 'ASK_HUMAN',
        question: 'Confidence is below the approval threshold. What should be done with this item?',
      },
      decision.eventId,
      policy.id,
      policy.version
    ) as ResolvedAction;
    decision.actions.push(askHumanAction);
  }

  // Gate 2: High-risk gate
  // If risk is HIGH and no ASK_HUMAN, add one
  // Exception: sender in allowlist AND a rule explicitly granted override
  // In v1: allowlist check only (no explicit rule override tracking yet)
  const isHighRisk = decision.classification.risk === 'HIGH';
  const hasAskHumanAfterGate1 = decision.actions.some((a) => a.type === 'ASK_HUMAN');

  if (isHighRisk && !hasAskHumanAfterGate1) {
    const gate: GateOutcome = {
      gate: 'high_risk',
      applied: true,
      reason: 'Event classified as HIGH risk — human review required',
    };
    gates.push(gate);

    const askHumanAction = resolveAction(
      {
        type: 'ASK_HUMAN',
        question: 'This event is classified as HIGH risk. Please review and decide.',
      },
      decision.eventId,
      policy.id,
      policy.version
    ) as ResolvedAction;
    decision.actions.push(askHumanAction);
  }

  // Gate 3: DRAFT_REPLY approval gate
  // Unconditionally set requiresApproval: true on every DRAFT_REPLY action
  for (const action of decision.actions) {
    if (action.type === 'DRAFT_REPLY') {
      const wasAlreadyRequired = action.requiresApproval === true;
      (action as { requiresApproval: boolean }).requiresApproval = true;
      if (!wasAlreadyRequired) {
        gates.push({
          gate: 'draft_reply_approval',
          applied: true,
          reason: 'DRAFT_REPLY actions always require explicit user approval',
        });
      }
    }
  }

  // Attach gate outcomes to a synthetic trace entry if any gates fired
  if (gates.length > 0) {
    const syntheticEntry: RuleTraceEntry = {
      ruleId: '_safety_gates',
      priority: -1,
      matched: true,
      predicateResult: {
        matched: true,
        reason: `${gates.length} safety gate(s) applied`,
      },
      terminal: false,
      gateOutcomes: gates,
    };
    decision.trace.push(syntheticEntry);
  }

  return decision;
}

/**
 * Check if a sender email is in the policy allowlist.
 */
export function isSenderAllowlisted(senderEmail: string, policy: Policy): boolean {
  const allowlist = policy.defaults.senderAllowlist ?? [];
  return allowlist.some((allowed) => allowed.toLowerCase() === senderEmail.toLowerCase());
}

/**
 * Get action types that need to be suppressed based on gate results.
 * Used by conflict resolver.
 */
export function getSuppressedActionTypes(decision: PolicyDecision, policy: Policy): ActionType[] {
  const suppressed: ActionType[] = [];
  const hasAskHuman = decision.actions.some((a) => a.type === 'ASK_HUMAN');

  if (hasAskHuman && policy.defaults.conflictResolution?.askHumanBlocksMoveToArchive !== false) {
    suppressed.push('MOVE');
  }

  return suppressed;
}
