/**
 * PolicyPipelineTask — the central orchestrator for the policy evaluation pipeline.
 * Runs all pipeline stages on each heartbeat cycle.
 *
 * Pipeline stages (T041 wires them all together):
 *   1. Scan system/triage/ for pending/enriched events
 *   2. Run local enrichment on pending events (US8)
 *   3. Check system/human/ for approved claude_approval items, run Claude enrichment (US8)
 *   4. Process resolved ask_human items from system/human/ (US7)
 *   5. Evaluate events with PolicyEvaluator
 *   6. Write decisions via DecisionStore
 *   7. Execute pending decisions (LABEL, MOVE, CREATE_TASK, CREATE_READING_PACK, ASK_HUMAN, DRAFT_REPLY)
 *   8. Write RunLog via RunLogWriter (US9)
 *
 * Currently implemented stages: 5–7 (evaluation + CREATE_TASK + CREATE_READING_PACK execution).
 * Remaining stages are stubs pending their respective user story phases.
 */

import * as path from 'path';
import type { TaskHandler } from '../types';
import type { TaskConfig } from '../../../types/heartbeat';
import type { Policy, PolicyDecision, TriageEvent } from '../../../lib/policy/types';
import { evaluate } from '../../../lib/policy/evaluator';
import { loadPolicy } from '../../../lib/policy/policy-loader';
import { listEvents, saveEvent } from '../../../lib/triage/triage-event-store';
import { saveDecision } from '../../../lib/triage/decision-store';
import { createTask } from '../../../lib/triage/task-writer';
import { appendEntry as appendReadingPackEntry } from '../../../lib/triage/reading-pack-writer';
import { createItem as createHumanQueueItem, listByStatus } from '../../../lib/triage/human-queue-store';
import { processResolved } from '../../../lib/triage/human-queue-processor';
import { LocalEnrichmentService } from '../../enrichment/local-enrichment-service';
import { ClaudeEnrichmentService } from '../../enrichment/claude-enrichment-service';
import type { ResolvedAction } from '../../../lib/policy/types';
import { randomUUID } from 'crypto';
import { logger } from '../../../common/logger';

export interface PolicyPipelineConfig {
  /** Path to a single policy YAML file — used when policyDir is not set */
  policyPath?: string;
  /** Directory containing per-source policy files (e.g. email.yaml, calendar.yaml, default.yaml) */
  policyDir?: string;
  /** Maximum events to process per cycle */
  batchSize?: number;
}

export class PolicyPipelineTask implements TaskHandler {
  constructor(
    private readonly systemDir: string,
    private readonly policyDir: string,
    private readonly localEnrichment?: LocalEnrichmentService,
    private readonly claudeEnrichment?: ClaudeEnrichmentService
  ) {}

