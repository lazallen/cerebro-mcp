/**
 * Predicate DSL interpreter for the policy engine.
 * Evaluates Predicate trees against a TriageEvent using dot-path resolution.
 * Missing paths evaluate to false — never throws on absent fields.
 */

import type { Predicate, PredicateResult, LeafOp } from './types';

/**
 * Resolve a dot-path against a plain object.
 * Returns undefined for missing intermediate nodes or leaf values.
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Extract domain from an email address string.
 * Returns empty string if the value is not a valid email string.
 */
function extractDomain(value: unknown): string {
  if (typeof value !== 'string') return '';
  const atIndex = value.lastIndexOf('@');
  if (atIndex === -1) return '';
  return value.slice(atIndex + 1).toLowerCase();
}

/**
 * Evaluate a leaf predicate against a resolved field value.
 */
function evaluateLeaf(
  op: LeafOp,
  fieldValue: unknown,
  testValue: unknown
): { matched: boolean; reason: string } {
  // Missing field → false for all operators
  if (fieldValue === undefined || fieldValue === null) {
    return { matched: false, reason: 'field missing or null' };
  }

  switch (op) {
    case 'eq':
      return {
        matched: fieldValue === testValue,
        reason: `${JSON.stringify(fieldValue)} === ${JSON.stringify(testValue)}`,
      };

    case 'neq':
      return {
        matched: fieldValue !== testValue,
        reason: `${JSON.stringify(fieldValue)} !== ${JSON.stringify(testValue)}`,
      };

    case 'contains': {
      const strVal = String(fieldValue).toLowerCase();
      const testStr = String(testValue).toLowerCase();
      return {
        matched: strVal.includes(testStr),
        reason: `"${strVal}" contains "${testStr}"`,
      };
    }

    case 'matches': {
      try {
        // Support (?i) inline flag (PCRE syntax) — convert to JavaScript regex flags
        let pattern = String(testValue);
        let flags = '';
        if (pattern.startsWith('(?i)')) {
          pattern = pattern.slice(4);
          flags = 'i';
        }
        const regex = new RegExp(pattern, flags);
        const matched = regex.test(String(fieldValue));
        return {
          matched,
          reason: `"${String(fieldValue)}" ${matched ? 'matches' : 'does not match'} /${pattern}/${flags}`,
        };
      } catch {
        return { matched: false, reason: `invalid regex: ${String(testValue)}` };
      }
    }

    case 'in': {
      if (!Array.isArray(testValue)) {
        return { matched: false, reason: '"in" value must be an array' };
      }
      const matched = testValue.includes(fieldValue);
      return {
        matched,
        reason: `${JSON.stringify(fieldValue)} ${matched ? 'in' : 'not in'} [${testValue.join(', ')}]`,
      };
    }

    case 'domain_in': {
      if (!Array.isArray(testValue)) {
        return { matched: false, reason: '"domain_in" value must be an array' };
      }
      const domain = extractDomain(fieldValue);
      if (!domain) {
        return { matched: false, reason: 'field is not a valid email address' };
      }
      const matched = (testValue as string[]).some((d) => d.toLowerCase() === domain);
      return {
        matched,
        reason: `domain "${domain}" ${matched ? 'in' : 'not in'} blocklist`,
      };
    }

    case 'gte': {
      const numField = Number(fieldValue);
      const numTest = Number(testValue);
      if (isNaN(numField) || isNaN(numTest)) {
        return { matched: false, reason: 'non-numeric value for gte' };
      }
      return {
        matched: numField >= numTest,
        reason: `${numField} >= ${numTest}`,
      };
    }

    case 'lte': {
      const numField = Number(fieldValue);
      const numTest = Number(testValue);
      if (isNaN(numField) || isNaN(numTest)) {
        return { matched: false, reason: 'non-numeric value for lte' };
      }
      return {
        matched: numField <= numTest,
        reason: `${numField} <= ${numTest}`,
      };
    }

    default: {
      const _exhaustive: never = op;
      return { matched: false, reason: `unknown operator: ${String(_exhaustive)}` };
    }
  }
}

/**
 * Evaluate a Predicate tree against a TriageEvent (or any plain object).
 * Returns a PredicateResult with matched flag and human-readable trace.
 * Never throws — all evaluation errors produce matched: false.
 */
export function evaluatePredicate(
  predicate: Predicate,
  event: Record<string, unknown>
): PredicateResult {
  // Branch: all (AND)
  if ('all' in predicate) {
    const children: PredicateResult[] = [];
    for (const child of predicate.all) {
      const result = evaluatePredicate(child, event);
      children.push(result);
      if (!result.matched) {
        // Short-circuit: first false stops evaluation
        return {
          matched: false,
          reason: 'all: short-circuited on first false child',
          children,
        };
      }
    }
    return {
      matched: true,
      reason: `all: ${children.length} children all matched`,
      children,
    };
  }

  // Branch: any (OR)
  if ('any' in predicate) {
    const children: PredicateResult[] = [];
    for (const child of predicate.any) {
      const result = evaluatePredicate(child, event);
      children.push(result);
      if (result.matched) {
        // Short-circuit: first true stops evaluation
        return {
          matched: true,
          reason: 'any: short-circuited on first true child',
          children,
        };
      }
    }
    return {
      matched: false,
      reason: `any: ${children.length} children none matched`,
      children,
    };
  }

  // Branch: not (NOT)
  if ('not' in predicate) {
    const inner = evaluatePredicate(predicate.not, event);
    return {
      matched: !inner.matched,
      reason: `not: inner was ${inner.matched}`,
      children: [inner],
    };
  }

  // Leaf: field test
  const { field, op, value } = predicate;
  const fieldValue = resolvePath(event, field);
  const { matched, reason } = evaluateLeaf(op, fieldValue, value);
  return {
    matched,
    path: field,
    op,
    reason,
  };
}
