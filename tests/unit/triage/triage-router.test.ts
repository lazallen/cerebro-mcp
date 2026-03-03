/**
 * Unit tests for TriageRouter
 * Tests the API handlers in isolation by mocking the item-store module.
 */

import * as http from 'http';
import { EventEmitter } from 'events';

// Mock item-store before importing TriageRouter
jest.mock('../../../src/lib/item/item-store');

import { TriageRouter } from '../../../src/auth-server/triage-router';
import * as itemStore from '../../../src/lib/item/item-store';
import type { Item, MessageItem } from '../../../src/lib/item/types';

const mockedStore = itemStore as jest.Mocked<typeof itemStore>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTriageItem(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    type: 'MESSAGE',
    source: 'email',
    id: 'test-item-001',
    status: 'triage',
    createdAt: '2026-02-24T10:00:00.000Z',
    subject: 'Test Email Subject',
    from: 'sender@example.com',
    body: 'This is the email body.',
    signals: {
      isAutomated: false,
      isBulk: false,
      hasUnsubscribe: false,
      hasAttachments: false,
      mentionsMoney: false,
      mentionsMeeting: false,
      isActionRequest: false,
      isPrioritySender: false,
    },
    actions: [
      { type: 'INGEST', at: '2026-02-24T09:00:00Z', status: 'done' },
      {
        type: 'TRIAGE',
        at: '2026-02-24T09:01:00Z',
        status: 'pending',
        question: 'What should we do?',
      },
    ],
    ...overrides,
  };
}

function makeRouter(): TriageRouter {
  return new TriageRouter('./system', './context');
}

function makeRequest(method: string): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage;
  req.method = method;
  return req;
}

