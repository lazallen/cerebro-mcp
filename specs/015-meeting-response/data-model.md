# Data Model: Meeting Response Functionality

**Feature**: 015-meeting-response
**Date**: 2026-02-02
**Status**: Design Phase

## Overview

This document defines the data structures, types, and entities used in the meeting response functionality. All types follow TypeScript strict mode requirements and integrate with the existing Microsoft service architecture.

## Core Entities

### 1. EventResponseRequest

Input data for responding to a meeting invitation.

```typescript
interface EventResponseRequest {
  /**
   * Microsoft Graph API event ID
   * Format: Graph API GUID (e.g., "AAMkAGI...")
   */
  eventId: string;

  /**
   * Response type
   * Maps to Microsoft Graph endpoints:
   * - 'accepted' -> /events/{id}/accept
   * - 'declined' -> /events/{id}/decline
   * - 'tentativelyAccepted' -> /events/{id}/tentativelyAccept
   */
  response: EventResponseType;

  /**
   * Optional comment to organizer
   * Maximum length: 8,192 bytes (UTF-8)
   * Will be truncated if exceeds limit
   */
  comment?: string;

  /**
   * Whether to send response notification to organizer
   * Default: true
   */
  sendResponse?: boolean;
}
```

**Validation Rules:**
- `eventId`: Required, non-empty string
- `response`: Required, must be one of the enum values
- `comment`: Optional, will be validated and truncated to 8KB if needed
- `sendResponse`: Optional, defaults to true if not provided

**Example:**
```typescript
const request: EventResponseRequest = {
  eventId: "AAMkAGI1AAAwCEZ3AAA=",
  response: "declined",
  comment: "I'm out of office on this date",
  sendResponse: true
};
```

---

### 2. EventResponseType

Enum defining valid response types.

```typescript
type EventResponseType = 'accepted' | 'declined' | 'tentativelyAccepted';
```

**Mapping to Microsoft Graph API:**
| Type | Endpoint Path |
|------|--------------|
| `accepted` | `/accept` |
| `declined` | `/decline` |
| `tentativelyAccepted` | `/tentativelyAccept` |

---

### 3. EventResponseResult

Output data from a meeting response operation.

```typescript
interface EventResponseResult {
  /**
   * Operation success status
   */
  success: boolean;

  /**
   * The event ID that was processed
   */
  eventId: string;

  /**
   * The response type that was sent
   */
  responseType: EventResponseType;

  /**
   * User-friendly message describing the outcome
   * Success: "Meeting response {type} sent successfully for event {id}"
   * Failure: Specific error message based on error type
   */
  message: string;

  /**
   * Error details (only present if success = false)
   */
  error?: EventResponseError;

  /**
   * Timestamp of the operation (ISO 8601)
   */
  timestamp: string;
}
```

**Success Example:**
```typescript
const result: EventResponseResult = {
  success: true,
  eventId: "AAMkAGI1AAAwCEZ3AAA=",
  responseType: "declined",
  message: "Meeting response declined sent successfully for event AAMkAGI1AAAwCEZ3AAA=",
  timestamp: "2026-02-02T14:30:00.000Z"
};
```

**Failure Example:**
```typescript
const result: EventResponseResult = {
  success: false,
  eventId: "AAMkAGI1AAAwCEZ3AAA=",
  responseType: "accepted",
  message: "Event AAMkAGI1AAAwCEZ3AAA= not found. It may have been deleted or you may not have access.",
  error: {
    code: "ResourceNotFound",
    status: 404,
    retryable: false
  },
  timestamp: "2026-02-02T14:30:00.000Z"
};
```

---

### 4. EventResponseError

Error details for failed response operations.

