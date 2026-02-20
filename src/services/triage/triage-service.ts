/**
 * Triage MCP Service
 *
 * Exposes the human review queue via MCP so Claude (or the user) can inspect
 * pending ASK_HUMAN items and resolve them with answers that feed back into
 * the policy pipeline.
 *
 * Tools:
 *   triage.list-pending-reviews  — list pending ask_human items with event context
 *   triage.resolve-review        — resolve an item with a human answer
 */

import * as path from 'path';
import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common/logger';
import { listByStatus, updateItemStatus } from '../../lib/triage/human-queue-store';
import { getEvent } from '../../lib/triage/triage-event-store';

export class TriageService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string;
  private readonly systemDir: string;

  constructor(config: ServiceConfig, systemDir: string) {
    this.config = config;
    this.name = config.name;
    this.systemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async initialize(): Promise<void> {
    logger.info({
      operation: 'triage_service_init',
      systemDir: this.systemDir,
      message: 'TriageService initialized',
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return true; // File-based; no auth required
  }

  async shutdown(): Promise<void> {}

  getTools(): Tool[] {
    return [
      {
        name: 'list-pending-reviews',
        description:
          'List all pending human review items (ask_human) from the triage queue. ' +
          'Returns each item with its question and the associated email/calendar event context ' +
          '(title, snippet, signals, latest policy decision) so you can help decide what to do.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        handler: this.listPendingReviews.bind(this),
      },
      {
        name: 'resolve-review',
        description:
          'Resolve a pending human review item with an answer. ' +
          'The answer is stored on the queue item and the policy pipeline will ' +
          're-evaluate the original event on its next cycle using your response as context.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The UUID of the human queue item to resolve (from list-pending-reviews)',
            },
            answer: {
              type: 'string',
              description:
                'Your decision or instruction for this item. ' +
                'Examples: "Archive it", "Create a task: book LNER tickets for BCN", ' +
                '"Flag and reply: I\'ll review by Friday"',
            },
          },
          required: ['id', 'answer'],
        },
        handler: this.resolveReview.bind(this),
      },
    ];
  }

  private async listPendingReviews(_input: Record<string, unknown>): Promise<unknown> {
    const items = await listByStatus(this.systemDir, ['pending']);
    const askHumanItems = items.filter((i) => i.itemType === 'ask_human');

    if (askHumanItems.length === 0) {
      return { count: 0, reviews: [], message: 'No pending reviews.' };
    }

    const reviews = await Promise.all(
      askHumanItems.map(async (item) => {
        const event = await getEvent(this.systemDir, item.eventRef);
        return {
          id: item.id,
          createdAt: item.createdAt,
          question: item.question ?? '(no question specified)',
          event: event
            ? {
                eventId: event.eventId,
                source: event.source,
                title: event.title,
                author: event.author,
                receivedAt: event.receivedAt,
                snippet: event.snippet || '(no snippet)',
                signals: Object.entries(event.signals)
                  .filter(([, v]) => v === true)
                  .map(([k]) => k),
                latestDecision: event.latestPassTimestamp
                  ? {
                      timestamp: event.latestPassTimestamp,
                      intent: event.extracted?.['intent'],
                      confidence: event.extracted?.['confidence'],
                    }
                  : null,
              }
            : { eventId: item.eventRef, note: 'Event file not found (may have been archived)' },
        };
      })
    );

    logger.info({
      operation: 'triage_list_pending_reviews',
      count: reviews.length,
      message: `Listed ${reviews.length} pending review(s)`,
    });

    return { count: reviews.length, reviews };
  }

  private async resolveReview(input: Record<string, unknown>): Promise<unknown> {
    const id = input['id'] as string | undefined;
    const answer = input['answer'] as string | undefined;

    if (!id || typeof id !== 'string') {
      return { success: false, error: 'Missing or invalid "id" parameter' };
    }
    if (!answer || typeof answer !== 'string' || answer.trim() === '') {
      return { success: false, error: 'Missing or empty "answer" parameter' };
    }

    const found = await updateItemStatus(this.systemDir, id, 'resolved', answer.trim());

    if (!found) {
      return { success: false, error: `No pending review found with id "${id}"` };
    }

    logger.info({
      operation: 'triage_resolve_review',
      id,
      message: `Review resolved: ${id}`,
    });

    return {
      success: true,
      message:
        `Review ${id} resolved. The policy pipeline will re-evaluate the event ` +
        `on its next cycle using your answer as context.`,
    };
  }
}
