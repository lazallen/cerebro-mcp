# Tasks: LocalFoundry LLM Integration

**Input**: Design documents from `/specs/011-localfoundry-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are included as this is a new service integration requiring validation of tool behavior, error handling, and dashboard functionality.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Single project structure:
- Source: `src/` at repository root
- Tests: `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and LocalFoundry service structure

- [X] T001 Create LocalFoundry service directory structure at src/services/localfoundry/
- [X] T002 [P] Create TypeScript interfaces file at src/services/localfoundry/types.ts with ChatMessage, ChatCompletionRequest, ChatCompletionResponse, LocalFoundryConfig interfaces per data-model.md
- [X] T003 [P] Create test directory structure at tests/unit/services/localfoundry/ and tests/integration/
- [X] T004 [P] Add LocalFoundry configuration variables to .env.example (LOCALFOUNDRY_ENDPOINT, LOCALFOUNDRY_MODEL, LOCALFOUNDRY_TIMEOUT)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core service infrastructure that MUST be complete before ANY user story tools can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Implement LocalFoundryClient HTTP client class in src/services/localfoundry/localfoundry-client.ts with chatCompletion() and healthCheck() methods per research.md
- [X] T006 Implement minimal LocalFoundryTokenStorage class in src/services/localfoundry/localfoundry-token-storage.ts (dummy implementation - no OAuth needed)
- [X] T007 Implement LocalFoundryService class in src/services/localfoundry/localfoundry-service.ts implementing BaseService interface with initialize(), getTools(), isAuthenticated(), shutdown() methods
- [X] T008 Add LocalFoundry configuration loading to src/common/config.ts with loadLocalFoundryConfig() function that reads environment variables
- [X] T009 Add conditional LocalFoundry service registration in src/mcp-server/service-registration.ts (only registers if LOCALFOUNDRY_ENDPOINT is configured)
- [X] T010 Add structured logging for LocalFoundry operations using pino logger in LocalFoundryService

**Checkpoint**: Foundation ready - user story tool implementation can now begin in parallel

---

## Phase 3: User Story 1 - Summarize Long Text (Priority: P1) 🎯 MVP

**Goal**: Provide `local.summarize` tool that accepts text input and returns concise summaries

**Independent Test**: Can be fully tested by configuring LocalFoundry endpoint, invoking the `local.summarize` tool with a long text input, and verifying a concise summary is returned within acceptable time limits.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T011 [P] [US1] Create unit test file at tests/unit/services/localfoundry/tools.test.ts for testing summarize tool handler with valid input, maxLength parameter, and input validation
- [X] T012 [P] [US1] Add LocalFoundryClient mock tests in tests/unit/services/localfoundry/localfoundry-client.test.ts for successful API request/response and error handling (network errors, timeouts, HTTP errors, malformed JSON)
- [X] T013 [P] [US1] Create integration test at tests/integration/localfoundry-integration.test.ts for end-to-end summarize tool invocation with mock HTTP server

### Implementation for User Story 1

- [X] T014 [US1] Implement summarize tool handler in LocalFoundryService.getTools() at src/services/localfoundry/localfoundry-service.ts with input schema validation (text: string required, maxLength: number optional default 300)
- [X] T015 [US1] Implement system prompt for summarization in summarize tool handler ("You are a text summarization assistant. Provide concise summaries highlighting key points.")
- [X] T016 [US1] Add error handling for summarize tool (endpoint unreachable, timeout, invalid response) with clear error messages per FR-018, FR-019
- [X] T017 [US1] Add input validation for summarize tool (non-empty text, reasonable maxLength, text length limit 50000 characters) per FR-010
- [X] T018 [US1] Add timeout handling for summarize tool (60 second default, configurable via LOCALFOUNDRY_TIMEOUT) per FR-011
- [X] T019 [US1] Add structured logging for summarize tool operations (invocation, success, errors) using pino logger

**Checkpoint**: At this point, User Story 1 (summarize tool) should be fully functional and testable independently

---

## Phase 4: User Story 2 - Clarify Ambiguous Content (Priority: P2)

**Goal**: Provide `local.clarify` tool that accepts text and a question, returning targeted answers

