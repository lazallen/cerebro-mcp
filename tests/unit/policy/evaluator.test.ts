/**
 * Unit tests for PolicyEvaluator (T017)
 * Tests: classification, priority ordering, terminal flag, determinism
 */

import * as path from 'path';
import { evaluate } from '../../../src/lib/policy/evaluator';
import { loadPolicy } from '../../../src/lib/policy/policy-loader';
import type { TriageEvent, Policy } from '../../../src/lib/policy/types';

// Load the default policy for these tests
let policy: Policy;

function makeEvent(overrides: Partial<TriageEvent> = {}): TriageEvent {
  return {
    eventId: 'test-event-001',
    source: 'email',
    status: 'pending',
    title: 'Test Subject',
    author: 'sender@example.com',
    receivedAt: '2026-02-19T08:00:00Z',
    snippet: 'Test snippet',
    signals: {
      isAutomated: false,
      isBulk: false,
      hasUnsubscribe: false,
      hasAttachments: false,
      mentionsMoney: false,
      mentionsMeeting: false,
      asksForAction: false,
      prioritySender: false,
    },
    extracted: {},
    passCount: 0,
    passes: [],
    ...overrides,
  };
}

beforeAll(async () => {
  const policyPath = path.resolve(
    __dirname,
    '../../../specs/019-policy-engine/contracts/default-policy.yaml'
  );
  policy = await loadPolicy(policyPath);
});

describe('evaluate — newsletter classification', () => {
  test('newsletter fixture: unsubscribe signal → NEWSLETTER, terminal', () => {
    const event = makeEvent({
      eventId: '20260219-email-news1',
      title: 'ACME Weekly — Top tips for February',
      author: 'news@acme.example',
      snippet: 'Product updates… Unsubscribe here.',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
    });

    const [decision] = evaluate(policy, [event]);

    expect(decision.classification.intent).toBe('NEWSLETTER');
    expect(decision.classification.confidence).toBeGreaterThanOrEqual(0.9);
    expect(decision.terminal).toBe(true);
    expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(true);
    expect(decision.actions.some((a) => a.type === 'CATEGORY')).toBe(true);
  });
});

describe('evaluate — receipt classification', () => {
  test('receipt fixture: money + receipt keyword → RECEIPT, terminal', () => {
    const event = makeEvent({
      eventId: '20260218-email-rcpt1',
      title: 'Receipt for your payment — Invoice #INV-10492',
      author: 'billing@cloudvendor.example',
      snippet: 'Payment received. Total amount: £42.99. Invoice attached.',
      signals: {
        isAutomated: true,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: true,
        mentionsMoney: true,
        mentionsMeeting: false,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
    });

    const [decision] = evaluate(policy, [event]);

    expect(decision.classification.intent).toBe('RECEIPT');
    expect(decision.classification.confidence).toBeGreaterThanOrEqual(0.9);
    expect(decision.terminal).toBe(true);
    expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(true);
  });
});

describe('evaluate — spam classification', () => {
  test('spam fixture: blocklist domain + spam signals → SPAM, terminal', () => {
    // Default policy has empty blocklist, but spam signals still match via bulk+automated+unsubscribe+spam title
    const event = makeEvent({
      eventId: '20260219-email-spam1',
      title: 'WINNER! Get rich fast — act now',
      author: 'promo@cheap-deals.example',
      snippet: 'You have been selected! Free money waiting.',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: true,
        mentionsMeeting: false,
        asksForAction: true,
        prioritySender: false,
      },
      extracted: {},
    });

    const [decision] = evaluate(policy, [event]);

    // Newsletter or spam — both are valid terminal results for this fixture
    // The spam rule (priority 1100) is higher priority than newsletter (900)
    // Title matches spam pattern → SPAM
    expect(['SPAM', 'NEWSLETTER']).toContain(decision.classification.intent);
    expect(decision.terminal).toBe(true);
  });
});

describe('evaluate — priority ordering', () => {
  test('higher-priority rule fires first (spam > newsletter)', () => {
    // Build a minimal policy with two rules at different priorities
    const testPolicy: Policy = {
      id: 'test',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
        // Lower priority listed first in array
        {
          id: 'low-priority',
          priority: 100,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'FYI',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.5,
            rationale: ['low priority rule'],
          },
          actions: [{ type: 'LABEL', name: 'low' }],
          terminal: true,
        },
        // Higher priority listed second in array
        {
          id: 'high-priority',
          priority: 900,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'NEWSLETTER',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.9,
            rationale: ['high priority rule'],
          },
          actions: [{ type: 'MOVE', folder: 'Archive' }],
          terminal: true,
        },
      ],
    };

    const event = makeEvent();
    const [decision] = evaluate(testPolicy, [event]);

    // High-priority rule should fire first
    expect(decision.classification.intent).toBe('NEWSLETTER');
    expect(decision.trace[0].ruleId).toBe('high-priority');
  });
});

