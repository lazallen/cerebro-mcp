/**
 * Unit tests for LocalEnrichmentService
 * Tests: correct EnrichmentResult, truncation detection, failure handling
 */

import { LocalEnrichmentService } from '../../../src/services/enrichment/local-enrichment-service';
import type { LocalFoundryClient } from '../../../src/services/localfoundry/localfoundry-client';
import type { MessageItem } from '../../../src/lib/item/types';

function makeItem(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    type: 'MESSAGE',
    source: 'email',
    id: 'test-enrich-001',
    status: 'inbox',
    createdAt: '2026-02-19T08:00:00Z',
    subject: 'Quarterly Budget Review',
    from: 'finance@company.example',
    body: 'Please review the attached Q1 budget and provide your sign-off by Friday.',
    signals: {
      isAutomated: false,
      isBulk: false,
      hasUnsubscribe: false,
      hasAttachments: true,
      mentionsMoney: true,
      mentionsMeeting: false,
      isActionRequest: true,
      isPrioritySender: false,
    },
    actions: [{ type: 'INGEST', at: '2026-02-19T08:00:00Z', status: 'done' }],
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
      const result = await service.enrich(makeItem());

      expect(result.confidence).toBe(0.92);
      expect(result.intent).toBe('ACTION_REQUIRED');
    });

    test('strips markdown code fences from LLM response', async () => {
      const client = makeMockClient(
        '```json\n{"intent":"FYI","confidence":0.8,"summary":"Info update."}\n```'
      );

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeItem());

      expect(result.intent).toBe('FYI');
      expect(result.confidence).toBe(0.8);
    });

    test('clamps confidence to [0, 1] range', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'NEWSLETTER', confidence: 1.5 }));

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeItem());

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    test('returns UNKNOWN intent for unrecognised value', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'TOTALLY_MADE_UP', confidence: 0.7 }));

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeItem());

      expect(result.intent).toBe('UNKNOWN');
    });

    test('includes summary and entities when provided', async () => {
      const client = makeMockClient(
        JSON.stringify({
          intent: 'FYI',
          confidence: 0.8,
          summary: 'An update email.',
          entities: ['Q1', 'Finance'],
        })
      );

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeItem());

      expect(result.summary).toBe('An update email.');
      expect(result.entities).toEqual(['Q1', 'Finance']);
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
      const result = await service.enrich(makeItem());

      expect(result.confidence).toBe(0);
      expect(result.intent).toBe('UNKNOWN');
    });

    test('returns confidence 0 on invalid JSON response', async () => {
      const client = makeMockClient('not json at all');

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(makeItem());

      expect(result.confidence).toBe(0);
      expect(result.intent).toBe('UNKNOWN');
    });
  });

  describe('EVENT item enrichment', () => {
    test('enriches EventItem using title/description fields', async () => {
      const client = makeMockClient(JSON.stringify({ intent: 'SCHEDULING', confidence: 0.88 }));

      const eventItem = {
        type: 'EVENT' as const,
        source: 'calendar' as const,
        id: 'event-001',
        status: 'inbox' as const,
        createdAt: '2026-02-19T08:00:00Z',
        title: 'Q1 Planning Meeting',
        start: '2026-02-25T10:00:00Z',
        end: '2026-02-25T11:00:00Z',
        organizer: 'alice@example.com',
        signals: {
          isAutomated: false,
          isBulk: false,
          hasUnsubscribe: false,
          hasAttachments: false,
          mentionsMoney: false,
          mentionsMeeting: true,
          isActionRequest: false,
          isPrioritySender: false,
        },
        actions: [{ type: 'INGEST' as const, at: '2026-02-19T08:00:00Z', status: 'done' as const }],
      };

      const service = new LocalEnrichmentService(client as unknown as LocalFoundryClient);
      const result = await service.enrich(eventItem);

      expect(result.intent).toBe('SCHEDULING');
      expect(result.confidence).toBe(0.88);
    });
  });
});
