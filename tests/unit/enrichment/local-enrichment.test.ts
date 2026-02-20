/**
 * Unit tests for LocalEnrichmentService (T045)
 * Tests: truncation, failure returns confidence 0, llmTier field
 */

import { LocalEnrichmentService } from '../../../src/services/enrichment/local-enrichment-service';
import type { LocalFoundryClient } from '../../../src/services/localfoundry/localfoundry-client';
import type { TriageEvent } from '../../../src/lib/policy/types';

function makeEvent(overrides: Partial<TriageEvent> = {}): TriageEvent {
  return {
    eventId: 'test-enrich-001',
    source: 'email',
    status: 'pending',
    title: 'Quarterly Budget Review',
    author: 'finance@company.example',
    receivedAt: '2026-02-19T08:00:00Z',
    snippet: 'Please review the attached Q1 budget and provide your sign-off by Friday.',
    signals: {
      isAutomated: false,
      isBulk: false,
      hasUnsubscribe: false,
      hasAttachments: true,
      mentionsMoney: true,
      mentionsMeeting: false,
      asksForAction: true,
      prioritySender: false,
    },
    extracted: {},
    passCount: 0,
    passes: [],
    ...overrides,
  };
}

function makeMockClient(responseText: string): Pick<LocalFoundryClient, 'chatCompletion'> {
  return {
    chatCompletion: jest
      .fn()
      .mockResolvedValue(responseText) as LocalFoundryClient['chatCompletion'],
  };
}

describe('LocalEnrichmentService', () => {
  describe('successful enrichment', () => {
    test('returns correct intent and confidence from LLM response', async () => {
      const client = makeMockClient(
        JSON.stringify({
          intent: 'ACTION_REQUIRED',
          confidence: 0.92,
          summary: 'Budget review sign-off requested by Friday.',
          entities: ['Q1 budget'],
        })
      );

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.confidence).toBe(0.92);
      expect(result.extracted.intent).toBe('ACTION_REQUIRED');
      expect(result.extracted.confidence).toBe(0.92);
      expect(result.extracted.llmTier).toBe('local');
      expect(result.tier).toBe('local');
      expect(result.truncated).toBe(false);
    });

    test('strips markdown code fences from LLM response', async () => {
      const client = makeMockClient(
        '```json\n{"intent":"FYI","confidence":0.8,"summary":"Info update."}\n```'
      );

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.extracted.intent).toBe('FYI');
      expect(result.confidence).toBe(0.8);
    });

    test('clamps confidence to [0, 1] range', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'NEWSLETTER', confidence: 1.5 }));

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    test('unknown intent for unrecognised value', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'TOTALLY_MADE_UP', confidence: 0.7 }));

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.extracted.intent).toBe('UNKNOWN');
    });
  });

  describe('truncation', () => {
    test('truncated: true when body exceeds ~1500 tokens', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'FYI', confidence: 0.6 }));

      // Create an event with a very long snippet (>2000 chars)
      const longSnippet = 'x'.repeat(3000);
      const event = makeEvent({ snippet: longSnippet });

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(event);

      expect(result.truncated).toBe(true);
    });

    test('truncated: false for short body', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'ACTION_REQUIRED', confidence: 0.9 }));

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.truncated).toBe(false);
    });
  });

  describe('failure handling', () => {
    test('returns confidence 0 on LLM client throw — does not rethrow', async () => {
      const client: Pick<LocalFoundryClient, 'chatCompletion'> = {
        chatCompletion: jest
          .fn()
          .mockRejectedValue(
            new Error('LLM connection timeout')
          ) as LocalFoundryClient['chatCompletion'],
      };

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.confidence).toBe(0);
      expect(result.extracted.intent).toBe('UNKNOWN');
      expect(result.tier).toBe('local');
    });

    test('returns confidence 0 on invalid JSON response', async () => {
      const client = makeMockClient('not json at all');

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.confidence).toBe(0);
      expect(result.extracted.intent).toBe('UNKNOWN');
    });

    test('extracted.llmTier is always "local" even on failure', async () => {
      const client: Pick<LocalFoundryClient, 'chatCompletion'> = {
        chatCompletion: jest
          .fn()
          .mockRejectedValue(new Error('timeout')) as LocalFoundryClient['chatCompletion'],
      };

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeEvent());

      expect(result.extracted.llmTier).toBe('local');
    });
  });
});
