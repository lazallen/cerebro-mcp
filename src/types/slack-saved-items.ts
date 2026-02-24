/**
 * Shared TypeScript types for the Slack Save for Later integration (Feature 020).
 * These are the canonical definitions — implementation files should import from here.
 */

// ─── Credential Storage ──────────────────────────────────────────────────────

/** Slack browser session credentials stored in .tokens/slack-session-credentials.json */
export interface SessionCredentials {
  /** Browser localStorage token, starts with "xoxc-" */
  xoxcToken: string;
  /** Browser "d" cookie value, starts with "xoxd-" */
  xoxdCookie: string;
  /** Unix timestamp (ms) when credentials were last saved via the dashboard */
  savedAt: number;
  /** Cached workspace base URL from auth.test (e.g. "https://myworkspace.slack.com") */
  workspaceUrl?: string;
}

/** Computed credential health status for dashboard display */
export type CredentialStatus =
  | 'configured'     // Credentials valid and >2h from expiry
  | 'expiring_soon'  // Credentials valid but ≤2h remaining
  | 'expired'        // Estimated expiry has passed
  | 'not_configured'; // No credentials stored

// ─── Saved Items ─────────────────────────────────────────────────────────────

/** State values returned by Slack's saved.list API */
export type SavedItemState = 'uncompleted' | 'completed' | 'archived';

/** A saved item enriched with message text from conversations.history */
export interface SavedItem {
  /** Channel or DM identifier (Slack item_id field) */
  itemId: string;
  /** Item type — always "message" in current Slack implementation */
  itemType: string;
  /** Message timestamp in Slack format: "seconds.microseconds" */
  ts: string;
  /** Current state of the saved item */
  state: SavedItemState;
  /** Unix timestamp (seconds) when item was saved */
  dateCreated: number;
  /** Unix timestamp (seconds) for due date; 0 = none */
  dateDue: number;
  /** Unix timestamp (seconds) when completed; 0 = not yet completed */
  dateCompleted: number;
  /** Unix timestamp (seconds) of last state change */
  dateUpdated: number;
  /** Unix timestamp (seconds) for snooze expiry; 0 = not snoozed */
  dateSnoozedUntil: number;
  /** Whether the item has been archived */
  isArchived: boolean;
  /** Full message text fetched from conversations.history; empty string if unavailable */
  messageText: string;
  /** Raw Slack user ID of message author; empty string if unavailable */
  userId: string;
}

/** Summary counts from Slack's saved.list response */
export interface SavedItemCounts {
  uncompletedCount: number;
  uncompletedOverdueCount: number;
  archivedCount: number;
  completedCount: number;
  totalCount: number;
}

// ─── MCP Tool Inputs / Outputs ───────────────────────────────────────────────

/** Input schema for the list-saved-items tool */
export interface ListSavedItemsInput {
  /** Pagination cursor from a previous list-saved-items response */
  cursor?: string;
}

/** Output schema for the list-saved-items tool */
export interface ListSavedItemsOutput {
  /** All saved items for the current page, regardless of state */
  items: SavedItem[];
  /** Aggregate counts across all states */
  counts: SavedItemCounts;
  /** Cursor to pass as input for the next page; absent when no more items */
  nextCursor?: string;
}

/** Input schema for the mark-saved-item-complete tool */
export interface MarkSavedItemCompleteInput {
  /** Channel identifier (itemId from list-saved-items) */
  channel: string;
  /** Message timestamp (ts from list-saved-items) */
  ts: string;
}

/** Output schema for the mark-saved-item-complete tool */
export interface MarkSavedItemCompleteOutput {
  success: true;
  channel: string;
  ts: string;
}

// ─── Raw API Types (internal — not exposed via MCP) ──────────────────────────

/** Raw item shape returned by Slack's saved.list Webclient API */
export interface RawSavedItem {
  item_id: string;
  item_type: string;
  date_created: number;
  date_due: number;
  date_completed: number;
  date_updated: number;
  is_archived: boolean;
  date_snoozed_until: number;
  ts: string;
  state: string;
}

/** Raw counts shape returned by Slack's saved.list Webclient API */
export interface RawSavedItemCounts {
  uncompleted_count: number;
  uncompleted_overdue_count: number;
  archived_count: number;
  completed_count: number;
  total_count: number;
}

/** Full raw response from saved.list */
export interface RawSavedListResponse {
  ok: boolean;
  error?: string;
  saved_items: RawSavedItem[];
  counts: RawSavedItemCounts;
  response_metadata: {
    next_cursor: string;
  };
}
