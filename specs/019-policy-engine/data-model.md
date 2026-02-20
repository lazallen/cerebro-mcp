# Data Model: Cerebro Policy Engine (019)

**Branch**: `019-policy-engine` | **Date**: 2026-02-19

All TypeScript types defined here. Runtime types use strict mode (`noImplicitAny`, no `any` except at IO boundaries). Zod schemas validate external input (YAML config, artifact frontmatter).

---

## 1. TriageEvent

The core artifact written by ingestion tasks and read by the policy pipeline.

```typescript
/**
 * Source of a triage event
 */
export type EventSource = 'email' | 'calendar' | 'slack' | 'journal' | 'other';

/**
 * Lifecycle status of a triage event artifact
 */
export type TriageEventStatus = 'pending' | 'enriched' | 'evaluated' | 'actioned';

/**
 * Heuristic signals computed deterministically by the ingestion layer.
 * Missing signals default to false — never throw on absent fields.
 */
export interface EventSignals {
  isAutomated: boolean;       // From headers (X-Mailer, DKIM, etc.) or channel type
  isBulk: boolean;            // List-Unsubscribe header present or broadcast channel
  hasUnsubscribe: boolean;    // Explicit unsubscribe link/cue in body
  hasAttachments: boolean;    // One or more attachments / files
  mentionsMoney: boolean;     // Currency symbols, amounts, financial vocabulary
  mentionsMeeting: boolean;   // Meeting/calendar vocabulary
  asksForAction: boolean;     // Imperative verbs directed at recipient
  prioritySender: boolean;    // Sender/author in configured allowlist
  [key: string]: boolean | string | number; // Source-specific extensions
}

/**
 * Fields extracted by LLM enrichment (phi-4-mini or Claude).
 * All fields optional — engine behaves correctly when absent.
 */
export interface ExtractedFields {
  intent?: IntentType;           // LLM-classified intent
  urgency?: UrgencyLevel;        // LLM-inferred urgency
  confidence?: number;           // 0–1; confidence in intent classification
  summary?: string;              // One-sentence summary
  entities?: string[];           // Named entities (people, projects, deadlines)
  claudeEnriched?: boolean;      // Whether Claude enrichment has run
  claudeApprovalRef?: string;    // ID of the claude_approval item that authorised Claude
  truncated?: boolean;           // Whether input was truncated for context window
  llmTier?: 'local' | 'claude';  // Which tier populated these fields
}

/**
 * Common normalised fields present for all sources.
 * Source-specific fields live in signals and sourceData.
 */
export interface TriageEventCommon {
  eventId: string;               // Stable unique ID: YYYYMMDD-{source}-{counter}
  source: EventSource;
  title: string;                 // Subject / meeting title / message preview
  author: string;                // Sender email / Slack user ID / calendar organiser
  receivedAt: string;            // ISO 8601 timestamp
  snippet: string;               // Short body preview (≤500 chars)
}

/**
 * A structured triage event artifact.
 * Written by ingestion tasks to system/triage/.
 */
export interface TriageEvent extends TriageEventCommon {
  status: TriageEventStatus;
  signals: EventSignals;
  extracted: ExtractedFields;
  passCount: number;             // Number of evaluation passes completed
  latestPassTimestamp?: string;  // ISO 8601 of last evaluation
  passes: EvaluationPass[];      // Append-only history of all evaluation passes
  sourceData?: Record<string, unknown>; // Source-specific raw fields (email messageId, etc.)
}
```

---

## 2. Intent & Classification Taxonomy

```typescript
/**
 * Fixed intent taxonomy v1.
 * Adding new values is a breaking policy change — bump policy version.
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

export interface Classification {
  intent: IntentType;
  urgency: UrgencyLevel;
  risk: RiskLevel;
  confidence: number;    // 0–1
  rationale: string[];   // Ordered list of reasons (from matched rule)
}
```

---

## 3. Predicate DSL

```typescript
type StringOp = 'eq' | 'neq' | 'contains' | 'matches' | 'in' | 'domain_in';
type NumericOp = 'gte' | 'lte';
type LeafOp = StringOp | NumericOp;

/**
 * Leaf predicate: tests a single field via dot-path notation.
 * Missing paths → false (never throws).
 */
export interface LeafPredicate {
  field: string;
  op: LeafOp;
  value: unknown;
}

/**
 * Composable predicate tree.
 */
export type Predicate =
  | { all: Predicate[] }         // Boolean AND; short-circuits on first false
  | { any: Predicate[] }         // Boolean OR; short-circuits on first true
  | { not: Predicate }           // Boolean NOT
  | LeafPredicate;               // Field test

/**
 * Result of evaluating a single predicate node.
 */
export interface PredicateResult {
  matched: boolean;
  path?: string;           // Field path (leaf nodes only)
  op?: LeafOp;             // Operator used (leaf nodes only)
  reason?: string;         // Human-readable explanation
  children?: PredicateResult[];  // For all/any/not nodes
}
```

