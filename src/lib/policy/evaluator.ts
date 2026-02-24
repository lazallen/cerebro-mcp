/**
 * Policy evaluator — pure evaluation, no I/O.
 * Given a policy and a batch of triage events, returns one PolicyDecision per event.
 * Deterministic: same input always produces same output.
 */

import type {
  Policy,
  PolicyDefaults,
  PolicyRule,
  TriageEvent,
  PolicyDecision,
  Classification,
  ResolvedAction,
  RuleTraceEntry,
  IntentType,
  UrgencyLevel,
  RiskLevel,
} from './types';
import { evaluatePredicate } from './predicate';
import { resolveAction } from './idempotency';
import { applySafetyGates } from './safety-gates';
import { resolveConflicts } from './conflict-resolver';

/**
 * Resolve ${defaults.X.Y} template references in a string value.
 * Walks the defaults object by dot-separated path.
 */
function resolveTemplate(value: string, defaults: PolicyDefaults): string {
  return value.replace(/\$\{defaults\.([^}]+)\}/g, (_match, dotPath: string) => {
    const parts = dotPath.split('.');
    let current: unknown = defaults;
    for (const part of parts) {
      if (current !== null && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return _match; // path not found — return original
      }
    }
    return typeof current === 'string' ? current : _match;
  });
}

/**
 * Resolve template strings in all string fields of a ResolvedAction.
 */
function resolveActionTemplates(action: ResolvedAction, defaults: PolicyDefaults): ResolvedAction {
  const resolve = (v: string | undefined) => (v ? resolveTemplate(v, defaults) : v);
  return {
    ...action,
    name: resolve(action.name),
    folder: resolve(action.folder),
    question: resolve(action.question),
    notePath: resolve(action.notePath),
    template: resolve(action.template),
  };
}

/**
 * Default classification when no rule matches or classification is incomplete.
 */
const DEFAULT_CLASSIFICATION: Classification = {
  intent: 'UNKNOWN',
  urgency: 'SOMEDAY',
  risk: 'MEDIUM',
  confidence: 0,
  rationale: ['No rule matched'],
};

/**
 * Sort rules by priority descending. Ties are broken by index (stable sort).
 */
function sortRules(rules: PolicyRule[]): PolicyRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

/**
 * Evaluate a single event against an ordered list of rules.
 * Returns the trace and matched actions.
 */
function evaluateEvent(
  policy: Policy,
  event: TriageEvent,
  humanAnswers?: Map<string, string>
): {
  classification: Classification;
  actions: ResolvedAction[];
  trace: RuleTraceEntry[];
  terminal: boolean;
} {
  const sortedRules = sortRules(policy.rules);

  let classification: Classification = { ...DEFAULT_CLASSIFICATION };
  if (policy.defaults.unknownIntentRisk) {
    classification.risk = policy.defaults.unknownIntentRisk;
  }

  const allActions: ResolvedAction[] = [];
  const trace: RuleTraceEntry[] = [];
  let terminal = false;

  // Build evaluation object — merge event with human answer context if available
  const evalTarget: Record<string, unknown> = eventToEvalObject(event, humanAnswers);

  for (const rule of sortedRules) {
    const predicateResult = evaluatePredicate(rule.when, evalTarget);

    const traceEntry: RuleTraceEntry = {
      ruleId: rule.id,
      priority: rule.priority,
      matched: predicateResult.matched,
      predicateResult,
      terminal: rule.terminal,
    };
    trace.push(traceEntry);

    if (predicateResult.matched) {
      // Apply classification override
      if (rule.setClassification) {
        classification = mergeClassification(classification, rule.setClassification);
      }

      // Resolve actions with idempotency keys, then interpolate ${defaults.*} templates
      for (const action of rule.actions) {
        const resolved = resolveAction(
          action,
          event.eventId,
          policy.id,
          policy.version
        ) as ResolvedAction;
        allActions.push(resolveActionTemplates(resolved, policy.defaults));
      }

      if (rule.terminal) {
        terminal = true;
        break;
      }
    }
  }

  return { classification, actions: allActions, trace, terminal };
}

/**
 * Convert a TriageEvent to a flat evaluation object for predicate path resolution.
 * Merges in human answer context if provided.
 */
function eventToEvalObject(
  event: TriageEvent,
  humanAnswers?: Map<string, string>
): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    eventId: event.eventId,
    source: event.source,
    title: event.title,
    author: event.author,
    receivedAt: event.receivedAt,
    snippet: event.snippet,
    status: event.status,
    signals: event.signals,
    extracted: event.extracted,
    passCount: event.passCount,
    // Support legacy "subject" field references in policy YAML
    subject: event.title,
    // Support "from.email" path for email events.
    // Normalise to { email, name } regardless of whether sourceData uses "address" or "email".
    from: (() => {
      const raw = event.sourceData?.from as Record<string, string> | undefined;
      return {
        email: raw?.address ?? raw?.email ?? event.author,
        name: raw?.name ?? '',
      };
    })(),
    bodyPreview: event.snippet,
  };

  // Merge source-specific data at top level for predicate access
  if (event.sourceData) {
    obj['sourceData'] = event.sourceData;
  }

  // Inject human answers as top-level context fields
  if (humanAnswers && humanAnswers.size > 0) {
    obj['humanAnswers'] = Object.fromEntries(humanAnswers);
  }

  return obj;
}

/**
 * Merge a partial classification override onto the current classification.
 */
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

/**
 * Evaluate a batch of triage events against a versioned policy.
 * Returns one PolicyDecision per event in input order.
 * Never throws — individual failures produce an UNKNOWN decision with the error in the trace.
 *
 * @param policy Loaded, validated Policy
 * @param events Array of TriageEvent artifacts to evaluate
 * @param humanAnswers Optional map of eventId → human answer for re-evaluation with context
 */
export function evaluate(
  policy: Policy,
  events: TriageEvent[],
  humanAnswers?: Map<string, string>
): PolicyDecision[] {
  const timestamp = new Date().toISOString();

  return events.map((event) => {
    try {
      const { classification, actions, trace, terminal } = evaluateEvent(
        policy,
        event,
        humanAnswers
      );

      let decision: PolicyDecision = {
        eventId: event.eventId,
        policyId: policy.id,
        policyVersion: policy.version,
        timestamp,
        classification,
        actions,
        trace,
        terminal,
      };

      // Post-evaluation: apply safety gates then resolve action conflicts
      decision = applySafetyGates(decision, policy);
      decision = resolveConflicts(decision, policy);

      return decision;
    } catch (err) {
      // Evaluation error — return a safe UNKNOWN decision
      return {
        eventId: event.eventId,
        policyId: policy.id,
        policyVersion: policy.version,
        timestamp,
        classification: {
          intent: 'UNKNOWN',
          urgency: 'SOMEDAY',
          risk: 'HIGH',
          confidence: 0,
          rationale: [`Evaluation error: ${(err as Error).message}`],
        },
        actions: [],
        trace: [],
        terminal: false,
      } satisfies PolicyDecision;
    }
  });
}
