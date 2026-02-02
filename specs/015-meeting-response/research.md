# Microsoft Graph API - Meeting Response Implementation Research

## Document Overview

This document provides comprehensive research and implementation guidance for responding to calendar events (accept, decline, tentative) using Microsoft Graph API v1.0. The research includes API endpoints, best practices for retry logic, rate limiting, concurrency control, and error handling.

**Research Date:** 2026-02-02
**Target API:** Microsoft Graph v1.0
**Feature:** Calendar Event Response Functionality

---

## 1. API Endpoints

### 1.1 Accept Event

**Endpoint:** `POST /me/events/{id}/accept`

**Alternative Paths:**
```
POST /users/{id | userPrincipalName}/events/{id}/accept
POST /me/calendar/events/{id}/accept
POST /users/{id | userPrincipalName}/calendar/events/{id}/accept
POST /me/calendars/{id}/events/{id}/accept
POST /users/{id | userPrincipalName}/calendars/{id}/events/{id}/accept
POST /me/calendarGroups/{id}/calendars/{id}/events/{id}/accept
POST /users/{id | userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/accept
```

**Required Permission:** `Calendars.ReadWrite` (least privileged)

**Request Headers:**
| Header | Value | Required |
|--------|-------|----------|
| Authorization | Bearer {token} | Yes |
| Content-Type | application/json | Yes |

**Request Body Parameters:**
| Parameter | Type | Description | Optional |
|-----------|------|-------------|----------|
| `comment` | String | Text included in the response to organizer | Yes |
| `sendResponse` | Boolean | Whether to send response to organizer (default: true) | Yes |

**Request Example:**
```json
POST https://graph.microsoft.com/v1.0/me/events/{id}/accept
Content-Type: application/json
Authorization: Bearer {token}

{
  "comment": "I'll be there!",
  "sendResponse": true
}
```

**Response:**
- **Success:** `202 Accepted` with empty body
- **Error:** 4xx/5xx with error details (see Error Handling section)

**Availability:** All national cloud deployments (Global, US Gov L4, US Gov L5, China)

---

### 1.2 Decline Event

**Endpoint:** `POST /me/events/{id}/decline`

**Alternative Paths:** Same pattern as Accept endpoint

**Required Permission:** `Calendars.ReadWrite` (least privileged)

**Request Headers:** Same as Accept endpoint

**Request Body Parameters:**
| Parameter | Type | Description | Optional |
|-----------|------|-------------|----------|
| `comment` | String | Text response included in decline notification | Yes |
| `sendResponse` | Boolean | Whether to send response to organizer (default: true) | Yes |
| `proposedNewTime` | timeSlot | Alternative date/time proposed by invitee | Yes* |

*Note: `proposedNewTime` requires `sendResponse: true` and only works if event's `allowNewTimeProposals` is `true`.

**proposedNewTime Structure:**
```json
{
  "start": {
    "dateTime": "2026-02-02T18:00:00",
    "timeZone": "Pacific Standard Time"
  },
  "end": {
    "dateTime": "2026-02-02T19:00:00",
    "timeZone": "Pacific Standard Time"
  }
}
```

**Request Example:**
```json
POST https://graph.microsoft.com/v1.0/me/events/{id}/decline
Content-Type: application/json
Authorization: Bearer {token}

{
  "comment": "I won't be able to make this week. How about next week?",
  "sendResponse": true,
  "proposedNewTime": {
    "start": {
      "dateTime": "2026-02-09T18:00:00",
      "timeZone": "Pacific Standard Time"
    },
    "end": {
      "dateTime": "2026-02-09T19:00:00",
      "timeZone": "Pacific Standard Time"
    }
  }
}
```

**Response:**
- **Success:** `202 Accepted` with empty body
- **Error:**
  - `400 Bad Request` if `proposedNewTime` is included but `allowNewTimeProposals` is `false` or `sendResponse` is `false`
  - Other 4xx/5xx with error details (see Error Handling section)

**Availability:** All national cloud deployments

---

### 1.3 Tentatively Accept Event

**Endpoint:** `POST /me/events/{id}/tentativelyAccept`