**Independent Test**: Can be tested by invoking `local.clarify` with text content and a specific question, then verifying the response directly answers the question based on the provided content.

### Tests for User Story 2

- [X] T020 [P] [US2] Add clarify tool unit tests in tests/unit/services/localfoundry/tools.test.ts for testing clarify tool handler with valid text+question, input validation, and unrelated question handling
- [X] T021 [P] [US2] Add clarify tool integration test in tests/integration/localfoundry-integration.test.ts for end-to-end Q&A workflow

### Implementation for User Story 2

- [ ] T022 [P] [US2] Implement clarify tool handler in LocalFoundryService.getTools() at src/services/localfoundry/localfoundry-service.ts with input schema validation (text: string required, question: string required)
- [X] T023 [US2] Implement system prompt for clarification in clarify tool handler ("You are a Q&A assistant. Answer questions based only on the provided text.")
- [X] T024 [US2] Add error handling for clarify tool (same error categories as summarize: endpoint unreachable, timeout, invalid response)
- [X] T025 [US2] Add input validation for clarify tool (non-empty text and question, reasonable length limits) per FR-010
- [X] T026 [US2] Add structured logging for clarify tool operations using pino logger

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Extract Structured Data (Priority: P3)

**Goal**: Provide `local.extract` tool that accepts text and schema description, returning structured JSON

**Independent Test**: Can be tested by invoking `local.extract` with text and a schema description, then verifying the response is valid JSON matching the requested schema.

### Tests for User Story 3

- [X] T027 [P] [US3] Add extract tool unit tests in tests/unit/services/localfoundry/tools.test.ts for testing extract tool handler with valid schema, JSON validation, invalid JSON handling, and parse errors
- [X] T028 [P] [US3] Add extract tool integration test in tests/integration/localfoundry-integration.test.ts for end-to-end extraction workflow with schema validation

### Implementation for User Story 3

- [ ] T029 [P] [US3] Implement extract tool handler in LocalFoundryService.getTools() at src/services/localfoundry/localfoundry-service.ts with input schema validation (text: string required, schema: string required)
- [X] T030 [US3] Implement system prompt for extraction in extract tool handler ("You are a data extraction assistant. Extract information matching the requested schema and return ONLY valid JSON.")
- [X] T031 [US3] Add JSON response validation in extract tool handler with JSON.parse() and error handling for malformed JSON per FR-021
- [X] T032 [US3] Add error handling for extract tool including specific handling for invalid JSON responses per FR-020, FR-021
- [X] T033 [US3] Add input validation for extract tool (non-empty text and schema, reasonable length limits) per FR-010
- [X] T034 [US3] Add structured logging for extract tool operations using pino logger

**Checkpoint**: All three core tools (summarize, clarify, extract) should now be independently functional

---

## Phase 6: User Story 4 - Monitor LocalFoundry Status (Priority: P2)

**Goal**: Display LocalFoundry status card on OAuth dashboard showing availability, endpoint URL, and model configuration

**Independent Test**: Can be tested by visiting the Cerebro dashboard at `localhost:3333` and verifying LocalFoundry status card displays current availability, endpoint URL, and model configuration.

### Tests for User Story 4

- [X] T035 [P] [US4] Add LocalFoundryService unit tests in tests/unit/services/localfoundry/localfoundry-service.test.ts for service initialization with valid/missing config, isAuthenticated() health check, and shutdown cleanup
- [X] T036 [P] [US4] Add dashboard integration test in tests/integration/localfoundry-integration.test.ts for verifying status card display with different states (available, unavailable, not_configured)

### Implementation for User Story 4

- [X] T037 [US4] Implement isAuthenticated() health check method in LocalFoundryService at src/services/localfoundry/localfoundry-service.ts using LocalFoundryClient.healthCheck()
- [X] T038 [US4] Add getServiceStatus() method to OAuth dashboard in src/auth-server/oauth-server.ts to check LocalFoundry availability and return ServiceStatus per data-model.md
- [X] T039 [US4] Add LocalFoundry status card rendering in dashboard HTML in src/auth-server/oauth-server.ts with status badge (Available/Unavailable/Not Configured), endpoint URL, and model name per FR-012, FR-013, FR-014, FR-015
- [X] T040 [US4] Ensure status card does NOT display authentication button per FR-016 (LocalFoundry requires no OAuth)
- [X] T041 [US4] Add status check logic that attempts actual connection per FR-017 (not just config check)
- [X] T042 [US4] Add error state handling in status card for different error types (connection refused, timeout, HTTP errors)
- [X] T043 [US4] Add structured logging for dashboard status checks using pino logger

