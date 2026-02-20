/**
 * Unit tests for Predicate DSL interpreter (T018)
 */

import { evaluatePredicate } from '../../../src/lib/policy/predicate';
import type { Predicate } from '../../../src/lib/policy/types';

describe('evaluatePredicate', () => {
  const obj: Record<string, unknown> = {
    source: 'email',
    title: 'Hello World',
    snippet: 'Please confirm your order receipt total $99',
    author: 'news@acme.example',
    extracted: {
      intent: 'NEWSLETTER',
      confidence: 0.92,
    },
    signals: {
      isAutomated: true,
      isBulk: false,
      hasUnsubscribe: true,
      prioritySender: false,
      mentionsMoney: true,
    },
    from: { email: 'user@spammydomain.com' },
  };

  // ---------------------------------------------------------------------------
  // Leaf operators
  // ---------------------------------------------------------------------------

  test('eq: matches equal value', () => {
    const result = evaluatePredicate({ field: 'source', op: 'eq', value: 'email' }, obj);
    expect(result.matched).toBe(true);
  });

  test('eq: does not match different value', () => {
    const result = evaluatePredicate({ field: 'source', op: 'eq', value: 'slack' }, obj);
    expect(result.matched).toBe(false);
  });

  test('neq: matches when values differ', () => {
    const result = evaluatePredicate({ field: 'source', op: 'neq', value: 'calendar' }, obj);
    expect(result.matched).toBe(true);
  });

  test('neq: does not match equal value', () => {
    const result = evaluatePredicate({ field: 'source', op: 'neq', value: 'email' }, obj);
    expect(result.matched).toBe(false);
  });

  test('contains: matches substring (case-insensitive)', () => {
    const result = evaluatePredicate({ field: 'snippet', op: 'contains', value: 'RECEIPT' }, obj);
    expect(result.matched).toBe(true);
  });

  test('contains: does not match absent substring', () => {
    const result = evaluatePredicate({ field: 'snippet', op: 'contains', value: 'invoice' }, obj);
    expect(result.matched).toBe(false);
  });

  test('matches: regex match', () => {
    const result = evaluatePredicate(
      { field: 'snippet', op: 'matches', value: '(?i)receipt|invoice' },
      obj
    );
    expect(result.matched).toBe(true);
  });

  test('matches: regex no match', () => {
    const result = evaluatePredicate({ field: 'title', op: 'matches', value: '^receipt' }, obj);
    expect(result.matched).toBe(false);
  });

  test('in: value is in array', () => {
    const result = evaluatePredicate({ field: 'source', op: 'in', value: ['email', 'slack'] }, obj);
    expect(result.matched).toBe(true);
  });

  test('in: value is not in array', () => {
    const result = evaluatePredicate(
      { field: 'source', op: 'in', value: ['calendar', 'journal'] },
      obj
    );
    expect(result.matched).toBe(false);
  });

  test('domain_in: email domain matches', () => {
    const result = evaluatePredicate(
      { field: 'from.email', op: 'domain_in', value: ['spammydomain.com'] },
      obj
    );
    expect(result.matched).toBe(true);
  });

  test('domain_in: email domain does not match', () => {
    const result = evaluatePredicate(
      { field: 'from.email', op: 'domain_in', value: ['trusted.com'] },
      obj
    );
    expect(result.matched).toBe(false);
  });

  test('gte: value >= threshold', () => {
    const result = evaluatePredicate({ field: 'extracted.confidence', op: 'gte', value: 0.9 }, obj);
    expect(result.matched).toBe(true);
  });

  test('gte: value < threshold', () => {
    const result = evaluatePredicate(
      { field: 'extracted.confidence', op: 'gte', value: 0.95 },
      obj
    );
    expect(result.matched).toBe(false);
  });

  test('lte: value <= threshold', () => {
    const result = evaluatePredicate(
      { field: 'extracted.confidence', op: 'lte', value: 0.95 },
      obj
    );
    expect(result.matched).toBe(true);
  });

  test('lte: value > threshold', () => {
    const result = evaluatePredicate({ field: 'extracted.confidence', op: 'lte', value: 0.5 }, obj);
    expect(result.matched).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Missing paths → false, no throw
  // ---------------------------------------------------------------------------

  test('missing path → false (no throw)', () => {
    const result = evaluatePredicate({ field: 'nonexistent.deep.path', op: 'eq', value: 'x' }, obj);
    expect(result.matched).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  test('missing intermediate node → false', () => {
    const result = evaluatePredicate(
      { field: 'extracted.nonexistent', op: 'eq', value: true },
      obj
    );
    expect(result.matched).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Boolean compositions
  // ---------------------------------------------------------------------------

  test('all: all children true → true', () => {
    const p: Predicate = {
      all: [
        { field: 'signals.isAutomated', op: 'eq', value: true },
        { field: 'signals.hasUnsubscribe', op: 'eq', value: true },
      ],
    };
    expect(evaluatePredicate(p, obj).matched).toBe(true);
  });

  test('all: short-circuits on first false', () => {
    const p: Predicate = {
      all: [
        { field: 'signals.isBulk', op: 'eq', value: true }, // false
        { field: 'signals.isAutomated', op: 'eq', value: true }, // would be true
      ],
    };
    const result = evaluatePredicate(p, obj);
    expect(result.matched).toBe(false);
    // Short-circuit: second child not included after first fails
    expect(result.children?.length).toBe(1);
  });

  test('any: first true → true (short-circuit)', () => {
    const p: Predicate = {
      any: [
        { field: 'signals.hasUnsubscribe', op: 'eq', value: true }, // true
        { field: 'signals.isBulk', op: 'eq', value: true }, // false (but not reached)
      ],
    };
    const result = evaluatePredicate(p, obj);
    expect(result.matched).toBe(true);
    expect(result.children?.length).toBe(1);
  });

  test('any: all false → false', () => {
    const p: Predicate = {
      any: [
        { field: 'signals.isBulk', op: 'eq', value: true },
        { field: 'signals.prioritySender', op: 'eq', value: true },
      ],
    };
    expect(evaluatePredicate(p, obj).matched).toBe(false);
  });

  test('not: negates true → false', () => {
    const p: Predicate = {
      not: { field: 'signals.isAutomated', op: 'eq', value: true },
    };
    expect(evaluatePredicate(p, obj).matched).toBe(false);
  });

  test('not: negates false → true', () => {
    const p: Predicate = {
      not: { field: 'signals.isBulk', op: 'eq', value: true },
    };
    expect(evaluatePredicate(p, obj).matched).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Nested composition
  // ---------------------------------------------------------------------------

  test('nested all/any composition', () => {
    const p: Predicate = {
      any: [
        { field: 'signals.hasUnsubscribe', op: 'eq', value: true },
        {
          all: [
            { field: 'signals.isBulk', op: 'eq', value: true },
            { field: 'signals.isAutomated', op: 'eq', value: true },
          ],
        },
      ],
    };
    expect(evaluatePredicate(p, obj).matched).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  test('domain_in: non-email field → false', () => {
    const result = evaluatePredicate(
      { field: 'title', op: 'domain_in', value: ['acme.example'] },
      obj
    );
    expect(result.matched).toBe(false);
  });

  test('matches: invalid regex → false (no throw)', () => {
    const result = evaluatePredicate({ field: 'title', op: 'matches', value: '[invalid' }, obj);
    expect(result.matched).toBe(false);
  });

  test('dot-path resolution through nested objects', () => {
    const result = evaluatePredicate(
      { field: 'extracted.intent', op: 'eq', value: 'NEWSLETTER' },
      obj
    );
    expect(result.matched).toBe(true);
  });
});
