# Research: Move Email to Folder

**Date**: 2026-01-30
**Feature**: 014-move-email-folder

## Overview

Research findings for implementing email move functionality using Microsoft Graph API v1.0, addressing unknowns from Technical Context and evaluating implementation patterns for atomic batch operations, folder resolution, and read status management.

## Technical Decisions

### 1. Microsoft Graph API Endpoints for Email Move

**Decision**: Use `POST /me/messages/{id}/move` for single email moves and sequential calls for batch operations.

**Rationale**:
- Microsoft Graph API v1.0 provides a dedicated `move` endpoint that atomically moves an email and returns the new message object
- The endpoint supports moving to a folder specified by ID: `POST /me/messages/{messageId}/move` with body `{ "destinationId": "folderId" }`
- Moving automatically preserves all email properties (attachments, metadata, conversation threading) except those we explicitly modify
- The API does not provide a native batch move endpoint with transaction semantics, requiring custom batching logic

**Alternatives Considered**:
- **Graph API $batch endpoint**: Can batch multiple requests but doesn't provide transaction rollback - if one fails, others may still succeed. Doesn't meet FR-013 (atomic batch behavior).
- **Copy then delete**: More complex, requires handling partial failures, doesn't leverage Graph API's atomic move operation.

**References**:
- Microsoft Graph API: https://learn.microsoft.com/en-us/graph/api/message-move
- Graph API batch requests: https://learn.microsoft.com/en-us/graph/json-batching

---

### 2. Atomic Batch Operations Strategy

**Decision**: Implement client-side atomic batch behavior with pre-validation and compensation logic.

**Rationale**:
- Since Microsoft Graph API doesn't provide native transaction support for multiple moves, implement validation-first pattern:
  1. **Validation Phase**: Verify all email IDs exist and folder exists before any moves (FR-014)
  2. **Execution Phase**: Execute moves sequentially
  3. **Compensation Phase**: If any move fails, reverse all completed moves by moving emails back to original folders
- This ensures FR-013 (atomic behavior: all succeed or all fail) while using the reliable single-message `move` endpoint
- Sequential execution prevents race conditions and simplifies error tracking
- Store original folder IDs during validation to enable accurate rollback

**Alternatives Considered**:
- **Optimistic batch**: Execute all moves without validation, clean up failures afterward. Rejected: violates atomic behavior requirement, harder to provide meaningful error messages.
- **Batch API without compensation**: Use $batch endpoint without rollback. Rejected: doesn't meet atomic requirement (FR-013).
- **Transaction log with manual recovery**: Complex state management. Rejected: over-engineering for this use case.

**Implementation Notes**:
- Track move operations in array: `[{ emailId, originalFolderId, targetFolderId, moved: boolean }]`
- On failure at index N, reverse moves 0 to N-1 in reverse order
- Log each move and compensation step for debugging

---

### 3. Folder Path Resolution Pattern

**Decision**: Reuse existing `resolveFolderName()` method from MicrosoftService, which supports nested paths with forward slash delimiter.

**Rationale**:
- Feature 012-email-folder-filter established folder resolution pattern that handles:
  - Well-known folders (inbox, sent, drafts, spam/junk, trash/deleted)
  - Custom folder names (case-sensitive lookup via `/me/mailFolders`)
  - Nested paths using `/` delimiter (e.g., "Projects/2026/Q1")
- Consistent with existing list-emails tool folder parameter behavior
- Already handles Microsoft Graph API folder lookup and caching patterns
- Avoids code duplication and ensures consistent folder handling across tools

**Alternatives Considered**:
- **Folder ID-only input**: Require users to provide folder GUIDs. Rejected: poor UX, requires separate folder lookup step.
- **New resolver with different delimiter**: Use backslash or dot notation. Rejected: breaks consistency with 012-email-folder-filter.

**Implementation Notes**:
- The existing `mapToWellKnownFolder()` method maps common names (spam → junkemail, trash → deleteditems)
- The `resolveFolderName()` method splits on `/` and walks the folder hierarchy for nested paths
- No changes needed to folder resolution logic - just reuse the existing methods

