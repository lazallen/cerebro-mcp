/**
 * Triage MCP Service
 *
 * Exposes the triage queue via MCP so Claude (or the user) can inspect
 * pending TRIAGE items and resolve them with answers that feed back into
 * the policy pipeline.
 *
 * Tools:
 *   triage.list-pending-reviews  — list items with status: triage
 *   triage.resolve-review        — resolve an item (sets status: inbox for re-eval)
 */

import * as path from 'path';
import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common/logger';
import { listItems, getItem, updateItem } from '../../lib/item/item-store';
import type { Action } from '../../lib/item/types';

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
          'List all items waiting for human review (status: triage). ' +
          'Returns each item with its triage question and context ' +
          '(source, title, body preview, signals) so you can help decide what to do.',
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
          'Resolve a pending triage item with an answer. ' +
          'The answer is stored on the TRIAGE action and the item is moved back to inbox ' +
          'so the policy pipeline re-evaluates it with your response as context.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The item ID to resolve (from list-pending-reviews)',
            },
            answer: {
              type: 'string',
              description:
                'Your decision or instruction for this item. ' +
                "Examples: 'Archive it', 'Create a task: book LNER tickets for BCN', " +
                "'Flag and reply: I'll review by Friday'",
            },
          },
          required: ['id', 'answer'],
        },
        handler: this.resolveReview.bind(this),
      },
    ];
  }

  private async listPendingReviews(_input: Record<string, unknown>): Promise<unknown> {
    const items = await listItems(this.systemDir, ['triage']);

    if (items.length === 0) {
      return { count: 0, reviews: [], message: 'No pending reviews.' };
    }

    const reviews = items
      .map((item) => {
        const triageAction = item.actions
          .filter((a: Action) => a.type === 'TRIAGE' && a.status === 'pending')
          .pop();
        if (!triageAction) return null;

        const title =
          item.type === 'MESSAGE' ? (item.subject ?? `Message from ${item.source}`) : item.title;

        const body = item.type === 'MESSAGE' ? item.body : (item.description ?? '');

        return {
          id: item.id,
          createdAt: item.createdAt,
          source: item.source,
          title,
          question: triageAction.question ?? '(no question specified)',
          bodyPreview: body ? body.slice(0, 500) : '',
          signals: Object.entries(item.signals ?? {})
            .filter(([, v]) => v === true)
            .map(([k]) => k),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

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

    const item = await getItem(this.systemDir, id);
    if (!item) {
      return { success: false, error: `No item found with id "${id}"` };
    }
    if (item.status !== 'triage') {
      return {
        success: false,
        error: `Item "${id}" is not in triage state (status: ${item.status})`,
      };
    }

    // Mark the pending TRIAGE action as done with the human answer
    const triageAction = item.actions
      .filter((a: Action) => a.type === 'TRIAGE' && a.status === 'pending')
      .pop();
    if (triageAction) {
      triageAction.status = 'done';
      triageAction.answer = answer.trim();
      triageAction.at = new Date().toISOString();
    }

    // Send back to inbox for policy re-evaluation with the answer in context
    item.status = 'inbox';

    await updateItem(this.systemDir, item);

    logger.info({
      operation: 'triage_resolve_review',
      id,
      message: `Review resolved: ${id}`,
    });

    return {
      success: true,
      message:
        `Item ${id} resolved. The policy pipeline will re-evaluate on its next cycle ` +
        `using your answer as context.`,
    };
  }
}
