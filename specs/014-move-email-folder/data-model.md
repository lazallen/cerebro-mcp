# Data Model: Move Email to Folder

**Date**: 2026-01-30
**Feature**: 014-move-email-folder

## Overview

Type definitions and data structures for email move operations. All types are TypeScript interfaces for use in the cerebro-mcp type system.

## Core Entities

### MoveEmailInput

Input parameters for single email move operation.

```typescript
interface MoveEmailInput {
  /**
   * Email message ID to move (from list-emails tool)
   * Format: Graph API message GUID
   * Example: "AAMkAGI2T..."
   */
  emailId: string;

  /**
   * Target folder path (supports nested paths with / delimiter)
   * Examples: "Archive", "Projects/2026/Q1", "Work/Clients/ClientA"
   * Well-known names: inbox, sent, drafts, spam, junk, trash, deleted
   */
  folderPath: string;

  /**
   * Whether to mark the email as read after moving
   * Default: true
   * If false, preserves original read/unread status
   */
  markAsRead?: boolean;
}
```

**Validation Rules**:
- `emailId`: Required, non-empty string
- `folderPath`: Required, non-empty string, max length 260 characters (Graph API limit)
- `markAsRead`: Optional boolean, defaults to `true`

**Source**: FR-001, FR-002, FR-003, FR-004, FR-005

---

### MoveEmailsInput

Input parameters for batch email move operation (atomic).

```typescript
interface MoveEmailsInput {
  /**
   * Array of email message IDs to move (from list-emails tool)
   * All emails moved to the same target folder
   * Atomic: all succeed or all fail
   */
  emailIds: string[];

  /**
   * Target folder path (same format as MoveEmailInput.folderPath)
   */
  folderPath: string;

  /**
   * Whether to mark all emails as read after moving
   * Default: true
   * Applied to all emails in the batch
   */
  markAsRead?: boolean;
}
```

**Validation Rules**:
- `emailIds`: Required, non-empty array, max 50 elements (recommended limit)
- `folderPath`: Same as MoveEmailInput
- `markAsRead`: Same as MoveEmailInput

**Atomic Behavior** (FR-013):
- All emails must exist and be accessible
- Target folder must exist
- If any validation fails, no emails are moved
- If any move fails, all completed moves are reversed

**Source**: FR-013, FR-014, FR-015

---

### MoveResult

Success result returned by move operations.

```typescript
interface MoveResult {
  /**
   * Operation success indicator
   */
  success: true;

  /**
   * Email ID that was moved
   */
  emailId: string;

  /**
   * Email subject for human confirmation
   * Truncated to 100 characters if longer
   * Example: "Meeting notes from Q1 planning"
   */
  subject: string;

  /**
   * Original folder path (before move)
   * Example: "Inbox"
   */
  fromFolder: string;

  /**
   * Target folder path (after move)
   * Example: "Projects/2026/Q1"
   */
  toFolder: string;

  /**
   * Whether the email was marked as read
   */
  markedAsRead: boolean;

  /**
   * Whether this was an idempotent operation (email already in target folder)
   * If true, no actual move occurred
   */
  wasIdempotent: boolean;
}
```

**Source**: FR-010, FR-016, FR-017, FR-018

---

### MoveBatchResult

Success result returned by batch move operations.

```typescript
interface MoveBatchResult {
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
   * Array length equals input emailIds length
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
```

**Source**: FR-013, User Story 3

---

### MoveError

Error result returned when move operations fail.

```typescript
interface MoveError {
  /**
   * Operation success indicator
   */
  success: false;

  /**
   * Error type for categorization
   */
  errorType: 'EMAIL_NOT_FOUND' | 'FOLDER_NOT_FOUND' | 'PERMISSION_DENIED' |
             'INVALID_INPUT' | 'NETWORK_ERROR' | 'GRAPH_API_ERROR';

  /**
   * Human-readable error message with context
   * Format: "Failed to move email [id] \"subject\" to folder \"path\". Reason: detail"
   * Never includes sensitive email content (body, attachments)
   */
  message: string;

  /**
   * Email ID that failed (if applicable)
   */
  emailId?: string;

  /**
   * Email subject for context (if available)
   * Truncated to 100 characters
   */
  subject?: string;

  /**
   * Folder path that caused the error (if applicable)
   */
  folderPath?: string;

  /**
   * Microsoft Graph API error code (if applicable)
   * Example: "ErrorItemNotFound", "ErrorAccessDenied"
   */
  graphErrorCode?: string;
}
```

**Error Type Mapping**:
- `EMAIL_NOT_FOUND`: Email ID doesn't exist or was deleted (404 from Graph API)
- `FOLDER_NOT_FOUND`: Target folder path doesn't exist (404 from folder resolution)
- `PERMISSION_DENIED`: User lacks permission to move emails to target folder (403)
- `INVALID_INPUT`: Input validation failed (emailId empty, folderPath invalid)
- `NETWORK_ERROR`: Transient network issue, timeout, or connection failure
- `GRAPH_API_ERROR`: Other Microsoft Graph API errors not covered above

**Source**: FR-008, FR-009, FR-018, Edge Cases

---

### MoveBatchError

Error result returned when batch move operations fail.

