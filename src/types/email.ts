/**
 * Type definitions for email move operations
 * Feature: 014-move-email-folder
 */

/**
 * Input parameters for single email move operation
 */
export interface MoveEmailInput {
  /**
   * Email message ID to move (from list-emails tool)
   * Format: Graph API message GUID
   */
  emailId: string;

  /**
   * Target folder path (supports nested paths with / delimiter)
   * Examples: "Archive", "Projects/2026/Q1", "Work/Clients/ClientA"
   */
  folderPath: string;

  /**
   * Whether to mark the email as read after moving
   * Default: true
   */
  markAsRead?: boolean;
}

/**
 * Input parameters for batch email move operation (atomic)
 */
export interface MoveEmailsInput {
  /**
   * Array of email message IDs to move
   * All emails moved to the same target folder
   */
  emailIds: string[];

  /**
   * Target folder path (same format as MoveEmailInput.folderPath)
   */
  folderPath: string;

  /**
   * Whether to mark all emails as read after moving
   * Default: true
   */
  markAsRead?: boolean;
}

/**
 * Success result returned by move operations
 */
export interface MoveResult {
  /**
   * Operation success indicator
   */
  success: true;

  /**
   * Email ID that was moved
   */
  emailId: string;

  /**
   * Email subject for human confirmation (truncated to 100 chars)
   */
  subject: string;

  /**
   * Original folder path (before move)
   */
  fromFolder: string;

  /**
   * Target folder path (after move)
   */
  toFolder: string;

  /**
   * Whether the email was marked as read
   */
  markedAsRead: boolean;

  /**
   * Whether this was an idempotent operation (email already in target folder)
   */
  wasIdempotent: boolean;
}

/**
 * Success result returned by batch move operations
 */
export interface MoveBatchResult {
  /**
   * Operation success indicator
   */
  success: true;

  /**
   * Number of emails moved
   */
  count: number;

  /**
   * Individual move results for each email
   */
  results: MoveResult[];

  /**
   * Target folder path for the batch
   */
  toFolder: string;

  /**
   * Whether any emails were idempotent (already in target folder)
   */
  hadIdempotentMoves: boolean;
}

/**
 * Error types for move operations
 */
export type MoveErrorType =
  | 'EMAIL_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'NETWORK_ERROR'
  | 'GRAPH_API_ERROR';

/**
 * Error result returned when move operations fail
 */
export interface MoveError {
  /**
   * Operation success indicator
   */
  success: false;

  /**
   * Error type for categorization
   */
  errorType: MoveErrorType;

  /**
   * Human-readable error message with context
   */
  message: string;

  /**
   * Email ID that failed (if applicable)
   */
  emailId?: string;

  /**
   * Email subject for context (if available, truncated to 100 chars)
   */
  subject?: string;

  /**
   * Folder path that caused the error (if applicable)
   */
  folderPath?: string;

  /**
   * Microsoft Graph API error code (if applicable)
   */
  graphErrorCode?: string;
}

/**
 * Error result returned when batch move operations fail
 */
export interface MoveBatchError {
  /**
   * Operation success indicator
   */
  success: false;

  /**
   * Error type (same categories as MoveError)
   */
  errorType: MoveErrorType;

  /**
   * Human-readable error message explaining batch failure
   */
  message: string;

  /**
   * Individual validation failures for specific emails
   */
  validationErrors?: Array<{
    emailId: string;
    subject?: string;
    reason: string;
  }>;

  /**
   * Target folder path for the batch
   */
  folderPath: string;

  /**
   * Number of emails that were supposed to be moved
   */
  attemptedCount: number;

  /**
   * Whether compensation (rollback) was attempted
   */
  compensationAttempted?: boolean;

  /**
   * Whether compensation succeeded
   */
  compensationSucceeded?: boolean;
}

/**
 * Internal state for tracking batch move operations
 * Not exposed via MCP tool
 */
export interface BatchMoveState {
  /**
   * Target folder ID (resolved from path)
   */
  targetFolderId: string;

  /**
   * Target folder display name for reporting
   */
  targetFolderName: string;

  /**
   * Move operation tracking for each email
   */
  operations: Array<{
    emailId: string;
    subject: string;
    originalFolderId: string;
    originalFolderName: string;
    originalIsRead: boolean;
    moved: boolean;
    wasIdempotent: boolean;
  }>;

  /**
   * Whether compensation (rollback) is needed
   */
  needsCompensation: boolean;
}