---

### 4. Read Status Management Timing

**Decision**: Update read status after successful move using PATCH /me/messages/{id} with `isRead` property.

**Rationale**:
- Per clarification Q5 and FR-019, read status update must occur after move completes successfully
- Microsoft Graph API move operation doesn't modify `isRead` property, allowing explicit control
- Two-step process ensures data consistency:
  1. Move email to target folder (POST /me/messages/{id}/move)
  2. If markAsRead=true (default), PATCH /me/messages/{id} with `{ "isRead": true }`
- If move fails, read status is never modified (FR-020)
- For batch operations, update read status after all moves succeed (within atomic batch boundary)

**Alternatives Considered**:
- **Single Graph API call with both operations**: Not supported - move and property update are separate endpoints.
- **Update read status before move**: Rejected - violates FR-019, creates inconsistent state if move fails.
- **Separate Graph API requests in parallel**: Rejected - introduces race conditions and partial success scenarios.

**Implementation Notes**:
- Only call PATCH if markAsRead parameter is true (default)
- Include markAsRead in compensation logic for batch operations: if rolling back, restore original isRead state
- Log read status updates separately for debugging: `{ operation: 'email_marked_read', emailId, success: boolean }`

---

### 5. Idempotent Behavior Implementation

**Decision**: Check current folder before moving; treat same-folder moves as success without API call.

**Rationale**:
- Per clarification Q2 and FR-016, moving email to its current folder should succeed silently
- Retrieve email metadata before move to get current folder ID: `GET /me/messages/{id}?$select=id,parentFolderId,subject`
- Compare target folder ID with email's parentFolderId
- If match: Skip move API call, apply read status if requested, return success (idempotent)
- If different: Proceed with move operation
- Reduces unnecessary API calls and ensures true idempotency across multiple invocations

**Alternatives Considered**:
- **Always call move API**: Let Graph API handle same-folder moves. Rejected: API may return error for no-op moves.
- **Skip pre-check, catch specific error**: React to Graph API error codes. Rejected: Error handling is less clear and adds latency.

**Implementation Notes**:
- Pre-check adds one GET request per email but avoids errors and provides better UX
- For batch operations, pre-check all emails to identify which need actual moves
- Batch validation includes checking if any emails are already in target folder

---

### 6. Error Message Detail Level

**Decision**: Include email ID, subject (if available), and folder path in error messages per clarification Q4 and FR-018.

**Rationale**:
- Balanced approach: enough context for debugging without exposing sensitive email content
- Error message structure:
  ```
  Failed to move email: [emailId] "[subject]" to folder "[folderPath]". Reason: [specific error].
  ```
- For batch operations, list all validation failures:
  ```
  Batch move failed validation:
  - Email [id1] "[subject1]": not found
  - Folder "[path]": does not exist
  ```
- Never include email body, attachments, or full metadata in error messages
- Use email subject for human recognition while maintaining security

**Alternatives Considered**:
- **ID-only errors**: Rejected - requires users to cross-reference IDs manually, poor UX.
- **Full metadata in errors**: Rejected - security risk, exposes potentially sensitive information.

**Implementation Notes**:
- Retrieve email subject during validation phase for error reporting
- Truncate subjects longer than 100 characters: `"Long subject text..."`
- Handle missing subjects gracefully: `[No subject]`
- Log full error context to structured logs for debugging: `{ emailId, subject, folderPath, error: errorDetail }`

---

### 7. Testing Strategy for Graph API Operations

**Decision**: Unit tests with mocked Graph API responses; integration tests with recorded real API interactions.

**Rationale**:
- Follow existing cerebro-mcp testing patterns from microsoft-service.test.ts
- Unit tests: Mock `apiClient.request()` to test business logic (validation, atomic batch, compensation)
- Integration tests: Use real Microsoft Graph API calls with test account (or recorded VCR-style fixtures)
- Test coverage priorities:
  1. **Unit**: Atomic batch logic, folder resolution, error categorization, idempotent checks
  2. **Integration**: Actual move operations, read status updates, folder hierarchy traversal
  3. **Error paths**: Invalid IDs, missing folders, permission errors, network failures

