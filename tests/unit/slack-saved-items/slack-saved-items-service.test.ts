/**
 * Unit tests for SlackSavedItemsService (Feature 020)
 * Covers list-saved-items (T011) and mark-saved-item-complete (T013)
 */

import { SlackSavedItemsService } from '../../../src/services/slack-saved-items/slack-saved-items-service';
import {
  CredentialsNotConfiguredError,
  CredentialsExpiredError,
  CredentialsInvalidError,
  RateLimitedError,
} from '../../../src/services/slack-saved-items/webclient-api-client';
import type { SessionCredentialStorage } from '../../../src/services/slack-saved-items/session-credential-storage';
import type { WebclientApiClient } from '../../../src/services/slack-saved-items/webclient-api-client';
import type { RawSavedListResponse, RawSavedItem } from '../../../src/types/slack-saved-items';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawItem(overrides: Partial<RawSavedItem> = {}): RawSavedItem {
  return {
    item_id: 'C1234567890',
    item_type: 'message',
    ts: '1740000000.123456',
    state: 'uncompleted',
    date_created: 1740000000,
    date_due: 0,
    date_completed: 0,
    date_updated: 1740000000,
    date_snoozed_until: 0,
    is_archived: false,
    ...overrides,
  };
}

function makeListResponse(items: RawSavedItem[] = [], nextCursor = ''): RawSavedListResponse {
  return {
    ok: true,
    saved_items: items,
    counts: {
      uncompleted_count: items.length,
      uncompleted_overdue_count: 0,
      archived_count: 0,
      completed_count: 0,
      total_count: items.length,
    },
    response_metadata: { next_cursor: nextCursor },
  };
}

function makeStorage(overrides: {
  hasCreds?: boolean;
  isExpired?: boolean;
}): jest.Mocked<SessionCredentialStorage> {
  return {
    load: jest.fn().mockResolvedValue(overrides.hasCreds !== false ? {} : undefined),
    getCurrent: jest.fn().mockReturnValue(overrides.hasCreds !== false ? { xoxcToken: 'x', xoxdCookie: 'x', savedAt: Date.now() } : undefined),
    isExpired: jest.fn().mockReturnValue(overrides.isExpired ?? false),
    isExpiringSoon: jest.fn().mockReturnValue(false),
    save: jest.fn(),
    updateWorkspaceUrl: jest.fn().mockResolvedValue(undefined),
    getEstimatedExpiresAt: jest.fn().mockReturnValue(Date.now() + 3_600_000),
  } as unknown as jest.Mocked<SessionCredentialStorage>;
}

function makeApiClient(): jest.Mocked<WebclientApiClient> {
  return {
    savedList: jest.fn(),
    savedUpdate: jest.fn().mockResolvedValue(undefined),
    fetchMessageText: jest.fn().mockResolvedValue({ text: '', userName: '' }),
    resolveWorkspaceUrl: jest.fn().mockResolvedValue('https://test.slack.com'),
  } as unknown as jest.Mocked<WebclientApiClient>;
}

// ─── list-saved-items ────────────────────────────────────────────────────────