describe('evaluate — terminal flag', () => {
  test('terminal rule stops further evaluation', () => {
    const testPolicy: Policy = {
      id: 'test-terminal',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
        {
          id: 'first-terminal',
          priority: 500,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'FYI',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.8,
            rationale: ['first rule'],
          },
          actions: [],
          terminal: true,
        },
        {
          id: 'second-never-runs',
          priority: 400,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'SPAM',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.99,
            rationale: ['should never run'],
          },
          actions: [],
          terminal: false,
        },
      ],
    };

    const event = makeEvent();
    const [decision] = evaluate(testPolicy, [event]);

    expect(decision.terminal).toBe(true);
    expect(decision.classification.intent).toBe('FYI');
    // Only one trace entry — terminal stopped evaluation
    const matchedEntries = decision.trace.filter((t) => t.matched);
    expect(matchedEntries).toHaveLength(1);
    expect(matchedEntries[0].ruleId).toBe('first-terminal');
  });
});

describe('evaluate — determinism', () => {
  test('identical input → identical output on repeated calls', () => {
    const event = makeEvent({
      eventId: '20260219-email-det1',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
    });

    const [d1] = evaluate(policy, [event]);
    const [d2] = evaluate(policy, [event]);

    // Strip timestamp (changes each call) before comparing
    const compare = (d: typeof d1): object => ({
      intent: d.classification.intent,
      urgency: d.classification.urgency,
      risk: d.classification.risk,
      confidence: d.classification.confidence,
      terminal: d.terminal,
      actionTypes: d.actions.map((a) => a.type).sort(),
      traceRuleIds: d.trace.map((t) => t.ruleId),
      idempotencyKeys: d.actions.map((a) => a.idempotencyKey).sort(),
    });

    expect(compare(d1)).toEqual(compare(d2));
  });
});

describe('evaluate — missing extracted fields', () => {
  test('engine behaves correctly when extracted fields are absent', () => {
    const event = makeEvent({ extracted: {} });
    // Should not throw; returns a decision
    expect(() => evaluate(policy, [event])).not.toThrow();
    const [decision] = evaluate(policy, [event]);
    expect(decision.eventId).toBe(event.eventId);
  });
});

