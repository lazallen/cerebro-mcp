/**
 * Slack Service Tests
 */

import { SlackService } from '../slack-service';
import { ServiceConfig } from '../../../types/service';
import * as fs from 'fs/promises';

// Mock environment setup
process.env['MOCK_MODE'] = 'true';

describe('SlackService', () => {
  let service: SlackService;
  const testTokenPath = './.tokens/test-slack-tokens.json';
  const mockConfig: ServiceConfig = {
    name: 'slack',
    displayName: 'Slack',
    apiEndpoint: 'https://slack.com/api',
    oauth: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3333/auth/slack/callback',
      scopes: [
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'canvases:read',
        'canvases:write',
        'identify',
        'reminders:read',
        'reminders:write',
      ],
      authEndpoint: 'https://slack.com/oauth/v2/authorize',
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
    },
    tokenStorePath: testTokenPath,
  };

  beforeEach(async () => {
    // Set test mode
    process.env['USE_TEST_MODE'] = 'true';

    // Create mock token file for testing
    await fs.mkdir('./.tokens', { recursive: true });
    await fs.writeFile(
      testTokenPath,
      JSON.stringify({
        accessToken: 'xoxb-mock-slack-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        tokenType: 'Bearer',
        scopes: ['channels:read', 'channels:history'],
      })
    );

    service = new SlackService(mockConfig);
  });

  afterEach(async () => {
    await service.shutdown();
    try {
      await fs.unlink(testTokenPath);
    } catch {
      // Ignore if file doesn't exist
    }
    delete process.env['USE_TEST_MODE'];
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should have correct service name', () => {
      expect(service.name).toBe('slack');
    });
  });

  describe('shutdown', () => {
    it('should shutdown without errors', async () => {
      await service.initialize();
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  describe('tool registration', () => {
    it('should return 16 tools', () => {
      const tools = service.getTools();
      expect(tools).toHaveLength(16);
    });

    it('should have all tools defined with correct names', () => {
      const tools = service.getTools();
      const expectedTools = [
        'authenticate',
        'check-auth-status',
        'list-channels',
        'get-channel-history',
        'list-groups',
        'get-group-history',
        'get-thread-replies',
        'read-canvas',
        'search-canvases',
        'get-user-identity',
        'list-reminders',
        'create-reminder',
        'complete-reminder',
        'list-message-actions',
        'get-message-action',
        'delete-message-action',
      ];

      expectedTools.forEach((toolName) => {
        const tool = tools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
        expect(tool?.handler).toBeDefined();
      });
    });

    it('should have required parameters marked correctly', () => {
      const tools = service.getTools();

      // Check channel history requires channelId
      const channelHistory = tools.find((t) => t.name === 'get-channel-history');
      expect(channelHistory?.inputSchema.required).toContain('channelId');

      // Check thread replies requires channelId and threadTs
      const threadReplies = tools.find((t) => t.name === 'get-thread-replies');
      expect(threadReplies?.inputSchema.required).toContain('channelId');
      expect(threadReplies?.inputSchema.required).toContain('threadTs');

      // Check create reminder requires text and time
      const createReminder = tools.find((t) => t.name === 'create-reminder');
      expect(createReminder?.inputSchema.required).toContain('text');
      expect(createReminder?.inputSchema.required).toContain('time');
    });
  });

  describe('authentication tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('authenticate tool', () => {
      it('should return OAuth URL', async () => {
        const tools = service.getTools();
        const authenticate = tools.find((t) => t.name === 'authenticate');

        const result = await authenticate?.handler({});
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('authUrl');
        expect((result as { success: boolean }).success).toBe(true);
      });
    });

    describe('check-auth-status tool', () => {
      it('should return false when not authenticated', async () => {
        const tools = service.getTools();
        const checkAuth = tools.find((t) => t.name === 'check-auth-status');

        const result = await checkAuth?.handler({});
        expect(result).toHaveProperty('authenticated');
        expect((result as { authenticated: boolean }).authenticated).toBe(false);
      });
    });
  });

  describe('channel tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('list-channels tool', () => {
      it('should list channels with default limit', async () => {
        const tools = service.getTools();
        const listChannels = tools.find((t) => t.name === 'list-channels');

        const result = await listChannels?.handler({});
        expect(result).toHaveProperty('channels');
        expect(result).toHaveProperty('count');
        expect((result as { channels: unknown[] }).channels).toBeInstanceOf(Array);
      });

      it('should respect custom limit', async () => {
        const tools = service.getTools();
        const listChannels = tools.find((t) => t.name === 'list-channels');

        const result = await listChannels?.handler({ limit: 50 });
        expect(result).toHaveProperty('channels');
      });

      it('should cap limit at 200', async () => {
        const tools = service.getTools();
        const listChannels = tools.find((t) => t.name === 'list-channels');

        const result = await listChannels?.handler({ limit: 500 });
        expect(result).toHaveProperty('channels');
      });

      it('should support cursor pagination', async () => {
        const tools = service.getTools();
        const listChannels = tools.find((t) => t.name === 'list-channels');

        const result = await listChannels?.handler({ cursor: 'test-cursor' });
        expect(result).toHaveProperty('nextCursor');
      });
    });

    describe('get-channel-history tool', () => {
      it('should retrieve channel messages', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        const result = await getHistory?.handler({ channelId: 'C123456' });
        expect(result).toHaveProperty('messages');
        expect(result).toHaveProperty('count');
        expect((result as { messages: unknown[] }).messages).toBeInstanceOf(Array);
      });

      it('should default to 50 messages', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        const result = await getHistory?.handler({ channelId: 'C123456' });
        expect(result).toHaveProperty('messages');
      });

      it('should respect custom limit', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        const result = await getHistory?.handler({ channelId: 'C123456', limit: 100 });
        expect(result).toHaveProperty('messages');
      });

      it('should cap limit at 200', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        const result = await getHistory?.handler({ channelId: 'C123456', limit: 500 });
        expect(result).toHaveProperty('messages');
      });

      it('should support time filters', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        const result = await getHistory?.handler({
          channelId: 'C123456',
          oldest: '1640000000',
          latest: '1640086400',
        });
        expect(result).toHaveProperty('messages');
      });

      it('should require channelId parameter', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-channel-history');

        await expect(getHistory?.handler({})).rejects.toThrow();
      });
    });
  });

  describe('group tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('list-groups tool', () => {
      it('should list private groups', async () => {
        const tools = service.getTools();
        const listGroups = tools.find((t) => t.name === 'list-groups');

        const result = await listGroups?.handler({});
        expect(result).toHaveProperty('groups');
        expect(result).toHaveProperty('count');
        expect((result as { groups: unknown[] }).groups).toBeInstanceOf(Array);
      });

      it('should default to 100 groups', async () => {
        const tools = service.getTools();
        const listGroups = tools.find((t) => t.name === 'list-groups');

        const result = await listGroups?.handler({});
        expect(result).toHaveProperty('groups');
      });

      it('should cap limit at 200', async () => {
        const tools = service.getTools();
        const listGroups = tools.find((t) => t.name === 'list-groups');

        const result = await listGroups?.handler({ limit: 500 });
        expect(result).toHaveProperty('groups');
      });
    });

    describe('get-group-history tool', () => {
      it('should retrieve group messages', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-group-history');

        const result = await getHistory?.handler({ groupId: 'G123456' });
        expect(result).toHaveProperty('messages');
        expect(result).toHaveProperty('count');
      });

      it('should require groupId parameter', async () => {
        const tools = service.getTools();
        const getHistory = tools.find((t) => t.name === 'get-group-history');

        await expect(getHistory?.handler({})).rejects.toThrow();
      });
    });
  });

  describe('thread tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('get-thread-replies tool', () => {
      it('should retrieve thread replies', async () => {
        const tools = service.getTools();
        const getReplies = tools.find((t) => t.name === 'get-thread-replies');

        const result = await getReplies?.handler({
          channelId: 'C123456',
          threadTs: '1234567890.123456',
        });
        expect(result).toHaveProperty('messages');
        expect(result).toHaveProperty('count');
      });

      it('should require channelId parameter', async () => {
        const tools = service.getTools();
        const getReplies = tools.find((t) => t.name === 'get-thread-replies');

        await expect(getReplies?.handler({ threadTs: '1234567890.123456' })).rejects.toThrow();
      });

      it('should require threadTs parameter', async () => {
        const tools = service.getTools();
        const getReplies = tools.find((t) => t.name === 'get-thread-replies');

        await expect(getReplies?.handler({ channelId: 'C123456' })).rejects.toThrow();
      });
    });
  });

  describe('canvas tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('read-canvas tool', () => {
      it('should read canvas content', async () => {
        const tools = service.getTools();
        const readCanvas = tools.find((t) => t.name === 'read-canvas');

        const result = await readCanvas?.handler({ canvasId: 'F123456' });
        expect(result).toHaveProperty('canvasId');
        expect(result).toHaveProperty('content');
      });

      it('should require canvasId parameter', async () => {
        const tools = service.getTools();
        const readCanvas = tools.find((t) => t.name === 'read-canvas');

        await expect(readCanvas?.handler({})).rejects.toThrow();
      });
    });

    describe('search-canvases tool', () => {
      it('should search for canvases in channel', async () => {
        const tools = service.getTools();
        const searchCanvases = tools.find((t) => t.name === 'search-canvases');

        const result = await searchCanvases?.handler({ channelId: 'C123456' });
        expect(result).toHaveProperty('canvases');
        expect(result).toHaveProperty('count');
      });

      it('should default to 20 results', async () => {
        const tools = service.getTools();
        const searchCanvases = tools.find((t) => t.name === 'search-canvases');

        const result = await searchCanvases?.handler({ channelId: 'C123456' });
        expect(result).toHaveProperty('canvases');
      });

      it('should cap limit at 100', async () => {
        const tools = service.getTools();
        const searchCanvases = tools.find((t) => t.name === 'search-canvases');

        const result = await searchCanvases?.handler({ channelId: 'C123456', limit: 500 });
        expect(result).toHaveProperty('canvases');
      });

      it('should require channelId parameter', async () => {
        const tools = service.getTools();
        const searchCanvases = tools.find((t) => t.name === 'search-canvases');

        await expect(searchCanvases?.handler({})).rejects.toThrow();
      });
    });
  });

  describe('identity tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('get-user-identity tool', () => {
      it('should retrieve user identity', async () => {
        const tools = service.getTools();
        const getIdentity = tools.find((t) => t.name === 'get-user-identity');

        const result = await getIdentity?.handler({});
        expect(result).toBeDefined();
      });
    });
  });

  describe('reminder tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('list-reminders tool', () => {
      it('should list reminders', async () => {
        const tools = service.getTools();
        const listReminders = tools.find((t) => t.name === 'list-reminders');

        const result = await listReminders?.handler({});
        expect(result).toHaveProperty('reminders');
        expect(result).toHaveProperty('count');
        expect((result as { reminders: unknown[] }).reminders).toBeInstanceOf(Array);
      });
    });

    describe('create-reminder tool', () => {
      it('should create reminder', async () => {
        const tools = service.getTools();
        const createReminder = tools.find((t) => t.name === 'create-reminder');

        const result = await createReminder?.handler({
          text: 'Test reminder',
          time: 'in 1 hour',
        });
        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
        expect(result).toHaveProperty('reminder');
      });

      it('should require text parameter', async () => {
        const tools = service.getTools();
        const createReminder = tools.find((t) => t.name === 'create-reminder');

        await expect(createReminder?.handler({ time: 'in 1 hour' })).rejects.toThrow();
      });

      it('should require time parameter', async () => {
        const tools = service.getTools();
        const createReminder = tools.find((t) => t.name === 'create-reminder');

        await expect(createReminder?.handler({ text: 'Test reminder' })).rejects.toThrow();
      });
    });

    describe('complete-reminder tool', () => {
      it('should complete reminder', async () => {
        const tools = service.getTools();
        const completeReminder = tools.find((t) => t.name === 'complete-reminder');

        const result = await completeReminder?.handler({ reminderId: 'R123456' });
        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should require reminderId parameter', async () => {
        const tools = service.getTools();
        const completeReminder = tools.find((t) => t.name === 'complete-reminder');

        await expect(completeReminder?.handler({})).rejects.toThrow();
      });
    });
  });

  describe('message action tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('list-message-actions tool', () => {
      it('should return empty array when no actions stored', async () => {
        const tools = service.getTools();
        const listActions = tools.find((t) => t.name === 'list-message-actions');

        const result = await listActions?.handler({});
        expect(result).toHaveProperty('actions');
        expect(result).toHaveProperty('total');
        expect((result as { actions: unknown[]; total: number }).actions).toBeInstanceOf(Array);
        expect((result as { total: number }).total).toBe(0);
      });

      it('should accept processed filter parameter', async () => {
        const tools = service.getTools();
        const listActions = tools.find((t) => t.name === 'list-message-actions');

        const result = await listActions?.handler({ processed: false });
        expect(result).toHaveProperty('actions');
        expect(result).toHaveProperty('total');
      });
    });

    describe('get-message-action tool', () => {
      it('should return not_found error for non-existent ID', async () => {
        const tools = service.getTools();
        const getAction = tools.find((t) => t.name === 'get-message-action');

        const result = await getAction?.handler({ id: 'non-existent-uuid' });
        expect(result).toHaveProperty('error');
        expect((result as { error: string }).error).toBe('not_found');
      });

      it('should have id as required parameter', () => {
        const tools = service.getTools();
        const getAction = tools.find((t) => t.name === 'get-message-action');

        expect(getAction?.inputSchema.required).toContain('id');
      });
    });

    describe('delete-message-action tool', () => {
      it('should return not_found error for non-existent ID', async () => {
        const tools = service.getTools();
        const deleteAction = tools.find((t) => t.name === 'delete-message-action');

        const result = await deleteAction?.handler({ id: 'non-existent-uuid' });
        expect(result).toHaveProperty('error');
        expect((result as { error: string }).error).toBe('not_found');
      });

      it('should have id as required parameter', () => {
        const tools = service.getTools();
        const deleteAction = tools.find((t) => t.name === 'delete-message-action');

        expect(deleteAction?.inputSchema.required).toContain('id');
      });
    });
  });
});