describe('SlackSavedItemsService - list-saved-items', () => {
  it('returns credentials_not_configured when no credentials', async () => {
    const storage = makeStorage({ hasCreds: false });
    const apiClient = makeApiClient();
    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.code).toBe('credentials_not_configured');
    expect(apiClient.savedList).not.toHaveBeenCalled();
  });

  it('returns credentials_expired when credentials expired', async () => {
    const storage = makeStorage({ hasCreds: true, isExpired: true });
    const apiClient = makeApiClient();
    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.code).toBe('credentials_expired');
  });

  it('returns mapped items on success', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    const rawItem = makeRawItem();
    apiClient.savedList.mockResolvedValue(makeListResponse([rawItem]));
    apiClient.fetchMessageText.mockResolvedValue({ text: 'Hello world', userName: 'U123' });

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.items).toHaveLength(1);
    expect(result.items[0].messageText).toBe('Hello world');
    expect(result.items[0].userId).toBe('U123');
    expect(result.items[0].itemId).toBe('C1234567890');
    expect(result.counts.uncompletedCount).toBe(1);
  });

  it('passes cursor to savedList', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValue(makeListResponse([]));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    await tool.handler({ cursor: 'test-cursor' });

    expect(apiClient.savedList).toHaveBeenCalledWith('test-cursor');
  });

  it('returns nextCursor when present', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValue(makeListResponse([makeRawItem()], 'next-page-cursor'));
    apiClient.fetchMessageText.mockResolvedValue({ text: '', userName: '' });

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.nextCursor).toBe('next-page-cursor');
  });

  it('returns item with empty messageText when fetchMessageText fails', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValue(makeListResponse([makeRawItem()]));
    apiClient.fetchMessageText.mockResolvedValue({ text: '', userName: '' });

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.items[0].messageText).toBe('');
    // Should not throw — empty string is acceptable
    expect(result.items).toHaveLength(1);
  });

  it('returns empty list when no saved items', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValue(makeListResponse([]));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.items).toHaveLength(0);
    expect(result.counts.totalCount).toBe(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns rate_limited when API is rate-limited', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValue(new RateLimitedError('too many requests'));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.code).toBe('rate_limited');
  });

  it('returns credentials_invalid on auth failure from API', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValue(new CredentialsInvalidError('not_authed'));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items')!;
    const result = await tool.handler({}) as any;

    expect(result.code).toBe('credentials_invalid');
    expect(result.dashboardUrl).toBeDefined();
  });
});

// ─── mark-saved-item-complete ────────────────────────────────────────────────

describe('SlackSavedItemsService - mark-saved-item-complete', () => {
  it('returns success when savedUpdate succeeds', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ channel: 'C1234', ts: '1234567890.123456' }) as any;

    expect(result.success).toBe(true);
    expect(result.channel).toBe('C1234');
    expect(result.ts).toBe('1234567890.123456');
    expect(apiClient.savedUpdate).toHaveBeenCalledWith('C1234', '1234567890.123456');
  });

  it('returns invalid_input when channel is missing', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ ts: '1234567890.123456' }) as any;

    expect(result.code).toBe('invalid_input');
    expect(apiClient.savedUpdate).not.toHaveBeenCalled();
  });

  it('returns invalid_input when ts is missing', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ channel: 'C1234' }) as any;

    expect(result.code).toBe('invalid_input');
  });

  it('returns credentials_not_configured when no credentials', async () => {
    const storage = makeStorage({ hasCreds: false });
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ channel: 'C1234', ts: '1234567890.123456' }) as any;

    expect(result.code).toBe('credentials_not_configured');
  });

  it('returns credentials_expired when credentials are expired', async () => {
    const storage = makeStorage({ hasCreds: true, isExpired: true });
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ channel: 'C1234', ts: '1234567890.123456' }) as any;

    expect(result.code).toBe('credentials_expired');
  });

  it('returns api_error on unexpected API error', async () => {
    const storage = makeStorage({ hasCreds: true });
    const apiClient = makeApiClient();
    apiClient.savedUpdate.mockRejectedValue(new Error('Internal server error'));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete')!;
    const result = await tool.handler({ channel: 'C1234', ts: '1234567890.123456' }) as any;

    expect(result.code).toBe('api_error');
  });
});

// ─── isAuthenticated() ────────────────────────────────────────────────────────

describe('SlackSavedItemsService - isAuthenticated()', () => {
  it('returns false when no credentials', async () => {
    const storage = makeStorage({ hasCreds: false });
    const apiClient = makeApiClient();
    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    expect(await service.isAuthenticated()).toBe(false);
  });

  it('returns false when credentials expired', async () => {
    const storage = makeStorage({ hasCreds: true, isExpired: true });
    const apiClient = makeApiClient();
    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    expect(await service.isAuthenticated()).toBe(false);
  });

  it('returns true when credentials valid', async () => {
    const storage = makeStorage({ hasCreds: true, isExpired: false });
    const apiClient = makeApiClient();
    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    expect(await service.isAuthenticated()).toBe(true);
  });
});
