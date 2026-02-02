# Implementation Plan: Meeting Response Functionality for Microsoft MCP Server

**Branch**: `015-meeting-response` | **Date**: 2026-02-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/015-meeting-response/spec.md`

## Summary

Add programmatic meeting invitation response capability (accept/decline/tentative) to the Microsoft MCP server, enabling automated calendar management via Microsoft Graph API. Primary use case: bulk declining meetings during holidays/time off via calendar triage command. Includes retry logic with exponential backoff, rate limiting handling, concurrent request protection, comprehensive logging, and calendar triage integration.

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: `@modelcontextprotocol/sdk ^1.25.3`, Microsoft Graph API v1.0
**Storage**: File-based OAuth token storage (existing `.tokens/` directory)
**Testing**: Jest 29.7.0 with ts-jest, 80% coverage requirement
**Target Platform**: Node.js server (localhost MCP server at port 3334)
**Project Type**: Single TypeScript project with MCP server architecture
**Performance Goals**:
- Meeting response within 5 seconds (SC-003)
- Organizer notification within 30 seconds (SC-002)
- 100% success rate for valid responses (SC-004)
**Constraints**:
- 8KB maximum comment length (Microsoft Graph API limit)
- Must respect HTTP 429 rate limiting with Retry-After headers
- Maximum 3 retry attempts with exponential backoff
- Single-process concurrency control (in-memory locks)
**Scale/Scope**:
- 3 response types (accept/decline/tentative)
- 17 functional requirements
- Integration with existing calendar triage command
- Bulk operation support for managing multiple meeting responses

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Documentation-First ✅
- **README Updates**: Will add new MCP tools documentation with usage examples
- **API Documentation**: Will document all three response tools (accept/decline/tentative) with input schemas
- **Configuration Documentation**: No new environment variables (uses existing Microsoft OAuth config)
- **Integration Guides**: Will create quickstart.md for calendar triage integration
- **Breaking Changes**: None (purely additive feature)

### Service Architecture ✅
- **BaseService Interface**: Extends existing MicrosoftService (already implements BaseService)
- **Configuration via Environment**: Uses existing Microsoft OAuth environment variables
- **Structured Logging**: Will use existing pino logger with operation, service, context fields (FR-015)
- **Error Handling**: Comprehensive error handling with clear messages (FR-008, FR-009, FR-013, FR-017)
- **Type Safety**: TypeScript strict mode enabled in tsconfig.json

### Testing Standards ✅
- **Unit Tests**: Will test retry logic, concurrency control, comment validation, error handling
- **Integration Tests**: Will test all three response types, rate limiting, token refresh, error scenarios
- **Coverage**: Target 80% as per jest.config.js
- **Error Path Testing**: Will test all edge cases from spec (8 scenarios documented)
- **Type Validation**: Input schema validation for all MCP tools

### MCP Tool Design ✅
- **Tool Naming**: Will use `microsoft` namespace prefix (e.g., `microsoft.respond-to-event`)
- **Input Schemas**: JSON Schema validation with clear descriptions
- **Error Messages**: User-friendly messages per constitution (FR-008, FR-009, FR-013)
- **Timeouts**: Will use existing BaseAPIClient timeout configuration (60s default)
- **Independence**: Each tool independently testable via existing MCP test infrastructure

### Dashboard Integration ✅
- **Status Cards**: No changes needed (uses existing Microsoft service status)
- **State Indicators**: No changes needed (OAuth status already displayed)
- **Configuration Display**: No new configuration to display
- **No Auth Services**: N/A (Microsoft service has OAuth)
- **Real Health Checks**: No changes needed (uses existing health check)

### Complexity Justification

No constitution violations. All requirements align with existing patterns and principles.

## Project Structure

### Documentation (this feature)

```text
specs/015-meeting-response/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Microsoft Graph API research (Phase 0 complete)
├── data-model.md        # Data models and entities (Phase 1 - to be created)
├── quickstart.md        # Calendar triage integration guide (Phase 1 - to be created)
└── contracts/           # API contracts (Phase 1 - to be created)
    └── event-response-api.md  # Response endpoint contracts
```

### Source Code (repository root)

```text
src/
├── services/
│   └── microsoft/
│       ├── microsoft-service.ts        # Add 3 new MCP tools (MODIFY)
│       ├── api-client.ts               # Add retry wrapper (MODIFY)
│       ├── event-response-client.ts    # Event response logic (NEW)
│       ├── retry-handler.ts            # Exponential backoff retry (NEW)
│       ├── resource-lock.ts            # Concurrency control (NEW)
│       └── __tests__/
│           ├── event-response-client.test.ts  # Unit tests (NEW)
│           ├── retry-handler.test.ts          # Unit tests (NEW)
│           └── resource-lock.test.ts          # Unit tests (NEW)
├── mcp-server/
│   └── handlers/
│       └── calendar-response-tools.ts  # MCP tool handlers (NEW)
├── types/
│   ├── calendar.ts                     # Calendar response types (NEW)
│   └── index.ts                        # Export new types (MODIFY)
└── common/
    └── logger.ts                       # Already exists (no changes)

