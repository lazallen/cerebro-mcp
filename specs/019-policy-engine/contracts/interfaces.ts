/**
 * Policy Engine — Service Interfaces (Feature 019)
 *
 * Defines the public interfaces for the policy engine's key service components.
 * Implementations live in src/lib/policy/ and src/lib/triage/.
 */

import type {
  TriageEvent,
  Policy,
  PolicyDecision,
  EnrichmentResult,
  HumanQueueItem,
  RunLogEntry,
} from './types';

// ---------------------------------------------------------------------------
// Core Policy Evaluator
// ---------------------------------------------------------------------------

/**
 * Pure evaluation interface — no I/O; deterministic given same inputs.
 * Test this in complete isolation from the file system.
 */
export interface PolicyEvaluator {
  /**
   * Evaluate a batch of triage events against a policy.
   * Returns one PolicyDecision per event in input order.
   * Never throws; individual failures logged in decision trace.
   */
  evaluate(policy: Policy, events: TriageEvent[]): PolicyDecision[];
}

// ---------------------------------------------------------------------------
// Triage Artifact I/O
// ---------------------------------------------------------------------------

/**
 * Read/write operations for TriageEvent artifacts in system/triage/.
 */
export interface TriageEventStore {
  /**
   * Read all TriageEvent artifacts with the given statuses.
   * Returns events sorted by receivedAt ascending.
   */
  listEvents(statuses: TriageEvent['status'][]): Promise<TriageEvent[]>;

  /**
   * Read a single TriageEvent by eventId.
   */
  getEvent(eventId: string): Promise<TriageEvent | null>;

  /**
   * Write or update a TriageEvent artifact atomically.
   * Appends to passes[] — does not overwrite history.
   */
  saveEvent(event: TriageEvent): Promise<void>;
}

/**
 * Read/write operations for PolicyDecision artifacts in system/decisions/.
 */
export interface DecisionStore {
  /**
   * Write a PolicyDecision artifact atomically.
   */
  saveDecision(decision: PolicyDecision): Promise<void>;

  /**
   * Mark an action within a decision as applied (by idempotency key).
   */
  markActionApplied(eventId: string, idempotencyKey: string, appliedAt: string): Promise<void>;

  /**
   * Get all unapplied decisions (for executor pickup).
   */
  listPendingDecisions(): Promise<PolicyDecision[]>;
}

/**
 * Read/write operations for HumanQueueItem artifacts in system/human/.
 */
export interface HumanQueueStore {
  /**
   * Write a new HumanQueueItem with status: pending.
   */
  createItem(item: HumanQueueItem): Promise<void>;

  /**
   * List items by status. Used to find resolved/approved items on each cycle.
   */
  listByStatus(statuses: HumanQueueItem['status'][]): Promise<HumanQueueItem[]>;

  /**
   * Update the status (and optional answer) of an existing item.
   */
  updateItemStatus(
    id: string,
    status: HumanQueueItem['status'],
    answer?: string
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// LLM Enrichment Services
// ---------------------------------------------------------------------------

/**
 * Local LLM enrichment (phi-4-mini via LocalFoundry).
 * Runs automatically; never requires approval.
 */
export interface LocalEnrichmentService {
  /**
   * Enrich a TriageEvent with intent, confidence, summary, and entities.
   * Truncates input if body exceeds context window; records truncation.
   * Never throws — returns result with confidence 0 on failure.
   */
  enrich(event: TriageEvent): Promise<EnrichmentResult>;
}

/**
 * Claude enrichment service (Anthropic API).
 * MUST check for a valid approved claude_approval item before invocation.
 * Throws if invoked without valid approval.
 */
export interface ClaudeEnrichmentService {
  /**
   * Enrich a TriageEvent with Claude after confirming valid approval.
   * @param event The event to enrich
   * @param approvalItemId The ID of the approved claude_approval item
   * @throws {Error} if approvalItemId does not correspond to an approved item
   */
  enrich(event: TriageEvent, approvalItemId: string): Promise<EnrichmentResult>;
}

// ---------------------------------------------------------------------------
// Policy Pipeline Orchestrator
// ---------------------------------------------------------------------------

/**
 * Configuration for a single pipeline run.
 */
export interface PipelineRunContext {
  runId: string;
  policy: Policy;
  systemDir: string;   // Absolute path to system/ root
  maxEvents: number;
}

/**
 * Orchestrates all pipeline stages for one heartbeat cycle.
 */
export interface PolicyPipelineOrchestrator {
  /**
   * Execute all pipeline stages in sequence:
   * 1. Load pending triage events
   * 2. Run local LLM enrichment on new events
   * 3. Process resolved human queue items
   * 4. Evaluate policy on enriched events
   * 5. Execute pending decisions
   * 6. Handle approved Claude enrichment items
   * 7. Write run log
   */
  run(context: PipelineRunContext): Promise<RunLogEntry>;
}

// ---------------------------------------------------------------------------
// Policy Loader
// ---------------------------------------------------------------------------

/**
 * Loads and validates a Policy from a YAML file.
 * Throws a descriptive ConfigurationError if the YAML is invalid.
 */
export interface PolicyLoader {
  load(policyFilePath: string): Promise<Policy>;
}
