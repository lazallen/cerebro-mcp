/**
 * Policy Engine — Type Contracts
 *
 * Defines the YAML-driven policy configuration DSL (Policy, PolicyRule,
 * Predicate, Classification) and the evaluator's output type (EvalResult).
 *
 * Item types (MessageItem, EventItem, etc.) live in src/lib/item/types.ts.
 */

export type IntentType =
  | 'ACTION_REQUIRED'
  | 'APPROVAL_REQUEST'
  | 'SCHEDULING'
  | 'DELEGATABLE'
  | 'FYI'
  | 'NEWSLETTER'
  | 'RECEIPT'
  | 'SPAM'
  | 'UNKNOWN';

export type UrgencyLevel = 'NOW' | 'THIS_WEEK' | 'SOMEDAY';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Action types that can appear in policy YAML rules. */
export type PolicyActionType =
  | 'TRIAGE'
  | 'MOVE'
  | 'FLAG'
  | 'LABEL'
  | 'CREATE_TASK'
  | 'JOURNAL_NOTE'
  | 'RESPOND_CALENDAR'
  | 'ARCHIVE';

// ---------------------------------------------------------------------------
// Predicate DSL
// ---------------------------------------------------------------------------

export type LeafOp = 'eq' | 'neq' | 'contains' | 'matches' | 'in' | 'domain_in' | 'gte' | 'lte';

export interface LeafPredicate {
  field: string;
  op: LeafOp;
  value: unknown;
}

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | LeafPredicate;

export interface PredicateResult {
  matched: boolean;
  path?: string;
  op?: LeafOp;
  reason?: string;
  children?: PredicateResult[];
}

// ---------------------------------------------------------------------------
// Policy Config
// ---------------------------------------------------------------------------

export interface PolicyDefaults {
  approvalThreshold: number;
  claudeRecommendThreshold: number;
  unknownIntentRisk: RiskLevel;
  categories?: Record<string, string>;
  folders?: Record<string, string>;
  selfSenderDomains?: string[];
  senderAllowlist?: string[];
  senderBlocklistDomains?: string[];
  conflictResolution?: {
    triageBlocksMove: boolean;
  };
}

export interface RuleAction {
  type: PolicyActionType;
  name?: string;
  folder?: string;
  folderId?: string;
  question?: string;
  flagStatus?: string;
  calendarResponse?: 'accepted' | 'declined' | 'tentativelyAccepted';
}

export interface Classification {
  intent: IntentType;
  urgency: UrgencyLevel;
  risk: RiskLevel;
  confidence: number;
  rationale: string[];
}

export interface PolicyRule {
  id: string;
  priority: number;
  when: Predicate;
  setClassification?: Partial<Classification>;
  actions: RuleAction[];
  terminal: boolean;
}

export interface Policy {
  id: string;
  version: string;
  defaults: PolicyDefaults;
  rules: PolicyRule[];
}

// ---------------------------------------------------------------------------
// Evaluator output
// ---------------------------------------------------------------------------

/** One rule's contribution to the trace (kept internal for logging). */
export interface RuleTraceEntry {
  ruleId: string;
  priority: number;
  matched: boolean;
  predicateResult: PredicateResult;
  terminal: boolean;
  suppressedActions?: PolicyActionType[];
}

/** Result of evaluating one item against a policy. */
export interface EvalResult {
  itemId: string;
  classification: Classification;
  /** Actions to append to the item (status will be set by the pipeline task). */
  nextActions: RuleAction[];
  trace: RuleTraceEntry[];
}

// ---------------------------------------------------------------------------
// Pipeline task config (heartbeat-config.json)
// ---------------------------------------------------------------------------

export interface PolicyPipelineConfig {
  /** Directory containing per-source policy files (email.yaml, slack.yaml, etc.) */
  policyDir?: string;
  /** Single policy file fallback (legacy) */
  policyFile?: string;
  /** Max items to process per cycle (default: 50) */
  batchSize?: number;
  /** Timeout in ms for local LLM enrichment per item (default: 30000) */
  localLlmTimeout?: number;
}