**Alternative Paths:** Same pattern as Accept endpoint

**Required Permission:** `Calendars.ReadWrite` (least privileged)

**Request Headers:** Same as Accept endpoint

**Request Body Parameters:**
| Parameter | Type | Description | Optional |
|-----------|------|-------------|----------|
| `comment` | String | Text included in the response | Yes |
| `sendResponse` | Boolean | Whether to send response to organizer (default: true) | Yes |
| `proposedNewTime` | timeSlot | Alternate date/time proposed by invitee | Yes* |

*Note: Same constraints as Decline endpoint

**Request Example:**
```json
POST https://graph.microsoft.com/v1.0/me/events/{id}/tentativelyAccept
Content-Type: application/json
Authorization: Bearer {token}

{
  "comment": "I may not be able to make this week. How about next week?",
  "sendResponse": true,
  "proposedNewTime": {
    "start": {
      "dateTime": "2026-02-09T18:00:00",
      "timeZone": "Pacific Standard Time"
    },
    "end": {
      "dateTime": "2026-02-09T19:00:00",
      "timeZone": "Pacific Standard Time"
    }
  }
}
```

**Response:**
- **Success:** `202 Accepted` with empty body
- **Error:** Same error conditions as Decline endpoint

**Availability:** All national cloud deployments

---

## 2. Message Length Limits

**Comment Field Limit:** 8KB (8,192 bytes)

This limit applies to the `comment` parameter in all three response endpoints (accept, decline, tentativelyAccept).

**Implementation Recommendations:**
- Validate comment length before sending request
- Truncate comments that exceed 8KB
- Use UTF-8 byte count, not character count
- Consider adding a warning to users when comments are truncated

**Example Validation:**
```typescript
function validateComment(comment: string): string {
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

  return truncated;
}
```

---

## 3. Retry Strategy with Exponential Backoff

### 3.1 Overview

Microsoft Graph API recommends implementing exponential backoff retry logic to handle transient failures and throttling. The existing codebase already implements this pattern in `/home/stuartdavidson/code/cerebro-mcp/src/services/slack/slack-socket-client.ts`.

### 3.2 Exponential Backoff Formula

**Formula:** `delay = min(base * 2^attempt, maxDelay)`

**Recommended Values:**
- **Base delay:** 1000ms (1 second)
- **Max delay:** 30000ms (30 seconds)
- **Max attempts:** 10

**Example Progression:**
- Attempt 1: 1s
- Attempt 2: 2s
- Attempt 3: 4s
- Attempt 4: 8s
- Attempt 5: 16s
- Attempt 6+: 30s (capped)

### 3.3 Implementation Pattern

Based on existing codebase pattern in `slack-socket-client.ts` (lines 373-374):

```typescript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
```

### 3.4 Retry Logic Guidelines

**Retry on these conditions:**
- HTTP 429 (Too Many Requests) - ALWAYS retry
- HTTP 503 (Service Unavailable) - ALWAYS retry
- HTTP 500 (Internal Server Error) - Retry up to max attempts
- Network timeouts - Retry up to max attempts
- Network errors - Retry up to max attempts

**Do NOT retry on:**
- HTTP 400 (Bad Request) - Invalid request
- HTTP 401 (Unauthorized) - Authentication failure (refresh token instead)
- HTTP 403 (Forbidden) - Permission denied
- HTTP 404 (Not Found) - Resource doesn't exist
- HTTP 409 (Conflict) - State conflict (handle separately)

### 3.5 Recommended Implementation

```typescript
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

class RetryHandler {
  private attempts = 0;
  private readonly config: RetryConfig = {
    maxAttempts: 10,
    baseDelay: 1000,
    maxDelay: 30000,
  };

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    isRetryable: (error: unknown) => boolean
  ): Promise<T> {
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!isRetryable(error) || this.attempts >= this.config.maxAttempts) {
          throw error;
        }

        const delay = Math.min(
          this.config.baseDelay * Math.pow(2, this.attempts),
          this.config.maxDelay
        );

        this.attempts++;

        // Log retry attempt
        console.log(`Retry attempt ${this.attempts}/${this.config.maxAttempts} after ${delay}ms`);

        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reset(): void {
    this.attempts = 0;
  }
}
```

