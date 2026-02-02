# Tasks: Meeting Response Functionality for Microsoft MCP Server

**Input**: Design documents from `/specs/015-meeting-response/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are INCLUDED per plan.md testing standards (80% coverage requirement)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- TypeScript project structure per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and type system setup

- [x] T001 [P] Create calendar response types in src/types/calendar.ts (EventResponseRequest, EventResponseResult, EventResponseType, EventResponseError, RetryConfig, ResourceLockState)
- [x] T002 [P] Export calendar types from src/types/index.ts
- [x] T003 [P] Verify TypeScript compilation passes with new types

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Implement RetryHandler class in src/services/microsoft/retry-handler.ts with exponential backoff (base: 1000ms, max: 30000ms, maxAttempts: 3)
- [x] T005 [P] Implement ResourceLock class in src/services/microsoft/resource-lock.ts for concurrency control (in-memory Map-based locking per event ID)
- [x] T006 [P] Write unit tests for RetryHandler in src/services/microsoft/__tests__/retry-handler.test.ts (test exponential backoff calculation, max attempts enforcement, retryable error detection)
- [x] T007 [P] Write unit tests for ResourceLock in src/services/microsoft/__tests__/resource-lock.test.ts (test lock acquire/release, concurrent request handling, "already processing" status)
- [x] T008 [P] Create EventResponseClient class in src/services/microsoft/event-response-client.ts with comment validation method (8KB UTF-8 byte limit check)
- [x] T009 [P] Write unit tests for EventResponseClient comment validation in src/services/microsoft/__tests__/event-response-client.test.ts (test exactly 8192 bytes, 8193 bytes truncation, empty, undefined, multi-byte UTF-8)
- [x] T010 Run unit tests for all foundational components (npm test -- retry-handler.test resource-lock.test event-response-client.test)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Decline Holiday Meetings in Bulk (Priority: P1) 🎯 MVP

**Goal**: Enable programmatic declining of meeting invitations with custom message and notification control, supporting bulk operations for holiday conflict management

**Independent Test**: Can be fully tested by declining a meeting invitation and verifying organizer receives decline notification with message and calendar shows "declined" status

### Implementation for User Story 1

- [ ] T011 [US1] Implement decline method in EventResponseClient in src/services/microsoft/event-response-client.ts (calls POST /me/events/{id}/decline with validated comment and sendResponse)
- [ ] T012 [US1] Add rate limiting handling to decline method (check Retry-After header first, fall back to exponential backoff)
- [ ] T013 [US1] Add retry logic integration to decline method (wrap with RetryHandler, handle 429/500/503/network errors)
- [ ] T014 [US1] Add concurrency control to decline method (wrap with ResourceLock, return "already processing" for concurrent attempts)
- [ ] T015 [US1] Add structured logging to decline method (log operation, eventId, responseType, outcome, timestamp without comment content per FR-015)
- [ ] T016 [P] [US1] Write unit tests for decline method in src/services/microsoft/__tests__/event-response-client.test.ts (test successful decline, decline with comment, silent decline, error cases)
- [ ] T017 [P] [US1] Create respondToEvent handler for decline in src/mcp-server/handlers/calendar-response-tools.ts (input validation, call EventResponseClient.decline, return EventResponseResult)
- [ ] T018 [US1] Add respond-to-event MCP tool to MicrosoftService in src/services/microsoft/microsoft-service.ts with decline support (JSON Schema with eventId required, response enum including "declined", comment optional max 8KB, sendResponse optional default true)
- [ ] T019 [P] [US1] Write integration test for decline workflow in tests/integration/microsoft-event-response.test.ts (test end-to-end decline with notification, silent decline, decline with comment)
- [ ] T020 [P] [US1] Test decline error scenarios in integration test (404 invalid event ID, 400 invalid request, 429 rate limiting with Retry-After, concurrent requests)
- [ ] T021 [US1] Run all US1 tests and verify 80% coverage (npm test -- calendar-response event-response-client)

**Checkpoint**: At this point, User Story 1 (decline functionality) should be fully functional and testable independently

---

## Phase 4: User Story 2 - Accept Meeting Invitations Programmatically (Priority: P2)

**Goal**: Enable programmatic acceptance of meeting invitations to support automated calendar management when no conflicts exist

**Independent Test**: Can be fully tested by accepting a meeting invitation and verifying calendar shows "accepted" status and organizer receives acceptance notification

### Implementation for User Story 2

- [ ] T022 [P] [US2] Implement accept method in EventResponseClient in src/services/microsoft/event-response-client.ts (calls POST /me/events/{id}/accept with validated comment and sendResponse)
- [ ] T023 [US2] Add rate limiting handling to accept method (reuse Retry-After header logic from decline)
- [ ] T024 [US2] Add retry logic integration to accept method (wrap with RetryHandler, same error handling as decline)
- [ ] T025 [US2] Add concurrency control to accept method (wrap with ResourceLock)
- [ ] T026 [US2] Add structured logging to accept method (same pattern as decline per FR-015)
- [ ] T027 [P] [US2] Write unit tests for accept method in src/services/microsoft/__tests__/event-response-client.test.ts (test successful accept, accept with comment, silent accept, error cases)
- [ ] T028 [US2] Update respondToEvent handler to support accept in src/mcp-server/handlers/calendar-response-tools.ts (handle "accepted" response type)
- [ ] T029 [US2] Update respond-to-event MCP tool schema to include "accepted" in enum in src/services/microsoft/microsoft-service.ts
- [ ] T030 [P] [US2] Write integration test for accept workflow in tests/integration/microsoft-event-response.test.ts (test end-to-end accept with notification, silent accept, accept with comment)
- [ ] T031 [P] [US2] Test accept error scenarios in integration test (401 auth error with token refresh, network timeout with retry)
- [ ] T032 [US2] Run all US2 tests and verify 80% coverage maintained (npm test -- calendar-response event-response-client)

**Checkpoint**: At this point, User Stories 1 AND 2 (decline and accept) should both work independently

---

## Phase 5: User Story 3 - Tentatively Accept Meetings (Priority: P3)

**Goal**: Enable tentative responses when availability is uncertain, providing organizers with provisional acceptance status

**Independent Test**: Can be fully tested by tentatively accepting a meeting invitation and verifying calendar shows "tentative" status and organizer is notified

### Implementation for User Story 3

- [ ] T033 [P] [US3] Implement tentativelyAccept method in EventResponseClient in src/services/microsoft/event-response-client.ts (calls POST /me/events/{id}/tentativelyAccept with validated comment and sendResponse)
- [ ] T034 [US3] Add rate limiting handling to tentativelyAccept method (reuse Retry-After header logic)
- [ ] T035 [US3] Add retry logic integration to tentativelyAccept method (wrap with RetryHandler)
- [ ] T036 [US3] Add concurrency control to tentativelyAccept method (wrap with ResourceLock)
- [ ] T037 [US3] Add structured logging to tentativelyAccept method (same pattern per FR-015)
- [ ] T038 [P] [US3] Write unit tests for tentativelyAccept method in src/services/microsoft/__tests__/event-response-client.test.ts (test successful tentative, tentative with comment, silent tentative, error cases)
- [ ] T039 [US3] Update respondToEvent handler to support tentative in src/mcp-server/handlers/calendar-response-tools.ts (handle "tentativelyAccepted" response type)
- [ ] T040 [US3] Update respond-to-event MCP tool schema to include "tentativelyAccepted" in enum in src/services/microsoft/microsoft-service.ts
- [ ] T041 [P] [US3] Write integration test for tentative workflow in tests/integration/microsoft-event-response.test.ts (test end-to-end tentative with notification, tentative with comment)
- [ ] T042 [US3] Run all US3 tests and verify 80% coverage maintained (npm test -- calendar-response event-response-client)

**Checkpoint**: All user stories (decline, accept, tentative) should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, documentation, and final validation

- [ ] T043 [P] Add README section documenting microsoft.respond-to-event tool with usage examples for all three response types
- [ ] T044 [P] Add JSDoc comments to all public interfaces in src/types/calendar.ts, src/services/microsoft/retry-handler.ts, src/services/microsoft/resource-lock.ts, src/services/microsoft/event-response-client.ts
- [ ] T045 [P] Add error handling documentation for each error code (400, 401, 403, 404, 409, 429, 500, 503) in code comments
- [ ] T046 Run npm run lint and fix any issues (npm run lint:fix)
- [ ] T047 Run npm run format:check and format if needed (npm run format)
- [ ] T048 Run npm run type-check and fix any type errors
- [ ] T049 Run full test suite and verify 80% coverage (npm run test:coverage)
- [ ] T050 Run npm run build and verify clean compilation to dist/
- [ ] T051 [P] Validate quickstart.md examples work as documented
- [ ] T052 Update CLAUDE.md with new feature documentation (already done by update-agent-context.sh)
- [ ] T053 Manual testing: Create test meeting, decline with notification, verify in Outlook
- [ ] T054 Manual testing: Create test meeting, accept with comment, verify in Outlook
- [ ] T055 Manual testing: Test bulk decline workflow with 3+ meetings during holiday period
- [ ] T056 Manual testing: Test rate limiting handling by rapidly calling respond-to-event 10+ times
- [ ] T057 Manual testing: Test concurrent request handling by calling respond-to-event for same event from multiple terminals
- [ ] T058 Code review: Verify all constitution checks pass (Documentation-First, Service Architecture, Testing Standards, MCP Tool Design)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001-T003) completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase (T004-T010) completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (T004-T010) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (T004-T010) - Reuses RetryHandler, ResourceLock from foundational, but independently testable
- **User Story 3 (P3)**: Can start after Foundational (T004-T010) - Reuses RetryHandler, ResourceLock from foundational, but independently testable

### Within Each User Story

- Models/Infrastructure (EventResponseClient methods) before handlers
- Handlers before MCP tool registration
- Unit tests can run in parallel with implementation (TDD approach)
- Integration tests after handler implementation
- Story validation before moving to next priority

### Parallel Opportunities

#### Phase 1 (Setup)
- T001, T002, T003 can all run in parallel (different files)

#### Phase 2 (Foundational)
- T004 (RetryHandler), T005 (ResourceLock), T008 (EventResponseClient) can run in parallel
- T006 (RetryHandler tests), T007 (ResourceLock tests), T009 (EventResponseClient tests) can run in parallel after their implementations

#### Phase 3 (User Story 1)
- T016 (US1 unit tests) and T017 (US1 handler) can run in parallel
- T019 (US1 integration test) and T020 (US1 error scenarios) can run in parallel

#### Phase 4 (User Story 2)
- T022 (accept implementation) can start immediately after Foundational
- T027 (US2 unit tests) and T028 (US2 handler update) can run in parallel
- T030 (US2 integration test) and T031 (US2 error scenarios) can run in parallel

#### Phase 5 (User Story 3)
- T033 (tentative implementation) can start immediately after Foundational
- T038 (US3 unit tests) and T039 (US3 handler update) can run in parallel

#### Phase 6 (Polish)
- T043 (README), T044 (JSDoc), T045 (error docs) can run in parallel
- T053-T057 (manual tests) can run in any order

**Once Foundational phase (T004-T010) completes, User Stories 1, 2, and 3 can all start in parallel if team capacity allows**

---

## Parallel Example: User Story 1

```bash
# After Foundational phase (T004-T010) completes, launch User Story 1 tasks in parallel:

