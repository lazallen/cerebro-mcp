# MCP Tool Contracts: Move Email

**Date**: 2026-01-30
**Feature**: 014-move-email-folder
**Namespace**: microsoft

## Overview

MCP tool schemas for email move operations. Both tools integrate into the existing Microsoft service (`MicrosoftService`) and appear in the MCP tool registry with the `microsoft.` prefix.

---

## Tool 1: move-email

Move a single email to a target folder with optional read status control.

### Tool Definition

```json
{
  "name": "move-email",
  "description": "Move an email to a different folder in Outlook. Supports nested folder paths (e.g., 'Projects/2026/Q1'). Marks emails as read by default after moving. Operation is idempotent - moving an email to its current folder succeeds without error.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "emailId": {
        "type": "string",
        "description": "Email message ID from list-emails tool. Format: Microsoft Graph API message GUID."
      },
      "folderPath": {
        "type": "string",
        "description": "Target folder path. Supports nested paths with forward slash delimiter (e.g., 'Archive', 'Projects/2026/Q1', 'Work/Clients/ClientA'). Common folders: inbox, sent, drafts, spam, junk, trash, deleted. Case-sensitive for custom folders."
      },
      "markAsRead": {
        "type": "boolean",
        "description": "Mark email as read after moving. Default: true. Set to false to preserve original read/unread status.",
        "default": true
      }
    },
    "required": ["emailId", "folderPath"]
  }
}
```

### Success Response

```typescript
{
  success: true,
  emailId: string,          // Email ID that was moved
  subject: string,          // Email subject (truncated to 100 chars)
  fromFolder: string,       // Original folder name
  toFolder: string,         // Target folder name
  markedAsRead: boolean,    // Whether email was marked as read
  wasIdempotent: boolean    // True if email was already in target folder
}
```

### Success Response Examples

**Standard Move**:
```json
{
  "success": true,
  "emailId": "AAMkAGI2T...",
  "subject": "Q1 Planning Meeting Notes",
  "fromFolder": "Inbox",
  "toFolder": "Projects/2026/Q1",
  "markedAsRead": true,
  "wasIdempotent": false
}
```

**Idempotent Move** (email already in target folder):
```json
{
  "success": true,
  "emailId": "AAMkAGI2T...",
  "subject": "Archived Document",
  "fromFolder": "Archive",
  "toFolder": "Archive",
  "markedAsRead": true,
  "wasIdempotent": true
}
```

**Preserve Read Status**:
```json
{
  "success": true,
  "emailId": "AAMkAGI2T...",
  "subject": "Unread Important Email",
  "fromFolder": "Inbox",
  "toFolder": "Important",
  "markedAsRead": false,
  "wasIdempotent": false
}
```

### Error Response

```typescript
{
  success: false,
  errorType: 'EMAIL_NOT_FOUND' | 'FOLDER_NOT_FOUND' | 'PERMISSION_DENIED' |
             'INVALID_INPUT' | 'NETWORK_ERROR' | 'GRAPH_API_ERROR',
  message: string,          // Human-readable error with context
  emailId?: string,         // Email ID that failed
  subject?: string,         // Email subject (if available)
  folderPath?: string,      // Folder path that caused error
  graphErrorCode?: string   // Microsoft Graph API error code
}
```

### Error Response Examples

**Email Not Found**:
```json
{
  "success": false,
  "errorType": "EMAIL_NOT_FOUND",
  "message": "Failed to move email [AAMkAGI2T...]: Email not found or has been deleted.",
  "emailId": "AAMkAGI2T...",
  "folderPath": "Archive"
}
```

**Folder Not Found**:
```json
{
  "success": false,
  "errorType": "FOLDER_NOT_FOUND",
  "message": "Failed to move email [AAMkAGI2T...] \"Meeting Notes\" to folder \"NonExistent\". Reason: Folder does not exist.",
  "emailId": "AAMkAGI2T...",
  "subject": "Meeting Notes",
  "folderPath": "NonExistent"
}
```

