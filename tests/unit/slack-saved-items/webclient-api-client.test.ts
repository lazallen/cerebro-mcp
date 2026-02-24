/**
 * Unit tests for WebclientApiClient (Feature 020)
 */

import {
  WebclientApiClient,
  CredentialsNotConfiguredError,
  CredentialsExpiredError,
  CredentialsInvalidError,
  RateLimitedError,
  ApiError,
} from '../../../src/services/slack-saved-items/webclient-api-client';
import type { SessionCredentialStorage } from '../../../src/services/slack-saved-items/session-credential-storage';
import type { RawSavedListResponse } from '../../../src/types/slack-saved-items';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCredentials(overrides: Partial<{
  xoxcToken: string;
  xoxdCookie: string;
  savedAt: number;
  workspaceUrl: string;
}> = {}) {
  return {
    xoxcToken: 'xoxc-test-token',
    xoxdCookie: 'xoxd-test-cookie',
    savedAt: Date.now(),
    workspaceUrl: 'https://testworkspace.slack.com',
    ...overrides,
  };
}

function makeStorage(overrides: Partial<{
  credentials: ReturnType<typeof makeCredentials> | undefined;
  expired: boolean;
}> = {}): jest.Mocked<SessionCredentialStorage> {
  const creds = 'credentials' in overrides ? overrides.credentials : makeCredentials();
  return {
    getCurrent: jest.fn().mockReturnValue(creds),
    isExpired: jest.fn().mockReturnValue(overrides.expired ?? false),
    isExpiringSoon: jest.fn().mockReturnValue(false),
    load: jest.fn(),
    save: jest.fn(),
    updateWorkspaceUrl: jest.fn().mockResolvedValue(undefined),
    getEstimatedExpiresAt: jest.fn(),
  } as unknown as jest.Mocked<SessionCredentialStorage>;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WebclientApiClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── savedList() ─────────────────────────────────────────────────────────

  describe('savedList()', () => {
    it('throws CredentialsNotConfiguredError when no credentials', async () => {
      const storage = makeStorage({ credentials: undefined });
      const client = new WebclientApiClient(storage);
      await expect(client.savedList()).rejects.toThrow(CredentialsNotConfiguredError);
    });

    it('throws CredentialsExpiredError when credentials expired', async () => {
      const storage = makeStorage({ expired: true });
      const client = new WebclientApiClient(storage);
      await expect(client.savedList()).rejects.toThrow(CredentialsExpiredError);
    });

    it('makes POST request with token and cookie', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      const mockResponse: RawSavedListResponse = {
        ok: true,
        saved_items: [],
        counts: {
          uncompleted_count: 0,
          uncompleted_overdue_count: 0,
          archived_count: 0,
          completed_count: 0,
          total_count: 0,
        },
        response_metadata: { next_cursor: '' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(mockResponse),
      } as unknown as Response);

      const result = await client.savedList();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://testworkspace.slack.com/api/saved.list',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Cookie: 'd=xoxd-test-cookie',
          }),
        })
      );

      expect(result.ok).toBe(true);
    });

    it('passes cursor in request body', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          ok: true,
          saved_items: [],
          counts: { uncompleted_count: 0, uncompleted_overdue_count: 0, archived_count: 0, completed_count: 0, total_count: 0 },
          response_metadata: { next_cursor: '' },
        }),
      } as unknown as Response);

      await client.savedList('test-cursor');

      const callArgs = fetchMock.mock.calls[0];
      const body = callArgs[1].body as string;
      expect(body).toContain('cursor=test-cursor');
    });

    it('throws CredentialsInvalidError on not_authed error', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ ok: false, error: 'not_authed' }),
      } as unknown as Response);

      await expect(client.savedList()).rejects.toThrow(CredentialsInvalidError);
    });

    it('throws ApiError on unexpected API error', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ ok: false, error: 'channel_not_found' }),
      } as unknown as Response);

      await expect(client.savedList()).rejects.toThrow(ApiError);
    });
  });

  // ─── savedUpdate() ───────────────────────────────────────────────────────

  describe('savedUpdate()', () => {
    it('sends correct fields to saved.update', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ ok: true }),
      } as unknown as Response);

      await client.savedUpdate('C1234', '1234567890.123456');

      const callArgs = fetchMock.mock.calls[0];
      const body = callArgs[1].body as string;
      expect(body).toContain('channel=C1234');
      expect(body).toContain('ts=1234567890.123456');
      expect(body).toContain('state=completed');
    });
  });

  // ─── fetchMessageText() ──────────────────────────────────────────────────

  describe('fetchMessageText()', () => {
    it('returns text and userId from conversations.history', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          ok: true,
          messages: [{ text: 'Hello world', user: 'U123ABC' }],
        }),
      } as unknown as Response);

      const result = await client.fetchMessageText('C1234', '1234567890.123456');
      expect(result.text).toBe('Hello world');
      expect(result.userName).toBe('U123ABC');
    });

    it('returns empty strings when API returns ok:false', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ ok: false, error: 'channel_not_found' }),
      } as unknown as Response);

      const result = await client.fetchMessageText('C1234', '1234567890.123456');
      expect(result.text).toBe('');
      expect(result.userName).toBe('');
    });

    it('returns empty strings when fetch throws', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.fetchMessageText('C1234', '1234567890.123456');
      expect(result.text).toBe('');
      expect(result.userName).toBe('');
    });

    it('returns empty strings when messages array is empty', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ ok: true, messages: [] }),
      } as unknown as Response);

      const result = await client.fetchMessageText('C1234', '1234567890.123456');
      expect(result.text).toBe('');
    });
  });

  // ─── Rate limiting ────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries once on 429 then succeeds', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      const mockSuccess = {
        ok: true,
        saved_items: [],
        counts: { uncompleted_count: 0, uncompleted_overdue_count: 0, archived_count: 0, completed_count: 0, total_count: 0 },
        response_metadata: { next_cursor: '' },
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Retry-After': '1' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValueOnce(mockSuccess),
        } as unknown as Response);

      const promise = client.savedList();
      // Advance timers to skip the retry delay
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    });

    it('throws RateLimitedError on second consecutive 429', async () => {
      const storage = makeStorage();
      const client = new WebclientApiClient(storage);

      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '1' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '1' }),
        } as unknown as Response);

      // Attach rejection handler before running timers to avoid unhandled rejection
      const rejectionPromise = expect(client.savedList()).rejects.toThrow(RateLimitedError);
      await jest.runAllTimersAsync();
      await rejectionPromise;
    });
  });
});