# Developer A:
Task T011: "Implement decline method in EventResponseClient"
Task T012: "Add rate limiting to decline"
Task T013: "Add retry logic to decline"
Task T014: "Add concurrency control to decline"
Task T015: "Add logging to decline"

# Developer B (simultaneously):
Task T016: "Write unit tests for decline method" [P]
Task T017: "Create respondToEvent handler for decline" [P]

# Developer C (after T011-T017):
Task T019: "Write integration test for decline" [P]
Task T020: "Test decline error scenarios" [P]
```

---

## Parallel Example: All User Stories

```bash
# After Foundational phase (T004-T010) completes, launch ALL stories in parallel:

# Team Member 1: User Story 1 (Decline)
Tasks T011-T021

# Team Member 2: User Story 2 (Accept) - simultaneously
Tasks T022-T032

# Team Member 3: User Story 3 (Tentative) - simultaneously
Tasks T033-T042
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T010) - CRITICAL - blocks all stories
3. Complete Phase 3: User Story 1 (T011-T021)
4. **STOP and VALIDATE**: Test User Story 1 (decline functionality) independently
5. Manual testing: Decline meetings during holiday period
6. Deploy/demo MVP with bulk decline capability

### Incremental Delivery

1. Complete Setup (T001-T003) + Foundational (T004-T010) → Foundation ready
2. Add User Story 1 (T011-T021) → Test independently → Deploy/Demo (MVP with decline!)
3. Add User Story 2 (T022-T032) → Test independently → Deploy/Demo (accept added)
4. Add User Story 3 (T033-T042) → Test independently → Deploy/Demo (tentative added)
5. Polish (T043-T058) → Final validation and documentation
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup (T001-T003) + Foundational (T004-T010) together
2. Once Foundational is done:
   - Developer A: User Story 1 (T011-T021) - Decline
   - Developer B: User Story 2 (T022-T032) - Accept
   - Developer C: User Story 3 (T033-T042) - Tentative