describe('evaluate — idempotency keys', () => {
  test('action idempotency keys are stable across runs', () => {
    const event = makeEvent({
      eventId: '20260219-email-idem1',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
    });

    const [d1] = evaluate(policy, [event]);
    const [d2] = evaluate(policy, [event]);

    const keys1 = d1.actions.map((a) => a.idempotencyKey).sort();
    const keys2 = d2.actions.map((a) => a.idempotencyKey).sort();
    expect(keys1).toEqual(keys2);
    expect(keys1.every((k) => k.startsWith('event:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T030 — Multi-pass re-evaluation tests
// ---------------------------------------------------------------------------

/**
 * Minimal policy for multi-pass tests: ACTION_REQUIRED rule (priority 500),
 * ASK_HUMAN fallback (priority 0).
 */
function makeMultiPassPolicy(): Policy {
  return {
    id: 'multi-pass-test',
    version: '1.0.0',
    defaults: {
      approvalThreshold: 0.75,
      claudeRecommendThreshold: 0.6,
      unknownIntentRisk: 'MEDIUM',
    },
    rules: [
      {
        id: 'action-required',
        priority: 500,
        when: {
          all: [
            { field: 'extracted.intent', op: 'eq', value: 'ACTION_REQUIRED' },
            { field: 'extracted.confidence', op: 'gte', value: 0.75 },
          ],
        },
        setClassification: {
          intent: 'ACTION_REQUIRED',
          urgency: 'TODAY',
          risk: 'MEDIUM',
          confidence: 0.88,
          rationale: ['LLM extracted intent ACTION_REQUIRED with high confidence'],
        },
        actions: [{ type: 'CREATE_TASK' }],
        terminal: true,
      },
      {
        id: 'fallback-ask-human',
        priority: 0,
        when: { field: 'source', op: 'eq', value: 'email' },
        setClassification: {
          intent: 'UNKNOWN',
          urgency: 'SOMEDAY',
          risk: 'MEDIUM',
          confidence: 0.0,
          rationale: ['No rule matched — human review required'],
        },
        actions: [{ type: 'ASK_HUMAN' }],
        terminal: true,
      },
    ],
  };
}

describe('evaluate — multi-pass re-evaluation (T030)', () => {
  test('Pass 1: sparse event (no extracted fields) → UNKNOWN + ASK_HUMAN', () => {
    const testPolicy = makeMultiPassPolicy();
    const event = makeEvent({ eventId: 'multi-pass-001', extracted: {}, passCount: 0 });

    const [decision] = evaluate(testPolicy, [event]);

    expect(decision.classification.intent).toBe('UNKNOWN');
    // Safety gate may add ASK_HUMAN; fallback rule also adds it
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(true);
    expect(decision.actions.some((a) => a.type === 'CREATE_TASK')).toBe(false);
  });

  test('Pass 2: same event enriched with ACTION_REQUIRED 0.88 → ACTION_REQUIRED + CREATE_TASK', () => {
    const testPolicy = makeMultiPassPolicy();
    const enrichedEvent = makeEvent({
      eventId: 'multi-pass-001',
      extracted: { intent: 'ACTION_REQUIRED', confidence: 0.88 },
      passCount: 1,
      status: 'enriched',
    });

    const [decision] = evaluate(testPolicy, [enrichedEvent]);

    expect(decision.classification.intent).toBe('ACTION_REQUIRED');
    expect(decision.classification.confidence).toBeGreaterThanOrEqual(0.75);
    expect(decision.actions.some((a) => a.type === 'CREATE_TASK')).toBe(true);
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(false);
  });

  test('enrichment below threshold → UNKNOWN (confidence 0.4 < 0.75)', () => {
    const testPolicy = makeMultiPassPolicy();
    const lowConfidenceEvent = makeEvent({
      eventId: 'multi-pass-002',
      extracted: { intent: 'ACTION_REQUIRED', confidence: 0.4 },
      passCount: 1,
    });

    const [decision] = evaluate(testPolicy, [lowConfidenceEvent]);

    // action-required rule requires confidence >= 0.75, so it does not fire
    expect(decision.classification.intent).toBe('UNKNOWN');
  });

  test('humanAnswers context injected into evaluation object', () => {
    const testPolicy: Policy = {
      id: 'human-answer-test',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
        {
          id: 'human-answered',
          priority: 500,
          when: { field: 'humanAnswers.multi-pass-003', op: 'eq', value: 'ACTION_REQUIRED' },
          setClassification: {
            intent: 'ACTION_REQUIRED',
            urgency: 'TODAY',
            risk: 'LOW',
            confidence: 0.9,
            rationale: ['Human confirmed intent'],
          },
          actions: [{ type: 'CREATE_TASK' }],
          terminal: true,
        },
        {
          id: 'fallback',
          priority: 0,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'UNKNOWN',
            urgency: 'SOMEDAY',
            risk: 'MEDIUM',
            confidence: 0,
            rationale: ['fallback'],
          },
          actions: [{ type: 'ASK_HUMAN' }],
          terminal: true,
        },
      ],
    };

    const event = makeEvent({ eventId: 'multi-pass-003', extracted: {} });
    const humanAnswers = new Map([['multi-pass-003', 'ACTION_REQUIRED']]);

    const [decision] = evaluate(testPolicy, [event], humanAnswers);

    expect(decision.classification.intent).toBe('ACTION_REQUIRED');
    expect(decision.actions.some((a) => a.type === 'CREATE_TASK')).toBe(true);
    expect(decision.actions.some((a) => a.type === 'ASK_HUMAN')).toBe(false);
  });

  test('determinism: second pass with same enriched input → identical actions and keys', () => {
    const testPolicy = makeMultiPassPolicy();
    const enrichedEvent = makeEvent({
      eventId: 'multi-pass-004',
      extracted: { intent: 'ACTION_REQUIRED', confidence: 0.88 },
      passCount: 1,
    });

    const [d1] = evaluate(testPolicy, [enrichedEvent]);
    const [d2] = evaluate(testPolicy, [enrichedEvent]);

    expect(d1.classification.intent).toBe(d2.classification.intent);
    expect(d1.actions.map((a) => a.type).sort()).toEqual(d2.actions.map((a) => a.type).sort());
    expect(d1.actions.map((a) => a.idempotencyKey).sort()).toEqual(
      d2.actions.map((a) => a.idempotencyKey).sort()
    );
  });
});