**Nested Folder Not Found**:
```json
{
  "success": false,
  "errorType": "FOLDER_NOT_FOUND",
  "message": "Failed to move email [AAMkAGI2T...] \"Report\" to folder \"Projects/2026/Q5\". Reason: Folder path 'Q5' not found under 'Projects/2026'.",
  "emailId": "AAMkAGI2T...",
  "subject": "Report",
  "folderPath": "Projects/2026/Q5"
}
```

**Permission Denied**:
```json
{
  "success": false,
  "errorType": "PERMISSION_DENIED",
  "message": "Failed to move email [AAMkAGI2T...] \"Confidential\" to folder \"Restricted\". Reason: Insufficient permissions.",
  "emailId": "AAMkAGI2T...",
  "subject": "Confidential",
  "folderPath": "Restricted",
  "graphErrorCode": "ErrorAccessDenied"
}
```

**Invalid Input**:
```json
{
  "success": false,
  "errorType": "INVALID_INPUT",
  "message": "Invalid input: emailId is required and cannot be empty."
}
```

---

## Tool 2: move-emails-batch

Move multiple emails to a target folder atomically (all succeed or all fail).

### Tool Definition

```json
{
  "name": "move-emails-batch",
  "description": "Move multiple emails to the same target folder atomically. All emails must move successfully, or none will be moved (transaction-style behavior). Useful for organizing multiple related messages at once. Marks emails as read by default after moving. Maximum recommended batch size: 50 emails.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "emailIds": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Array of email message IDs from list-emails tool. All emails will be moved to the same target folder. Maximum recommended: 50 emails.",
        "minItems": 1,
        "maxItems": 50
      },
      "folderPath": {
        "type": "string",
        "description": "Target folder path. Same format as move-email tool: supports nested paths with forward slash delimiter."
      },
      "markAsRead": {
        "type": "boolean",
        "description": "Mark all emails as read after moving. Default: true. Applied to all emails in the batch.",
        "default": true
      }
    },
    "required": ["emailIds", "folderPath"]
  }
}
```

### Success Response

```typescript
{
  success: true,
  count: number,            // Number of emails moved
  results: MoveResult[],    // Individual results for each email
  toFolder: string,         // Target folder name
  hadIdempotentMoves: boolean // True if any emails were already in target folder
}
```

### Success Response Example

```json
{
  "success": true,
  "count": 3,
  "results": [
    {
      "success": true,
      "emailId": "AAMkAGI2T001...",
      "subject": "Meeting Agenda",
      "fromFolder": "Inbox",
      "toFolder": "Archive",
      "markedAsRead": true,
      "wasIdempotent": false
    },
    {
      "success": true,
      "emailId": "AAMkAGI2T002...",
      "subject": "Project Update",
      "fromFolder": "Inbox",
      "toFolder": "Archive",
      "markedAsRead": true,
      "wasIdempotent": false
    },
    {
      "success": true,
      "emailId": "AAMkAGI2T003...",
      "subject": "Old Email",
      "fromFolder": "Archive",
      "toFolder": "Archive",
      "markedAsRead": true,
      "wasIdempotent": true
    }
  ],
  "toFolder": "Archive",
  "hadIdempotentMoves": true
}
```

### Error Response

```typescript
{
  success: false,
  errorType: 'EMAIL_NOT_FOUND' | 'FOLDER_NOT_FOUND' | 'PERMISSION_DENIED' |
             'INVALID_INPUT' | 'NETWORK_ERROR' | 'GRAPH_API_ERROR',
  message: string,                  // Human-readable batch error summary
  validationErrors?: Array<{        // Present for validation failures
    emailId: string,
    subject?: string,
    reason: string
  }>,
  folderPath: string,               // Target folder path
  attemptedCount: number,           // Number of emails in batch
  compensationAttempted?: boolean,  // True if rollback was needed
  compensationSucceeded?: boolean   // True if rollback succeeded
}
```

### Error Response Examples

**Validation Failure (Multiple Issues)**:
```json
{
  "success": false,
  "errorType": "EMAIL_NOT_FOUND",
  "message": "Batch move failed validation:\n- Email [AAMkAGI2T001...] \"Subject 1\": not found\n- Email [AAMkAGI2T003...]: not found",
  "validationErrors": [
    {
      "emailId": "AAMkAGI2T001...",
      "subject": "Subject 1",
      "reason": "Email not found or has been deleted"
    },
    {
      "emailId": "AAMkAGI2T003...",
      "reason": "Email not found or has been deleted"
    }
  ],
  "folderPath": "Archive",
  "attemptedCount": 3
}
```

