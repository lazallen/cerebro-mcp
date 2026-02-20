/**
 * Action conflict resolver.
 * Runs after safety gates to suppress actions that conflict with ASK_HUMAN.
 */

import type { PolicyDecision, Policy, GateOutcome, RuleTraceEntry, ActionType } from './types';

const ARCHIVE_SUPPRESSED_TYPES: ActionType[] = ['MOVE'];

/**
 * Resolve action conflicts in a PolicyDecision.
 * Primary rule: if ASK_HUMAN is present and askHumanBlocksMoveToArchive is true,
 * suppress all MOVE actions.
 * Records all suppressions as GateOutcome entries in the trace.
 */
export function resolveConflicts(decision: PolicyDecision, policy: Policy): PolicyDecision {
  const hasAskHuman = decision.actions.some((a) => a.type === 'ASK_HUMAN');
  const blockMove = policy.defaults.conflictResolution?.askHumanBlocksMoveToArchive !== false;

  if (!hasAskHuman || !blockMove) {
    return decision;
  }

  const suppressedGates: GateOutcome[] = [];
  const retained: typeof decision.actions = [];

  for (const action of decision.actions) {
    if (ARCHIVE_SUPPRESSED_TYPES.includes(action.type)) {
      suppressedGates.push({
        gate: 'ask_human_blocks_move',
        applied: true,
        reason: 'ASK_HUMAN present — MOVE suppressed until human flag is resolved',
        actionSuppressed: action.type,
      });
    } else {
      retained.push(action);
    }
  }

  decision.actions = retained;

  if (suppressedGates.length > 0) {
    const entry: RuleTraceEntry = {
      ruleId: '_conflict_resolver',
      priority: -2,
      matched: true,
      predicateResult: {
        matched: true,
        reason: `${suppressedGates.length} action(s) suppressed by conflict resolver`,
      },
      terminal: false,
      gateOutcomes: suppressedGates,
    };
    decision.trace.push(entry);
  }

  return decision;
}
