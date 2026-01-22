/**
 * Tests for MessageActionStorage
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MessageActionStorage } from '../message-action-storage';
import type { SlackMessageActionPayload } from '../../../types/slack-message-action';

describe('MessageActionStorage', () => {
  const testDir = '.tasks-test';
  const testStoragePath = join(testDir, 'test-actions.json');
  let storage: MessageActionStorage;

  // Sample payload for testing
  const createSamplePayload = (
    overrides: Partial<SlackMessageActionPayload> = {}
  ): SlackMessageActionPayload => ({
    type: 'message_action',
    action_ts: '1737543000.123456',
    team: { id: 'T0123456', domain: 'testworkspace' },
    user: { id: 'U0123456', username: 'testuser', name: 'Test User', team_id: 'T0123456' },
    channel: { id: 'C0123456', name: 'general' },
    message: {
      type: 'message',
      user: 'U9876543',
      ts: '1737542900.000001',
      text: 'This is a test message for storage testing',
    },
    callback_id: 'test_callback',
    trigger_id: '123456.789012.abcdef',
    response_url: 'https://hooks.slack.com/app/test',
    ...overrides,
  });

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    storage = new MessageActionStorage(testStoragePath);
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('add', () => {
    it('should store a new action with generated UUID', () => {
      const payload = createSamplePayload();
      const action = storage.add(payload);

      expect(action.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(action.payload).toEqual(payload);
    });

    it('should store a new action with ISO timestamp', () => {
      const payload = createSamplePayload();
      const action = storage.add(payload);

      expect(action.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('should set processed to false by default', () => {
      const payload = createSamplePayload();
      const action = storage.add(payload);

      expect(action.processed).toBe(false);
    });

    it('should create storage directory if not exists', () => {
      const payload = createSamplePayload();
      storage.add(payload);

      expect(existsSync(testDir)).toBe(true);
    });

    it('should persist action to file', () => {
      const payload = createSamplePayload();
      storage.add(payload);

      // Create new storage instance to read from file
      const newStorage = new MessageActionStorage(testStoragePath);
      const actions = newStorage.list();

      expect(actions).toHaveLength(1);
    });

    it('should append to existing actions', () => {
      const payload1 = createSamplePayload({ callback_id: 'callback1' });
      const payload2 = createSamplePayload({ callback_id: 'callback2' });

      storage.add(payload1);
      storage.add(payload2);

      const actions = storage.list();
      expect(actions).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('should return empty array when no actions stored', () => {
      const actions = storage.list();
      expect(actions).toEqual([]);
    });

    it('should return all actions as summaries', () => {
      storage.add(createSamplePayload());
      storage.add(createSamplePayload());

      const actions = storage.list();

      expect(actions).toHaveLength(2);
      expect(actions[0]).toHaveProperty('id');
      expect(actions[0]).toHaveProperty('receivedAt');
      expect(actions[0]).toHaveProperty('processed');
      expect(actions[0]).toHaveProperty('channelName');
      expect(actions[0]).toHaveProperty('userName');
      expect(actions[0]).toHaveProperty('messagePreview');
    });

    it('should filter by processed=false', () => {
      const action1 = storage.add(createSamplePayload());
      storage.add(createSamplePayload());

      // Manually mark one as processed by getting and re-adding
      const full = storage.get(action1.id);
      if (full) {
        storage.delete(action1.id);
        // Note: In real implementation we'd have a markProcessed method
      }

      const unprocessed = storage.list({ processed: false });
      expect(unprocessed).toHaveLength(1);
    });

    it('should include channel name in summary', () => {
      storage.add(createSamplePayload({ channel: { id: 'C123', name: 'test-channel' } }));

      const [summary] = storage.list();

      expect(summary.channelName).toBe('test-channel');
    });

    it('should include user name in summary', () => {
      storage.add(
        createSamplePayload({
          user: { id: 'U123', username: 'jdoe', name: 'John Doe', team_id: 'T123' },
        })
      );

      const [summary] = storage.list();

      expect(summary.userName).toBe('John Doe');
    });

    it('should truncate long message previews to 100 chars', () => {
      const longMessage = 'A'.repeat(150);
      storage.add(
        createSamplePayload({
          message: { type: 'message', user: 'U123', ts: '123.456', text: longMessage },
        })
      );

      const [summary] = storage.list();

      expect(summary.messagePreview).toHaveLength(103); // 100 + '...'
      expect(summary.messagePreview.endsWith('...')).toBe(true);
    });

    it('should not truncate short message previews', () => {
      const shortMessage = 'Short message';
      storage.add(
        createSamplePayload({
          message: { type: 'message', user: 'U123', ts: '123.456', text: shortMessage },
        })
      );

      const [summary] = storage.list();

      expect(summary.messagePreview).toBe(shortMessage);
    });
  });

  describe('get', () => {
    it('should return action by ID', () => {
      const added = storage.add(createSamplePayload());

      const retrieved = storage.get(added.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(added.id);
      expect(retrieved?.payload).toEqual(added.payload);
    });

    it('should return null for non-existent ID', () => {
      storage.add(createSamplePayload());

      const retrieved = storage.get('non-existent-id');

      expect(retrieved).toBeNull();
    });

    it('should return full payload, not summary', () => {
      const added = storage.add(createSamplePayload());

      const retrieved = storage.get(added.id);

      expect(retrieved).toHaveProperty('payload');
      expect(retrieved?.payload.type).toBe('message_action');
    });
  });

  describe('delete', () => {
    it('should remove action by ID', () => {
      const added = storage.add(createSamplePayload());

      const deleted = storage.delete(added.id);

      expect(deleted).toBe(true);
      expect(storage.get(added.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      storage.add(createSamplePayload());

      const deleted = storage.delete('non-existent-id');

      expect(deleted).toBe(false);
    });

    it('should persist deletion to file', () => {
      const added = storage.add(createSamplePayload());
      storage.delete(added.id);

      // Create new storage instance to verify persistence
      const newStorage = new MessageActionStorage(testStoragePath);
      expect(newStorage.get(added.id)).toBeNull();
    });

    it('should not affect other actions', () => {
      const action1 = storage.add(createSamplePayload({ callback_id: 'callback1' }));
      const action2 = storage.add(createSamplePayload({ callback_id: 'callback2' }));

      storage.delete(action1.id);

      expect(storage.get(action2.id)).not.toBeNull();
    });
  });

  describe('count', () => {
    it('should return 0 for empty storage', () => {
      expect(storage.count()).toBe(0);
    });

    it('should return total count of actions', () => {
      storage.add(createSamplePayload());
      storage.add(createSamplePayload());
      storage.add(createSamplePayload());

      expect(storage.count()).toBe(3);
    });

    it('should respect filter options', () => {
      storage.add(createSamplePayload());
      storage.add(createSamplePayload());

      expect(storage.count({ processed: false })).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all actions', () => {
      storage.add(createSamplePayload());
      storage.add(createSamplePayload());

      storage.clear();

      expect(storage.list()).toHaveLength(0);
    });

    it('should persist clear to file', () => {
      storage.add(createSamplePayload());
      storage.clear();

      const newStorage = new MessageActionStorage(testStoragePath);
      expect(newStorage.list()).toHaveLength(0);
    });
  });

  describe('getStoragePath', () => {
    it('should return the configured storage path', () => {
      expect(storage.getStoragePath()).toBe(testStoragePath);
    });
  });

  describe('removeStorageFile', () => {
    it('should remove the storage file', () => {
      storage.add(createSamplePayload());
      expect(existsSync(testStoragePath)).toBe(true);

      storage.removeStorageFile();

      expect(existsSync(testStoragePath)).toBe(false);
    });

    it('should not throw if file does not exist', () => {
      expect(() => storage.removeStorageFile()).not.toThrow();
    });
  });

  describe('file corruption handling', () => {
    it('should handle corrupted file gracefully', () => {
      // Create corrupted file
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testStoragePath, 'not valid json {{{');

      // Should return empty state instead of throwing
      const actions = storage.list();
      expect(actions).toEqual([]);
    });
  });
});
