/**
 * MCP tool interface contracts for Feature 020: Slack Save for Later.
 * These describe the JSON Schema used for tool registration and validation.
 */

// ─── Tool: list-saved-items ───────────────────────────────────────────────────

export const LIST_SAVED_ITEMS_TOOL = {
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
} as const;

// ─── Tool: mark-saved-item-complete ──────────────────────────────────────────

export const MARK_SAVED_ITEM_COMPLETE_TOOL = {
  name: 'mark-saved-item-complete',
  description:
    "Mark a Slack saved item as complete. Use the channel (itemId) and ts values " +
    "from a list-saved-items response. The change is reflected immediately in Slack.",
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
} as const;

// ─── Error shapes ─────────────────────────────────────────────────────────────

/** Standard error response returned by both tools on failure */
export interface ToolErrorResponse {
  error: string;
  /** Machine-readable error category */
  code:
    | 'credentials_not_configured'  // No credentials stored
    | 'credentials_expired'         // savedAt + 12h has passed
    | 'credentials_invalid'         // API returned auth failure
    | 'api_error'                   // Unexpected Slack API error
    | 'rate_limited'                // Still rate-limited after one retry
    | 'invalid_input';              // Missing or malformed required fields
  /** URL the user should visit to resolve auth issues */
  dashboardUrl?: string;
}

// ─── Heartbeat task config ────────────────────────────────────────────────────

/** Config block for the slack-saved-items-ingestion heartbeat task */
export interface SlackSavedItemsIngestionConfig {
  /**
   * Whether to call mark-saved-item-complete on each item after successful ingestion.
   * Default: true. Set to false to ingest without removing from Slack saved list.
   */
  markAsComplete?: boolean;
}

// ─── Dashboard credential form ────────────────────────────────────────────────

/** POST body for /auth/slack-saved-items/credentials */
export interface CredentialFormInput {
  xoxcToken: string;
  xoxdCookie: string;
}

/** Response from POST /auth/slack-saved-items/credentials */
export interface CredentialFormResponse {
  success: boolean;
  message: string;
  /** Estimated expiry time as ISO 8601 string (savedAt + 12h) */
  estimatedExpiresAt?: string;
  error?: string;
}

// ─── Dashboard status card ────────────────────────────────────────────────────

/** Shape of the status card data passed to the dashboard renderer */
export interface SlackSavedItemsCardData {
  status: 'configured' | 'expiring_soon' | 'expired' | 'not_configured';
  savedAt?: string;          // ISO 8601
  estimatedExpiresAt?: string; // ISO 8601
  workspaceUrl?: string;
  credentialsUrl: string;    // Link to the credential management page
}
