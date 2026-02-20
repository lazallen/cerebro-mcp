/**
 * Policy Engine — Type Contracts (Feature 019)
 *
 * These are the authoritative TypeScript interfaces for all policy engine
 * components. Implementation files import from here; do not redefine these
 * types inline.
 *
 * All types exported from this file are stable API contracts.
 * Breaking changes require a policy version bump.
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type EventSource = 'email' | 'calendar' | 'slack' | 'journal' | 'other';

export type TriageEventStatus = 'pending' | 'enriched' | 'evaluated' | 'actioned';

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

export type ActionType =
  | 'LABEL'
  | 'MOVE'
  | 'FLAG'
  | 'CREATE_TASK'
  | 'CREATE_READING_PACK'
  | 'DRAFT_REPLY'
  | 'ASK_HUMAN'
  | 'CATEGORY'
  | 'ENRICH_CONFLUENCE';

export type HumanQueueItemType = 'ask_human' | 'claude_approval';

export type HumanQueueItemStatus = 'pending' | 'resolved' | 'approved' | 'declined' | 'complete';

export type LlmTier = 'local' | 'claude' | 'none';

export type RunStage = 'ingestion' | 'enrichment' | 'evaluation' | 'execution' | 'human-queue';

// ---------------------------------------------------------------------------
// Event Signals & Extraction
// ---------------------------------------------------------------------------

export interface EventSignals {
  isAutomated: boolean;
  isBulk: boolean;
  hasUnsubscribe: boolean;
  hasAttachments: boolean;
  mentionsMoney: boolean;
  mentionsMeeting: boolean;
  asksForAction: boolean;
  prioritySender: boolean;
  /** Source-specific extensions (e.g., calendar.isOrganiser, slack.isDirectMessage) */
  [key: string]: boolean | string | number;
}

export interface ExtractedFields {
  intent?: IntentType;
  urgency?: UrgencyLevel;
  confidence?: number;
  summary?: string;
  entities?: string[];
  claudeEnriched?: boolean;
  claudeApprovalRef?: string;
  truncated?: boolean;
  llmTier?: LlmTier;
}

// ---------------------------------------------------------------------------
// TriageEvent
// ---------------------------------------------------------------------------

export interface TriageEvent {
  eventId: string;
  source: EventSource;
  status: TriageEventStatus;
  title: string;
  author: string;
  receivedAt: string;
  snippet: string;
  signals: EventSignals;
  extracted: ExtractedFields;
  passCount: number;
  latestPassTimestamp?: string;
  passes: EvaluationPass[];
  sourceData?: Record<string, unknown>;
}

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
    askHumanBlocksMoveToArchive: boolean;
  };
}

export interface RuleAction {
  type: ActionType;
  name?: string;
  folder?: string;
  folderId?: string;
  template?: string;
  notePath?: string;
  question?: string;
  flagStatus?: string;
  requiresApproval?: boolean;
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
// PolicyDecision & Trace
// ---------------------------------------------------------------------------

export interface ResolvedAction extends RuleAction {
  idempotencyKey: string;
  requiresApproval: boolean;
  applied?: boolean;
  appliedAt?: string;
}

export interface GateOutcome {
  gate: 'low_confidence' | 'high_risk' | 'draft_reply_approval' | 'ask_human_blocks_move';
  applied: boolean;
  reason: string;
  actionSuppressed?: ActionType;
}

export interface RuleTraceEntry {
  ruleId: string;
  priority: number;
  matched: boolean;
  predicateResult: PredicateResult;
  terminal: boolean;
  gateOutcomes?: GateOutcome[];
}

export interface PolicyDecision {
  eventId: string;
  policyId: string;
  policyVersion: string;
  timestamp: string;
  classification: Classification;
  actions: ResolvedAction[];
  trace: RuleTraceEntry[];
  terminal: boolean;
}

// ---------------------------------------------------------------------------
// EvaluationPass
// ---------------------------------------------------------------------------

export interface EvaluationPass {
  passNumber: number;
  timestamp: string;
  policyId: string;
  policyVersion: string;
  llmTier?: LlmTier;
  llmConfidence?: number;
  decision: PolicyDecision;
}

// ---------------------------------------------------------------------------
// HumanQueueItem
// ---------------------------------------------------------------------------

export interface HumanQueueItem {
  id: string;
  itemType: HumanQueueItemType;
  eventRef: string;
  status: HumanQueueItemStatus;
  createdAt: string;
  resolvedAt?: string;
  question?: string;
  reason?: string;
  localConfidence?: number;
  answer?: string;
  approvalRef?: string;
}

// ---------------------------------------------------------------------------
// EnrichmentResult
// ---------------------------------------------------------------------------

export interface EnrichmentResult {
  eventId: string;
  tier: LlmTier;
  confidence: number;
  extracted: ExtractedFields;
  truncated: boolean;
  claudeApprovalRef?: string;
  durationMs: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// RunLog
// ---------------------------------------------------------------------------

export interface RunLogDecisionSummary {
  eventId: string;
  intent: IntentType;
  terminal: boolean;
  actionTypes: ActionType[];
  hasHumanItem: boolean;
}

export interface RunLogError {
  stage: RunStage;
  eventId?: string;
  message: string;
}

export interface RunLogEntry {
  runId: string;
  policyId: string;
  policyVersion: string;
  startedAt: string;
  completedAt?: string;
  stages: RunStage[];
  eventsProcessed: number;
  eventsActioned: number;
  humanItemsCreated: number;
  humanItemsResolved: number;
  claudeApprovalsRequested: number;
  claudeApprovalsGranted: number;
  errors: RunLogError[];
  decisions: RunLogDecisionSummary[];
}

// ---------------------------------------------------------------------------
// Pipeline Task Config
// ---------------------------------------------------------------------------

/**
 * Heartbeat task config for the policy-pipeline task type.
 * Used in heartbeat-config.json under tasks[].config.
 */
export interface PolicyPipelineConfig {
  /** Path to the policy YAML file, relative to rootDir */
  policyFile: string;

  /** Max number of triage events to process per run (default: 50) */
  maxEvents?: number;

  /** Whether to run Claude enrichment for approved items (default: true) */
  enableClaudeEnrichment?: boolean;

  /** Timeout in ms for local LLM enrichment per event (default: 30000) */
  localLlmTimeout?: number;

  /** Timeout in ms for Claude enrichment per event (default: 60000) */
  claudeLlmTimeout?: number;
}
