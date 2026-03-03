/**
 * LocalEnrichmentService — phi-4-mini enrichment via LocalFoundry.
 * Sends a structured JSON-output prompt and extracts intent, confidence,
 * summary, and entities. Never throws — returns confidence: 0 on failure.
 */

import type { LocalFoundryClient } from '../localfoundry/localfoundry-client';
import type { Item, MessageItem, Action } from '../../lib/item/types';
import type { IntentType } from '../../lib/policy/types';
import { logger } from '../../common/logger';

/**
 * Maximum chars for the full prompt (Subject + From + body).
 * phi-4-mini on NPU has a hard limit of 1024 input tokens. The system prompt
 * consumes ~375 tokens and the user prefix ~20, leaving ~580 tokens ≈ 770 chars.
 * Using 600 to leave a comfortable margin.
 *
 * When a context brief is provided, we reserve ~200 chars for it and reduce
 * the body budget to 400 chars. Total stays at ~600.
 */
const MAX_BODY_CHARS = 600;
const MAX_BODY_CHARS_WITH_CONTEXT = 400;
const MAX_CONTEXT_BRIEF_CHARS = 200;

const SYSTEM_PROMPT = `You are a concise email/message classifier. Analyse the provided message and return ONLY a valid JSON object (no markdown, no explanation) matching this schema:
{
  "intent": "NEWSLETTER|RECEIPT|SPAM|SCHEDULING|ACTION_REQUIRED|FYI|UNKNOWN",
  "confidence": 0.0,
  "summary": "one sentence summary",
  "entities": ["entity1", "entity2"]
}

Intent definitions:
- NEWSLETTER: bulk marketing / informational digest
- RECEIPT: payment confirmation / invoice
- SPAM: unsolicited junk
- SCHEDULING: meeting invite or calendar-related request
- ACTION_REQUIRED: explicit request for human action or decision
- FYI: informational update, no action needed
- UNKNOWN: cannot determine`;

const TASK_MATCH_SYSTEM_PROMPT = `You match messages to open tasks. Return ONLY valid JSON: {"relatedTasks":["slug"]}. List 0-2 task slugs that are clearly related to the message. Use exact slugs from the provided list. Return empty array if nothing clearly matches.`;

const TRIAGE_QUESTION_SYSTEM_PROMPT = `Generate a concise one-sentence triage question for a human reviewer. Be specific and action-oriented. Return only the question, no preamble.`;

export interface EnrichmentResult {
  intent: IntentType;
  confidence: number;
  summary?: string;
  entities?: string[];
}

export class LocalEnrichmentService {
  constructor(private readonly lfClient: LocalFoundryClient) {}

  /**
   * Enrich an Item with LLM-extracted fields via phi-4-mini.
   * @param contextBrief Optional journal context snippets (≤200 chars) to inject into prompt.
   * Returns an EnrichmentResult. On any failure, returns confidence 0 — never throws.
   */
  async enrich(item: Item, contextBrief?: string): Promise<EnrichmentResult> {
    const title =
      item.type === 'MESSAGE'
        ? ((item as MessageItem).subject ?? item.source)
        : item.title;
    const from =
      item.type === 'MESSAGE' ? ((item as MessageItem).from ?? '') : (item.organizer ?? '');
    const body =
      item.type === 'MESSAGE'
        ? ((item as MessageItem).body ?? '')
        : (item.description ?? '');

    const bodyLimit = contextBrief ? MAX_BODY_CHARS_WITH_CONTEXT : MAX_BODY_CHARS;
    let prompt = `Subject: ${title}\nFrom: ${from}\n\n${body}`;
    if (prompt.length > bodyLimit) {
      prompt = prompt.slice(0, bodyLimit);
    }

    const brief =
      contextBrief && contextBrief.length > 0
        ? contextBrief.slice(0, MAX_CONTEXT_BRIEF_CHARS)
        : undefined;
    const userContent = brief
      ? `Context from recent journal:\n${brief}\n\nClassify this message:\n\n${prompt}`
      : `Classify this message:\n\n${prompt}`;

    try {
      const raw = await this.lfClient.chatCompletion([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]);
      const parsed = parseEnrichmentResponse(raw);

      logger.debug({
        operation: 'local_enrichment_complete',
        itemId: item.id,
        intent: parsed.intent,
        confidence: parsed.confidence,
        message: `Local enrichment complete: ${item.id}`,
      });

      return parsed;
    } catch (err) {
      logger.warn({
        operation: 'local_enrichment_error',
        itemId: item.id,
        error: (err as Error).message,
        message: `Local enrichment failed for ${item.id} — returning confidence 0`,
      });

      return { intent: 'UNKNOWN', confidence: 0 };
    }
  }

