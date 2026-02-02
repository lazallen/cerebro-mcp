# API Contracts: Event Response

**Feature**: 015-meeting-response
**Date**: 2026-02-02
**Status**: Design Phase

## Overview

This document defines the API contracts for the meeting response functionality, including MCP tool definitions and Microsoft Graph API interactions.

---

## MCP Tools

### Tool: `microsoft.respond-to-event`

Accept, decline, or tentatively accept a meeting invitation programmatically.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "eventId": {
      "type": "string",
      "description": "Microsoft Graph API event ID from list-events or get-event tool"
    },
    "response": {
      "type": "string",
      "enum": ["accepted", "declined", "tentativelyAccepted"],
      "description": "Response type: 'accepted', 'declined', or 'tentativelyAccepted'"
    },
    "comment": {
      "type": "string",
      "description": "Optional comment to include in response to organizer (maximum 8KB)",
      "maxLength": 8192
    },
    "sendResponse": {
      "type": "boolean",
      "description": "Whether to send response notification to organizer (default: true)",
      "default": true
    }
  },
  "required": ["eventId", "response"]
}
```

#### Success Response

```json
{
  "success": true,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "declined",
  "message": "Meeting response declined sent successfully for event AAMkAGI1AAAwCEZ3AAA=",
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

#### Error Responses

**Invalid Event ID (404):**
```json
{
  "success": false,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "accepted",
  "message": "Event AAMkAGI1AAAwCEZ3AAA= not found. It may have been deleted or you may not have access.",
  "error": {
    "code": "ResourceNotFound",
    "status": 404,
    "retryable": false
  },
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

**Comment Too Long (400):**
```json
{
  "success": false,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "declined",
  "message": "Comment exceeds 8KB limit. Comment was truncated and retry will be attempted.",
  "error": {
    "code": "CommentTooLong",
    "status": 400,
    "retryable": true
  },
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

**Already Processing (409):**
```json
{
  "success": false,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "accepted",
  "message": "Event AAMkAGI1AAAwCEZ3AAA= is already being processed. Please wait for the current operation to complete.",
  "error": {
    "code": "AlreadyProcessing",
    "status": 409,
    "retryable": false
  },
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

**Authentication Error (401):**
```json
{
  "success": false,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "declined",
  "message": "Authentication token expired. Please re-authenticate using the microsoft.authenticate tool.",
  "error": {
    "code": "InvalidAuthenticationToken",
    "status": 401,
    "retryable": false
  },
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

**Rate Limit (429):**
```json
{
  "success": false,
  "eventId": "AAMkAGI1AAAwCEZ3AAA=",
  "responseType": "accepted",
  "message": "Rate limit exceeded. System will automatically retry after 10 seconds.",
  "error": {
    "code": "TooManyRequests",
    "status": 429,
    "retryable": true,
    "details": {
      "retryAfter": 10
    }
  },
  "timestamp": "2026-02-02T14:30:00.000Z"
}
```

#### Usage Examples

**Accept a meeting:**
```typescript
const result = await mcpClient.callTool('microsoft.respond-to-event', {
  eventId: 'AAMkAGI1AAAwCEZ3AAA=',
  response: 'accepted',
  comment: 'Looking forward to it!',
  sendResponse: true
});
```

**Decline without notification:**
```typescript
const result = await mcpClient.callTool('microsoft.respond-to-event', {
  eventId: 'AAMkAGI1AAAwCEZ3AAA=',
  response: 'declined',
  comment: 'Out of office',
  sendResponse: false // Silent decline
});
```

**Tentative with minimal parameters:**
```typescript
const result = await mcpClient.callTool('microsoft.respond-to-event', {
  eventId: 'AAMkAGI1AAAwCEZ3AAA=',
  response: 'tentativelyAccepted'
  // comment and sendResponse use defaults
});
```

---

## Microsoft Graph API Endpoints

### Endpoint: Accept Event

**URL**: `POST https://graph.microsoft.com/v1.0/me/events/{event-id}/accept`

**Headers**:
```http
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body**:
```json
{
  "comment": "I'll be there!",
  "sendResponse": true
}
```

**Success Response**:
```http
HTTP/1.1 202 Accepted
```

**Error Response Example**:
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

### Endpoint: Decline Event

**URL**: `POST https://graph.microsoft.com/v1.0/me/events/{event-id}/decline`

**Headers**: Same as Accept endpoint

**Request Body**:
```json
{
  "comment": "Out of office on this date",
  "sendResponse": true
}
```

**Success Response**: Same as Accept endpoint (202 Accepted)

**Error Response**: Same format as Accept endpoint

---

### Endpoint: Tentatively Accept Event

**URL**: `POST https://graph.microsoft.com/v1.0/me/events/{event-id}/tentativelyAccept`

**Headers**: Same as Accept endpoint

**Request Body**:
```json
{
  "comment": "I may not be available",
  "sendResponse": true
}
```

**Success Response**: Same as Accept endpoint (202 Accepted)

**Error Response**: Same format as Accept endpoint

---

## Error Handling Contract

### HTTP Status Code → User Message Mapping

| Status | Error Code | User Message Template | Retryable |
|--------|------------|----------------------|-----------|
| 202 | N/A | "Meeting response {type} sent successfully for event {eventId}" | N/A |
| 400 | InvalidRequest | "Invalid request. Check that the event allows time proposals if proposedNewTime is provided." | No |
| 400 | CommentTooLong | "Comment exceeds 8KB limit. It will be truncated automatically." | Yes |
| 401 | InvalidAuthenticationToken | "Authentication token expired. Please re-authenticate using the microsoft.authenticate tool." | No |
| 401 | Unauthenticated | "Authentication required. Please authenticate using the microsoft.authenticate tool." | No |
| 403 | Forbidden | "Insufficient permissions. Calendars.ReadWrite permission is required." | No |
| 404 | ResourceNotFound | "Event {eventId} not found. It may have been deleted or you may not have access." | No |
| 404 | ErrorItemNotFound | "Event {eventId} not found. It may have been deleted or you may not have access." | No |
| 409 | AlreadyProcessing | "Event {eventId} is already being processed. Please wait for the current operation to complete." | No |
| 429 | TooManyRequests | "Rate limit exceeded. System will automatically retry after {retryAfter} seconds." | Yes |
| 500 | InternalServerError | "Microsoft service error. System will automatically retry (attempt {attempt}/{max})." | Yes |
| 503 | ServiceNotAvailable | "Microsoft service temporarily unavailable. System will automatically retry (attempt {attempt}/{max})." | Yes |
| Network | NetworkError | "Network connection failed. System will automatically retry (attempt {attempt}/{max})." | Yes |
| Timeout | RequestTimeout | "Request timed out. System will automatically retry (attempt {attempt}/{max})." | Yes |

---

## Retry Logic Contract

### Retryable vs Non-Retryable Errors

**Retryable (with exponential backoff):**
- HTTP 429 (Rate Limited) - Use Retry-After header if present
- HTTP 500 (Internal Server Error)
- HTTP 503 (Service Unavailable)
- Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
- Request timeouts

**Not Retryable:**
- HTTP 400 (Bad Request) - except CommentTooLong
- HTTP 401 (Unauthorized) - requires token refresh, not retry
- HTTP 403 (Forbidden) - permission issue
- HTTP 404 (Not Found) - resource doesn't exist
- HTTP 409 (Conflict) - concurrent operation in progress

### Retry Configuration

```typescript
{
  maxAttempts: 3,
  baseDelay: 1000,    // 1 second
  maxDelay: 30000,    // 30 seconds
  formula: "delay = min(baseDelay * 2^attempt, maxDelay)"
}
```

### Retry Delay Progression

| Attempt | Delay |
|---------|-------|
| 0 (first) | 0ms (immediate) |
| 1 (first retry) | 1s |
| 2 (second retry) | 2s |
| 3 (third retry) | 4s |

**Total max time**: Initial + 1s + 2s + 4s = ~7-8 seconds

---

## Concurrency Contract

### Resource Locking

**Lock Scope**: Per event ID

**Behavior**:
1. First request acquires lock
2. Concurrent requests to same event ID get 409 "AlreadyProcessing" error
3. Lock released when operation completes (success or failure)
4. Lock automatically released after timeout (60s default)

**Lock Key Format**: `event:{eventId}`

**Example Flow**:
```
Time    Request 1 (eventId: A)     Request 2 (eventId: A)
0ms     Acquire lock on A          -
50ms    Processing...              Attempt to acquire lock on A
51ms    Processing...              Lock exists → Return 409 error
200ms   Complete → Release lock    -
201ms   -                          Retry → Acquire lock on A (success)
```

---

## Rate Limiting Contract

### Retry-After Header Priority

When HTTP 429 is received:

1. **Check Retry-After header first**
   - If present: Use the specified seconds
   - Convert to milliseconds: `retryAfter * 1000`
   - Wait exactly this duration before retrying

2. **Fall back to exponential backoff**
   - Only if Retry-After header is missing
   - Use standard exponential backoff formula

**Example**:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 10

→ Wait 10 seconds (not exponential backoff)
```

### Rate Limit Logging

```typescript
logger.info({
  operation: 'rate_limit_detected',
  service: 'microsoft',
  eventId: eventId,
  responseType: response,
  retryAfter: retryAfterSeconds,
  strategy: 'retry_after_header', // or 'exponential_backoff'
  msg: 'Rate limited, waiting before retry'
});
```

---

## Logging Contract

### Success Log

```typescript
logger.info({
  operation: 'event_response_success',
  service: 'microsoft',
  eventId: string,
  responseType: 'accepted' | 'declined' | 'tentativelyAccepted',
  outcome: 'success',
  timestamp: string, // ISO 8601
  durationMs: number,
  msg: string
});
```

### Error Log

```typescript
logger.error({
  operation: 'event_response_error',
  service: 'microsoft',
  eventId: string,
  responseType: 'accepted' | 'declined' | 'tentativelyAccepted',
  outcome: 'failure',
  timestamp: string,
  errorCode: string,
  errorStatus: number,
  errorMessage: string,
  retryable: boolean,
  attempt: number,
  msg: string
});
```

### Retry Log

```typescript
logger.info({
  operation: 'event_response_retry',
  service: 'microsoft',
  eventId: string,
  responseType: string,
  attempt: number,
  maxAttempts: number,
  delayMs: number,
  reason: string, // e.g., 'rate_limit', 'server_error', 'network_error'
  msg: string
});
```

**IMPORTANT**: Never log `comment` content (per FR-015 privacy requirement)

---

## Integration with Existing Tools

### Prerequisite Tools

Users must call these existing tools before responding to events:

1. **`microsoft.authenticate`** - Obtain OAuth token
2. **`microsoft.check-auth-status`** - Verify authentication
3. **`microsoft.list-events`** - Get list of events with IDs
4. **`microsoft.get-event`** - Get event details (optional)

### Workflow Example

```typescript
// 1. Authenticate
await mcpClient.callTool('microsoft.authenticate');

// 2. List events
const events = await mcpClient.callTool('microsoft.list-events', {
  startDate: '2026-02-09T00:00:00Z',
  endDate: '2026-02-09T23:59:59Z'
});

// 3. Respond to events
for (const event of events.value) {
  await mcpClient.callTool('microsoft.respond-to-event', {
    eventId: event.id,
    response: 'declined',
    comment: 'Out of office on this date',
    sendResponse: true
  });
}
```

---

## Testing Contracts

### Mock Response Examples

**Success (202):**
```typescript
{
  data: {},
  status: 202,
  headers: {}
}
```

**Rate Limited (429 with Retry-After):**
```typescript
{
  data: {
    error: {
      code: 'TooManyRequests',
      message: 'Please retry after',
      innererror: {
        code: '429',
        request-id: 'test-request-id',
        date: '2026-02-02T12:51:51'
      }
    }
  },
  status: 429,
  headers: {
    'retry-after': '10'
  }
}
```

**Not Found (404):**
```typescript
{
  data: {
    error: {
      code: 'ResourceNotFound',
      message: 'The specified object was not found in the store.'
    }
  },
  status: 404,
  headers: {}
}
```

---

## Summary

This API contract defines:
- ✅ MCP tool schema with input validation
- ✅ Success and error response formats
- ✅ Microsoft Graph API endpoints and payloads
- ✅ Error handling with user-friendly messages
- ✅ Retry logic with exponential backoff
- ✅ Rate limiting with Retry-After header priority
- ✅ Concurrency control with resource locking
- ✅ Structured logging requirements
- ✅ Integration with existing MCP tools
- ✅ Testing mock response patterns

All contracts align with:
- Specification requirements (FR-001 through FR-017)
- Constitution principles (MCP Tool Design, Error Handling, Structured Logging)
- Microsoft Graph API v1.0 documentation