---

## 4. Rate Limiting

### 4.1 HTTP 429 Response

When throttling occurs, Microsoft Graph returns:

**Status Code:** `429 Too Many Requests`

**Response Example:**
```json
{
  "error": {
    "code": "TooManyRequests",
    "innerError": {
      "code": "429",
      "date": "2026-02-02T12:51:51",
      "message": "Please retry after",
      "request-id": "94fb3b52-452a-4535-a601-69e0a90e3aa2",
      "status": "429"
    },
    "message": "Please retry again later."
  }
}
```

### 4.2 Retry-After Header

The `429` response includes a `Retry-After` header specifying the number of seconds to wait before retrying.

**Example:**
```
HTTP/1.1 429 Too Many Requests
Retry-After: 10
Content-Type: application/json
```

### 4.3 Handling Rate Limits

**Priority Order:**
1. **Check for Retry-After header** - This is the FASTEST way to recover from throttling
2. **Use the specified seconds** - Wait exactly as told by the API
3. **Retry the request** - After waiting the specified time
4. **Continue retrying** - If 429 errors persist, continue using Retry-After values
5. **Fall back to exponential backoff** - Only if Retry-After header is not provided

**Implementation Pattern:**
```typescript
async function handleRateLimit(response: APIResponse<unknown>): Promise<number> {
  if (response.status === 429) {
    const retryAfter = response.headers['retry-after'];

    if (retryAfter) {
      // Convert to milliseconds
      const waitTime = parseInt(retryAfter, 10) * 1000;
      console.log(`Rate limited. Waiting ${waitTime}ms as specified by Retry-After header`);
      return waitTime;
    }

    // Fall back to exponential backoff if no Retry-After header
    console.log('Rate limited but no Retry-After header. Using exponential backoff');
    return -1; // Signal to use exponential backoff
  }

  return 0; // No rate limiting
}
```

### 4.4 Best Practices to Avoid Throttling

1. **Use change tracking** instead of continuous polling
2. **Use change notifications** instead of regularly scanning resource collections
3. **Use JSON batching** to combine multiple requests
4. **Reduce the number of operations per request**
5. **Reduce the frequency of calls**
6. **Implement request queuing** to control rate of outgoing requests

### 4.5 Throttling Causes

Rate limiting can occur due to:
- Large number of requests across all applications in a tenant
- Large number of requests from a particular application across all tenants
- Write operations are more likely to trigger throttling than read operations

---

## 5. Concurrency Control

### 5.1 Problem Statement

Concurrent requests to the same event resource can cause:
- Race conditions
- Duplicate responses
- Inconsistent state
- Wasted API quota

### 5.2 Locking Strategies

#### 5.2.1 In-Memory Lock (Simple)

**Best for:** Single-process applications

```typescript
class ResourceLock {
  private locks: Map<string, Promise<void>> = new Map();

  async acquireLock(resourceId: string, operation: () => Promise<void>): Promise<void> {
    // Wait for existing lock to release
    const existingLock = this.locks.get(resourceId);
    if (existingLock) {
      await existingLock;
    }

    // Create new lock
    const lockPromise = operation().finally(() => {
      // Release lock when operation completes
      if (this.locks.get(resourceId) === lockPromise) {
        this.locks.delete(resourceId);
      }
    });

    this.locks.set(resourceId, lockPromise);
    await lockPromise;
  }

  isLocked(resourceId: string): boolean {
    return this.locks.has(resourceId);
  }
}

// Usage
const eventLock = new ResourceLock();

async function respondToEvent(eventId: string, response: 'accept' | 'decline' | 'tentative'): Promise<void> {
  await eventLock.acquireLock(eventId, async () => {
    // Perform API request
    await apiClient.request(`/me/events/${eventId}/${response}`, {
      method: 'POST',
      body: { sendResponse: true }
    });
  });
}
```

#### 5.2.2 Request Deduplication

**Best for:** Handling rapid duplicate requests