  /**
   * Second enrichment call — matches item against a list of open tasks.
   * Returns up to 2 task slugs that are clearly related. Returns [] on any failure.
   */
  async findRelatedTasks(
    item: Item,
    tasks: Array<{ id: string; title: string }>
  ): Promise<string[]> {
    if (tasks.length === 0) return [];

    const title =
      item.type === 'MESSAGE'
        ? ((item as MessageItem).subject ?? item.source)
        : item.title;
    const from =
      item.type === 'MESSAGE' ? ((item as MessageItem).from ?? '') : (item.organizer ?? '');

    const taskLines = tasks.map((t) => `${t.id}: ${t.title}`).join('\n');

    const userContent =
      `Message: ${title}\nFrom: ${from}\n\nOpen tasks:\n${taskLines}\n\nWhich tasks are related?`;

    try {
      const raw = await this.lfClient.chatCompletion([
        { role: 'system', content: TASK_MATCH_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]);

      const relatedTasks = parseTaskMatchResponse(raw, tasks.map((t) => t.id));

      logger.debug({
        operation: 'local_enrichment_task_match',
        itemId: item.id,
        relatedTasks,
        message: `Task match complete: ${item.id} → [${relatedTasks.join(', ')}]`,
      });

      return relatedTasks;
    } catch (err) {
      logger.warn({
        operation: 'local_enrichment_task_match_error',
        itemId: item.id,
        error: (err as Error).message,
        message: `Task match failed for ${item.id} — returning no related tasks`,
      });
      return [];
    }
  }

  /**
   * Third enrichment call — generates a context-aware one-sentence triage question.
   * Uses intent, summary, and relatedTasks from the existing ENHANCE action on the item.
   * Returns undefined on any failure — caller should use the policy fallback question.
   */
  async generateTriageQuestion(item: Item): Promise<string | undefined> {
    const title =
      item.type === 'MESSAGE'
        ? ((item as MessageItem).subject ?? item.source)
        : item.title;
    const from =
      item.type === 'MESSAGE' ? ((item as MessageItem).from ?? '') : (item.organizer ?? '');

    const enhanceAction = item.actions.find((a) => a.type === 'ENHANCE' && a.status === 'done');
    const intent = enhanceAction?.intent ?? 'UNKNOWN';
    const summary = enhanceAction?.summary;
    const relatedTasks = enhanceAction?.relatedTasks ?? [];

    const parts = [
      `Subject: ${title}`,
      `From: ${from}`,
      `Intent: ${intent}`,
    ];
    if (summary) parts.push(`Summary: ${summary}`);
    if (relatedTasks.length > 0) parts.push(`Related tasks: ${relatedTasks.join(', ')}`);

    const userContent = parts.join('\n') + '\n\nGenerate a triage question.';

    try {
      const raw = await this.lfClient.chatCompletion([
        { role: 'system', content: TRIAGE_QUESTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]);

      const question = raw.trim().replace(/^["']|["']$/g, '');
      if (question.length > 0 && question.length < 300) {
        logger.debug({
          operation: 'local_enrichment_triage_question',
          itemId: item.id,
          question,
          message: `Triage question generated for ${item.id}`,
        });
        return question;
      }
      return undefined;
    } catch (err) {
      logger.warn({
        operation: 'local_enrichment_triage_question_error',
        itemId: item.id,
        error: (err as Error).message,
        message: `Triage question generation failed for ${item.id} — using policy fallback`,
      });
      return undefined;
    }
  }
}

/**
 * Build an ENHANCE Action from an enrichment result, ready to append to an item.
 */
export function buildEnhanceAction(result: EnrichmentResult): Action {
  return {
    type: 'ENHANCE',
    at: new Date().toISOString(),
    status: 'done',
    intent: result.intent,
    confidence: result.confidence,
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.entities !== undefined ? { entities: result.entities } : {}),
  };
}

interface ParsedEnrichment {
  intent: IntentType;
  confidence: number;
  summary?: string;
  entities?: string[];
}

const VALID_INTENTS = new Set<string>([
  'NEWSLETTER',
  'RECEIPT',
  'SPAM',
  'SCHEDULING',
  'ACTION_REQUIRED',
  'FYI',
  'UNKNOWN',
]);

function parseEnrichmentResponse(raw: string): ParsedEnrichment {
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { intent: 'UNKNOWN', confidence: 0 };
  }

  const intent =
    typeof parsed['intent'] === 'string' && VALID_INTENTS.has(parsed['intent'])
      ? (parsed['intent'] as IntentType)
      : 'UNKNOWN';

  const confidence =
    typeof parsed['confidence'] === 'number' ? Math.max(0, Math.min(1, parsed['confidence'])) : 0;

  const summary = typeof parsed['summary'] === 'string' ? parsed['summary'] : undefined;
  const entities = Array.isArray(parsed['entities'])
    ? (parsed['entities'] as unknown[]).filter((e): e is string => typeof e === 'string')
    : undefined;

  return { intent, confidence, summary, entities };
}

function parseTaskMatchResponse(raw: string, validIds: string[]): string[] {
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed['relatedTasks'])) return [];

  const validSet = new Set(validIds);
  return (parsed['relatedTasks'] as unknown[])
    .filter((id): id is string => typeof id === 'string' && validSet.has(id))
    .slice(0, 2);
}