---

## 4. Policy & Rules

```typescript
/**
 * A declarative action in a rule.
 */
export type ActionType =
  | 'LABEL'
  | 'MOVE'
  | 'FLAG'
  | 'CREATE_TASK'
  | 'CREATE_READING_PACK'
  | 'DRAFT_REPLY'
  | 'ASK_HUMAN'
  | 'CATEGORY';  // Outlook/source-specific category label

export interface RuleAction {
  type: ActionType;
  name?: string;           // For LABEL / CATEGORY
  folder?: string;         // For MOVE (human-readable folder name)
  folderId?: string;       // Optional fallback ID for MOVE
  template?: string;       // For CREATE_TASK / CREATE_READING_PACK / DRAFT_REPLY
  notePath?: string;       // For CREATE_READING_PACK (Handlebars template)
  question?: string;       // For ASK_HUMAN
  flagStatus?: string;     // For FLAG (e.g., 'flagged')
  requiresApproval?: boolean; // For DRAFT_REPLY (always true; cannot be unset via config)
}

/**
 * A single evaluation rule within a policy.
 */
export interface PolicyRule {
  id: string;
  priority: number;              // Higher priority evaluated first; ties broken by file order
  when: Predicate;
  setClassification?: Partial<Classification>;
  actions: RuleAction[];
  terminal: boolean;             // If true, stops evaluation after this rule matches
}

/**
 * Global defaults within a policy.
 */
export interface PolicyDefaults {
  approvalThreshold: number;           // Confidence below this → safety gate may add ASK_HUMAN
  claudeRecommendThreshold: number;    // Confidence below this → suggest Claude enrichment
  unknownIntentRisk: RiskLevel;        // Risk level when intent = UNKNOWN

  categories?: Record<string, string>; // Semantic name → source system category string
  folders?: Record<string, string>;    // Semantic name → folder name (e.g., archive → "Archive")

  senderAllowlist?: string[];          // Email addresses; prioritySender = true
  senderBlocklistDomains?: string[];   // Domains; auto-classify as SPAM candidate

  conflictResolution?: {
    askHumanBlocksMoveToArchive: boolean;
  };
}

/**
 * A versioned, human-editable policy config.
 */
export interface Policy {
  id: string;
  version: string;    // Semver (e.g., "1.0.0")
  defaults: PolicyDefaults;
  rules: PolicyRule[];
}
```

---

## 5. PolicyDecision & Actions

```typescript
/**
 * A resolved action — enriched at evaluation time with idempotency key.
 */
export interface ResolvedAction extends RuleAction {
  idempotencyKey: string;    // event:<eventId>:action:<type>:policy:<version>:v1
  requiresApproval: boolean; // Always true for DRAFT_REPLY; rule-configured otherwise
  applied?: boolean;         // Set by executor after successful application
  appliedAt?: string;        // ISO 8601 timestamp set by executor
}

/**
 * Trace entry for a single rule evaluation.
 */
export interface RuleTraceEntry {
  ruleId: string;
  priority: number;
  matched: boolean;
  predicateResult: PredicateResult;
  terminal: boolean;
  gateOutcomes?: GateOutcome[];
}

/**
 * Outcome of a safety gate application.
 */
export interface GateOutcome {
  gate: 'low_confidence' | 'high_risk' | 'draft_reply_approval' | 'ask_human_blocks_move';
  applied: boolean;
  reason: string;
  actionSuppressed?: ActionType; // Set if gate suppressed an action
}

/**
 * The complete output of one evaluation run against a TriageEvent.
 */
export interface PolicyDecision {
  eventId: string;
  policyId: string;
  policyVersion: string;
  timestamp: string;          // ISO 8601
  classification: Classification;
  actions: ResolvedAction[];
  trace: RuleTraceEntry[];
  terminal: boolean;          // Whether evaluation stopped early
}
```

---

## 6. EvaluationPass