```typescript
class RequestDeduplicator {
  private inFlight: Map<string, Promise<unknown>> = new Map();

  async deduplicate<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Return existing request if already in flight
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Start new request
    const promise = operation().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }
}

// Usage
const deduplicator = new RequestDeduplicator();

async function respondToEvent(eventId: string, response: 'accept' | 'decline' | 'tentative'): Promise<void> {
  const key = `event-response:${eventId}:${response}`;

  return deduplicator.deduplicate(key, async () => {
    await apiClient.request(`/me/events/${eventId}/${response}`, {
      method: 'POST',
      body: { sendResponse: true }
    });
  });
}
```

#### 5.2.3 Queue-Based Approach

**Best for:** High-volume applications or distributed systems

```typescript
class RequestQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  async enqueue(operation: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await operation();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          console.error('Queue operation failed:', error);
        }
      }
    }

    this.processing = false;
  }
}
```

### 5.3 Recommended Approach

For the cerebro-mcp codebase, the **In-Memory Lock** approach is recommended because:
- Single-process architecture (based on codebase analysis)
- Simple to implement and maintain
- No external dependencies
- Sufficient for most use cases
- Can be extended later if needed

---

## 6. Error Handling

### 6.1 Common HTTP Status Codes

| Status Code | Message | Description | Retry? |
|-------------|---------|-------------|--------|
| 400 | Bad Request | Malformed or incorrect request | No |
| 401 | Unauthorized | Missing or invalid authentication token | No* |
| 403 | Forbidden | Insufficient permissions or missing license | No |
| 404 | Not Found | Event resource doesn't exist | No |
| 409 | Conflict | State conflict (e.g., event already responded to) | Maybe** |
| 429 | Too Many Requests | API throttling applied | Yes |
| 500 | Internal Server Error | Server-side error | Yes |
| 503 | Service Unavailable | Maintenance or overload | Yes |

*For 401, refresh the authentication token and retry once
**For 409, check if operation is idempotent before retrying

### 6.2 Error Response Structure

Microsoft Graph returns errors in this format:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "innererror": {
      "code": "string",
      "request-id": "request-id",
      "date": "date-time"
    },
    "details": []
  }
}
```

### 6.3 Error Code Mappings

Common error codes for calendar event responses:

| Error Code | HTTP Status | Description | User Action |
|-----------|-------------|-------------|-------------|
| `InvalidAuthenticationToken` | 401 | Token expired or invalid | Refresh token and retry |
| `Unauthenticated` | 401 | No authentication provided | Authenticate and retry |
| `Forbidden` | 403 | Missing Calendars.ReadWrite permission | Grant permission |
| `ResourceNotFound` | 404 | Event ID doesn't exist | Verify event ID |
| `InvalidRequest` | 400 | Invalid proposedNewTime or comment | Fix request body |
| `RequestBodyRead` | 400 | Request body is malformed | Fix JSON format |
| `TooManyRequests` | 429 | Rate limit exceeded | Wait and retry |
| `ServiceNotAvailable` | 503 | Service temporarily unavailable | Wait and retry |
| `InternalServerError` | 500 | Server error | Wait and retry |
| `ErrorItemNotFound` | 404 | Event was deleted | Handle gracefully |

### 6.4 Error Handling Best Practices

#### 6.4.1 Use Error Codes, Not Messages

**DON'T:**
```typescript
if (error.message.includes('not found')) {
  // Don't depend on message text
}
```

**DO:**
```typescript
if (error.code === 'ResourceNotFound' || error.code === 'ErrorItemNotFound') {
  // Depend on error codes
}
```

#### 6.4.2 Handle Nested Errors

```typescript
function getErrorCode(error: MicrosoftGraphError): string {
  // Start with top-level code
  let code = error.code;

  // Loop through nested innererror objects
  let currentError = error.innererror;
  while (currentError) {
    if (currentError.code) {
      code = currentError.code;
    }
    currentError = currentError.innererror;
  }

  return code;
}
```

#### 6.4.3 Authentication Error Handling

```typescript
async function handleAuthError(error: APIError): Promise<boolean> {
  if (error.status === 401) {
    console.log('Authentication token expired. Refreshing...');

    try {
      // Refresh token (existing implementation in token-storage.ts)
      await tokenStorage.getValidAccessToken();
      return true; // Signal to retry
    } catch (refreshError) {
      console.error('Failed to refresh token:', refreshError);
      return false; // Signal to abort
    }
  }

  return false;
}
```

#### 6.4.4 Invalid Event ID Handling

```typescript
async function respondToEvent(eventId: string, response: 'accept' | 'decline' | 'tentative'): Promise<void> {
  try {
    await apiClient.request(`/me/events/${eventId}/${response}`, {
      method: 'POST',
      body: { sendResponse: true }
    });
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === 404) {
        throw new Error(`Event ${eventId} not found. It may have been deleted or you may not have access.`);
      }

      if (error.status === 400) {
        const errorData = error.details?.response as Record<string, unknown>;
        const errorCode = errorData?.error?.code;

        if (errorCode === 'InvalidRequest') {
          throw new Error('Invalid request. Check that the event allows time proposals if proposedNewTime is provided.');
        }
      }
    }

    throw error;
  }
}
```

### 6.5 Comprehensive Error Handler

```typescript
interface ErrorHandlerOptions {
  maxRetries: number;
  onAuthError?: () => Promise<boolean>;
  onRateLimit?: (retryAfter: number) => Promise<void>;
}

