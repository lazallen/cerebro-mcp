/**
 * Slack Service
 *
 * Provides Slack workspace integration with support for:
 * - Channels and private groups
 * - Message history and threads
 * - Canvas documents
 * - User identity
 * - Reminders
 */

import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common';
import { SlackTokenStorage } from './token-storage';
import { SlackApiClient } from './api-client';
import { MessageActionStorage } from './message-action-storage';
import { SlackSocketModeClient } from './slack-socket-client';
import type { MessageActionSummary, StoredMessageAction } from '../../types/slack-message-action';

export class SlackService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string;
  private readonly tokenStorage: SlackTokenStorage;
  private readonly apiClient: SlackApiClient;
  private readonly messageActionStorage: MessageActionStorage;
  private socketModeClient: SlackSocketModeClient | null = null;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.name = config.name;
    this.tokenStorage = new SlackTokenStorage(config);
    this.apiClient = new SlackApiClient(this.tokenStorage);
    this.messageActionStorage = new MessageActionStorage();
  }

  async initialize(): Promise<void> {
    logger.info({
      operation: 'slack_service_init',
      service: this.name,
      hasTokens: await this.isAuthenticated(),
      msg: 'Slack service initialized',
    });

    // Initialize Socket Mode if app token is configured
    await this.initializeSocketMode();
  }

  getTools(): Tool[] {
    return [
      // Authentication Tools
      {
        name: 'authenticate',
        description:
          'Initiate Slack OAuth authentication. Returns authorization URL to complete in browser.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.authenticate.bind(this),
      },
      {
        name: 'check-auth-status',
        description:
          'Check Slack authentication status. Returns team and user information if authenticated.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.checkAuthStatus.bind(this),
      },

      // Channel Tools
      {
        name: 'list-channels',
        description: 'List all public channels in the Slack workspace with pagination support.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of channels to return (default: 100, max: 200)',
              default: 100,
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous response',
            },
          },
        },
        handler: this.listChannels.bind(this),
      },
      {
        name: 'get-channel-history',
        description: 'Retrieve message history from a specific public channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'Slack channel ID',
            },
            limit: {
              type: 'number',
              description: 'Number of messages to return (default: 50, max: 200)',
              default: 50,
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous response',
            },
            oldest: {
              type: 'string',
              description: 'Unix timestamp to fetch messages after this time',
            },
            latest: {
              type: 'string',
              description: 'Unix timestamp to fetch messages before this time',
            },
          },
          required: ['channelId'],
        },
        handler: this.getChannelHistory.bind(this),
      },

      // Group Tools
      {
        name: 'list-groups',
        description: 'List all private groups (private channels) the user is a member of.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of groups to return (default: 100, max: 200)',
              default: 100,
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous response',
            },
          },
        },
        handler: this.listGroups.bind(this),
      },
      {
        name: 'get-group-history',
        description: 'Retrieve message history from a specific private group.',
        inputSchema: {
          type: 'object',
          properties: {
            groupId: {
              type: 'string',
              description: 'Slack group (private channel) ID',
            },
            limit: {
              type: 'number',
              description: 'Number of messages to return (default: 50, max: 200)',
              default: 50,
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous response',
            },
            oldest: {
              type: 'string',
              description: 'Unix timestamp to fetch messages after this time',
            },
            latest: {
              type: 'string',
              description: 'Unix timestamp to fetch messages before this time',
            },
          },
          required: ['groupId'],
        },
        handler: this.getGroupHistory.bind(this),
      },

      // Thread Tools
      {
        name: 'get-thread-replies',
        description: 'Retrieve all replies in a threaded conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'Slack channel ID containing the thread',
            },
            threadTs: {
              type: 'string',
              description: 'Thread parent message timestamp',
            },
            limit: {
              type: 'number',
              description: 'Number of replies to return (default: 50, max: 200)',
              default: 50,
            },
            cursor: {
              type: 'string',
              description: 'Pagination cursor from previous response',
            },
          },
          required: ['channelId', 'threadTs'],
        },
        handler: this.getThreadReplies.bind(this),
      },

      // Canvas Tools
      {
        name: 'read-canvas',
        description: 'Read content from a Slack canvas by ID. Returns markdown content.',
        inputSchema: {
          type: 'object',
          properties: {
            canvasId: {
              type: 'string',
              description: 'Slack canvas ID',
            },
          },
          required: ['canvasId'],
        },
        handler: this.readCanvas.bind(this),
      },
      {
        name: 'search-canvases',
        description: 'Search for canvases within a specific channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'Slack channel ID to search in',
            },
            limit: {
              type: 'number',
              description: 'Number of results to return (default: 20, max: 100)',
              default: 20,
            },
          },
          required: ['channelId'],
        },
        handler: this.searchCanvases.bind(this),
      },

      // Identity Tools
      {
        name: 'get-user-identity',
        description: "Retrieve the authenticated user's Slack identity information.",
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.getUserIdentity.bind(this),
      },

      // Reminder Tools
      {
        name: 'list-reminders',
        description: 'List all active reminders for the authenticated user.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.listReminders.bind(this),
      },
      {
        name: 'create-reminder',
        description: 'Create a new reminder for the authenticated user.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Reminder description/text',
            },
            time: {
              type: 'string',
              description: 'Unix timestamp or relative time (e.g., "in 1 hour", "tomorrow at 9am")',
            },
          },
          required: ['text', 'time'],
        },
        handler: this.createReminder.bind(this),
      },
      {
        name: 'complete-reminder',
        description: 'Mark a reminder as complete.',
        inputSchema: {
          type: 'object',
          properties: {
            reminderId: {
              type: 'string',
              description: 'Reminder ID to complete',
            },
          },
          required: ['reminderId'],
        },
        handler: this.completeReminder.bind(this),
      },

      // Message Action Tools (for triage workflow)
      {
        name: 'list-message-actions',
        description:
          'List stored Slack message actions captured via message shortcuts. Returns summaries with channel, user, and message preview.',
        inputSchema: {
          type: 'object',
          properties: {
            processed: {
              type: 'boolean',
              description: 'Filter by processed status. Omit to return all actions.',
            },
          },
        },
        handler: this.listMessageActions.bind(this),
      },
      {
        name: 'get-message-action',
        description:
          'Get full details of a stored message action by ID, including the complete Slack payload.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The action ID (UUID)',
            },
          },
          required: ['id'],
        },
        handler: this.getMessageAction.bind(this),
      },
      {
        name: 'delete-message-action',
        description: 'Delete a stored message action after processing/triage.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The action ID (UUID) to delete',
            },
          },
          required: ['id'],
        },
        handler: this.deleteMessageAction.bind(this),
      },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async isAuthenticated(): Promise<boolean> {
    return this.tokenStorage.hasTokens();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    logger.info({
      operation: 'slack_service_shutdown',
      service: this.name,
      msg: 'Shutting down Slack service',
    });

    // Disconnect Socket Mode client if connected
    if (this.socketModeClient) {
      this.socketModeClient.disconnect();
      this.socketModeClient = null;
    }
  }

  /**
   * Initialize Socket Mode client if SLACK_APP_TOKEN is configured
   */
  private async initializeSocketMode(): Promise<void> {
    const appToken = process.env['SLACK_APP_TOKEN'];

    if (!appToken) {
      logger.info({
        operation: 'socket_mode_skip',
        msg: 'Socket Mode not enabled: SLACK_APP_TOKEN not configured',
      });
      return;
    }

    if (!appToken.startsWith('xapp-')) {
      logger.warn({
        operation: 'socket_mode_skip',
        msg: 'Socket Mode not enabled: SLACK_APP_TOKEN must start with "xapp-"',
      });
      return;
    }

    logger.info({
      operation: 'socket_mode_init',
      msg: 'Initializing Socket Mode client...',
    });

    this.socketModeClient = new SlackSocketModeClient({
      appToken,
      onMessageAction: (payload) => {
        try {
          const stored = this.messageActionStorage.add(payload);
          logger.info({
            operation: 'socket_message_action_stored',
            actionId: stored.id,
            channel: payload.channel?.name,
            user: payload.user?.username,
            msg: `Stored message action: ${stored.id}`,
          });
        } catch (error) {
          logger.error({
            operation: 'socket_message_action_storage_error',
            error: error instanceof Error ? error.message : String(error),
            msg: 'Failed to store message action from Socket Mode',
          });
        }
      },
      onConnected: () => {
        logger.info({
          operation: 'socket_mode_connected',
          msg: 'Socket Mode connected - ready to receive message actions',
        });
      },
      onDisconnected: () => {
        logger.info({
          operation: 'socket_mode_disconnected',
          msg: 'Socket Mode disconnected',
        });
      },
    });

    try {
      await this.socketModeClient.connect();
    } catch (error) {
      logger.error({
        operation: 'socket_mode_connect_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to connect Socket Mode client (will retry automatically)',
      });
      // Don't throw - the client will retry automatically
    }
  }

  /**
   * Get authorization URL for OAuth flow
   * Note: This is handled by the OAuth server, but kept for backward compatibility
   */
  getAuthorizationUrl(): string {
    const userScopes = this.config.oauth.userScopes ?? [];
    const scopes = userScopes.join(','); // Slack uses comma-separated scopes
    const params = {
      client_id: this.config.oauth.clientId,
      user_scope: scopes,
      redirect_uri: encodeURIComponent(this.config.oauth.redirectUri),
    };

    const queryString = `client_id=${params.client_id}&user_scope=${params.user_scope}&redirect_uri=${params.redirect_uri}`;
    return `${this.config.oauth.authEndpoint}?${queryString}`;
  }

  /**
   * Initiate OAuth authentication
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async authenticate(_input: Record<string, unknown>): Promise<unknown> {
    const authUrl = this.getAuthorizationUrl();
    return {
      success: true,
      authUrl,
      message: 'Please visit the URL to complete authentication',
    };
  }

  /**
   * Check authentication status
   */
  private async checkAuthStatus(_input: Record<string, unknown>): Promise<unknown> {
    const hasTokens = await this.tokenStorage.hasTokens();
    if (!hasTokens) {
      return {
        authenticated: false,
        message: 'Not authenticated. Please run authenticate tool.',
      };
    }

    // Validate token with auth.test
    const response = await this.apiClient.request('/auth.test', {
      method: 'POST',
      body: {},
    });

    const data = response.data as {
      ok?: boolean;
      user_id?: string;
      user?: string;
      team_id?: string;
      team?: string;
      url?: string;
    };

    return {
      authenticated: true,
      userId: data.user_id,
      userName: data.user,
      teamId: data.team_id,
      teamName: data.team,
      teamUrl: data.url,
    };
  }

  /**
   * List public channels
   */
  private async listChannels(input: Record<string, unknown>): Promise<unknown> {
    const limit = Math.min((input['limit'] as number | undefined) ?? 100, 200);
    const cursor = input['cursor'] as string | undefined;

    const body: Record<string, unknown> = {
      types: 'public_channel',
      limit,
      exclude_archived: true,
    };

    if (cursor) {
      body['cursor'] = cursor;
    }

    const response = await this.apiClient.request('/conversations.list', {
      method: 'POST',
      body,
    });

    const data = response.data as {
      channels?: unknown[];
      response_metadata?: { next_cursor?: string };
    };

    return {
      channels: data.channels ?? [],
      count: (data.channels ?? []).length,
      nextCursor: data.response_metadata?.next_cursor,
    };
  }

  /**
   * Get channel message history
   */
  private async getChannelHistory(input: Record<string, unknown>): Promise<unknown> {
    const channelId = input['channelId'] as string;
    const limit = Math.min((input['limit'] as number | undefined) ?? 50, 200);
    const cursor = input['cursor'] as string | undefined;
    const oldest = input['oldest'] as string | undefined;
    const latest = input['latest'] as string | undefined;

    const body: Record<string, unknown> = {
      channel: channelId,
      limit,
    };

    if (cursor) body['cursor'] = cursor;
    if (oldest) body['oldest'] = oldest;
    if (latest) body['latest'] = latest;

    const response = await this.apiClient.request('/conversations.history', {
      method: 'POST',
      body,
    });

    const data = response.data as {
      messages?: unknown[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    };

    return {
      messages: data.messages ?? [],
      count: (data.messages ?? []).length,
      hasMore: data.has_more ?? false,
      nextCursor: data.response_metadata?.next_cursor,
    };
  }

  /**
   * List private groups
   */
  private async listGroups(input: Record<string, unknown>): Promise<unknown> {
    const limit = Math.min((input['limit'] as number | undefined) ?? 100, 200);
    const cursor = input['cursor'] as string | undefined;

    const body: Record<string, unknown> = {
      types: 'private_channel',
      limit,
      exclude_archived: true,
    };

    if (cursor) {
      body['cursor'] = cursor;
    }

    const response = await this.apiClient.request('/conversations.list', {
      method: 'POST',
      body,
    });

    const data = response.data as {
      channels?: unknown[];
      response_metadata?: { next_cursor?: string };
    };

    return {
      groups: data.channels ?? [],
      count: (data.channels ?? []).length,
      nextCursor: data.response_metadata?.next_cursor,
    };
  }

  /**
   * Get private group message history
   */
  private async getGroupHistory(input: Record<string, unknown>): Promise<unknown> {
    const groupId = input['groupId'] as string;
    const limit = Math.min((input['limit'] as number | undefined) ?? 50, 200);
    const cursor = input['cursor'] as string | undefined;
    const oldest = input['oldest'] as string | undefined;
    const latest = input['latest'] as string | undefined;

    const body: Record<string, unknown> = {
      channel: groupId,
      limit,
    };

    if (cursor) body['cursor'] = cursor;
    if (oldest) body['oldest'] = oldest;
    if (latest) body['latest'] = latest;

    const response = await this.apiClient.request('/conversations.history', {
      method: 'POST',
      body,
    });

    const data = response.data as {
      messages?: unknown[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    };

    return {
      messages: data.messages ?? [],
      count: (data.messages ?? []).length,
      hasMore: data.has_more ?? false,
      nextCursor: data.response_metadata?.next_cursor,
    };
  }

  /**
   * Get thread replies
   */
  private async getThreadReplies(input: Record<string, unknown>): Promise<unknown> {
    const channelId = input['channelId'] as string;
    const threadTs = input['threadTs'] as string;
    const limit = Math.min((input['limit'] as number | undefined) ?? 50, 200);
    const cursor = input['cursor'] as string | undefined;

    const body: Record<string, unknown> = {
      channel: channelId,
      ts: threadTs,
      limit,
    };

    if (cursor) {
      body['cursor'] = cursor;
    }

    const response = await this.apiClient.request('/conversations.replies', {
      method: 'POST',
      body,
    });

    const data = response.data as {
      messages?: unknown[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    };

    return {
      messages: data.messages ?? [],
      count: (data.messages ?? []).length,
      hasMore: data.has_more ?? false,
      nextCursor: data.response_metadata?.next_cursor,
    };
  }

  /**
   * Read canvas content
   */
  private async readCanvas(input: Record<string, unknown>): Promise<unknown> {
    const canvasId = input['canvasId'] as string;

    const response = await this.apiClient.request('/canvases.edit', {
      method: 'POST',
      body: {
        canvas_id: canvasId,
        changes: [], // Empty changes array for read-only
      },
    });

    const data = response.data as {
      canvas_id?: string;
      document_content?: unknown;
    };

    return {
      canvasId: data.canvas_id,
      content: data.document_content,
    };
  }

  /**
   * Search for canvases in a channel
   */
  private async searchCanvases(input: Record<string, unknown>): Promise<unknown> {
    const channelId = input['channelId'] as string;
    const limit = Math.min((input['limit'] as number | undefined) ?? 20, 100);

    const response = await this.apiClient.request('/search.messages', {
      method: 'POST',
      body: {
        query: `in:<#${channelId}> has:files`,
        count: limit,
      },
    });

    const data = response.data as {
      messages?: {
        matches?: Array<{
          text?: string;
          user?: string;
          ts?: string;
          channel?: { id?: string };
          files?: Array<{ id?: string; filetype?: string }>;
        }>;
      };
    };

    const matches = data.messages?.matches ?? [];
    const canvases = matches
      .filter((match) => {
        const files = match.files ?? [];
        return files.some((file) => file.filetype === 'canvas');
      })
      .map((match) => {
        const canvasFile = (match.files ?? []).find((file) => file.filetype === 'canvas');
        return {
          canvasId: canvasFile?.id,
          text: match.text,
          user: match.user,
          timestamp: match.ts,
          channelId: match.channel?.id,
        };
      });

    return {
      canvases,
      count: canvases.length,
    };
  }

  /**
   * Get user identity
   */
  private async getUserIdentity(_input: Record<string, unknown>): Promise<unknown> {
    const response = await this.apiClient.request('/users.identity', {
      method: 'POST',
      body: {},
    });

    return response.data;
  }

  /**
   * List reminders
   */
  private async listReminders(_input: Record<string, unknown>): Promise<unknown> {
    const response = await this.apiClient.request('/reminders.list', {
      method: 'POST',
      body: {},
    });

    const data = response.data as {
      reminders?: unknown[];
    };

    return {
      reminders: data.reminders ?? [],
      count: (data.reminders ?? []).length,
    };
  }

  /**
   * Create reminder
   */
  private async createReminder(input: Record<string, unknown>): Promise<unknown> {
    const text = input['text'] as string;
    const time = input['time'] as string;

    const response = await this.apiClient.request('/reminders.add', {
      method: 'POST',
      body: {
        text,
        time,
      },
    });

    const data = response.data as {
      reminder?: unknown;
    };

    return {
      success: true,
      reminder: data.reminder,
    };
  }

  /**
   * Complete reminder
   */
  private async completeReminder(input: Record<string, unknown>): Promise<unknown> {
    const reminderId = input['reminderId'] as string;

    await this.apiClient.request('/reminders.complete', {
      method: 'POST',
      body: {
        reminder: reminderId,
      },
    });

    return {
      success: true,
      reminderId,
    };
  }

  // ============================================================================
  // Message Action Tools (for triage workflow)
  // ============================================================================

  /**
   * List stored message actions
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async listMessageActions(input: Record<string, unknown>): Promise<unknown> {
    const processedFilter = input['processed'] as boolean | undefined;

    const options = processedFilter !== undefined ? { processed: processedFilter } : {};
    const actions: MessageActionSummary[] = this.messageActionStorage.list(options);
    const total = actions.length;

    logger.debug({
      operation: 'list_message_actions',
      total,
      filter: processedFilter,
      msg: `Listed ${total} message actions`,
    });

    return {
      actions,
      total,
    };
  }

  /**
   * Get full details of a message action by ID
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async getMessageAction(input: Record<string, unknown>): Promise<unknown> {
    const id = input['id'] as string;

    const action: StoredMessageAction | null = this.messageActionStorage.get(id);

    if (!action) {
      logger.debug({
        operation: 'get_message_action',
        id,
        found: false,
        msg: `Message action not found: ${id}`,
      });

      return {
        error: 'not_found',
        message: `Action with ID '${id}' not found`,
      };
    }

    logger.debug({
      operation: 'get_message_action',
      id,
      found: true,
      msg: `Retrieved message action: ${id}`,
    });

    return action;
  }

  /**
   * Delete a message action by ID
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async deleteMessageAction(input: Record<string, unknown>): Promise<unknown> {
    const id = input['id'] as string;

    const deleted = this.messageActionStorage.delete(id);

    if (!deleted) {
      logger.debug({
        operation: 'delete_message_action',
        id,
        success: false,
        msg: `Message action not found for deletion: ${id}`,
      });

      return {
        error: 'not_found',
        message: `Action with ID '${id}' not found`,
      };
    }

    logger.info({
      operation: 'delete_message_action',
      id,
      success: true,
      msg: `Deleted message action: ${id}`,
    });

    return {
      success: true,
      deletedId: id,
    };
  }
}