tests/
└── integration/
    └── microsoft-event-response.test.ts  # Integration tests (NEW)
```

**Structure Decision**: Using existing single TypeScript project structure. All meeting response functionality will be added to the `src/services/microsoft/` directory, following the established pattern of email tools (`email-move-tools.ts`) and OneNote tools (`onenote-tools.ts`). MCP tool handlers will be added to `src/mcp-server/handlers/` following the existing pattern.

## Research Summary (Phase 0 Complete)

Research document created at: [research.md](research.md)

### Key Findings

**API Endpoints (Microsoft Graph v1.0):**
- Accept: `POST /me/events/{id}/accept`
- Decline: `POST /me/events/{id}/decline`
- Tentative: `POST /me/events/{id}/tentativelyAccept`
- All return `202 Accepted` on success
- All support optional `comment` (8KB max) and `sendResponse` (boolean) parameters

**Retry Strategy:**
- Exponential backoff formula: `delay = min(base * 2^attempt, maxDelay)`
- Base: 1000ms, Max: 30000ms, Max attempts: 3 (per spec clarification)
- Retry on: 429 (always), 503 (always), 500 (with backoff), network errors
- Do not retry on: 400, 403, 404, 409 (client errors)
- Special case: 401 requires token refresh then retry once

**Rate Limiting:**
- HTTP 429 includes `Retry-After` header (seconds to wait)
- Priority: Use Retry-After value over exponential backoff
- Implementation: Check header first, fall back to backoff if missing

**Concurrency Control:**
- Recommended: In-memory lock (single-process architecture)
- Lock per event ID to prevent duplicate requests
- Return "already processing" for concurrent attempts to same event

**Error Handling:**
- Error codes (not messages) for logic decisions
- Nested `innererror` object traversal
- 8KB comment validation before API call
- Clear user-facing error messages per error type

**Codebase Integration:**
- Reuse: `BaseAPIClient`, `MicrosoftTokenStorage`, existing retry pattern in `slack-socket-client.ts`
- Pattern: Follow existing Microsoft service tools (email, OneNote, calendar)
- Logging: Use pino with structured fields (operation, service, context)

## Data Model Design (Phase 1)

See [data-model.md](data-model.md) for complete entity definitions and relationships.

**Core Entities:**
1. **EventResponseRequest**: Input for response operations
2. **EventResponseResult**: Output from response operations
3. **RetryConfig**: Retry strategy configuration
4. **ResourceLock**: Concurrency control state

## API Contracts (Phase 1)

See [contracts/event-response-api.md](contracts/event-response-api.md) for complete API documentation.

**MCP Tools:**
1. `microsoft.respond-to-event` - Accept/decline/tentative with comment and notification control
2. Integration with existing `microsoft.list-events` and `microsoft.get-event` tools

**Microsoft Graph API Calls:**
1. `POST /me/events/{id}/accept` - Accept meeting
2. `POST /me/events/{id}/decline` - Decline meeting
3. `POST /me/events/{id}/tentativelyAccept` - Tentatively accept meeting

## Implementation Phases

### Phase 0: Research & Planning ✅ COMPLETE

Research document generated with all technical details needed for implementation.

### Phase 1: Core Infrastructure (NEW FILES)

**1.1 Type Definitions** (`src/types/calendar.ts`)
- `EventResponseRequest` interface
- `EventResponseResult` interface
- `EventResponseType` enum ('accepted' | 'declined' | 'tentativelyAccepted')
- Export from `src/types/index.ts`

**1.2 Retry Handler** (`src/services/microsoft/retry-handler.ts`)
- Exponential backoff implementation (formula from research)
- Max 3 attempts configuration (per clarification)
- Retryable error detection (429, 500, 503, network errors)
- Non-retryable error handling (400, 403, 404)
- Token refresh on 401
- Structured logging for retry attempts

**1.3 Resource Lock** (`src/services/microsoft/resource-lock.ts`)
- In-memory lock implementation
- Lock per event ID
- Auto-release on operation completion
- "already processing" detection

**1.4 Event Response Client** (`src/services/microsoft/event-response-client.ts`)
- Accept event method
- Decline event method
- Tentatively accept event method
- Comment validation (8KB UTF-8 byte limit)
- Rate limiting handling (Retry-After header priority)
- Integration with RetryHandler and ResourceLock
- Microsoft Graph API client calls

### Phase 2: MCP Tool Integration

**2.1 Tool Handlers** (`src/mcp-server/handlers/calendar-response-tools.ts`)
- `respondToEvent` handler
  - Input validation (eventId, response type, comment, sendResponse)
  - Call EventResponseClient
  - Return success/failure result with clear messages
  - Error mapping to user-friendly messages

**2.2 Microsoft Service Updates** (`src/services/microsoft/microsoft-service.ts`)
- Add `respond-to-event` tool definition
  - JSON Schema with eventId (required), response (enum), comment (optional, max 8KB), sendResponse (optional, default true)
  - Description: "Accept, decline, or tentatively accept a meeting invitation programmatically"
  - Bind to handler

### Phase 3: Calendar Triage Integration

**3.1 Calendar Triage Command Updates** (if applicable - see spec FR-011, FR-012)
- Update `/home/stuartdavidson/cerebro/.claude/commands/calendar-triage.md`
- Add automated decline workflow with user confirmation
- Use `microsoft.respond-to-event` tool for bulk operations
- Document in quickstart.md

### Phase 4: Testing

**4.1 Unit Tests**
- `event-response-client.test.ts`:
  - Comment validation (exactly 8192 bytes, truncation)
  - Accept/decline/tentative method logic
  - Error handling for each error type
  - Mock Microsoft Graph API responses

- `retry-handler.test.ts`:
  - Exponential backoff calculation
  - Max 3 attempts enforcement
  - Retryable vs non-retryable error detection
  - Token refresh on 401

- `resource-lock.test.ts`:
  - Lock acquire/release
  - Concurrent request handling
  - "already processing" status

**4.2 Integration Tests** (`tests/integration/microsoft-event-response.test.ts`)
- Accept event successfully
- Decline event with comment
- Tentative accept
- Handle 429 rate limiting with Retry-After
- Handle 401 with token refresh
- Handle 404 invalid event ID
- Handle 400 invalid request
- Concurrent requests to same event
- Network timeout with retry

**4.3 Coverage Target**
- Minimum 80% coverage per jest.config.js
- Focus on error paths and edge cases

### Phase 5: Documentation

**5.1 Code Documentation**
- JSDoc comments on all public interfaces
- Inline comments for complex retry logic
- Error handling documentation

**5.2 README Updates**
- Add meeting response section to main README
- Document three new MCP tools
- Provide usage examples
- Reference quickstart.md for calendar triage integration

**5.3 Quickstart Guide** ([quickstart.md](quickstart.md))
- Calendar triage integration steps
- Bulk decline workflow example
- Error handling guidance
- Best practices for automated calendar management

## Critical Implementation Notes

### 1. Comment Length Validation
```typescript
// MUST validate BEFORE API call to avoid 400 errors
function validateComment(comment?: string): string | undefined {
  if (!comment) return undefined;

  const maxBytes = 8192;
  const buffer = Buffer.from(comment, 'utf8');

  if (buffer.length <= maxBytes) return comment;

  // Truncate to fit
  let truncated = comment;
  while (Buffer.from(truncated, 'utf8').length > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  logger.warn({
    operation: 'comment_truncated',
    originalLength: buffer.length,
    truncatedLength: Buffer.from(truncated, 'utf8').length,
    msg: 'Comment exceeded 8KB limit and was truncated'
  });

  return truncated;
}
```

### 2. Retry-After Header Priority
```typescript
// MUST check Retry-After header FIRST before exponential backoff
async function handleRateLimit(response: APIResponse): Promise<number> {
  if (response.status === 429) {
    const retryAfter = response.headers['retry-after'];
    if (retryAfter) {
      const waitMs = parseInt(retryAfter, 10) * 1000;
      logger.info({
        operation: 'rate_limit_retry_after',
        retryAfterSeconds: retryAfter,
        msg: 'Rate limited, using Retry-After header'
      });
      return waitMs;
    }

    // Fall back to exponential backoff only if no header
    logger.info({
      operation: 'rate_limit_exponential_backoff',
      msg: 'Rate limited but no Retry-After header, using exponential backoff'
    });
    return -1; // Signal to use exponential backoff
  }
  return 0;
}
```

### 3. Concurrency Control
```typescript
// MUST lock per event ID to prevent duplicate requests
class ResourceLock {
  private locks = new Map<string, Promise<void>>();

  async acquireLock<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(resourceId);
    if (existing) {
      throw new Error('Resource is already being processed');
    }

    const lockPromise = (async () => {
      try {
        return await operation();
      } finally {
        if (this.locks.get(resourceId) === lockPromise) {
          this.locks.delete(resourceId);
        }
      }
    })();

    this.locks.set(resourceId, lockPromise as unknown as Promise<void>);
    return lockPromise;
  }
}
```

### 4. Structured Logging (FR-015)
```typescript
// Log all response attempts with required fields
logger.info({
  operation: 'event_response_attempt',
  service: 'microsoft',
  eventId: eventId,
  responseType: response,
  outcome: 'success',
  timestamp: new Date().toISOString(),
  // Do NOT log comment content (per FR-015)
  msg: `Meeting response ${response} sent for event ${eventId}`
});