class MicrosoftGraphErrorHandler {
  private retryCount = 0;

  async handleError(
    error: APIError,
    options: ErrorHandlerOptions
  ): Promise<{ shouldRetry: boolean; delay?: number }> {

    // Handle authentication errors
    if (error.status === 401) {
      if (options.onAuthError) {
        const refreshed = await options.onAuthError();
        return { shouldRetry: refreshed && this.retryCount < options.maxRetries };
      }
      return { shouldRetry: false };
    }

    // Handle rate limiting
    if (error.status === 429) {
      const retryAfter = this.extractRetryAfter(error);
      if (options.onRateLimit) {
        await options.onRateLimit(retryAfter);
      }
      return { shouldRetry: true, delay: retryAfter * 1000 };
    }

    // Handle server errors (500, 503)
    if (error.status >= 500) {
      this.retryCount++;
      if (this.retryCount < options.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        return { shouldRetry: true, delay };
      }
      return { shouldRetry: false };
    }

    // Don't retry client errors (400, 403, 404, etc.)
    return { shouldRetry: false };
  }

  private extractRetryAfter(error: APIError): number {
    // Try to get from headers
    if (error.details?.headers?.['retry-after']) {
      return parseInt(error.details.headers['retry-after'], 10);
    }

    // Default to 10 seconds if not specified
    return 10;
  }

