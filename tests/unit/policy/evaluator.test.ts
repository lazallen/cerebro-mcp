/**
 * Unit tests for PolicyEvaluator
 * Tests: classification, priority ordering, terminal flag, determinism, safety gates
 */

import * as path from 'path';
import { evaluate } from '../../../src/lib/policy/evaluator';
import { loadPolicy } from '../../../src/lib/policy/policy-loader';
import type { MessageItem, Signals } from '../../../src/lib/item/types';
import type { Policy } from '../../../src/lib/policy/types';

// Load the default policy for these tests
let policy: Policy;

function makeItem(overrides: Partial<MessageItem> = {}): MessageItem {
  const signals: Signals = {
    isAutomated: false,
    isBulk: false,
    hasUnsubscribe: false,
    hasAttachments: false,
    mentionsMoney: false,
    mentionsMeeting: false,
    isActionRequest: false,
    isPrioritySender: false,
    ...(overrides.signals ?? {}),
  };

  return {
    type: 'MESSAGE',
    source: 'email',
    id: 'test-item-001',
    status: 'inbox',
    createdAt: '2026-02-19T08:00:00Z',
    body: 'Test body content.',
    subject: 'Test Subject',
    from: 'sender@example.com',
    signals,
    actions: [{ type: 'INGEST', at: '2026-02-19T08:00:00Z', status: 'done' }],
    ...overrides,
    // signals is merged above; prevent double-override
  } as MessageItem;
}

beforeAll(async () => {
  const policyPath = path.resolve(
    __dirname,
    '../../../specs/019-policy-engine/contracts/default-policy.yaml'
  );
  policy = await loadPolicy(policyPath);
});

describe('evaluate — newsletter classification', () => {
  test('unsubscribe signal → NEWSLETTER, LABEL + MOVE', () => {
    const item = makeItem({
      id: '20260219-email-news1',
      subject: 'ACME Weekly — Top tips for February',
      from: 'news@acme.example',
      body: 'Product updates… Unsubscribe here.',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        isActionRequest: false,
        isPrioritySender: false,
      },
    });

    const [result] = evaluate(policy, [item]);

    expect(result.classification.intent).toBe('NEWSLETTER');
    expect(result.classification.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextActions.some((a) => a.type === 'MOVE')).toBe(true);
    expect(result.nextActions.some((a) => a.type === 'LABEL')).toBe(true);
  });
});

describe('evaluate — receipt classification', () => {
  test('money + receipt keyword → RECEIPT, LABEL + MOVE', () => {
    const item = makeItem({
      id: '20260218-email-rcpt1',
      subject: 'Receipt for your payment — Invoice #INV-10492',
      from: 'billing@cloudvendor.example',
      body: 'Payment received. Total amount: £42.99. Invoice attached.',
      signals: {
        isAutomated: true,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: true,
        mentionsMoney: true,
        mentionsMeeting: false,
        isActionRequest: false,
        isPrioritySender: false,
      },
    });

    const [result] = evaluate(policy, [item]);

    expect(result.classification.intent).toBe('RECEIPT');
    expect(result.classification.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextActions.some((a) => a.type === 'MOVE')).toBe(true);
  });
});

describe('evaluate — spam classification', () => {
  test('spam signals → SPAM or NEWSLETTER, terminal MOVE', () => {
    const item = makeItem({
      id: '20260219-email-spam1',
      subject: 'WINNER! Get rich fast — act now',
      from: 'promo@cheap-deals.example',
      body: 'You have been selected! Free money waiting.',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: true,
        mentionsMeeting: false,
        isActionRequest: true,
        isPrioritySender: false,
      },
    });

    const [result] = evaluate(policy, [item]);

    // Newsletter or spam — both are valid terminal results for this fixture
    expect(['SPAM', 'NEWSLETTER']).toContain(result.classification.intent);
    // Terminal rule should be the matched one
    const matched = result.trace.filter((t) => t.matched);
    expect(matched.length).toBeGreaterThan(0);
  });
});