3. Stories complete and integrate independently
4. Team collaborates on Polish (T043-T058)

---

## Task Summary

### Total Tasks: 58

### By Phase:
- **Phase 1 (Setup)**: 3 tasks
- **Phase 2 (Foundational)**: 7 tasks
- **Phase 3 (User Story 1 - Decline)**: 11 tasks
- **Phase 4 (User Story 2 - Accept)**: 11 tasks
- **Phase 5 (User Story 3 - Tentative)**: 10 tasks
- **Phase 6 (Polish)**: 16 tasks

### By User Story:
- **User Story 1 (Decline)**: 11 tasks - Primary MVP focus
- **User Story 2 (Accept)**: 11 tasks - Secondary priority
- **User Story 3 (Tentative)**: 10 tasks - Lowest priority
- **Infrastructure**: 10 tasks (Setup + Foundational)
- **Cross-cutting**: 16 tasks (Polish)

### Parallelization:
- **Phase 1**: 3 parallel tasks possible
- **Phase 2**: 6 parallel tasks possible (after dependencies)
- **Phase 3**: 4 parallel tasks possible within story
- **Phase 4**: 4 parallel tasks possible within story
- **Phase 5**: 2 parallel tasks possible within story
- **Phase 6**: 3 parallel tasks possible
- **Across Stories**: All 3 user stories (32 tasks) can run in parallel after Foundational