  reset(): void {
    this.retryCount = 0;
  }
}
```

---

## 7. Integration with Existing Codebase

### 7.1 Existing Patterns

The codebase already implements several relevant patterns:

**1. Base API Client** (`/home/stuartdavidson/code/cerebro-mcp/src/common/base-api-client.ts`):
- HTTP request handling
- Error extraction
- Pagination support
- Timeout configuration

**2. Microsoft API Client** (`/home/stuartdavidson/code/cerebro-mcp/src/services/microsoft/api-client.ts`):
- Extends BaseAPIClient
- Token management integration
- Request wrapper

**3. Exponential Backoff** (`/home/stuartdavidson/code/cerebro-mcp/src/services/slack/slack-socket-client.ts`):
- Already implements exponential backoff for WebSocket reconnection (lines 373-374)
- Pattern can be reused for API retry logic

### 7.2 Recommended Implementation Location

Based on codebase structure:

**New files to create:**
```
src/services/microsoft/event-response-client.ts  # Event response logic
src/services/microsoft/retry-handler.ts          # Retry logic
src/services/microsoft/resource-lock.ts          # Concurrency control
src/types/calendar.ts                            # Type definitions
src/mcp-server/handlers/calendar-response-tools.ts  # MCP tool handlers
```

**Existing files to extend:**
```
src/services/microsoft/api-client.ts             # Add retry wrapper
src/mcp-server/error-mapper.ts                   # Add error code mappings
src/types/index.ts                               # Export new types
```

### 7.3 Implementation Checklist

- [ ] Create type definitions for event response requests
- [ ] Implement retry handler with exponential backoff
- [ ] Implement resource lock for concurrency control
- [ ] Extend Microsoft API client with retry wrapper
- [ ] Create event response client with accept/decline/tentative methods
- [ ] Add comment length validation (8KB limit)
- [ ] Implement rate limit handling with Retry-After header support
- [ ] Add error code mappings to error-mapper.ts
- [ ] Create MCP tool handlers for calendar response operations
- [ ] Add unit tests for retry logic
- [ ] Add integration tests for event response operations
- [ ] Update documentation

---

## 8. Testing Recommendations

### 8.1 Unit Tests

**Test Cases:**
1. Comment validation (8KB limit)
2. Exponential backoff calculation
3. Retry-After header parsing
4. Error code extraction (nested innererror)
5. Resource lock acquire/release
6. Request deduplication

### 8.2 Integration Tests

**Test Scenarios:**
1. Accept event successfully
2. Decline event with proposed time
3. Tentative accept with comment
4. Handle 429 rate limiting
5. Handle 401 authentication error with token refresh
6. Handle 404 invalid event ID
7. Handle 400 invalid proposedNewTime
8. Concurrent requests to same event
9. Network timeout with retry
10. Server error (500) with retry

### 8.3 Mock Responses

The existing `BaseAPIClient` already supports test mode with mock handlers. Use this for testing:

```typescript
// In tests
const mockHandler: MockRequestHandler<unknown> = async (config) => {
  if (config.path.includes('/accept')) {
    return {
      data: {},
      status: 202,
      headers: {},
    };
  }

  if (simulateRateLimit) {
    return {
      data: { error: { code: 'TooManyRequests', message: 'Please retry after' } },
      status: 429,
      headers: { 'retry-after': '10' },
    };
  }

  throw new APIError('Not implemented', 500, 'test', 'POST /test');
};

apiClient.setMockHandler(mockHandler);
```

---

## 9. References and Sources

This research is based on official Microsoft Graph API documentation:

### Documentation Sources

1. **Microsoft Graph Event Accept API**
   https://learn.microsoft.com/en-us/graph/api/event-accept
   - HTTP method, URL formats, permissions, request/response format

2. **Microsoft Graph Event Decline API**
   https://learn.microsoft.com/en-us/graph/api/event-decline
   - Decline functionality, proposedNewTime parameter, error conditions

3. **Microsoft Graph Event Tentatively Accept API**
   https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept
   - Tentative response functionality, optional time proposals

4. **Microsoft Graph Throttling Guidance**
   https://learn.microsoft.com/en-us/graph/throttling
   - Rate limiting, HTTP 429 responses, Retry-After headers, exponential backoff

5. **Microsoft Graph Error Handling**
   https://learn.microsoft.com/en-us/graph/errors
   - Error response structure, common error codes, best practices

### Codebase References

- `/home/stuartdavidson/code/cerebro-mcp/src/common/base-api-client.ts` - Base API client implementation
- `/home/stuartdavidson/code/cerebro-mcp/src/services/microsoft/api-client.ts` - Microsoft Graph client
- `/home/stuartdavidson/code/cerebro-mcp/src/services/slack/slack-socket-client.ts` - Exponential backoff pattern (lines 373-374)

---

## 10. Next Steps

1. **Review this document** with the development team
2. **Create feature plan** following the cerebro-mcp development guidelines
3. **Implement core functionality**:
   - Retry handler with exponential backoff
   - Resource lock for concurrency control
   - Event response client
4. **Add MCP tool definitions** for accept/decline/tentative operations
5. **Write comprehensive tests** (unit and integration)
6. **Update CLAUDE.md** with new feature information
7. **Document usage** in README or separate guide

---

## Document Metadata

**Author:** Research compiled from Microsoft Graph API documentation
**Date:** 2026-02-02
**Version:** 1.0
**Status:** Complete
**Target Implementation:** cerebro-mcp Feature 015 (Calendar Event Response)