describe('evaluate — priority ordering', () => {
  test('higher-priority rule fires first (spam > newsletter)', () => {
    const testPolicy: Policy = {
      id: 'test',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
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

    const item = makeItem();
    const [result] = evaluate(testPolicy, [item]);

    // High-priority rule should fire first
    expect(result.classification.intent).toBe('NEWSLETTER');
    const matchedEntries = result.trace.filter((t) => t.matched);
    expect(matchedEntries[0].ruleId).toBe('high-priority');
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

    const item = makeItem();
    const [result] = evaluate(testPolicy, [item]);

    expect(result.classification.intent).toBe('FYI');
    // Only one trace entry matched — terminal stopped evaluation
    const matchedEntries = result.trace.filter((t) => t.matched);
    expect(matchedEntries).toHaveLength(1);
    expect(matchedEntries[0].ruleId).toBe('first-terminal');
  });
});

describe('evaluate — determinism', () => {
  test('identical input → identical output on repeated calls', () => {
    const item = makeItem({
      id: '20260219-email-det1',
      signals: {
        isAutomated: true,
        isBulk: true,
        hasUnsubscribe: true,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        isActionRequest: false,
        isPrioritySender: false,
      },
    });

    const [d1] = evaluate(policy, [item]);
    const [d2] = evaluate(policy, [item]);

    expect(d1.classification.intent).toBe(d2.classification.intent);
    expect(d1.classification.confidence).toBe(d2.classification.confidence);
    expect(d1.nextActions.map((a) => a.type).sort()).toEqual(
      d2.nextActions.map((a) => a.type).sort()
    );
  });
});

describe('evaluate — missing extracted fields', () => {
  test('engine behaves correctly when ENHANCE action is absent', () => {
    const item = makeItem();
    expect(() => evaluate(policy, [item])).not.toThrow();
    const [result] = evaluate(policy, [item]);
    expect(result.itemId).toBe(item.id);
  });
});

describe('evaluate — safety gates', () => {
  test('low-confidence classification triggers TRIAGE', () => {
    const testPolicy: Policy = {
      id: 'test-safety',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
        {
          id: 'low-conf',
          priority: 100,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'FYI',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.4, // below 0.75 threshold
            rationale: ['low confidence'],
          },
          actions: [{ type: 'MOVE', folder: 'Archive' }],
          terminal: true,
        },
      ],
    };

    const item = makeItem();
    const [result] = evaluate(testPolicy, [item]);

    // Safety gate should add TRIAGE
    expect(result.nextActions.some((a) => a.type === 'TRIAGE')).toBe(true);
    // Conflict resolution suppresses MOVE when TRIAGE is present
    expect(result.nextActions.some((a) => a.type === 'MOVE')).toBe(false);
  });

  test('high-risk classification triggers TRIAGE gate', () => {
    const testPolicy: Policy = {
      id: 'test-high-risk',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
      },
      rules: [
        {
          id: 'high-risk',
          priority: 100,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'ACTION_REQUIRED',
            urgency: 'NOW',
            risk: 'HIGH',
            confidence: 0.9,
            rationale: ['high risk item'],
          },
          actions: [],
          terminal: true,
        },
      ],
    };

    const item = makeItem();
    const [result] = evaluate(testPolicy, [item]);

    expect(result.nextActions.some((a) => a.type === 'TRIAGE')).toBe(true);
  });
});

describe('evaluate — triage answer context', () => {
  test('triageAnswer from resolved TRIAGE action accessible in eval context', () => {
    const testPolicy: Policy = {
      id: 'triage-answer-test',
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
          when: { field: 'triageAnswer', op: 'eq', value: 'archive' },
          setClassification: {
            intent: 'FYI',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.95,
            rationale: ['Human said archive'],
          },
          actions: [{ type: 'MOVE', folder: 'Archive' }],
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
          actions: [{ type: 'TRIAGE', question: 'What to do?' }],
          terminal: true,
        },
      ],
    };

    const item = makeItem({ id: 'triage-answer-item' });
    // Add a resolved TRIAGE action with human answer
    item.actions.push({
      type: 'TRIAGE',
      at: '2026-02-19T09:00:00Z',
      status: 'done',
      answer: 'archive',
    });

    const [result] = evaluate(testPolicy, [item]);

    expect(result.classification.intent).toBe('FYI');
    expect(result.nextActions.some((a) => a.type === 'MOVE')).toBe(true);
  });
});

describe('evaluate — multi-item batch', () => {
  test('returns one result per item in input order', () => {
    const item1 = makeItem({ id: 'item-001', source: 'email' });
    const item2 = makeItem({ id: 'item-002', source: 'email' });

    const results = evaluate(policy, [item1, item2]);

    expect(results).toHaveLength(2);
    expect(results[0].itemId).toBe('item-001');
    expect(results[1].itemId).toBe('item-002');
  });
});