```typescript
interface MoveBatchError {
  /**
   * Operation success indicator
   */
  success: false;

  /**
   * Error type (same categories as MoveError)
   */
  errorType: MoveError['errorType'];

  /**
   * Human-readable error message explaining batch failure
   * Format: "Batch move failed validation:\n- Email [id] \"subject\": reason\n- Folder \"path\": reason"
   */
  message: string;

  /**
   * Individual validation failures for specific emails
   * Present when validation phase detects multiple issues
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
   * True if some moves succeeded before failure
   */
  compensationAttempted?: boolean;

  /**
   * Whether compensation succeeded
   * Only present if compensationAttempted is true
   */
  compensationSucceeded?: boolean;
}
```

**Batch Error Scenarios**:
1. **Validation failure**: One or more emails or folder invalid → no moves attempted
2. **Move failure**: Move fails after validation → compensation attempted to rollback
3. **Compensation failure**: Rollback fails → requires manual intervention (rare)

**Source**: FR-013, FR-014, FR-015

---

## Internal State Tracking

### BatchMoveState

Internal state for tracking batch move operations (not exposed via MCP tool).

```typescript
interface BatchMoveState {
  /**
   * Target folder ID (resolved from path)
   */
  targetFolderId: string;

  /**
   * Move operation tracking for each email
   */
  operations: Array<{
    /**
     * Email message ID
     */
    emailId: string;

    /**
     * Email subject (for error reporting)
     */
    subject: string;

    /**
     * Original folder ID (for compensation)
     */
    originalFolderId: string;

    /**
     * Original read status (for compensation)
     */
    originalIsRead: boolean;

    /**
     * Whether this email was moved successfully
     */
    moved: boolean;

    /**
     * Whether this was idempotent (no actual move needed)
     */
    wasIdempotent: boolean;
  }>;

  /**
   * Whether compensation (rollback) is needed
   */
  needsCompensation: boolean;
}
```

**Usage**:
- Created during batch validation phase
- Updated as each move completes
- Used for compensation if any move fails
- Logged for debugging: `{ operation: 'batch_move_state', state: BatchMoveState }`

---

## Relationships

```text
MoveEmailInput ──────> MoveResult (success)
                  └───> MoveError (failure)

MoveEmailsInput ─────> MoveBatchResult (all succeed)
                  └───> MoveBatchError (any fail)

MoveBatchResult.results[] ──> MoveResult[] (one per email)

BatchMoveState (internal) ──> Used by both success and error paths
                              Not exposed to MCP tool caller
```

---

## Validation Summary

### Pre-Move Validation

All validations occur before any moves:

1. **Input validation**:
   - Email ID(s) non-empty
   - Folder path non-empty, max 260 chars
   - Batch size ≤ 50 emails (recommended)

2. **Email existence**:
   - `GET /me/messages/{id}?$select=id,subject,parentFolderId,isRead`
   - Retrieve subject, current folder, read status for each email

3. **Folder existence**:
   - Resolve folder path to folder ID using `resolveFolderName()`
   - Verify folder is accessible

4. **Idempotent check**:
   - Compare email's parentFolderId with target folder ID
   - If match, mark as idempotent (skip actual move)

### Atomic Batch Validation (FR-014)

For batch operations, all validations complete before first move:
- Validate all email IDs exist
- Retrieve all email metadata (subject, current folder, isRead)
- Validate target folder exists
- Build BatchMoveState with complete operation list

If any validation fails:
- Return MoveBatchError with all validation failures
- No moves attempted
- No compensation needed

---

## Success Flow Example

**Single Email Move (Non-Idempotent)**:
```
1. Validate input: { emailId: "msg1", folderPath: "Archive", markAsRead: true }
2. Fetch email: GET /me/messages/msg1 → { subject: "Test", parentFolderId: "inbox-id", isRead: false }
3. Resolve folder: "Archive" → "archive-id"
4. Check idempotent: "inbox-id" ≠ "archive-id" → proceed with move
5. Move email: POST /me/messages/msg1/move { destinationId: "archive-id" }
6. Update read: PATCH /me/messages/msg1 { isRead: true }
7. Return: {
     success: true,
     emailId: "msg1",
     subject: "Test",
     fromFolder: "Inbox",
     toFolder: "Archive",
     markedAsRead: true,
     wasIdempotent: false
   }
```

**Batch Move with Compensation**:
```
1. Validate input: { emailIds: ["msg1", "msg2", "msg3"], folderPath: "Projects", markAsRead: true }
2. Validate all emails: GET /me/messages/{id} for each
3. Resolve folder: "Projects" → "projects-id"
4. Build BatchMoveState with 3 operations
5. Move msg1: Success, mark moved=true
6. Move msg2: Success, mark moved=true
7. Move msg3: Failure (network error)
8. Compensation: Move msg1 back to original folder
9. Compensation: Move msg2 back to original folder
10. Return: {
      success: false,
      errorType: 'NETWORK_ERROR',
      message: "Batch move failed...",
      folderPath: "Projects",
      attemptedCount: 3,
      compensationAttempted: true,
      compensationSucceeded: true
    }
```

---

## Notes

- All types will be defined in `src/types/email.ts`
- Extends existing email types (EmailMessage, MailFolder) where applicable
- Graph API response types are not exposed directly; mapped to these interfaces
- Error messages always include context (email ID, subject, folder path) per FR-018
- Subjects truncated to 100 chars with "..." suffix if longer
- Original folder names are human-readable (resolved from IDs for display)