  async execute(taskConfig: TaskConfig): Promise<void> {
    const cfg = (taskConfig.config ?? {}) as PolicyPipelineConfig;
    const batchSize = cfg.batchSize ?? 50;

    logger.info({
      operation: 'policy_pipeline_start',
      taskId: taskConfig.id,
      policyDir: cfg.policyDir,
      policyPath: cfg.policyPath,
      message: 'PolicyPipelineTask starting',
    });

    // Stage 1: Scan for pending events
    const events = await listEvents(this.systemDir, ['pending', 'enriched']);
    const batch = events.slice(0, batchSize);

    if (batch.length === 0) {
      logger.info({
        operation: 'policy_pipeline_no_events',
        message: 'No pending events to process',
      });
      return;
    }

    logger.info({
      operation: 'policy_pipeline_events_loaded',
      count: batch.length,
      message: `Processing ${batch.length} event(s)`,
    });

    // Stage 2: Run local enrichment on pending events
    if (this.localEnrichment) {
      for (const event of batch.filter((e) => e.status === 'pending')) {
        try {
          const result = await this.localEnrichment.enrich(event);
          const enriched = {
            ...event,
            status: 'enriched' as const,
            extracted: { ...event.extracted, ...result.extracted },
          };
          // Update the batch in-place so Stage 5 sees enriched fields
          batch[batch.indexOf(event)] = enriched;
          await saveEvent(this.systemDir, enriched);
        } catch (err) {
          logger.warn({
            operation: 'local_enrichment_skip',
            eventId: event.eventId,
            error: (err as Error).message,
          });
        }
      }
    }

    // Stage 3: Check for approved claude_approval items, run Claude enrichment
    if (this.claudeEnrichment) {
      const approvedItems = await listByStatus(this.systemDir, ['approved']);
      for (const item of approvedItems) {
        if (item.itemType !== 'claude_approval') continue;
        const event = batch.find((e) => e.eventId === item.eventRef);
        if (!event) continue;
        try {
          const result = await this.claudeEnrichment.enrich(event, item.id, this.systemDir);
          const enriched = {
            ...event,
            status: 'enriched' as const,
            extracted: { ...event.extracted, ...result.extracted },
          };
          batch[batch.indexOf(event)] = enriched;
          await saveEvent(this.systemDir, enriched);
        } catch (err) {
          logger.warn({
            operation: 'claude_enrichment_skip',
            eventId: event.eventId,
            approvalItemId: item.id,
            error: (err as Error).message,
          });
        }
      }
    }

    // Stage 4: Process resolved ask_human items (source-specific policy per event)
    await processResolved(this.systemDir, (source) => this.loadPolicyForSource(cfg, source));

    // Stage 5: Evaluate events per source (re-read batch to pick up enriched state)
    const freshBatch = await listEvents(this.systemDir, ['pending', 'enriched']);
    const toEvaluate = freshBatch.filter((e) =>
      batch.some((b) => b.eventId === e.eventId)
    );

    // Group by source so each group is evaluated with its own policy
    const bySource = new Map<string, TriageEvent[]>();
    for (const event of toEvaluate) {
      const src = event.source ?? 'unknown';
      const group = bySource.get(src) ?? [];
      group.push(event);
      bySource.set(src, group);
    }

    const allDecisions: PolicyDecision[] = [];
    const allEvents: TriageEvent[] = [];
    for (const [source, sourceEvents] of bySource) {
      const policy = await this.loadPolicyForSource(cfg, source);
      const decisions = evaluate(policy, sourceEvents);
      allDecisions.push(...decisions);
      allEvents.push(...sourceEvents);
    }

    // Stages 6–7: Write decisions + execute actions
    await this.writeAndExecuteDecisions(allEvents, allDecisions);

    logger.info({
      operation: 'policy_pipeline_complete',
      taskId: taskConfig.id,
      eventsProcessed: toEvaluate.length,
      message: 'PolicyPipelineTask complete',
    });
  }

  /**
   * Load the policy for a given source, using per-source files when policyDir is configured.
   * Resolution order: {policyDir}/{source}.yaml → {policyDir}/default.yaml → policyPath fallback.
   */
  private async loadPolicyForSource(cfg: PolicyPipelineConfig, source: string): Promise<Policy> {
    if (cfg.policyDir) {
      const absolutePolicyDir = path.isAbsolute(cfg.policyDir)
        ? cfg.policyDir
        : path.resolve(process.cwd(), cfg.policyDir);

      // Try source-specific file first
      try {
        return await loadPolicy(path.join(absolutePolicyDir, `${source}.yaml`));
      } catch {
        // Fall through to default.yaml
      }

      // Try default.yaml
      try {
        return await loadPolicy(path.join(absolutePolicyDir, 'default.yaml'));
      } catch {
        // Fall through to legacy policyPath
      }
    }

    // Legacy single-file fallback
    const legacyPath = cfg.policyPath ?? path.join(this.policyDir, 'policy.yaml');
    return await loadPolicy(legacyPath);
  }

  /**
   * Write each decision to system/decisions/ and execute its actions.
   * Currently handles: CREATE_TASK.
   * Other action types are no-ops pending their implementation phases.
   */
  private async writeAndExecuteDecisions(
    events: TriageEvent[],
    decisions: PolicyDecision[]
  ): Promise<void> {
    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];
      const event = events[i];

