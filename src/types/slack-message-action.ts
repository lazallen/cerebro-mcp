/**
 * Types for Slack message action payloads
 *
 * These types represent the payload structure sent by Slack when a user
 * triggers a message shortcut (message_action) from the "More actions" menu.
 */

/**
 * Stored message action with metadata
 */
export interface StoredMessageAction {
  /** Unique identifier (UUID v4) */
  id: string;
  /** ISO 8601 timestamp when action was received */
  receivedAt: string;
  /** Flag indicating triage status */
  processed: boolean;
  /** Complete Slack payload */
  payload: SlackMessageActionPayload;
}

/**
 * Slack message action payload as sent by Slack
 */
export interface SlackMessageActionPayload {
  /** Action type identifier - always 'message_action' for message shortcuts */
  type: 'message_action';
  /** Timestamp of the action */
  action_ts: string;
  /** Workspace information */
  team: SlackTeam;
  /** User who triggered the action */
  user: SlackActionUser;
  /** Channel where the message exists */
  channel: SlackChannel;
  /** The actioned message */
  message: SlackMessage;
  /** Shortcut callback identifier configured in Slack app */
  callback_id: string;
  /** Trigger ID for follow-up modals (expires after 3 seconds) */
  trigger_id: string;
  /** URL for delayed responses */
  response_url: string;
  /** Deprecated verification token */
  token?: string;
}

/**
 * Slack team/workspace information
 */
export interface SlackTeam {
  /** Slack team/workspace ID (T-prefixed) */
  id: string;
  /** Workspace domain name */
  domain: string;
}

/**
 * User who triggered the action
 */
export interface SlackActionUser {
  /** Slack user ID (U-prefixed) */
  id: string;
  /** User's handle (without @) */
  username: string;
  /** User's display name */
  name: string;
  /** Team ID reference */
  team_id: string;
}

/**
 * Channel where the message exists
 */
export interface SlackChannel {
  /** Slack channel ID (C-prefixed for public, G-prefixed for private) */
  id: string;
  /** Channel name (without #) */
  name: string;
}

/**
 * Slack message structure
 */
export interface SlackMessage {
  /** Message type (usually 'message') */
  type: string;
  /** Author's user ID */
  user: string;
  /** Message timestamp (Slack format: epoch.sequence) */
  ts: string;
  /** Message text content */
  text: string;
  /** Rich text blocks (if present) */
  blocks?: unknown[];
  /** Legacy attachments (if present) */
  attachments?: unknown[];
  /** Parent thread timestamp (if message is in a thread) */
  thread_ts?: string;
}

/**
 * Summary view for list operations
 */
export interface MessageActionSummary {
  /** Action ID */
  id: string;
  /** When the action was received */
  receivedAt: string;
  /** Triage status */
  processed: boolean;
  /** Channel name (without #) */
  channelName: string;
  /** Display name of user who triggered the action */
  userName: string;
  /** First 100 characters of message text */
  messagePreview: string;
}

/**
 * Storage file schema with versioning
 */
export interface MessageActionStorageSchema {
  /** Schema version for future migrations */
  version: number;
  /** Stored actions */
  actions: StoredMessageAction[];
}