**Checkpoint**: Dashboard status card should display LocalFoundry availability accurately

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final validation

- [ ] T044 [P] Verify all three tools are properly namespaced with `local.*` prefix per FR-009 (local.summarize, local.clarify, local.extract)
- [ ] T045 [P] Verify system starts successfully when LocalFoundry endpoint is unreachable or not configured per FR-005
- [ ] T046 [P] Verify system continues serving other MCP services when LocalFoundry is unavailable per FR-022
- [ ] T047 [P] Add comprehensive error message tests for all error scenarios (endpoint unreachable, timeout, HTTP 500, malformed JSON, invalid schema) per FR-018, FR-019, FR-020
- [ ] T048 [P] Verify timeout configuration via LOCALFOUNDRY_TIMEOUT environment variable per FR-025
- [ ] T049 [P] Verify model configuration via LOCALFOUNDRY_MODEL environment variable per FR-024
- [ ] T050 [P] Run quickstart.md validation scenarios for all tools and dashboard
- [ ] T051 [P] Verify concurrent tool request handling (multiple simultaneous invocations)
- [ ] T052 [P] Verify memory stability with repeated tool invocations (no leaks)
- [ ] T053 [P] Verify tool discoverability via MCP tool listing per SC-005
- [ ] T054 [P] Run `npm test` to verify 80% code coverage threshold is met
- [ ] T055 [P] Run `npm run lint` to verify TypeScript and ESLint compliance
- [ ] T056 [P] Update README.md or docs/ with LocalFoundry integration documentation (if needed)
- [ ] T057 Final integration test: Complete end-to-end workflow (configure → check dashboard → invoke all three tools → verify responses)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion (T001-T004) - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion (T005-T010)
  - User Story 1 (P1 - Summarize): Can start after Foundational - No dependencies on other stories
  - User Story 2 (P2 - Clarify): Can start after Foundational - No dependencies on other stories
  - User Story 3 (P3 - Extract): Can start after Foundational - No dependencies on other stories
  - User Story 4 (P2 - Dashboard): Can start after Foundational - No dependencies on other stories
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1 - Summarize)**: Independent - No dependencies on other stories
- **User Story 2 (P2 - Clarify)**: Independent - No dependencies on other stories
- **User Story 3 (P3 - Extract)**: Independent - No dependencies on other stories (builds on same client infrastructure)
- **User Story 4 (P2 - Dashboard)**: Independent - Uses service health check but doesn't require tools

All four user stories can be implemented and tested completely independently after the Foundational phase.

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Tool handler before system prompt and validation
- Core implementation before error handling
- Error handling before logging
- Story complete before moving to next priority

### Parallel Opportunities

**Setup Phase (Phase 1)**:
- T002 (types.ts), T003 (test directories), T004 (.env.example) can all run in parallel

**Foundational Phase (Phase 2)**:
- T005 (LocalFoundryClient) and T006 (TokenStorage) can run in parallel
- T010 (logging setup) can run in parallel with other tasks

**User Story 1 (Phase 3)**:
- T011 (tools.test.ts), T012 (client.test.ts), T013 (integration.test.ts) can all run in parallel

**User Story 2 (Phase 4)**:
- T020 (clarify tests), T021 (clarify integration) can run in parallel
- T022 (clarify handler) can start in parallel with other stories after T007

**User Story 3 (Phase 5)**:
- T027 (extract tests), T028 (extract integration) can run in parallel
- T029 (extract handler) can start in parallel with other stories after T007

**User Story 4 (Phase 6)**:
- T035 (service tests), T036 (dashboard tests) can run in parallel

**Polish Phase (Phase 7)**:
- T044-T056 (all verification tasks) can run in parallel
- T057 (final integration test) must run after all others

**Cross-Story Parallelism**:
Once Foundational (T005-T010) is complete, all four user stories (Phase 3, 4, 5, 6) can proceed in parallel by different developers or in sequence by priority.

