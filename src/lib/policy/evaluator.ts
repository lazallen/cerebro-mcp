/**
 * Policy evaluator — pure evaluation, no I/O.
 * Given a policy and a batch of items, returns one EvalResult per item.
 * Deterministic: same input always produces the same output.
 */

import type {
  Policy,
  PolicyDefaults,
  PolicyRule,
  RuleAction,
  Classification,
  EvalResult,
  RuleTraceEntry,
  IntentType,
  UrgencyLevel,
  RiskLevel,
  PolicyActionType,
} from './types';
import type { Item, Action } from '../item/types';
import { evaluatePredicate } from './predicate';

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

function resolveTemplate(value: string, defaults: PolicyDefaults): string {
  return value.replace(/\$\{defaults\.([^}]+)\}/g, (_match, dotPath: string) => {
    const parts = dotPath.split('.');
    let current: unknown = defaults;
    for (const part of parts) {
      if (current !== null && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return _match;
      }
    }
    return typeof current === 'string' ? current : _match;
  });
}

function resolveActionTemplates(action: RuleAction, defaults: PolicyDefaults): RuleAction {
  const resolve = (v: string | undefined) => (v ? resolveTemplate(v, defaults) : v);
  return {
    ...action,
    name: resolve(action.name),
    folder: resolve(action.folder),
    question: resolve(action.question),
  };
}

// ---------------------------------------------------------------------------
// Default classification
// ---------------------------------------------------------------------------

const DEFAULT_CLASSIFICATION: Classification = {
  intent: 'UNKNOWN',
  urgency: 'SOMEDAY',
  risk: 'MEDIUM',
  confidence: 0,
  rationale: ['No rule matched'],
};

function sortRules(rules: PolicyRule[]): PolicyRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------------------
// Item → flat eval object
// ---------------------------------------------------------------------------

/**
 * Convert an Item to a flat evaluation object for predicate path resolution.
 * Merges in human answer context from any resolved TRIAGE action.
 */
