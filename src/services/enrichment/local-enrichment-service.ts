/**
 * LocalEnrichmentService — phi-4-mini enrichment via LocalFoundry.
 * Sends a structured JSON-output prompt and extracts intent, confidence,
 * summary, and entities. Never throws — returns confidence: 0 on failure.
 */

import type { LocalFoundryClient } from '../localfoundry/localfoundry-client';
import type {
  TriageEvent,
  EnrichmentResult,
  ExtractedFields,
  IntentType,
} from '../../lib/policy/types';
import { logger } from '../../common/logger';

/** Maximum approximate token budget for the event body (chars × 0.75 ≈ tokens) */
const MAX_BODY_CHARS = 2000; // ~1,500 tokens

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

export class LocalEnrichmentService {
  constructor(private readonly lfClient: LocalFoundryClient) {}

  /**
   * Enrich a TriageEvent with LLM-extracted fields via phi-4-mini.
   * Returns an EnrichmentResult. On any failure, returns confidence 0 with
   * error logged — never throws.
   */
  async enrich(event: TriageEvent): Promise<EnrichmentResult> {
    const start = Date.now();

    // Build prompt body — truncate if too long
    let body = `Subject: ${event.title}\nFrom: ${event.author}\n\n${event.snippet ?? ''}`;
    let truncated = false;
    if (body.length > MAX_BODY_CHARS) {
      body = body.slice(0, MAX_BODY_CHARS);
      truncated = true;
    }

    const userPrompt = `Classify this message:\n\n${body}`;

    try {
      const raw = await this.lfClient.chatCompletion([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);
      const parsed = parseEnrichmentResponse(raw);

      const result: EnrichmentResult = {
        eventId: event.eventId,
        tier: 'local',
        confidence: parsed.confidence,
        extracted: {
          intent: parsed.intent,
          confidence: parsed.confidence,
          summary: parsed.summary,
          entities: parsed.entities,
          llmTier: 'local',
        } as ExtractedFields,
        truncated,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };

      logger.debug({
        operation: 'local_enrichment_complete',
        eventId: event.eventId,
        intent: parsed.intent,
        confidence: parsed.confidence,
        truncated,
        message: `Local enrichment complete: ${event.eventId}`,
      });

      return result;
    } catch (err) {
      logger.warn({
        operation: 'local_enrichment_error',
        eventId: event.eventId,
        error: (err as Error).message,
        message: `Local enrichment failed for ${event.eventId} — returning confidence 0`,
      });

      return {
        eventId: event.eventId,
        tier: 'local',
        confidence: 0,
        extracted: {
          intent: 'UNKNOWN',
          confidence: 0,
          llmTier: 'local',
        } as ExtractedFields,
        truncated,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  }
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
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Not valid JSON — return unknown
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
    ? (parsed['entities'] as unknown[]).filter((e) => typeof e === 'string')
    : undefined;

  return { intent, confidence, summary, entities };
}