### Independent Test Criteria:

**User Story 1**: Decline a meeting invitation with comment "Out of office", verify organizer receives notification and calendar shows "declined" status. Can be tested without accept or tentative functionality.

**User Story 2**: Accept a meeting invitation with comment "Looking forward to it", verify organizer receives notification and calendar shows "accepted" status. Can be tested without decline or tentative functionality.

**User Story 3**: Tentatively accept a meeting invitation with comment "May not be available", verify organizer receives notification and calendar shows "tentative" status. Can be tested without decline or accept functionality.

### Suggested MVP Scope

**MVP = Phase 1 + Phase 2 + Phase 3 (User Story 1 only)**
- Total: 21 tasks
- Delivers: Complete decline functionality with retry, rate limiting, concurrency control, and bulk operation support
- Value: Solves primary use case of declining holiday conflicts programmatically
- Independent: Fully testable and deployable without accept/tentative features

---

## Notes

- [P] tasks = different files, no dependencies, can run in parallel
- [Story] label (US1, US2, US3) maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- 80% test coverage required per jest.config.js
- All tests follow existing patterns in src/services/microsoft/__tests__/
- Integration tests use existing mock handler pattern from BaseAPIClient
- Structured logging follows pino format with operation, service, context fields
- Error handling uses error codes, not messages, for logic decisions
- Comment validation must check UTF-8 byte count, not character count
- Retry-After header takes priority over exponential backoff for rate limiting
- Resource locks are per event ID, not global
- All three response types share common infrastructure (RetryHandler, ResourceLock)