**Folder Not Found (All Emails Valid)**:
```json
{
  "success": false,
  "errorType": "FOLDER_NOT_FOUND",
  "message": "Batch move failed: Target folder \"NonExistent\" does not exist.",
  "folderPath": "NonExistent",
  "attemptedCount": 5
}
```

**Move Failure with Compensation**:
```json
{
  "success": false,
  "errorType": "NETWORK_ERROR",
  "message": "Batch move failed during execution: Network error while moving email [AAMkAGI2T003...]. All moves have been rolled back.",
  "folderPath": "Projects",
  "attemptedCount": 3,
  "compensationAttempted": true,
  "compensationSucceeded": true
}
```

**Compensation Failed (Rare)**:
```json
{
  "success": false,
  "errorType": "GRAPH_API_ERROR",
  "message": "CRITICAL: Batch move failed and compensation (rollback) failed. Some emails may be in inconsistent state. Please verify manually: [AAMkAGI2T001..., AAMkAGI2T002...]",
  "folderPath": "Archive",
  "attemptedCount": 5,
  "compensationAttempted": true,
  "compensationSucceeded": false
}
```

**Invalid Input**:
```json
{
  "success": false,
  "errorType": "INVALID_INPUT",
  "message": "Invalid input: emailIds array cannot be empty.",
  "folderPath": "Archive",
  "attemptedCount": 0
}
```

---

## Usage Examples

### Example 1: Move Single Email to Archive

```javascript
// MCP tool call
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
  // markAsRead defaults to true
});

// Result:
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Old Newsletter',
//   fromFolder: 'Inbox',
//   toFolder: 'Archive',
//   markedAsRead: true,
//   wasIdempotent: false
// }
```

### Example 2: Move Email to Nested Folder, Preserve Read Status

```javascript
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Projects/2026/Q1',
  markAsRead: false
});

// Result:
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Unread Project Brief',
//   fromFolder: 'Inbox',
//   toFolder: 'Projects/2026/Q1',
//   markedAsRead: false,
//   wasIdempotent: false
// }
```

### Example 3: Idempotent Move (Already in Target Folder)

```javascript
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Sent'
});

// Email is already in "Sent" folder
// Result:
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Re: Meeting Confirmation',
//   fromFolder: 'Sent',
//   toFolder: 'Sent',
//   markedAsRead: true,
//   wasIdempotent: true
// }
```

### Example 4: Batch Move Multiple Emails

```javascript
const result = await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: [
    'AAMkAGI2T001...',
    'AAMkAGI2T002...',
    'AAMkAGI2T003...'
  ],
  folderPath: 'Projects/Completed',
  markAsRead: true
});

// Result:
// {
//   success: true,
//   count: 3,
//   results: [ /* individual MoveResult objects */ ],
//   toFolder: 'Projects/Completed',
//   hadIdempotentMoves: false
// }
```

### Example 5: Batch Move with Validation Failure

```javascript
const result = await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: [
    'AAMkAGI2T001...',  // Valid
    'INVALID_ID',        // Invalid
    'AAMkAGI2T003...'   // Valid
  ],
  folderPath: 'Archive'
});

// Result:
// {
//   success: false,
//   errorType: 'EMAIL_NOT_FOUND',
//   message: 'Batch move failed validation:\n- Email [INVALID_ID]: not found',
//   validationErrors: [
//     {
//       emailId: 'INVALID_ID',
//       reason: 'Email not found or has been deleted'
//     }
//   ],
//   folderPath: 'Archive',
//   attemptedCount: 3
// }
// Note: No emails were moved (atomic behavior)
```

---

## Integration Notes

### Handler Implementation

Both tools are handled by functions in `src/mcp-server/handlers/email-move-tools.ts`:

```typescript
export async function moveEmail(
  input: MoveEmailInput,
  apiClient: MicrosoftApiClient
): Promise<MoveResult | MoveError>;

export async function moveEmailsBatch(
  input: MoveEmailsInput,
  apiClient: MicrosoftApiClient
): Promise<MoveBatchResult | MoveBatchError>;
```

### Service Registration

Tools are registered in `MicrosoftService.getTools()`:

```typescript
{
  name: 'move-email',
  description: '...',
  inputSchema: { /* see Tool 1 above */ },
  handler: this.moveEmail.bind(this),
},
{
  name: 'move-emails-batch',
  description: '...',
  inputSchema: { /* see Tool 2 above */ },
  handler: this.moveEmailsBatch.bind(this),
}
```

### Authentication Requirement

Both tools require Microsoft OAuth authentication:
- User must complete `microsoft.authenticate` flow first
- Tools check `isAuthenticated()` and return error if not authenticated
- Requires `Mail.ReadWrite` scope (already requested by existing email tools)

### Microsoft Graph API Endpoints Used

**Tool 1 (move-email)**:
1. `GET /me/messages/{id}?$select=id,subject,parentFolderId,isRead` - Pre-validation
2. `GET /me/mailFolders` (with filters) - Folder resolution (via existing methods)
3. `POST /me/messages/{id}/move` - Move operation
4. `PATCH /me/messages/{id}` - Update read status (if markAsRead=true)

**Tool 2 (move-emails-batch)**:
- Same endpoints as Tool 1, but executed sequentially for each email
- Validation phase: Parallel GET requests for all emails
- Move phase: Sequential POST requests with compensation on failure

---

## Testing Contracts

### Unit Test Cases

**move-email tool**:
- ✅ Valid input returns MoveResult
- ✅ Invalid emailId returns INVALID_INPUT error
- ✅ Empty folderPath returns INVALID_INPUT error
- ✅ Email not found returns EMAIL_NOT_FOUND error
- ✅ Folder not found returns FOLDER_NOT_FOUND error
- ✅ Idempotent move (already in folder) returns MoveResult with wasIdempotent=true
- ✅ markAsRead=false preserves original read status
- ✅ markAsRead=true marks email as read after move
- ✅ Permission denied returns PERMISSION_DENIED error
- ✅ Network error returns NETWORK_ERROR error

**move-emails-batch tool**:
- ✅ Valid input returns MoveBatchResult with all results
- ✅ Empty emailIds array returns INVALID_INPUT error
- ✅ One invalid email ID fails entire batch (no moves)
- ✅ Folder not found fails entire batch (no moves)
- ✅ Move failure triggers compensation (rollback)
- ✅ All idempotent moves return success with hadIdempotentMoves=true
- ✅ Mixed idempotent and non-idempotent moves handled correctly
- ✅ Compensation success rolls back all completed moves
- ✅ Compensation failure returns critical error

### Integration Test Cases

- ✅ Move email between actual folders in test mailbox
- ✅ Move to nested folder path (3+ levels deep)
- ✅ Batch move 10 emails atomically
- ✅ Verify read status updated correctly after move
- ✅ Idempotent move does not create duplicate or error

---

## Performance Characteristics

**Single Email Move**:
- Pre-validation: 1 Graph API call (~200ms)
- Folder resolution: 1-3 Graph API calls (~200-600ms, cached after first)
- Move operation: 1 Graph API call (~300ms)
- Read status update: 1 Graph API call (~200ms, if markAsRead=true)
- **Total: ~900ms - 1.3s** (meets SC-001: <3s)

**Batch Move (N emails)**:
- Pre-validation: N Graph API calls in parallel (~200ms)
- Folder resolution: 1-3 Graph API calls (~200-600ms, cached)
- Move operations: N sequential Graph API calls (~300ms each)
- Read status updates: N sequential Graph API calls (~200ms each, if markAsRead=true)
- **Total: ~(500N + 600)ms**
- Example: 10 emails = ~5.6s, 50 emails = ~25.6s

**Compensation (on failure)**:
- Rollback: M sequential Graph API calls (~300ms each, M = number of successful moves before failure)
- **Total: ~300M ms**

Note: All timings are estimates based on typical Microsoft Graph API latencies. Actual performance depends on network conditions and API throttling.