function itemToEvalObject(item: Item): Record<string, unknown> {
  // Extract enrichment data from the most recent ENHANCE action
  const enhance = [...item.actions]
    .reverse()
    .find((a): a is Action => a.type === 'ENHANCE' && a.status === 'done');

  // Extract human answer from the most recent resolved TRIAGE action
  const triageResolved = [...item.actions]
    .reverse()
    .find((a): a is Action => a.type === 'TRIAGE' && a.status === 'done' && !!a.answer);

  const obj: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    source: item.source,
    status: item.status,
    createdAt: item.createdAt,
    signals: item.signals,
    extracted: {
      intent: enhance?.intent,
      confidence: enhance?.confidence,
      summary: enhance?.summary,
      entities: enhance?.entities,
    },
    triageAnswer: triageResolved?.answer,
  };

  if (item.type === 'MESSAGE') {
    const msg = item;
    obj['subject'] = msg.subject;
    obj['title'] = msg.subject;
    obj['body'] = msg.body;
    obj['from'] = {
      email: msg.from ?? '',
      name: '',
    };
    obj['to'] = msg.to;
    obj['date'] = msg.date;
    obj['channel'] = msg.channel;
    obj['user'] = msg.user;
    obj['author'] = msg.from ?? '';
    obj['snippet'] = msg.body ? msg.body.slice(0, 500) : '';
  } else {
    obj['title'] = item.title;
    obj['start'] = item.start;
    obj['end'] = item.end;
    obj['organizer'] = item.organizer;
    obj['attendees'] = item.attendees;
    obj['isCancelled'] = item.isCancelled;
    obj['snippet'] = item.description ? item.description.slice(0, 500) : '';
    obj['author'] = item.organizer ?? '';
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

function evaluateItem(
  policy: Policy,
  item: Item
): { classification: Classification; actions: RuleAction[]; trace: RuleTraceEntry[] } {
  const sortedRules = sortRules(policy.rules);

  let classification: Classification = { ...DEFAULT_CLASSIFICATION };
  if (policy.defaults.unknownIntentRisk) {
    classification.risk = policy.defaults.unknownIntentRisk;
  }

  const allActions: RuleAction[] = [];
  const trace: RuleTraceEntry[] = [];

  const evalTarget = itemToEvalObject(item);

  for (const rule of sortedRules) {
    const predicateResult = evaluatePredicate(rule.when, evalTarget);

    trace.push({
      ruleId: rule.id,
      priority: rule.priority,
      matched: predicateResult.matched,
      predicateResult,
      terminal: rule.terminal,
    });

    if (predicateResult.matched) {
      if (rule.setClassification) {
        classification = mergeClassification(classification, rule.setClassification);
      }

      for (const action of rule.actions) {
        allActions.push(resolveActionTemplates(action, policy.defaults));
      }

      if (rule.terminal) break;
    }
  }

  return { classification, actions: allActions, trace };
}

function mergeClassification(
  current: Classification,
  override: Partial<Classification>
): Classification {
  return {
    intent: (override.intent ?? current.intent) as IntentType,
    urgency: (override.urgency ?? current.urgency) as UrgencyLevel,
    risk: (override.risk ?? current.risk) as RiskLevel,
    confidence: override.confidence ?? current.confidence,
    rationale: override.rationale ?? current.rationale,
  };
}

// ---------------------------------------------------------------------------
// Safety gates (inline — no separate module needed)
// ---------------------------------------------------------------------------

function applySafetyGates(
  classification: Classification,
  actions: RuleAction[],
  policy: Policy
): RuleAction[] {
  const result = [...actions];
  const hasTriage = result.some((a) => a.type === 'TRIAGE');

  // Low-confidence gate
  if (classification.confidence < policy.defaults.approvalThreshold && !hasTriage) {
    result.push({
      type: 'TRIAGE' as PolicyActionType,
      question: 'Confidence is below the approval threshold. What should be done with this item?',
    });
  }

  // High-risk gate
  const hasTriageNow = result.some((a) => a.type === 'TRIAGE');
  if (classification.risk === 'HIGH' && !hasTriageNow) {
    result.push({
      type: 'TRIAGE' as PolicyActionType,
      question: 'This item is classified as HIGH risk. Please review and decide.',
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Conflict resolution (inline)
// ---------------------------------------------------------------------------

function resolveConflicts(actions: RuleAction[], policy: Policy): RuleAction[] {
  const hasTriage = actions.some((a) => a.type === 'TRIAGE');
  const blockMove = policy.defaults.conflictResolution?.triageBlocksMove !== false;

  if (!hasTriage || !blockMove) return actions;

  // Suppress MOVE when TRIAGE is present — don't move email before human review
  return actions.filter((a) => a.type !== 'MOVE');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a batch of items against a versioned policy.
 * Returns one EvalResult per item in input order.
 * Never throws — individual failures produce a safe UNKNOWN/TRIAGE fallback.
 */
export function evaluate(policy: Policy, items: Item[]): EvalResult[] {
  return items.map((item) => {
    try {
      const evalResult = evaluateItem(policy, item);
      let { classification, actions } = evalResult;
      const { trace } = evalResult;

      actions = applySafetyGates(classification, actions, policy);
      actions = resolveConflicts(actions, policy);

      // Fallback: if still no actions, ask human
      if (actions.length === 0) {
        actions = [
          {
            type: 'TRIAGE' as PolicyActionType,
            question: 'No policy rule matched — please review.',
          },
        ];
      }

      return { itemId: item.id, classification, nextActions: actions, trace };
    } catch (err) {
      return {
        itemId: item.id,
        classification: {
          intent: 'UNKNOWN' as IntentType,
          urgency: 'SOMEDAY' as UrgencyLevel,
          risk: 'HIGH' as RiskLevel,
          confidence: 0,
          rationale: [`Evaluation error: ${(err as Error).message}`],
        },
        nextActions: [
          {
            type: 'TRIAGE' as PolicyActionType,
            question: `Evaluation error: ${(err as Error).message}`,
          },
        ],
        trace: [],
      };
    }
  });
}