**Alternatives Considered**:
- **Live API tests only**: Rejected - slow, requires real Microsoft account, flaky for CI.
- **Mocked tests only**: Rejected - doesn't verify actual Graph API behavior.

**Implementation Notes**:
- Extend existing `apiClient.setMockHandler()` pattern from microsoft-service.ts
- Mock move endpoint: `POST /me/messages/{id}/move → { id, parentFolderId }`
- Mock error scenarios: 404 for invalid email ID, 404 for invalid folder, 403 for permission denied
- Integration tests should run with `MICROSOFT_TEST_MODE=true` flag to avoid affecting real mailboxes

---

## Best Practices

### Microsoft Graph API Best Practices

**Throttling and Rate Limits**:
- Microsoft Graph API has rate limits per user/tenant (default: ~10,000 requests per 10 minutes)
- For batch operations, use exponential backoff on 429 (Too Many Requests) responses
- Space out sequential move requests with minimal delay (~10ms) to avoid hitting limits

**Error Handling**:
- Distinguish between transient (429, 503, 504) and permanent (400, 403, 404) errors
- Retry transient errors with exponential backoff (existing api-client.ts pattern)
- Log Graph API error codes and messages for debugging: `{ graphErrorCode, graphMessage, operation }`

**Authentication**:
- Reuse existing Microsoft OAuth flow (no changes)
- Required scope: `Mail.ReadWrite` (already requested by existing email tools)
- Token refresh handled by existing token-storage.ts

### Email Operations Best Practices

**Folder ID Caching**:
- Cache resolved folder IDs for common paths (inbox, sent, etc.) to reduce API calls
- TTL: 5 minutes (folders rarely change during active session)
- Key by folder path: `folderCache.set("Projects/2026", { id: "guid", expires: timestamp })`

**Batch Size Limits**:
- No artificial batch size limit per SC specification, but recommend practical limit
- Suggest max 50 emails per batch for reasonable operation time (<3s per email = ~150s total)
- Document recommended limits in tool description

**Compensation Strategy**:
- Store original state before any mutations: `{ emailId, originalFolderId, originalIsRead }`
- Roll back in reverse order of execution to maintain consistency
- Log all compensation actions: `{ operation: 'compensate_move', emailId, targetFolder }`

---

## Integration Patterns

### Reusing Existing Code

**From feature 012-email-folder-filter**:
- `mapToWellKnownFolder(folderName)`: Maps common names to Graph API well-known folder names
- `resolveFolderName(folderPath)`: Resolves nested folder paths to folder IDs
- Pattern: `/me/mailFolders/{parentId}/childFolders?$filter=displayName eq '{name}'`

**From existing microsoft-service.ts**:
- `apiClient.request(endpoint, config)`: HTTP client with auth, retries, error handling
- Error categorization: Network, timeout, API (400/403/404), validation
- Structured logging: `logger.info({ operation, service, context })`

**No changes needed to**:
- token-storage.ts (OAuth token management)
- api-client.ts (Graph API request wrapper)
- Dashboard integration (service-level auth status)

---

## Open Questions (Resolved)

All Technical Context unknowns have been resolved:
- ✅ **Move API endpoint**: Documented in Decision 1
- ✅ **Atomic batch strategy**: Documented in Decision 2
- ✅ **Folder resolution**: Documented in Decision 3 (reuse existing)
- ✅ **Read status timing**: Documented in Decision 4
- ✅ **Idempotent behavior**: Documented in Decision 5
- ✅ **Error message detail**: Documented in Decision 6
- ✅ **Testing approach**: Documented in Decision 7

---

## Next Steps

With all technical decisions documented, proceed to:
1. **Phase 1**: Generate data-model.md (email move entities)
2. **Phase 1**: Generate contracts/move-email-tools.md (MCP tool schemas)
3. **Phase 1**: Generate quickstart.md (usage examples)
4. **Phase 1**: Update CLAUDE.md agent context
5. **Phase 2**: Generate tasks.md (/speckit.tasks command)