---

## Parallel Example: After Foundational Complete

```bash
# All user story test files can be created in parallel:
Task T011: Create summarize tests in tests/unit/services/localfoundry/tools.test.ts
Task T020: Create clarify tests in tests/unit/services/localfoundry/tools.test.ts
Task T027: Create extract tests in tests/unit/services/localfoundry/tools.test.ts
Task T035: Create service tests in tests/unit/services/localfoundry/localfoundry-service.test.ts

# All user story tool handlers can be implemented in parallel (same file, different functions):
Task T014 [US1]: Implement summarize tool handler
Task T022 [US2]: Implement clarify tool handler
Task T029 [US3]: Implement extract tool handler

# Dashboard work can proceed in parallel with tool implementation:
Task T037 [US4]: Implement health check
Task T038 [US4]: Add status check to dashboard
```

---

## Implementation Strategy

### MVP First (User Story 1 Only - Summarize Tool)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T010) - CRITICAL - blocks all stories
3. Complete Phase 3: User Story 1 - Summarize (T011-T019)
4. **STOP and VALIDATE**: Test summarize tool independently with quickstart.md examples
5. Deploy/demo if ready - MVP delivers core value with single tool

This provides immediate value with the most common use case (summarization) working end-to-end.

### Incremental Delivery

1. Complete Setup (T001-T004) + Foundational (T005-T010) → Foundation ready
2. Add User Story 1 - Summarize (T011-T019) → Test independently → Deploy/Demo (MVP! 🎯)
3. Add User Story 4 - Dashboard (T035-T043) → Test independently → Deploy/Demo (Now users can see status)
4. Add User Story 2 - Clarify (T020-T026) → Test independently → Deploy/Demo (Q&A capability added)
5. Add User Story 3 - Extract (T027-T034) → Test independently → Deploy/Demo (Advanced extraction added)
6. Complete Polish (T044-T057) → Final validation → Production ready
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup (T001-T004) + Foundational (T005-T010) together
2. Once Foundational is done:
   - Developer A: User Story 1 - Summarize (T011-T019)
   - Developer B: User Story 4 - Dashboard (T035-T043)
   - Developer C: User Story 2 - Clarify (T020-T026)
   - Developer D: User Story 3 - Extract (T027-T034)
3. Stories complete and integrate independently
4. Team validates together with Polish phase (T044-T057)

---

## Task Summary

**Total Tasks**: 57

**By Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 6 tasks (BLOCKS all user stories)
- Phase 3 (US1 - Summarize): 9 tasks
- Phase 4 (US2 - Clarify): 7 tasks
- Phase 5 (US3 - Extract): 8 tasks
- Phase 6 (US4 - Dashboard): 9 tasks
- Phase 7 (Polish): 14 tasks

**By User Story**:
- US1 (P1 - Summarize): 9 tasks (T011-T019) - MVP target
- US2 (P2 - Clarify): 7 tasks (T020-T026)
- US3 (P3 - Extract): 8 tasks (T027-T034)
- US4 (P2 - Dashboard): 9 tasks (T035-T043)

**Parallel Opportunities**: 28 tasks marked [P] can run in parallel with other tasks in their phase

**Independent Test Criteria**:
- US1: Invoke `local.summarize` with long text, verify concise summary returned within timeout
- US2: Invoke `local.clarify` with text and question, verify targeted answer returned
- US3: Invoke `local.extract` with text and schema, verify valid JSON matching schema returned
- US4: Visit dashboard at localhost:3333, verify status card shows availability with endpoint/model info

**Suggested MVP Scope**:
- Phase 1 (Setup) + Phase 2 (Foundational) + Phase 3 (US1 - Summarize) = 19 tasks
- Delivers core value with summarization tool working end-to-end
- Add Phase 6 (US4 - Dashboard) for enhanced UX (9 more tasks) = 28 total for MVP+

---

## Notes

- [P] tasks = different files or independent logic, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- LocalFoundry service is simpler than OAuth services (no token refresh, no authentication flow)
- All tools share the same LocalFoundryClient and service infrastructure
- Error handling patterns are consistent across all three tools
- Dashboard status card is unique to LocalFoundry (no auth button required)