```typescript
interface EventResponseError {
  /**
   * Microsoft Graph API error code
   * Examples: "ResourceNotFound", "InvalidAuthenticationToken", "TooManyRequests"
   */
  code: string;

  /**
   * HTTP status code
   * Examples: 400, 401, 404, 429, 500
   */
  status: number;

  /**
   * Whether the error is retryable
   * Retryable: 429, 500, 503, network errors
   * Not retryable: 400, 401, 403, 404
   */
  retryable: boolean;

  /**
   * Additional error details from Microsoft Graph API
   * May include nested innererror object
   */
  details?: unknown;
}
```

---

### 5. RetryConfig

Configuration for retry logic with exponential backoff.

```typescript
interface RetryConfig {
  /**
   * Maximum number of retry attempts
   * Default: 3 (per specification clarification)
   */
  maxAttempts: number;

  /**
   * Base delay for exponential backoff in milliseconds
   * Default: 1000ms (1 second)
   */
  baseDelay: number;

  /**
   * Maximum delay between retries in milliseconds
   * Default: 30000ms (30 seconds)
   */
  maxDelay: number;

  /**
   * Current attempt number (0-based)
   * Incremented after each retry
   */
  currentAttempt: number;
}
```

**Default Configuration:**
```typescript
const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  currentAttempt: 0
};
```

**Exponential Backoff Formula:**
```typescript
const delay = Math.min(
  config.baseDelay * Math.pow(2, config.currentAttempt),
  config.maxDelay
);
```

**Delay Progression:**
- Attempt 0: 1s
- Attempt 1: 2s
- Attempt 2: 4s
- Attempt 3+: 30s (capped)

---

### 6. ResourceLockState

Internal state for concurrency control.

```typescript
interface ResourceLockState {
  /**
   * Map of resource IDs to their active lock promises
   * Key: eventId
   * Value: Promise that resolves when operation completes
   */
  locks: Map<string, Promise<void>>;
}
```

**Usage Pattern:**
```typescript
// Check if locked
const isLocked = lockState.locks.has(eventId);

// Acquire lock
const lockPromise = operation();
lockState.locks.set(eventId, lockPromise);

// Release lock (in finally block)
lockState.locks.delete(eventId);
```

---

## Microsoft Graph API Response Types

### Accept/Decline/Tentative Response Body

Request body sent to Microsoft Graph API.

```typescript
interface MicrosoftGraphResponseBody {
  /**
   * Optional comment to organizer
   */
  comment?: string;

  /**
   * Whether to send response to organizer
   * Default: true
   */
  sendResponse?: boolean;
}
```

**Example Request:**
```http
POST https://graph.microsoft.com/v1.0/me/events/AAMkAGI1AAAwCEZ3AAA=/decline
Content-Type: application/json
Authorization: Bearer {token}

{
  "comment": "I'm out of office on this date",
  "sendResponse": true
}
```

**Success Response:**
```http
HTTP/1.1 202 Accepted
```

**Error Response:**
```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": "ResourceNotFound",
    "message": "The specified object was not found in the store.",
    "innererror": {
      "request-id": "94fb3b52-452a-4535-a601-69e0a90e3aa2",
      "date": "2026-02-02T12:51:51"
    }
  }
}
```

---

## Data Flow

```
User Request (via MCP)
    ↓
EventResponseRequest
    ↓
[Validate comment length (8KB)]
    ↓
[Acquire resource lock]
    ↓
[Check retry config]
    ↓
Microsoft Graph API Call
    ↓
[Handle response]
    ├── Success (202) → Release lock → EventResponseResult (success=true)
    ├── Rate Limit (429) → Check Retry-After → Retry or Backoff
    ├── Auth Error (401) → Refresh token → Retry once
    ├── Not Found (404) → Release lock → EventResponseResult (success=false)
    └── Other Error → Check retryable → Retry or Fail
```

---

## Validation Rules

### Comment Length Validation