      try {
        // Write the decision artifact
        await saveDecision(this.systemDir, decision);

        // Execute each action
        for (const action of decision.actions) {
          await this.executeAction(event, action);
        }

        // Update event status to 'actioned' after all actions executed
        const updatedEvent: TriageEvent = {
          ...event,
          status: 'actioned',
          passes: [
            ...event.passes,
            {
              passNumber: event.passCount + 1,
              timestamp: decision.timestamp,
              policyId: decision.policyId,
              policyVersion: decision.policyVersion,
              decision,
            },
          ],
          passCount: event.passCount + 1,
          latestPassTimestamp: decision.timestamp,
        };
        await saveEvent(this.systemDir, updatedEvent);
      } catch (err) {
        logger.error({
          operation: 'policy_pipeline_event_error',
          eventId: event.eventId,
          error: (err as Error).message,
          message: `Failed to process event ${event.eventId}`,
        });
      }
    }
  }

  /**
   * Execute a single resolved action.
   * CREATE_TASK: write task artifact.
   * CREATE_READING_PACK: append entry to daily reading pack.
   * ASK_HUMAN: write human queue item.
   * Other types: stub (logged, no-op) pending their implementation phases.
   */
  private async executeAction(
    event: TriageEvent,
    action: ResolvedAction
  ): Promise<void> {
    switch (action.type) {
      case 'CREATE_TASK':
        await createTask(event, this.systemDir);
        break;

      case 'CREATE_READING_PACK':
        await appendReadingPackEntry(event, this.systemDir);
        break;

      case 'ASK_HUMAN':
        await createHumanQueueItem(
          {
            id: randomUUID(),
            itemType: 'ask_human',
            eventRef: event.eventId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            question: action.question ?? 'Please review this event and provide guidance.',
          },
          this.systemDir,
          buildEventContext(event)
        );
        break;

      case 'MOVE':
      case 'LABEL':
      case 'CATEGORY':
      case 'FLAG':
      case 'DRAFT_REPLY':
      case 'ENRICH_CONFLUENCE':
        // Handled by the executor-task via external API calls
        logger.debug({
          operation: 'policy_pipeline_action_deferred',
          actionType: action.type,
          eventId: event.eventId,
          message: `Action ${action.type} deferred to executor-task`,
        });
        break;

      default:
        logger.warn({
          operation: 'policy_pipeline_unknown_action',
          actionType: (action as ResolvedAction).type,
          eventId: event.eventId,
          message: `Unknown action type: ${(action as ResolvedAction).type}`,
        });
    }
  }
}

/**
 * Format a TriageEvent into a human-readable markdown context block for
 * inclusion in ASK_HUMAN queue items and MCP tool responses.
 */
function buildEventContext(event: TriageEvent): string {
  const lines: string[] = [
    `| Field | Value |`,
    `|---|---|`,
    `| **Source** | ${event.source} |`,
    `| **From** | ${event.author} |`,
    `| **Subject / Title** | ${event.title} |`,
    `| **Received** | ${event.receivedAt} |`,
    `| **Event ID** | ${event.eventId} |`,
  ];

  // Signals — only flag the ones that are true
  const activeSignals: string[] = [];
  if (event.signals.mentionsMeeting) activeSignals.push('📅 mentions meeting');
  if (event.signals.asksForAction) activeSignals.push('✅ asks for action');
  if (event.signals.mentionsMoney) activeSignals.push('💰 mentions money');
  if (event.signals.hasAttachments) activeSignals.push('📎 has attachments');
  if (event.signals.isBulk) activeSignals.push('📢 bulk mail');
  if (event.signals.isAutomated) activeSignals.push('🤖 automated');
  if (event.signals.hasUnsubscribe) activeSignals.push('🚫 has unsubscribe');
  if (event.signals.prioritySender) activeSignals.push('⭐ priority sender');

  if (activeSignals.length > 0) {
    lines.push(`| **Signals** | ${activeSignals.join(', ')} |`);
  }

  if (event.snippet && event.snippet.trim()) {
    lines.push('', '**Snippet:**', '', `> ${event.snippet.replace(/\n/g, '\n> ')}`);
  }

  return lines.join('\n');
}
