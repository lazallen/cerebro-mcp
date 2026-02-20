/**
 * HumanQueueProcessor — re-evaluation trigger for resolved human queue items.
 * Scans system/human/ for resolved/approved/declined items and processes them:
 * - ask_human resolved → re-evaluate parent event with human answer as context
 * - claude_approval approved/declined → handled by enrichment stage; advance to complete
 */

import { listByStatus, updateItemStatus } from './human-queue-store';
import { getEvent, saveEvent } from './triage-event-store';
import { saveDecision } from './decision-store';
import type { Policy } from '../policy/types';
import { evaluate } from '../policy/evaluator';
import { logger } from '../../common/logger';

type PolicyLoader = (source: string) => Promise<Policy>;

/**
 * Process all resolved human queue items in system/human/.
 * Returns the number of items processed.
 */
export async function processResolved(systemDir: string, policyLoader: PolicyLoader): Promise<number> {
  // Pick up items the human has resolved (answered)
  const resolvedItems = await listByStatus(systemDir, ['resolved']);
  let processed = 0;

  for (const item of resolvedItems) {
    if (item.itemType !== 'ask_human') continue;
    if (!item.answer) {
      logger.warn({
        operation: 'human_queue_missing_answer',
        id: item.id,
        eventRef: item.eventRef,
        message: `Resolved ask_human item has no answer — skipping`,
      });
      continue;
    }

    try {
      // Re-load the parent event
      const event = await getEvent(systemDir, item.eventRef);
      if (!event) {
        logger.warn({
          operation: 'human_queue_event_not_found',
          id: item.id,
          eventRef: item.eventRef,
          message: `Parent event ${item.eventRef} not found — skipping`,
        });
        continue;
      }

      // Re-evaluate with the human answer injected as context
      const humanAnswers = new Map([[item.eventRef, item.answer]]);
      const policy = await policyLoader(event.source ?? 'unknown');
      const [decision] = evaluate(policy, [event], humanAnswers);

      // Persist the new decision
      await saveDecision(systemDir, decision);

      // Append the new pass to the event artifact
      const updatedEvent = {
        ...event,
        status: 'enriched' as const,
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
      await saveEvent(systemDir, updatedEvent);

      // Advance the queue item to complete
      await updateItemStatus(systemDir, item.id, 'complete');

      logger.info({
        operation: 'human_queue_item_processed',
        id: item.id,
        eventRef: item.eventRef,
        newIntent: decision.classification.intent,
        message: `Human queue item processed: ${item.id} → ${decision.classification.intent}`,
      });

      processed++;
    } catch (err) {
      logger.error({
        operation: 'human_queue_processor_error',
        id: item.id,
        eventRef: item.eventRef,
        error: (err as Error).message,
        message: `Failed to process human queue item ${item.id}`,
      });
    }
  }

  // Advance approved/declined claude_approval items to complete
  // (actual enrichment is handled by ClaudeEnrichmentService in the pipeline)
  const approvedDeclined = await listByStatus(systemDir, ['approved', 'declined']);
  for (const item of approvedDeclined) {
    if (item.itemType !== 'claude_approval') continue;
    // These are advanced to complete by the enrichment stage — nothing to do here
  }

  return processed;
}
