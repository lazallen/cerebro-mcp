/**
 * Unit tests for safety gates (T022)
 */

import { applySafetyGates } from '../../../src/lib/policy/safety-gates';
import type { PolicyDecision, Policy, ResolvedAction } from '../../../src/lib/policy/types';

function makePolicy(overrides?: Partial<Policy['defaults']>): Policy {
  return {
    id: 'test',
    version: '1.0.0',
    defaults: {
      approvalThreshold: 0.75,
      claudeRecommendThreshold: 0.6,
      unknownIntentRisk: 'MEDIUM',
      conflictResolution: { askHumanBlocksMoveToArchive: true },
      ...overrides,
    },
    rules: [],
  };
}

function makeDecision(overrides?: Partial<PolicyDecision>): PolicyDecision {
  return {
    eventId: 'test-001',
    policyId: 'test',
    policyVersion: '1.0.0',
    timestamp: '2026-02-19T08:00:00Z',
    classification: {
      intent: 'FYI',
      urgency: 'SOMEDAY',
      risk: 'LOW',
      confidence: 0.9,
      rationale: ['test'],
    },
    actions: [] as ResolvedAction[],
    trace: [],
    terminal: true,
    ...overrides,
  };
}

describe('applySafetyGates — low confidence gate', () => {
  test('confidence below threshold → ASK_HUMAN appended', () => {
    const policy = makePolicy({ approvalThreshold: 0.75 });
    const decision = makeDecision({
      classification: {
        intent: 'FYI',
        urgency: 'SOMEDAY',
        risk: 'LOW',
        confidence: 0.5, // below 0.75
        rationale: [],
      },
    });

    applySafetyGates(decision, policy);

    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(true);
    const gateEntry = decision.trace.find((t) => t.ruleId === '_safety_gates');
    expect(gateEntry).toBeTruthy();
    expect(gateEntry?.gateOutcomes?.some((g) => g.gate === 'low_confidence')).toBe(true);
  });

  test('confidence at threshold → no ASK_HUMAN added', () => {
    const policy = makePolicy({ approvalThreshold: 0.75 });
    const decision = makeDecision({
      classification: {
        intent: 'FYI',
        urgency: 'SOMEDAY',
        risk: 'LOW',
        confidence: 0.75,
        rationale: [],
      },
    });

    applySafetyGates(decision, policy);
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(false);
  });

  test('ASK_HUMAN already present → not duplicated', () => {
    const policy = makePolicy({ approvalThreshold: 0.75 });
    const decision = makeDecision({
      classification: {
        intent: 'UNKNOWN',
        urgency: 'SOMEDAY',
        risk: 'MEDIUM',
        confidence: 0.3,
        rationale: [],
      },
      actions: [
        {
          type: 'ASK_HUMAN',
          question: 'Already there',
          idempotencyKey: 'existing',
          requiresApproval: false,
        },
      ] as ResolvedAction[],
    });

    applySafetyGates(decision, policy);
    const askHumans = decision.actions.filter((a) => a.type === 'ASK_HUMAN');
    // Should not add a second ASK_HUMAN
    expect(askHumans).toHaveLength(1);
  });
});

describe('applySafetyGates — high risk gate', () => {
  test('HIGH risk + no ASK_HUMAN → ASK_HUMAN added', () => {
    const policy = makePolicy();
    const decision = makeDecision({
      classification: {
        intent: 'APPROVAL_REQUEST',
        urgency: 'NOW',
        risk: 'HIGH',
        confidence: 0.85,
        rationale: [],
      },
    });

    applySafetyGates(decision, policy);

    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(true);
    const gateEntry = decision.trace.find((t) => t.ruleId === '_safety_gates');
    expect(gateEntry?.gateOutcomes?.some((g) => g.gate === 'high_risk')).toBe(true);
  });

  test('HIGH risk + ASK_HUMAN already present → no duplicate', () => {
    const policy = makePolicy();
    const decision = makeDecision({
      classification: {
        intent: 'APPROVAL_REQUEST',
        urgency: 'NOW',
        risk: 'HIGH',
        confidence: 0.85,
        rationale: [],
      },
      actions: [
        {
          type: 'ASK_HUMAN',
          question: 'Already there',
          idempotencyKey: 'existing',
          requiresApproval: false,
        },
      ] as ResolvedAction[],
    });

    applySafetyGates(decision, policy);
    const askHumans = decision.actions.filter((a) => a.type === 'ASK_HUMAN');
    expect(askHumans).toHaveLength(1);
  });
});

describe('applySafetyGates — DRAFT_REPLY approval gate', () => {
  test('DRAFT_REPLY always gets requiresApproval: true', () => {
    const policy = makePolicy();
    const decision = makeDecision({
      actions: [
        {
          type: 'DRAFT_REPLY',
          template: 'ack',
          requiresApproval: false, // should be overridden
          idempotencyKey: 'event:e1:action:DRAFT_REPLY:policy:test@1.0.0:v1',
        },
      ] as ResolvedAction[],
    });

    applySafetyGates(decision, policy);

    const draftAction = decision.actions.find((a) => a.type === 'DRAFT_REPLY');
    expect(draftAction?.requiresApproval).toBe(true);
    const gateEntry = decision.trace.find((t) => t.ruleId === '_safety_gates');
    expect(gateEntry?.gateOutcomes?.some((g) => g.gate === 'draft_reply_approval')).toBe(true);
  });

  test('DRAFT_REPLY with requiresApproval already true → gate not re-fired', () => {
    const policy = makePolicy();
    const decision = makeDecision({
      actions: [
        {
          type: 'DRAFT_REPLY',
          template: 'ack',
          requiresApproval: true, // already correct
          idempotencyKey: 'k1',
        },
      ] as ResolvedAction[],
    });

    applySafetyGates(decision, policy);

    // Gate outcome should NOT be recorded since it was already true
    const gateEntry = decision.trace.find((t) => t.ruleId === '_safety_gates');
    const draftGates = gateEntry?.gateOutcomes?.filter((g) => g.gate === 'draft_reply_approval');
    expect(draftGates?.length ?? 0).toBe(0);
  });
});