```typescript
/**
 * Record of one engine run against a TriageEvent.
 * Stored append-only in the event artifact.
 */
export interface EvaluationPass {
  passNumber: number;
  timestamp: string;           // ISO 8601
  policyId: string;
  policyVersion: string;
  llmTier?: 'local' | 'claude' | 'none';
  llmConfidence?: number;
  decision: PolicyDecision;
}
```

---

## 7. HumanQueueItem

```typescript
export type HumanQueueItemType = 'ask_human' | 'claude_approval';
export type HumanQueueItemStatus = 'pending' | 'resolved' | 'approved' | 'declined' | 'complete';

/**
 * A pending human interaction item.
 * Written to system/human/ by the policy engine or enrichment stage.
 * Never deleted — preserved for audit.
 */
export interface HumanQueueItem {
  id: string;                  // hq_YYYYMMDD_<counter>
  itemType: HumanQueueItemType;
  eventRef: string;            // eventId of the parent TriageEvent
  status: HumanQueueItemStatus;
  createdAt: string;           // ISO 8601
  resolvedAt?: string;         // ISO 8601
  question?: string;           // For ask_human: the question posed to the user
  reason?: string;             // For claude_approval: why Claude is recommended
  localConfidence?: number;    // For claude_approval: local LLM confidence score
  answer?: string;             // For ask_human: user's response
  approvalRef?: string;        // Set by enrichment stage after Claude runs (the item ID used)
}
```

---

## 8. EnrichmentResult

```typescript
/**
 * Output of one LLM enrichment pass.
 */
export interface EnrichmentResult {
  eventId: string;
  tier: 'local' | 'claude';
  confidence: number;
  extracted: ExtractedFields;
  truncated: boolean;
  claudeApprovalRef?: string;  // ID of the claude_approval item (Claude tier only)
  durationMs: number;
  timestamp: string;           // ISO 8601
}
```

---

## 9. RunLog

```typescript
export type RunStage = 'ingestion' | 'enrichment' | 'evaluation' | 'execution' | 'human-queue';

export interface RunLogEntry {
  runId: string;               // run_YYYYMMDD_<counter>
  policyId: string;
  policyVersion: string;
  startedAt: string;           // ISO 8601
  completedAt?: string;
  stages: RunStage[];
  eventsProcessed: number;
  eventsActioned: number;
  humanItemsCreated: number;
  humanItemsResolved: number;
  claudeApprovalsRequested: number;
  claudeApprovalsGranted: number;
  errors: Array<{ stage: RunStage; eventId?: string; message: string }>;
  decisions: Array<{
    eventId: string;
    intent: IntentType;
    terminal: boolean;
    actionTypes: ActionType[];
    hasHumanItem: boolean;
  }>;
}
```

---

## 10. Artifact Frontmatter Schemas

### TriageEvent frontmatter (system/triage/)

```yaml
---
type: triage-event
eventId: 20260219-email-a1b2
source: email
status: pending
title: "ACME Weekly — Top tips for February"
author: news@acme.example
receivedAt: 2026-02-19T07:55:00Z
passCount: 0
signals_isAutomated: true
signals_isBulk: true
signals_hasUnsubscribe: true
signals_prioritySender: false
---
```

### PolicyDecision frontmatter (system/decisions/)

```yaml
---
type: policy-decision
eventId: 20260219-email-a1b2
policyId: email-triage
policyVersion: 1.0.0
timestamp: 2026-02-19T08:01:00Z
intent: NEWSLETTER
urgency: SOMEDAY
risk: LOW
confidence: 0.90
terminal: true
actionsApplied: false
---
```

### HumanQueueItem frontmatter (system/human/)

```yaml
---
type: human-queue-item
id: hq_20260219_0001
itemType: ask_human
eventRef: 20260219-email-a1b2
status: pending
createdAt: 2026-02-19T08:01:00Z
---
```

---

## Entity Relationships

```
Policy (1) ─────────── (N) PolicyRule
PolicyRule (1) ─────── (1) Predicate (tree)
PolicyRule (1) ─────── (N) RuleAction

TriageEvent (1) ──────── (N) EvaluationPass
EvaluationPass (1) ────── (1) PolicyDecision
PolicyDecision (1) ─────── (N) ResolvedAction
PolicyDecision (1) ─────── (N) RuleTraceEntry

TriageEvent (1) ────── (0..N) HumanQueueItem (via eventRef)
HumanQueueItem (1) ──── (0..1) ResolvedAction (claude_approval → enrichment)

RunLog (1) ─────────── (N) PolicyDecision summary
```
