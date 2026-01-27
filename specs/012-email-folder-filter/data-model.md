# Data Model: Email Folder Filtering

**Feature**: Email Folder Filtering for List-Emails
**Date**: 2026-01-27
**Phase**: 1 - Design

## Overview

This document defines the data entities involved in email folder filtering functionality. The feature introduces folder-based filtering without adding new data storage requirements.

## Entities

### Email Folder

Represents a mailbox folder containing email messages.

**Attributes**:
- **Folder Name** (string): User-friendly folder identifier
  - Examples: "inbox", "spam", "junk", "sent", "drafts", "trash", "deleted", "all"
  - Case-insensitive (normalized to lowercase)
  - Validation: Must match supported folder names list

- **Well-Known Name** (string): Microsoft Graph API well-known folder identifier
  - Maps user-friendly names to API names
  - Examples: "inbox" → "inbox", "spam" → "junkemail", "sent" → "sentitems"
  - Used in API endpoint construction

- **Folder Type** (enum): Category of folder
  - Values: Standard (well-known folders), All (cross-folder search)
  - Standard folders: inbox, spam, junk, sent, drafts, trash, deleted
  - All: Special value representing all folders

**Relationships**:
- One folder contains zero or more Email Messages
- Email Messages belong to exactly one folder at a time (spec entity relationship)

**State Transitions**:
- No state transitions (folders are read-only for this feature)

**Validation Rules**:
- FR-008: Folder name must be case-insensitive ("Inbox", "INBOX", "inbox" all valid)
- FR-004: Must support standard folder names: inbox, spam, junk, sent, drafts
- FR-005: Invalid folder names must produce clear error messages
- FR-006: "all" is a special value for cross-folder retrieval

**Folder Name Mapping**:
```
User Input         → Well-Known Name   → API Endpoint
---------------------------------------------------------
"inbox"            → "inbox"           → /me/mailFolders/inbox/messages
"spam"             → "junkemail"       → /me/mailFolders/junkemail/messages
"junk"             → "junkemail"       → /me/mailFolders/junkemail/messages
"sent"             → "sentitems"       → /me/mailFolders/sentitems/messages
"drafts"           → "drafts"          → /me/mailFolders/drafts/messages
"trash"            → "deleteditems"    → /me/mailFolders/deleteditems/messages
"deleted"          → "deleteditems"    → /me/mailFolders/deleteditems/messages
"all"              → (none)            → /me/messages
```

### Email Message

Represents an individual email that belongs to a folder. Entity definition from feature spec.

**Attributes**:
- **ID** (string): Unique message identifier (from Microsoft Graph)
- **Subject** (string): Email subject line
- **From** (object): Sender information (email address, display name)
- **Received Date/Time** (datetime): When email was received
- **Body Preview** (string): Short preview of email content
- **Is Read** (boolean): Read/unread status
- **Parent Folder** (reference): Folder containing this message

**Relationships**:
- Each Email Message belongs to exactly one Email Folder
- Email Folder contains zero or more Email Messages

**Query Constraints**:
- FR-003: Messages filtered by parent folder
- FR-009: Pagination preserved ($top parameter)
- FR-009: Sorting preserved ($orderby parameter)
- FR-007: Response format unchanged (existing attributes maintained)

**Default Query Parameters**:
```typescript
{
  $top: 10,                              // Max 50 (from spec)
  $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead',
  $orderby: 'receivedDateTime desc'
}
```

## Data Flow

### Folder Parameter Processing

```
User Input: { folder: "spam", count: 20 }
    ↓
Normalize folder name: "spam" → "spam" (lowercase)
    ↓
Map to well-known name: "spam" → "junkemail"
    ↓
Construct endpoint: /me/mailFolders/junkemail/messages
    ↓
Add query parameters: ?$top=20&$select=...&$orderby=...
    ↓
Microsoft Graph API request
    ↓
Response: { emails: [...], count: 20 }
```

### Special Case: "all" Folder

```
User Input: { folder: "all", count: 10 }
    ↓
Normalize folder name: "all" → "all" (lowercase)
    ↓
Detect special value: "all" → (no folder mapping)
    ↓
Construct endpoint: /me/messages (original behavior)
    ↓
Add query parameters: ?$top=10&$select=...&$orderby=...
    ↓
Microsoft Graph API request
    ↓
Response: { emails: [...], count: 10 }
```

### Default Behavior (No Folder Parameter)

```
User Input: { count: 10 }  (no folder parameter)
    ↓
Apply default: folder = "inbox"
    ↓
[Continue with standard folder processing...]
```

## Validation Rules

### Client-Side Validation

**Folder Name Validation**:
```typescript
const SUPPORTED_FOLDERS = [
  'inbox', 'spam', 'junk', 'sent', 'drafts',
  'trash', 'deleted', 'all'
];

function validateFolder(folder: string): void {
  const normalized = folder.toLowerCase();

  if (!SUPPORTED_FOLDERS.includes(normalized)) {
    throw new Error(
      `Invalid folder: ${folder}. ` +
      `Supported folders: ${SUPPORTED_FOLDERS.join(', ')}`
    );
  }
}
```

