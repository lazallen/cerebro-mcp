/**
 * ClaudeTriageService — generates context-aware triage questions using Claude.
 *
 * Called after policy evaluation identifies a TRIAGE action. Uses the item's
 * enriched ENHANCE data (intent, summary, relatedTasks) to produce a specific,
 * action-oriented question for the human reviewer — replacing the generic
 * policy-rule fallback string.
 *
 * Uses claude-haiku-4-5 for low latency and cost.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Item, MessageItem, Action } from '../../lib/item/types';
import { logger } from '../../common/logger';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_BODY_CHARS = 300;

const SYSTEM_PROMPT =
  'Generate a concise one-sentence triage question for a human reviewer. ' +
  'Be specific and action-oriented. Return only the question, no preamble or punctuation prefix.';

export class ClaudeTriageService {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Generate a context-aware triage question for an item.
   * Uses the ENHANCE action fields (intent, summary, relatedTasks) if present.
   * Returns undefined on failure — caller should use the policy fallback question.
   */
  async generateTriageQuestion(item: Item): Promise<string | undefined> {
    try {
      const title =
        item.type === 'MESSAGE'
          ? ((item as MessageItem).subject ?? item.source)
          : item.title;
      const from =
        item.type === 'MESSAGE'
          ? ((item as MessageItem).from ?? '')
          : (item.organizer ?? '');
      const body =
        item.type === 'MESSAGE'
          ? ((item as MessageItem).body ?? '').slice(0, MAX_BODY_CHARS)
          : (item.description ?? '').slice(0, MAX_BODY_CHARS);

      // Pull enrichment data from ENHANCE action if it exists
      const enhanceAction = item.actions.find(
        (a): a is Action & { intent: string } => a.type === 'ENHANCE' && a.status === 'done'
      );
      const intent = enhanceAction?.intent ?? 'UNKNOWN';
      const summary = enhanceAction?.summary;
      const relatedTasks = enhanceAction?.relatedTasks ?? [];

      const parts: string[] = [
        `Subject: ${title}`,
        `From: ${from}`,
        `Intent: ${intent}${enhanceAction?.confidence !== undefined ? ` (${Math.round(enhanceAction.confidence * 100)}% confidence)` : ''}`,
      ];
      if (summary) parts.push(`Summary: ${summary}`);
      if (relatedTasks.length > 0) {
        parts.push(`Related tasks: ${relatedTasks.join(', ')}`);
      }
      if (body) parts.push(`\nMessage:\n${body}`);

      const userContent = parts.join('\n') + '\n\nGenerate a triage question.';

      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });

      const text =
        message.content[0]?.type === 'text' ? message.content[0].text.trim() : undefined;

      if (text && text.length > 0) {
        logger.debug({
          operation: 'claude_triage_question_generated',
          itemId: item.id,
          question: text,
          message: `Triage question generated for ${item.id}`,
        });
        return text;
      }

      return undefined;
    } catch (err) {
      logger.warn({
        operation: 'claude_triage_question_error',
        itemId: item.id,
        error: (err as Error).message,
        message: `Claude triage question failed for ${item.id} — using policy fallback`,
      });
      return undefined;
    }
  }
}
