/**
 * Slack Saved Items Service (Feature 020)
 *
 * Standalone MCP service exposing list-saved-items and mark-saved-item-complete
 * tools. Uses browser session credentials (xoxc/xoxd) exclusively — no dependency
 * on the OAuth-based Slack integration.
 */

import { BaseService, ServiceConfig } from '../../types/service';
import { Tool, ToolHandler } from '../../types/tool';
import { logger } from '../../common/logger';
import { SessionCredentialStorage } from './session-credential-storage';
import {
  WebclientApiClient,
  CredentialsNotConfiguredError,
  CredentialsExpiredError,
  CredentialsInvalidError,
  RateLimitedError,
  mapRawItem,
  mapCounts,
} from './webclient-api-client';
import type {
  ListSavedItemsInput,
  MarkSavedItemCompleteInput,
  MarkSavedItemCompleteOutput,
  ListSavedItemsOutput,
} from '../../types/slack-saved-items';

/** Standard error response returned by both tools on failure */
export interface ToolErrorResponse {
  error: string;
  code:
    | 'credentials_not_configured'
    | 'credentials_expired'
    | 'credentials_invalid'
    | 'api_error'
    | 'rate_limited'
    | 'invalid_input';
  dashboardUrl?: string;
}

/** Placeholder dashboard URL for error messages */
const DASHBOARD_URL = 'http://localhost:3333/auth/slack-saved-items/credentials';