// On error
logger.error({
  operation: 'event_response_error',
  service: 'microsoft',
  eventId: eventId,
  responseType: response,
  outcome: 'failure',
  timestamp: new Date().toISOString(),
  errorCode: error.code,
  errorStatus: error.status,
  errorMessage: error.message,
  // Do NOT log comment content
  msg: `Meeting response ${response} failed for event ${eventId}`
});
```

### 5. Error Code Handling (Not Messages)
```typescript
// MUST use error codes, not messages
function getErrorCode(error: MicrosoftGraphError): string {
  let code = error.code;
  let current = error.innererror;

  while (current) {
    if (current.code) code = current.code;
    current = current.innererror;
  }

  return code;
}

// Handle specific codes
if (getErrorCode(error) === 'ResourceNotFound' || getErrorCode(error) === 'ErrorItemNotFound') {
  throw new Error(`Event ${eventId} not found. It may have been deleted or you may not have access.`);
}
```

## Testing Strategy

### Unit Test Coverage
- Comment validation edge cases (exactly 8192 bytes, 8193 bytes, empty, undefined, multi-byte UTF-8)
- Exponential backoff progression (1s, 2s, 4s up to 30s max)
- Retry attempt limiting (exactly 3 attempts per spec)
- Error code extraction (nested innererror traversal)
- Resource lock behavior (acquire, release, concurrent attempts)
- Rate limit handling (Retry-After header vs exponential backoff)

### Integration Test Scenarios
- Happy path: Accept/decline/tentative with all parameter combinations
- Error paths: All 8 edge cases from spec
- Rate limiting: HTTP 429 with and without Retry-After header
- Authentication: Token refresh on 401
- Concurrency: Multiple rapid requests to same event ID
- Network: Timeout and retry behavior

### Mock Response Patterns
```typescript
// Reuse existing BaseAPIClient mock handler pattern
const mockHandler = async (config: RequestConfig) => {
  if (config.path.includes('/accept')) {
    return { data: {}, status: 202, headers: {} };
  }

  if (simulateRateLimit) {
    return {
      data: { error: { code: 'TooManyRequests' } },
      status: 429,
      headers: { 'retry-after': '10' }
    };
  }

  // ... other mock scenarios
};

