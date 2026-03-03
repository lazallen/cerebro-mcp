/**
 * Integration test for Slack Save for Later pipeline (Feature 020)
 *
 * Validates the full pipeline:
 *   list-saved-items → mark-saved-item-complete → heartbeat ingestion → MessageItem written
 * Includes idempotency and credential-expiry scenarios.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { SlackSavedItemsService } from '../../src/services/slack-saved-items/slack-saved-items-service';
import { SlackSavedItemsIngestionTask } from '../../src/services/heartbeat/tasks/slack-saved-items-ingestion-task';
import { CredentialsExpiredError } from '../../src/services/slack-saved-items/webclient-api-client';
import type { SessionCredentialStorage } from '../../src/services/slack-saved-items/session-credential-storage';
import type { WebclientApiClient } from '../../src/services/slack-saved-items/webclient-api-client';
import type { RawSavedListResponse, RawSavedItem } from '../../src/types/slack-saved-items';
import type { TaskConfig } from '../../src/types/heartbeat';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

function makeListResponse(items: RawSavedItem[], nextCursor = ''): RawSavedListResponse {
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

function makeStorage(expired = false): jest.Mocked<SessionCredentialStorage> {
  return {
    load: jest.fn().mockResolvedValue({ xoxcToken: 'x', xoxdCookie: 'x', savedAt: Date.now() }),
    getCurrent: jest.fn().mockReturnValue({ xoxcToken: 'x', xoxdCookie: 'x', savedAt: Date.now() }),
    isExpired: jest.fn().mockReturnValue(expired),
    isExpiringSoon: jest.fn().mockReturnValue(false),
    save: jest.fn(),
    updateWorkspaceUrl: jest.fn().mockResolvedValue(undefined),
    getEstimatedExpiresAt: jest.fn().mockReturnValue(Date.now() + 3_600_000),
  } as unknown as jest.Mocked<SessionCredentialStorage>;
}

function makeApiClient(): jest.Mocked<WebclientApiClient> {
  return {
    savedList: jest.fn().mockResolvedValue(makeListResponse([])),
    savedUpdate: jest.fn().mockResolvedValue(undefined),
    fetchMessageText: jest.fn().mockResolvedValue({
      text: 'Can you review the Q1 report by Friday?',
      userName: 'U09876ABCD',
    }),
    resolveWorkspaceUrl: jest.fn().mockResolvedValue('https://testworkspace.slack.com'),
  } as unknown as jest.Mocked<WebclientApiClient>;
}

function makeTaskConfig(): TaskConfig {
  return {
    id: 'slack-saved-items-integration-test',
    name: 'Slack Integration Test',
    type: 'slack-saved-items-ingestion',
    schedule: '*/15 * * * *',
    enabled: true,
    config: { markAsComplete: true },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Slack Saved Items — Full Pipeline Integration', () => {
  let tmpDir: string;
  let messagesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebro-slack-integration-'));
    messagesDir = path.join(tmpDir, 'messages');
    await fs.mkdir(messagesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // ─── Scenario 1: list-saved-items returns items with message text ─────────

  it('list-saved-items returns both items with messageText', async () => {
    const storage = makeStorage();
    const apiClient = makeApiClient();

    const item1 = makeRawItem({ item_id: 'C0001', ts: '1740000001.000000' });
    const item2 = makeRawItem({ item_id: 'C0002', ts: '1740000002.000000' });
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([item1, item2]));

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items');
    const result = (await tool.handler({})) as any;

    expect(result.items).toHaveLength(2);
    expect(result.items[0].messageText).toBe('Can you review the Q1 report by Friday?');
    expect(result.items[0].userId).toBe('U09876ABCD');
    expect(result.counts.uncompletedCount).toBe(2);
  });

  // ─── Scenario 2: mark-saved-item-complete succeeds for each item ──────────

  it('mark-saved-item-complete succeeds for items from list', async () => {
    const storage = makeStorage();
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'mark-saved-item-complete');
    const result = (await tool.handler({ channel: 'C0001', ts: '1740000001.000000' })) as any;

    expect(result.success).toBe(true);
    expect(apiClient.savedUpdate).toHaveBeenCalledWith('C0001', '1740000001.000000');
  });

  // ─── Scenario 3: heartbeat ingestion writes MessageItem YAML files ────────

  it('heartbeat task writes MessageItem YAML for each uncompleted item', async () => {
    const apiClient = makeApiClient();
    const item1 = makeRawItem({ item_id: 'C0001', ts: '1740000001.000000' });
    const item2 = makeRawItem({ item_id: 'C0002', ts: '1740000002.000000' });
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([item1, item2]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith('.yaml'))).toBe(true);

    // Verify MessageItem content
    const content = await fs.readFile(path.join(messagesDir, files[0]), 'utf-8');
    expect(content).toContain('source: slack-saved');
    expect(content).toContain('status: inbox');
  });

  // ─── Scenario 4: heartbeat calls savedUpdate after each ingestion ─────────

  it('heartbeat calls savedUpdate for each item when markAsComplete: true', async () => {
    const apiClient = makeApiClient();
    const item1 = makeRawItem({ item_id: 'C0001', ts: '1740000001.000000' });
    const item2 = makeRawItem({ item_id: 'C0002', ts: '1740000002.000000' });
    apiClient.savedList.mockResolvedValueOnce(makeListResponse([item1, item2]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());

    expect(apiClient.savedUpdate).toHaveBeenCalledTimes(2);
    expect(apiClient.savedUpdate).toHaveBeenCalledWith('C0001', '1740000001.000000');
    expect(apiClient.savedUpdate).toHaveBeenCalledWith('C0002', '1740000002.000000');
  });

  // ─── Scenario 5: idempotency on re-run ───────────────────────────────────

  it('re-run of heartbeat task does not create duplicate MessageItem files', async () => {
    const apiClient = makeApiClient();
    const item = makeRawItem({ item_id: 'C0001', ts: '1740000001.000000' });
    apiClient.savedList
      .mockResolvedValueOnce(makeListResponse([item]))
      .mockResolvedValueOnce(makeListResponse([item]));

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await task.execute(makeTaskConfig());
    await task.execute(makeTaskConfig());

    const files = await fs.readdir(messagesDir);
    // Idempotent: same stable ID → same file, no duplicate
    expect(files).toHaveLength(1);
  });

  // ─── Scenario 6: expired credentials → heartbeat exits early ─────────────

  it('heartbeat exits early with no events when credentials expired', async () => {
    const apiClient = makeApiClient();
    apiClient.savedList.mockRejectedValueOnce(new CredentialsExpiredError());

    const task = new SlackSavedItemsIngestionTask(apiClient, tmpDir);
    await expect(task.execute(makeTaskConfig())).resolves.not.toThrow();

    const files = await fs.readdir(messagesDir);
    expect(files).toHaveLength(0);
    expect(apiClient.savedUpdate).not.toHaveBeenCalled();
  });

  // ─── Scenario 7: list-saved-items returns credentials_expired ────────────

  it('list-saved-items returns credentials_expired when storage is expired', async () => {
    const storage = makeStorage(/* expired= */ true);
    const apiClient = makeApiClient();

    const service = new SlackSavedItemsService(storage, apiClient);
    await service.initialize();

    const tool = service.getTools().find((t) => t.name === 'list-saved-items');
    const result = (await tool.handler({})) as any;

    expect(result.code).toBe('credentials_expired');
    expect(result.dashboardUrl).toContain('/auth/slack-saved-items/credentials');
    expect(apiClient.savedList).not.toHaveBeenCalled();
  });
});