export class SlackSavedItemsService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string = 'slack-saved-items';

  constructor(
    private readonly credentialStorage: SessionCredentialStorage,
    private readonly apiClient: WebclientApiClient
  ) {
    // Minimal ServiceConfig — this service has no OAuth flow
    this.config = {
      name: 'slack-saved-items',
      displayName: 'Slack Saved Items',
      apiEndpoint: 'https://slack.com',
      oauth: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        scopes: [],
        authEndpoint: '',
        tokenEndpoint: '',
      },
      tokenStorePath: '.tokens/slack-session-credentials.json',
    };
  }

  // ─── BaseService lifecycle ────────────────────────────────────────────────

  async initialize(): Promise<void> {
    logger.info({
      operation: 'slack_saved_items_init',
      message: 'Initializing Slack Saved Items service',
    });

    await this.credentialStorage.load();
    const creds = this.credentialStorage.getCurrent();

    if (creds) {
      if (this.credentialStorage.isExpired()) {
        logger.warn({
          operation: 'slack_saved_items_credentials_expired',
          message: `Slack saved-items credentials expired. Visit ${DASHBOARD_URL} to refresh.`,
        });
      } else {
        if (this.credentialStorage.isExpiringSoon()) {
          logger.warn({
            operation: 'slack_saved_items_credentials_expiring',
            message: `Slack saved-items credentials expire soon. Visit ${DASHBOARD_URL} to refresh.`,
          });
        }
        // Warm up workspace URL cache
        try {
          await this.apiClient.resolveWorkspaceUrl();
        } catch (err) {
          logger.warn({
            operation: 'slack_saved_items_workspace_resolve_failed',
            error: (err as Error).message,
            message: 'Could not resolve workspace URL during init — will retry on first tool call',
          });
        }
      }
    } else {
      logger.info({
        operation: 'slack_saved_items_no_credentials',
        message: `Slack saved-items: no credentials configured. Visit ${DASHBOARD_URL} to set up.`,
      });
    }

    logger.info({
      operation: 'slack_saved_items_initialized',
      hasCredentials: !!creds,
      isExpired: this.credentialStorage.isExpired(),
      message: 'Slack Saved Items service initialized',
    });
  }

  getTools(): Tool[] {
    return [
      {
        name: 'list-saved-items',
        description:
          "List messages saved using Slack's native 'Save for Later' button. " +
          'Returns all items regardless of state (active, snoozed, completed, archived) ' +
          'with full message text and metadata. Use the nextCursor field to page through results.',
        inputSchema: {
          type: 'object',
          properties: {
            cursor: {
              type: 'string',
              description: 'Pagination cursor from a previous list-saved-items response.',
            },
          },
          additionalProperties: false,
        },
        handler: this.listSavedItems.bind(this),
      },
      {
        name: 'mark-saved-item-complete',
        description:
          'Mark a Slack saved item as complete. Use the channel (itemId) and ts values ' +
          'from a list-saved-items response. The change is reflected immediately in Slack.',
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: "Channel identifier — the 'itemId' field from list-saved-items.",
            },
            ts: {
              type: 'string',
              description: "Message timestamp — the 'ts' field from list-saved-items.",
            },
          },
          required: ['channel', 'ts'],
          additionalProperties: false,
        },
        handler: this.markSavedItemComplete.bind(this) as unknown as ToolHandler,
      },
    ];
  }

  async isAuthenticated(): Promise<boolean> {
    const creds = this.credentialStorage.getCurrent();
    return !!creds && !this.credentialStorage.isExpired();
  }

  async shutdown(): Promise<void> {
    // No persistent resources to clean up
  }

  // ─── Tool: list-saved-items ───────────────────────────────────────────────

  private async listSavedItems(input: ListSavedItemsInput): Promise<ListSavedItemsOutput | ToolErrorResponse> {
    logger.info({
      operation: 'list_saved_items_call',
      hasCursor: !!input?.cursor,
      message: 'list-saved-items tool called',
    });

    const credCheck = this.checkCredentials();
    if (credCheck) return credCheck;

    try {
      const response = await this.apiClient.savedList(input?.cursor);

      // Enrich each item with message text inline
      const items = await Promise.all(
        response.saved_items.map(async (raw) => {
          const { text, userName } = await this.apiClient.fetchMessageText(raw.item_id, raw.ts);
          return mapRawItem(raw, text, userName);
        })
      );

      const counts = mapCounts(response.counts);
      const nextCursor = response.response_metadata?.next_cursor || undefined;

      logger.info({
        operation: 'list_saved_items_success',
        itemCount: items.length,
        hasNextCursor: !!nextCursor,
        message: `list-saved-items returned ${items.length} items`,
      });

      const result: ListSavedItemsOutput = { items, counts };
      if (nextCursor) result.nextCursor = nextCursor;
      return result;
    } catch (err) {
      return this.mapError(err);
    }
  }

  // ─── Tool: mark-saved-item-complete ──────────────────────────────────────

  private async markSavedItemComplete(input: MarkSavedItemCompleteInput): Promise<MarkSavedItemCompleteOutput | ToolErrorResponse> {
    logger.info({
      operation: 'mark_saved_item_complete_call',
      channel: input?.channel,
      ts: input?.ts,
      message: 'mark-saved-item-complete tool called',
    });

    if (!input?.channel) {
      return {
        error: 'Missing required field: channel',
        code: 'invalid_input',
      };
    }
    if (!input?.ts) {
      return {
        error: 'Missing required field: ts',
        code: 'invalid_input',
      };
    }

    const credCheck = this.checkCredentials();
    if (credCheck) return credCheck;

    try {
      await this.apiClient.savedUpdate(input.channel, input.ts);

      logger.info({
        operation: 'mark_saved_item_complete_success',
        channel: input.channel,
        ts: input.ts,
        message: 'Saved item marked as complete',
      });

      return { success: true, channel: input.channel, ts: input.ts };
    } catch (err) {
      return this.mapError(err);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Returns an error response if credentials are missing or expired; otherwise null */
  private checkCredentials(): ToolErrorResponse | null {
    const creds = this.credentialStorage.getCurrent();
    if (!creds) {
      return {
        error: `Slack session credentials are not configured. Visit ${DASHBOARD_URL} to set them up.`,
        code: 'credentials_not_configured',
        dashboardUrl: DASHBOARD_URL,
      };
    }
    if (this.credentialStorage.isExpired()) {
      return {
        error: `Slack session credentials have expired. Visit ${DASHBOARD_URL} to refresh them.`,
        code: 'credentials_expired',
        dashboardUrl: DASHBOARD_URL,
      };
    }
    return null;
  }

  /** Map a thrown error to a ToolErrorResponse */
  private mapError(err: unknown): ToolErrorResponse {
    if (err instanceof CredentialsNotConfiguredError) {
      return { error: err.message, code: 'credentials_not_configured', dashboardUrl: DASHBOARD_URL };
    }
    if (err instanceof CredentialsExpiredError) {
      return { error: err.message, code: 'credentials_expired', dashboardUrl: DASHBOARD_URL };
    }
    if (err instanceof CredentialsInvalidError) {
      return { error: err.message, code: 'credentials_invalid', dashboardUrl: DASHBOARD_URL };
    }
    if (err instanceof RateLimitedError) {
      return { error: err.message, code: 'rate_limited' };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({
      operation: 'slack_saved_items_tool_error',
      error: message,
      message: 'Unexpected error in Slack saved-items tool',
    });
    return { error: `Unexpected error: ${message}`, code: 'api_error' };
  }
}