```typescript
/**
 * Validates and truncates comment to 8KB UTF-8 byte limit
 * @param comment - Optional comment string
 * @returns Validated comment (truncated if needed) or undefined
 */
function validateComment(comment?: string): string | undefined {
  if (!comment) return undefined;

  const maxBytes = 8192;
  const buffer = Buffer.from(comment, 'utf8');

  if (buffer.length <= maxBytes) {
    return comment;
  }

  // Truncate to fit within limit
  let truncated = comment;
  while (Buffer.from(truncated, 'utf8').length > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  // Log truncation warning
  logger.warn({
    operation: 'comment_truncated',
    originalLength: buffer.length,
    truncatedLength: Buffer.from(truncated, 'utf8').length
  });

  return truncated;
}
```

### Event ID Validation

```typescript
/**
 * Validates Microsoft Graph event ID format
 * @param eventId - Event ID to validate
 * @returns true if valid, false otherwise
 */
function validateEventId(eventId: string): boolean {
  // Event ID must be non-empty string
  // Microsoft Graph uses base64-encoded GUIDs
  return typeof eventId === 'string' && eventId.length > 0;
}
```

---

## Error Code Mappings

| HTTP Status | Error Code | User Message | Retryable |
|-------------|------------|--------------|-----------|
| 400 | InvalidRequest | Invalid request. Check that the event allows time proposals if proposedNewTime is provided. | No |
| 401 | InvalidAuthenticationToken | Authentication token expired. Please re-authenticate. | Yes (after token refresh) |
| 403 | Forbidden | Insufficient permissions. Calendars.ReadWrite permission is required. | No |
| 404 | ResourceNotFound | Event not found. It may have been deleted or you may not have access. | No |
| 404 | ErrorItemNotFound | Event not found. It may have been deleted or you may not have access. | No |
| 429 | TooManyRequests | Rate limit exceeded. The system will automatically retry after waiting. | Yes |
| 500 | InternalServerError | Microsoft service error. The system will automatically retry. | Yes |
| 503 | ServiceNotAvailable | Microsoft service temporarily unavailable. The system will automatically retry. | Yes |

---

## Type Exports

All types should be exported from `src/types/calendar.ts`:

```typescript
export type {
  EventResponseRequest,
  EventResponseType,
  EventResponseResult,
  EventResponseError,
  RetryConfig,
  ResourceLockState,
  MicrosoftGraphResponseBody
};
```

And re-exported from `src/types/index.ts`:

```typescript
export * from './calendar';
```

---

## Integration with Existing Types

### BaseAPIClient Types

The implementation will use existing types from `src/common/base-api-client.ts`:

```typescript
import type { APIError, APIResponse, RequestConfig } from '../common/base-api-client';
```

### MCP Tool Types

The implementation will use existing types from `src/types/tool.ts`:

```typescript
import type { Tool, ToolHandler } from '../types/tool';
```

---

## Database/Storage

**No database or persistent storage required.**

All state is ephemeral:
- OAuth tokens: Managed by existing `MicrosoftTokenStorage` (file-based)
- Resource locks: In-memory only (Map data structure)
- Retry state: Per-request only (not persisted)

---

## Testing Data

### Valid Test Request

```typescript
const validRequest: EventResponseRequest = {
  eventId: "AAMkAGI1AAAwCEZ3AAA=",
  response: "declined",
  comment: "Out of office",
  sendResponse: true
};
```

### Comment at Limit (exactly 8192 bytes)

```typescript
const maxComment = "a".repeat(8192); // Exactly 8192 single-byte characters
```

### Comment Over Limit (requires truncation)

```typescript
const oversizedComment = "a".repeat(8193); // 8193 bytes, will be truncated
```

### Multi-byte UTF-8 Comment

```typescript
const unicodeComment = "你好".repeat(1365); // ~8190 bytes (each char = 3 bytes)
```

---

## Summary

This data model provides:
- **Clear type definitions** for all inputs and outputs
- **Validation rules** for comment length and event IDs
- **Error handling** with retryable/non-retryable classification
- **Retry configuration** with exponential backoff
- **Concurrency control** with resource locking
- **Integration** with existing Microsoft service types

All types follow TypeScript strict mode requirements and align with the project's constitution principles.
