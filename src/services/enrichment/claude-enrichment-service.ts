/**
 * ClaudeEnrichmentService — Claude haiku enrichment for low-confidence events.
 * Requires an approved claude_approval item in system/human/ before it will run.
 * Throws UnauthorizedEnrichmentError if approval not found.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  TriageEvent,
  EnrichmentResult,
  ExtractedFields,
  IntentType,
} from '../../lib/policy/types';
import { listByStatus, updateItemStatus } from '../../lib/triage/human-queue-store';
import { logger } from '../../common/logger';

export class UnauthorizedEnrichmentError extends Error {
  constructor(eventId: string, approvalItemId: string) {
    super(
      `Claude enrichment not authorized for event ${eventId}: ` +
        `approval item ${approvalItemId} not found or not in 'approved' state`
    );
    this.name = 'UnauthorizedEnrichmentError';
  }
}

const MAX_BODY_CHARS = 4000;

const SYSTEM_PROMPT = `You are a precise message classifier and summarizer.
Analyse the message and return ONLY a valid JSON object (no markdown, no explanation):
{
  "intent": "NEWSLETTER|RECEIPT|SPAM|SCHEDULING|ACTION_REQUIRED|FYI|UNKNOWN",
  "confidence": 0.0,
  "summary": "2-3 sentence summary",
  "entities": ["person", "org", "date", "amount"],
  "actionItems": ["specific action 1", "specific action 2"],
  "keyDate": "YYYY-MM-DD or null"
}`;

export class ClaudeEnrichmentService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Enrich a TriageEvent with Claude.
   * Verifies that approvalItemId corresponds to an 'approved' item in system/human/.
   * Throws UnauthorizedEnrichmentError if authorization check fails.
   */
  async enrich(
    event: TriageEvent,
    approvalItemId: string,
    systemDir: string
  ): Promise<EnrichmentResult> {
    const start = Date.now();

    // Authorization check — must have an approved item
    const approvedItems = await listByStatus(systemDir, ['approved']);
    const approvalItem = approvedItems.find((i) => i.id === approvalItemId);
    if (!approvalItem) {
      throw new UnauthorizedEnrichmentError(event.eventId, approvalItemId);
    }

    let body = `Subject: ${event.title}\nFrom: ${event.author}\n\n${event.snippet ?? ''}`;
    let truncated = false;
    if (body.length > MAX_BODY_CHARS) {
      body = body.slice(0, MAX_BODY_CHARS);
      truncated = true;
    }

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${SYSTEM_PROMPT}\n\nMessage to classify:\n\n${body}` }],
    });

    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const parsed = parseClaudeResponse(raw);

    // Advance approval item to complete
    await updateItemStatus(systemDir, approvalItemId, 'complete');

    const result: EnrichmentResult = {
      eventId: event.eventId,
      tier: 'claude',
      confidence: parsed.confidence,
      extracted: {
        intent: parsed.intent,
        confidence: parsed.confidence,
        summary: parsed.summary,
        entities: parsed.entities,
        llmTier: 'claude',
        claudeEnriched: true,
        claudeApprovalRef: approvalItemId,
      } as ExtractedFields,
      truncated,
      claudeApprovalRef: approvalItemId,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };

    logger.info({
      operation: 'claude_enrichment_complete',
      eventId: event.eventId,
      intent: parsed.intent,
      confidence: parsed.confidence,
      approvalItemId,
      message: `Claude enrichment complete: ${event.eventId}`,
    });

    return result;
  }
}

interface ParsedClaudeResponse {
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

function parseClaudeResponse(raw: string): ParsedClaudeResponse {
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

  return {
    intent,
    confidence,
    summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : undefined,
    entities: Array.isArray(parsed['entities'])
      ? (parsed['entities'] as unknown[]).filter((e) => typeof e === 'string')
      : undefined,
  };
}
