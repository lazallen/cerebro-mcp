/**
 * Unit tests for SlackSavedItemsIngestionTask (Feature 020)
 * Updated for new item-per-file design (MessageItem, system/messages/)
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
import type { SavedItem } from '../../../src/types/slack-saved-items';

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
  let messagesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebro-ingestion-'));
    messagesDir = path.join(tmpDir, 'messages');
    await fs.mkdir(messagesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // ─── Happy path ────────────────────────────────────────────────────────────

  it('writes a MessageItem YAML for each uncompleted item', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([makeRaw()]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.yaml$/);
  });

  it('calls savedUpdate for each item when markAsComplete is true', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(
      makeListResponse([makeRaw(), makeRaw({ item_id: 'C9999', ts: '1740000001.000000' })])
    );

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
    apiClient.savedList.mockResolvedValueOnce(
      makeListResponse([
        makeRaw({ state: 'uncompleted' }),
        makeRaw({ item_id: 'C_DONE', ts: '9999999999.000000', state: 'completed' }),
      ])
    );

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(1);
  });

  // ─── Credential errors ────────────────────────────────────────────────────

  it('exits early without processing when credentials expired', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValueOnce(new CredentialsExpiredError());

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(0);
  });

  it('exits early without processing when credentials not configured', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValueOnce(new CredentialsNotConfiguredError());

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(0);
  });

  // ─── Per-item mark-complete failure ───────────────────────────────────────

  it('continues to next item when savedUpdate fails for one item', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockResolvedValueOnce(
      makeListResponse([
        makeRaw({ item_id: 'C_FAIL', ts: '1740000001.000000' }),
        makeRaw({ item_id: 'C_OK', ts: '1740000002.000000' }),
      ])
    );
    apiClient.savedUpdate
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce(undefined);

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(2);
    expect(apiClient.savedUpdate).toHaveBeenCalledTimes(2);
  });

  // ─── buildMessageItem ─────────────────────────────────────────────────────

  describe('buildMessageItem()', () => {
    function makeSavedItem(overrides: Partial<SavedItem> = {}): SavedItem {
      return {
        itemId: 'C1234',
        itemType: 'message',
        ts: '1740000000.123456',
        state: 'uncompleted',
        dateCreated: 1740000000,
        dateDue: 0,
        dateCompleted: 0,
        dateUpdated: 1740000000,
        dateSnoozedUntil: 0,
        isArchived: false,
        messageText: 'Hello world, please follow up on this.',
        userId: 'U123',
        ...overrides,
      };
    }

    it('builds MessageItem with correct id and fields', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = makeSavedItem();
      const stableId = 'slack-C1234-1740000000.123456';
      const msg = task.buildMessageItem(item, stableId);

      expect(msg.id).toBe(stableId);
      expect(msg.source).toBe('slack-saved');
      expect(msg.type).toBe('MESSAGE');
      expect(msg.body).toBe('Hello world, please follow up on this.');
      expect(msg.user).toBe('U123');
      expect(msg.status).toBe('inbox');
    });

    it('detects isActionRequest correctly for action words', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = makeSavedItem({ messageText: 'Hello world, please follow up on this.' });
      const msg = task.buildMessageItem(item, 'test-id');

      expect(msg.signals.isActionRequest).toBe(true);
    });

    it('uses empty string body when messageText is empty', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = makeSavedItem({ messageText: '' });
      const msg = task.buildMessageItem(item, 'test-id');
      expect(msg.body).toBe('');
    });

    it('detects mentionsMoney correctly', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = makeSavedItem({ messageText: 'Invoice for £500 attached' });
      const msg = task.buildMessageItem(item, 'test-id');
      expect(msg.signals.mentionsMoney).toBe(true);
    });

    it('sets slackTimestamp from ts', () => {
      const apiClient = makeApiClient();
      const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);

      const item = makeSavedItem({ ts: '1740000000.999999' });
      const msg = task.buildMessageItem(item, 'test-id');
      expect(msg.slackTimestamp).toBe('1740000000.999999');
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────────────────

  it('does not create duplicate MessageItem for same item on second run', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList
      .mockResolvedValueOnce(makeListResponse([makeRaw()]))
      .mockResolvedValueOnce(makeListResponse([makeRaw()]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(messagesDir);
    // Same stable ID → same file, only 1 file written
    expect(files).toHaveLength(1);
  });
});