function makeResponse(): {
  res: http.ServerResponse;
  result: { statusCode: number; body: string };
} {
  const result = { statusCode: 200, body: '' };
  const res = {
    writeHead(code: number) {
      result.statusCode = code;
    },
    end(data: unknown) {
      result.body = data ? String(data) : '';
    },
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, result };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TriageRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: fs.readFile throws (no static files in tests)
  });

  describe('loadPendingItems', () => {
    it('returns empty array when no triage items', async () => {
      mockedStore.listItems.mockResolvedValue([]);

      const router = makeRouter();
      const items = await router.loadPendingItems();
      expect(items).toEqual([]);
    });

    it('returns pending items with correct fields', async () => {
      mockedStore.listItems.mockResolvedValue([makeTriageItem()]);

      const router = makeRouter();
      const items = await router.loadPendingItems();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('test-item-001');
      expect(items[0].source).toBe('email');
      expect(items[0].title).toBe('Test Email Subject');
      expect(items[0].question).toBe('What should we do?');
      expect(items[0].bodyMarkdown).toBe('This is the email body.');
    });

    it('filters out items with no pending TRIAGE action', async () => {
      const itemNoTriage = makeTriageItem({
        actions: [{ type: 'INGEST', at: '2026-02-24T09:00:00Z', status: 'done' }],
      });
      mockedStore.listItems.mockResolvedValue([itemNoTriage]);

      const router = makeRouter();
      const items = await router.loadPendingItems();
      expect(items).toHaveLength(0);
    });

    it('sorts items by createdAt ascending', async () => {
      const itemB = makeTriageItem({ id: 'id-b', createdAt: '2026-02-24T12:00:00.000Z' });
      const itemA = makeTriageItem({ id: 'id-a', createdAt: '2026-02-24T09:00:00.000Z' });
      mockedStore.listItems.mockResolvedValue([itemB, itemA]);

      const router = makeRouter();
      const items = await router.loadPendingItems();
      expect(items[0].id).toBe('id-a');
      expect(items[1].id).toBe('id-b');
    });

    it('uses id as fallback title for EVENT items', async () => {
      const eventItem = {
        type: 'EVENT' as const,
        source: 'calendar' as const,
        id: 'event-001',
        status: 'triage' as const,
        createdAt: '2026-02-24T10:00:00Z',
        title: 'Q1 Planning Meeting',
        start: '2026-02-25T10:00:00Z',
        end: '2026-02-25T11:00:00Z',
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
        actions: [
          { type: 'INGEST' as const, at: '2026-02-24T09:00:00Z', status: 'done' as const },
          {
            type: 'TRIAGE' as const,
            at: '2026-02-24T09:01:00Z',
            status: 'pending' as const,
            question: 'Accept this meeting?',
          },
        ],
      };
      mockedStore.listItems.mockResolvedValue([eventItem] as Item[]);

      const router = makeRouter();
      const items = await router.loadPendingItems();
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Q1 Planning Meeting');
      expect(items[0].question).toBe('Accept this meeting?');
    });
  });

  describe('POST /triage/api/items/:id/resolve', () => {
    it('returns 404 for unknown item id', async () => {
      mockedStore.getItem.mockResolvedValue(null);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/non-existent-id/resolve'
      );
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'done' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(404);
      const parsed = JSON.parse(result.body);
      expect(parsed.ok).toBe(false);
    });

    it('returns 400 for invalid resolution value', async () => {
      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(req, res, '/triage/api/items/some-id/resolve');
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'invalid-value' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(400);
    });

    it('returns 409 for item not in triage state', async () => {
      const doneItem = makeTriageItem({ status: 'done' });
      mockedStore.getItem.mockResolvedValue(doneItem);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/test-item-001/resolve'
      );
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'done' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(409);
    });

    it('resolves done: marks TRIAGE done, appends ARCHIVE, sets pending', async () => {
      const item = makeTriageItem();
      mockedStore.getItem.mockResolvedValue(item);
      mockedStore.updateItem.mockResolvedValue(undefined);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/test-item-001/resolve'
      );
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'done' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(200);
      expect(mockedStore.updateItem).toHaveBeenCalledTimes(1);
      const savedItem = mockedStore.updateItem.mock.calls[0][1] as MessageItem;
      expect(savedItem.status).toBe('pending');
      const archiveAction = savedItem.actions.find((a) => a.type === 'ARCHIVE');
      expect(archiveAction).toBeDefined();
      expect(archiveAction?.status).toBe('pending');
    });

    it('resolves defer: appends CREATE_TASK action', async () => {
      const item = makeTriageItem();
      mockedStore.getItem.mockResolvedValue(item);
      mockedStore.updateItem.mockResolvedValue(undefined);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/test-item-001/resolve'
      );
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'defer' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(200);
      const savedItem = mockedStore.updateItem.mock.calls[0][1] as MessageItem;
      expect(savedItem.actions.some((a) => a.type === 'CREATE_TASK')).toBe(true);
    });

    it('resolves delegate: marks TRIAGE done with answer, sets inbox', async () => {
      const item = makeTriageItem();
      mockedStore.getItem.mockResolvedValue(item);
      mockedStore.updateItem.mockResolvedValue(undefined);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/test-item-001/resolve'
      );
      req.emit(
        'data',
        Buffer.from(JSON.stringify({ resolution: 'delegate', answer: 'Create task for this' }))
      );
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(200);
      const savedItem = mockedStore.updateItem.mock.calls[0][1] as MessageItem;
      expect(savedItem.status).toBe('inbox');
      const triageAction = savedItem.actions.find(
        (a) => a.type === 'TRIAGE' && a.status === 'done'
      );
      expect(triageAction?.answer).toBe('Create task for this');
    });

    it('returns 400 for delegate without answer', async () => {
      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('POST');

      const handlePromise = router.handleRequest(
        req,
        res,
        '/triage/api/items/test-item-001/resolve'
      );
      req.emit('data', Buffer.from(JSON.stringify({ resolution: 'delegate' })));
      req.emit('end');

      await handlePromise;

      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /triage/api/items', () => {
    it('returns list of triage items', async () => {
      mockedStore.listItems.mockResolvedValue([makeTriageItem()]);

      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('GET');

      await router.handleRequest(req, res, '/triage/api/items');

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.items).toHaveLength(1);
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown paths', async () => {
      const router = makeRouter();
      const { res, result } = makeResponse();
      const req = makeRequest('GET');

      await router.handleRequest(req, res, '/triage/api/unknown');

      expect(result.statusCode).toBe(404);
    });
  });
});
