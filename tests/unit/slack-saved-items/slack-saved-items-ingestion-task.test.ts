/**
 * Unit tests for SlackSavedItemsIngestionTask (Feature 020)
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { SlackSavedItemsIngestionTask } from '../../../src/services/heartbeat/tasks/slack-saved-items-ingestion-task';
import {
  CredentialsExpiredError,
  CredentialsNotConfiguredError,
} from '../../../src/services/slack-saved-items/webclient-api-client';
import type { WebclientApiClient } from '../../../src/services/slack-saved-items/webclient-api-client';
import type { RawSavedItem, RawSavedListResponse } from '../../../src/types/slack-saved-items';
import type { TaskConfig } from '../../../src/types/heartbeat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRaw(overrides: Partial<RawSavedItem> = {}): RawSavedItem {
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

function makeListResponse(items: RawSavedItem[], nextCursor = ''): RawSavedListResponse {
  return {
    ok: true,
    saved_items: items,
    counts: {
      uncompleted_count: items.filter((i) => i.state === 'uncompleted').length,
      uncompleted_overdue_count: 0,
      archived_count: 0,
      completed_count: 0,
      total_count: items.length,
    },
    response_metadata: { next_cursor: nextCursor },
  };
}

function makeApiClient(): jest.Mocked<WebclientApiClient> {
  return {
    savedList: jest.fn().mockResolvedValue(makeListResponse([])),
    savedUpdate: jest.fn().mockResolvedValue(undefined),
    fetchMessageText: jest.fn().mockResolvedValue({ text: 'Test message', userName: 'U123' }),
    resolveWorkspaceUrl: jest.fn().mockResolvedValue('https://test.slack.com'),
  } as unknown as jest.Mocked<WebclientApiClient>;
}

function makeTaskConfig(overrides: Partial<{ config: Record<string, unknown> }> = {}): TaskConfig {
  return {
    id: 'test-task',
    name: 'Test Slack Ingestion',
    type: 'slack-saved-items-ingestion',
    schedule: '*/15 * * * *',
    enabled: true,
    config: {},
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SlackSavedItemsIngestionTask', () => {
  let tmpDir: string;
  let triageDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebro-ingestion-'));
    triageDir = path.join(tmpDir, 'triage');
    await fs.mkdir(triageDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // ─── Happy path ────────────────────────────────────────────────────────────

  it('writes a TriageEvent for each uncompleted item', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([makeRaw()]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(triageDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.md$/);
  });

  it('calls savedUpdate for each item when markAsComplete is true', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([makeRaw(), makeRaw({ item_id: 'C9999', ts: '1740000001.000000' })]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig({ config: { markAsComplete: true } }));

    expect(apiClient.savedUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not call savedUpdate when markAsComplete is false', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([makeRaw()]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig({ config: { markAsComplete: false } }));

    expect(apiClient.savedUpdate).not.toHaveBeenCalled();
  });

  it('skips completed items (only processes uncompleted)', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([
      makeRaw({ state: 'uncompleted' }),
      makeRaw({ item_id: 'C_DONE', ts: '9999999999.000000', state: 'completed' }),
    ]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    // Only 1 event written (the uncompleted one)
    const files = await fs.readdir(triageDir);
    expect(files).toHaveLength(1);
  });

  // ─── Credential errors ────────────────────────────────────────────────────

  it('exits early without processing when credentials expired', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValueOnce(new CredentialsExpiredError());

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(triageDir);
    expect(files).toHaveLength(0);
  });

  it('exits early without processing when credentials not configured', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValueOnce(new CredentialsNotConfiguredError());

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(triageDir);
    expect(files).toHaveLength(0);
  });

  // ─── Per-item mark-complete failure ───────────────────────────────────────

  it('continues to next item when savedUpdate fails for one item', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([
      makeRaw({ item_id: 'C_FAIL', ts: '1740000001.000000' }),
      makeRaw({ item_id: 'C_OK', ts: '1740000002.000000' }),
    ]));
    apiClient.savedUpdate
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce(undefined);

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    // Both items should have events written
    const files = await fs.readdir(triageDir);
    expect(files).toHaveLength(2);
    // Second savedUpdate still called despite first failing
    expect(apiClient.savedUpdate).toHaveBeenCalledTimes(2);
  });

  // ─── buildTriageEvent ─────────────────────────────────────────────────────

  describe('buildTriageEvent()', () => {
    it('builds correct eventId from dateCreated + ts', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = {
        itemId: 'C1234',
        itemType: 'message',
        ts: '1740000000.123456',
        state: 'uncompleted' as const,
        dateCreated: 1740000000,
        dateDue: 0,
        dateCompleted: 0,
        dateUpdated: 1740000000,
        dateSnoozedUntil: 0,
        isArchived: false,
        messageText: 'Hello world, please follow up on this.',
        userId: 'U123',
      };

      const event = task.buildTriageEvent(item);

      expect(event.eventId).toBe('20250219-slack-1740000000-123456');
      expect(event.source).toBe('slack-saved');
      expect(event.title).toBe('Hello world, please follow up on this.');
      expect(event.author).toBe('U123');
      expect(event.snippet).toBe('Hello world, please follow up on this.');
      expect(event.signals.isAutomated).toBe(false);
      expect(event.signals.isBulk).toBe(false);
      expect(event.signals.asksForAction).toBe(true); // "please follow up"
    });

    it('uses fallback title when messageText is empty', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = {
        itemId: 'C1234',
        itemType: 'message',
        ts: '1740000000.123456',
        state: 'uncompleted' as const,
        dateCreated: 1740000000,
        dateDue: 0, dateCompleted: 0, dateUpdated: 1740000000,
        dateSnoozedUntil: 0, isArchived: false,
        messageText: '',
        userId: 'U123',
      };

      const event = task.buildTriageEvent(item);
      expect(event.title).toBe('Slack message 1740000000.123456');
    });

    it('detects mentionsMoney correctly', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = {
        itemId: 'C1', itemType: 'message', ts: '1740000000.000000',
        state: 'uncompleted' as const, dateCreated: 1740000000,
        dateDue: 0, dateCompleted: 0, dateUpdated: 1740000000,
        dateSnoozedUntil: 0, isArchived: false,
        messageText: 'Invoice for £500 attached', userId: 'U1',
      };

      const event = task.buildTriageEvent(item);
      expect(event.signals.mentionsMoney).toBe(true);
    });

    it('stores sourceData with itemId and ts', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = {
        itemId: 'C9876', itemType: 'message', ts: '1740000000.000000',
        state: 'uncompleted' as const, dateCreated: 1740000000,
        dateDue: 0, dateCompleted: 0, dateUpdated: 1740000000,
        dateSnoozedUntil: 0, isArchived: false,
        messageText: 'Test', userId: 'U1',
      };

      const event = task.buildTriageEvent(item);
      expect(event.sourceData?.['itemId']).toBe('C9876');
      expect(event.sourceData?.['ts']).toBe('1740000000.000000');
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────────────────

  it('does not create duplicate TriageEvent for same item on second run', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList
      .mockResolvedValueOnce(makeListResponse([makeRaw()]))
      .mockResolvedValueOnce(makeListResponse([makeRaw()]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(triageDir);
    // saveEvent is idempotent — same eventId overwrites, so still only 1 file
    expect(files).toHaveLength(1);
  });
});