apiClient.setMockHandler(mockHandler);
```

## Success Criteria Mapping

| Success Criterion | Implementation |
|-------------------|----------------|
| SC-001: Respond without Outlook | MCP tools provide programmatic API |
| SC-002: Notification within 30s | Microsoft Graph API handles delivery |
| SC-003: Calendar update within 5s | Microsoft Graph API handles updates |
| SC-004: 100% success rate | Retry logic with exponential backoff (FR-014) |
| SC-005: Bulk operation support | Calendar triage integration (FR-011) |
| SC-006: Clear error messages | Error handler with code mapping (FR-008, FR-009, FR-013) |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Rate limiting impacts bulk operations | Retry-After header priority, exponential backoff (FR-017) |
| Duplicate responses from concurrent requests | Resource lock per event ID (FR-016) |
| Comment exceeds 8KB limit | Pre-validation with truncation (FR-004, FR-013) |
| Network transient failures | Automatic retry up to 3 attempts (FR-014) |
| Token expiration during operation | Automatic token refresh on 401 |
| Invalid event IDs | Clear error message with guidance (FR-008) |

## Dependencies

**External:**
- Microsoft Graph API v1.0 (already integrated)
- `@modelcontextprotocol/sdk ^1.25.3` (already installed)
- Calendars.ReadWrite permission (already granted per assumptions)

**Internal:**
- `BaseAPIClient` - HTTP request handling
- `MicrosoftTokenStorage` - OAuth token management
- `MicrosoftApiClient` - Graph API wrapper
- Pino logger - Structured logging
- Jest - Testing framework

## Rollout Plan

1. **Phase 1**: Implement core infrastructure (retry, locking, client) with unit tests
2. **Phase 2**: Add MCP tools with integration tests
3. **Phase 3**: Update calendar triage command (if exists)
4. **Phase 4**: Documentation and README updates
5. **Phase 5**: Code review and quality gates (TypeScript, ESLint, Prettier, 80% coverage)
6. **Phase 6**: Manual testing with real Microsoft account
7. **Phase 7**: Merge to main branch

## Next Steps

After plan approval:
1. Run `/speckit.tasks` to generate task breakdown
2. Begin Phase 1 implementation (core infrastructure)
3. Follow TDD approach: write tests first, then implementation
4. Regular commits with descriptive messages
5. Update CLAUDE.md after completion