**Count Validation** (existing):
```typescript
const count = Math.min((input['count'] as number | undefined) ?? 10, 50);
```

### Server-Side Error Mapping

**Microsoft Graph Error Handling**:
```typescript
function mapGraphFolderError(error: GraphError, folder: string): string {
  if (error.code === 'ErrorItemNotFound') {
    return (
      `Folder '${folder}' not found. ` +
      `Supported folders: inbox, spam, junk, sent, drafts, trash, deleted, all`
    );
  }

  if (error.code === 'ErrorAccessDenied') {
    return `Access denied to folder '${folder}'. Check mailbox permissions.`;
  }

  return `Error retrieving emails from folder '${folder}': ${error.message}`;
}
```

## API Contract Changes

### Updated Tool Schema

The list-emails tool schema is updated to include the folder parameter:

**Before** (current schema):
```json
{
  "type": "object",
  "properties": {
    "count": {
      "type": "number",
      "description": "Number of emails to retrieve (default: 10, max: 50)",
      "default": 10
    }
  }
}
```

**After** (new schema):
```json
{
  "type": "object",
  "properties": {
    "count": {
      "type": "number",
      "description": "Number of emails to retrieve (default: 10, max: 50)",
      "default": 10
    },
    "folder": {
      "type": "string",
      "description": "Folder to retrieve emails from. Supported values: inbox, spam, junk, sent, drafts, trash, deleted, all (default: inbox)",
      "default": "inbox",
      "enum": ["inbox", "spam", "junk", "sent", "drafts", "trash", "deleted", "all"]
    }
  }
}
```

### Response Format (Unchanged)

**Response Structure** (FR-007: maintain existing format):
```json
{
  "emails": [
    {
      "id": "AAMkAG...",
      "subject": "Project Update",
      "from": {
        "emailAddress": {
          "name": "John Doe",
          "address": "john@example.com"
        }
      },
      "receivedDateTime": "2026-01-27T10:30:00Z",
      "bodyPreview": "Here's the latest update...",
      "isRead": false
    }
  ],
  "count": 10
}
```

**No changes** to response structure, field names, or data types.

## Edge Cases

### Edge Case: Empty Folder

**Scenario**: User requests emails from a folder that exists but contains no emails

**Behavior**:
```json
{
  "emails": [],
  "count": 0
}
```

**Validation**: Not an error, valid response (FR-003 compliant)

### Edge Case: Invalid Folder

**Scenario**: User requests emails from unsupported folder

**Behavior**:
```json
{
  "error": {
    "message": "Invalid folder: Archive. Supported folders: inbox, spam, junk, sent, drafts, trash, deleted, all"
  }
}
```

**Validation**: Client-side validation catches before API call (FR-005 compliant)

### Edge Case: Case Variations

**Scenario**: User provides folder name with different casing

**Input**: `{ folder: "INBOX", count: 10 }`

**Behavior**: Normalized to "inbox", processed normally

**Validation**: FR-008 compliant (case-insensitive)

### Edge Case: Whitespace

**Scenario**: User provides folder name with surrounding whitespace

**Input**: `{ folder: "  inbox  ", count: 10 }`

**Behavior**: Trim whitespace, normalize to "inbox"

**Implementation**:
```typescript
const folder = (input['folder'] as string | undefined)?.trim() ?? 'inbox';
```

## Implementation Notes

### No Database Schema Changes

This feature requires **no database or persistent storage changes**:
- Folder filtering is query-time behavior (API parameter selection)
- No new tables, collections, or schema modifications
- Token storage unchanged (existing .tokens/ directory)

### No New External Dependencies

This feature requires **no new npm packages**:
- Uses existing @modelcontextprotocol/sdk for MCP protocol
- Uses existing Microsoft Graph API client (api-client.ts)
- Uses existing error handling infrastructure

### Type Definitions

**TypeScript Type Additions**:
```typescript
// Add to method signature (microsoft-service.ts)
type FolderName = 'inbox' | 'spam' | 'junk' | 'sent' | 'drafts' | 'trash' | 'deleted' | 'all';

interface ListEmailsInput {
  count?: number;
  folder?: FolderName;
}
```

**No changes to existing types** (Tool, ServiceConfig, etc.)

## Summary

**New Entities**: 1 (Email Folder - conceptual, not persisted)
**Modified Entities**: 1 (Email Message - adds folder context to queries)
**Schema Changes**: 0 (no database modifications)
**API Contract Changes**: 1 (list-emails tool schema updated with folder parameter)
**Storage Changes**: 0 (no new storage requirements)

**Compliance**:
- ✅ FR-001: Optional folder parameter defined
- ✅ FR-002: Default value "inbox" specified
- ✅ FR-003: Folder filtering mapped to API endpoints
- ✅ FR-004: Standard folders (inbox, spam, junk, sent, drafts) supported
- ✅ FR-005: Clear error messages for invalid folders
- ✅ FR-006: "all" special value for cross-folder retrieval
- ✅ FR-007: Response format unchanged
- ✅ FR-008: Case-insensitive folder handling via normalization
- ✅ FR-009: Pagination and sorting preserved ($top, $orderby)

**Phase 1 Data Model Status**: ✅ COMPLETE
