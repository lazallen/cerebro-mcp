/**
 * Unit tests for conflict resolver (T023)
 */

import { resolveConflicts } from '../../../src/lib/policy/conflict-resolver';
import type { PolicyDecision, Policy, ResolvedAction } from '../../../src/lib/policy/types';

function makePolicy(askHumanBlocksMove = true): Policy {
  return {
    id: 'test',
    version: '1.0.0',
    defaults: {
      approvalThreshold: 0.75,
      claudeRecommendThreshold: 0.6,
      unknownIntentRisk: 'MEDIUM',
      conflictResolution: { askHumanBlocksMoveToArchive: askHumanBlocksMove },
    },
    rules: [],
  };
}

function makeDecision(actions: ResolvedAction[]): PolicyDecision {
  return {
    eventId: 'test-001',
    policyId: 'test',
    policyVersion: '1.0.0',
    timestamp: '2026-02-19T08:00:00Z',
    classification: {
      intent: 'UNKNOWN',
      urgency: 'SOMEDAY',
      risk: 'MEDIUM',
      confidence: 0.5,
      rationale: [],
    },
    actions,
    trace: [],
    terminal: false,
  };
}

function action(type: ResolvedAction['type']): ResolvedAction {
  return {
    type,
    idempotencyKey: `k-${type}`,
    requiresApproval: false,
  };
}

describe('resolveConflicts — ASK_HUMAN blocks MOVE', () => {
  test('ASK_HUMAN + MOVE → MOVE suppressed', () => {
    const decision = makeDecision([action('ASK_HUMAN'), action('MOVE')]);
    resolveConflicts(decision, makePolicy(true));

    expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(false);
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(true);

    const resolverEntry = decision.trace.find((t) => t.ruleId === '_conflict_resolver');
    expect(resolverEntry).toBeTruthy();
    expect(
      resolverEntry?.gateOutcomes?.some(
        (g) => g.gate === 'ask_human_blocks_move' && g.actionSuppressed === 'MOVE'
      )
    ).toBe(true);
  });

  test('ASK_HUMAN alone → no suppression', () => {
    const decision = makeDecision([action('ASK_HUMAN'), action('LABEL')]);
    resolveConflicts(decision, makePolicy(true));

    expect(decision.actions).toHaveLength(2);
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(true);
    expect(decision.actions.some((a) => a.type === 'LABEL')).toBe(true);
  });

  test('no ASK_HUMAN + MOVE → MOVE preserved', () => {
    const decision = makeDecision([action('MOVE'), action('CATEGORY')]);
    resolveConflicts(decision, makePolicy(true));

    expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(true);
    expect(decision.trace.find((t) => t.ruleId === '_conflict_resolver')).toBeUndefined();
  });

  test('conflict resolution disabled → MOVE preserved even with ASK_HUMAN', () => {
    const decision = makeDecision([action('ASK_HUMAN'), action('MOVE')]);
    resolveConflicts(decision, makePolicy(false));

    expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(true);
  });

  test('gate outcome includes actionSuppressed field', () => {
    const decision = makeDecision([action('ASK_HUMAN'), action('MOVE'), action('LABEL')]);
    resolveConflicts(decision, makePolicy(true));

    const resolverEntry = decision.trace.find((t) => t.ruleId === '_conflict_resolver');
    const moveGate = resolverEntry?.gateOutcomes?.find((g) => g.gate === 'ask_human_blocks_move');
    expect(moveGate?.actionSuppressed).toBe('MOVE');
  });
});
