# Tasks: Move Email to Folder

**Input**: Design documents from `/specs/014-move-email-folder/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included per constitution testing standards (80% coverage requirement)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths shown below follow cerebro-mcp structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Type definitions and shared infrastructure

- [x] T001 [P] Create TypeScript type definitions for move operations in src/types/email.ts
- [x] T002 [P] Create handler file structure in src/mcp-server/handlers/email-move-tools.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement folder resolution helper (reuse existing resolveFolderName and mapToWellKnownFolder from MicrosoftService)
- [x] T004 Implement email metadata fetch helper in src/mcp-server/handlers/email-move-tools.ts
- [x] T005 Implement idempotent check helper (compare current folder with target) in src/mcp-server/handlers/email-move-tools.ts
- [x] T006 Implement read status update helper in src/mcp-server/handlers/email-move-tools.ts
- [x] T007 Implement error formatting helper (balanced detail: ID + subject + folder) in src/mcp-server/handlers/email-move-tools.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Move Single Email to Target Folder (Priority: P1) 🎯 MVP

**Goal**: Enable users to move a single email from one folder to another with optional read status control

**Independent Test**: Provide an email ID and target folder name, verify email appears in destination folder and is marked as read by default

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T008 [P] [US1] Unit test for single email move success case in tests/unit/email-move-handlers.test.ts
- [ ] T009 [P] [US1] Unit test for invalid email ID error in tests/unit/email-move-handlers.test.ts
- [ ] T010 [P] [US1] Unit test for folder not found error in tests/unit/email-move-handlers.test.ts
- [ ] T011 [P] [US1] Unit test for idempotent move (already in folder) in tests/unit/email-move-handlers.test.ts
- [ ] T012 [P] [US1] Unit test for markAsRead=false preserving status in tests/unit/email-move-handlers.test.ts
- [ ] T013 [P] [US1] Integration test for single email move with real Graph API mock in tests/integration/microsoft-email-move.test.ts

### Implementation for User Story 1

- [x] T014 [US1] Implement moveEmail handler function in src/mcp-server/handlers/email-move-tools.ts
- [x] T015 [US1] Add input validation for moveEmail (emailId, folderPath) in src/mcp-server/handlers/email-move-tools.ts
- [x] T016 [US1] Implement Graph API move call (POST /me/messages/{id}/move) in src/mcp-server/handlers/email-move-tools.ts
- [x] T017 [US1] Add error handling with balanced detail messages in src/mcp-server/handlers/email-move-tools.ts
- [x] T018 [US1] Add structured logging for move operations in src/mcp-server/handlers/email-move-tools.ts
- [x] T019 [US1] Register move-email tool in MicrosoftService.getTools() in src/services/microsoft/microsoft-service.ts
- [x] T020 [US1] Add move-email service method binding in src/services/microsoft/microsoft-service.ts
- [ ] T021 [US1] Update microsoft-service.test.ts with move-email tool tests in src/services/microsoft/__tests__/microsoft-service.test.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Move Email to Nested Folder Path (Priority: P2)

**Goal**: Support moving emails to nested folder structures (e.g., "Projects/2026/Q1/Planning")

**Independent Test**: Specify a nested folder path and verify email is moved to the correct nested location

### Tests for User Story 2

- [ ] T022 [P] [US2] Unit test for nested folder path resolution in tests/unit/email-move-handlers.test.ts
- [ ] T023 [P] [US2] Unit test for deeply nested path (5 levels) in tests/unit/email-move-handlers.test.ts
- [ ] T024 [P] [US2] Unit test for nested path with missing intermediate folder in tests/unit/email-move-handlers.test.ts
- [ ] T025 [P] [US2] Integration test for nested folder move in tests/integration/microsoft-email-move.test.ts

### Implementation for User Story 2

- [ ] T026 [US2] Verify existing resolveFolderName handles nested paths (already implemented in 012-email-folder-filter)
- [ ] T027 [US2] Add nested path validation and error messages in src/mcp-server/handlers/email-move-tools.ts
- [ ] T028 [US2] Test move-email with nested folder paths using existing moveEmail handler
- [ ] T029 [US2] Update error messages to show full nested path on failure in src/mcp-server/handlers/email-move-tools.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Move Multiple Emails in Batch (Priority: P3)

**Goal**: Enable atomic batch moves where all emails move together or none move (transaction-style)

**Independent Test**: Provide multiple email IDs and target folder, verify all emails are moved correctly or none are moved on failure

### Tests for User Story 3

- [ ] T030 [P] [US3] Unit test for batch move success (all valid emails) in tests/unit/email-move-handlers.test.ts
- [ ] T031 [P] [US3] Unit test for batch validation failure (one invalid email) in tests/unit/email-move-handlers.test.ts
- [ ] T032 [P] [US3] Unit test for batch move failure with compensation in tests/unit/email-move-handlers.test.ts
- [ ] T033 [P] [US3] Unit test for batch with mixed idempotent moves in tests/unit/email-move-handlers.test.ts
- [ ] T034 [P] [US3] Unit test for compensation (rollback) success in tests/unit/email-move-handlers.test.ts
- [ ] T035 [P] [US3] Integration test for batch move atomic behavior in tests/integration/microsoft-email-move.test.ts

### Implementation for User Story 3

- [ ] T036 [US3] Create BatchMoveState tracking interface in src/types/email.ts
- [ ] T037 [US3] Implement moveEmailsBatch handler function in src/mcp-server/handlers/email-move-tools.ts
- [ ] T038 [US3] Implement batch validation phase (all emails + folder) in src/mcp-server/handlers/email-move-tools.ts
- [ ] T039 [US3] Implement sequential move execution with state tracking in src/mcp-server/handlers/email-move-tools.ts
- [ ] T040 [US3] Implement compensation logic (rollback on failure) in src/mcp-server/handlers/email-move-tools.ts
- [ ] T041 [US3] Add batch error reporting with validation details in src/mcp-server/handlers/email-move-tools.ts
- [ ] T042 [US3] Register move-emails-batch tool in MicrosoftService.getTools() in src/services/microsoft/microsoft-service.ts
- [ ] T043 [US3] Add move-emails-batch service method binding in src/services/microsoft/microsoft-service.ts
- [ ] T044 [US3] Update microsoft-service.test.ts with batch move tests in src/services/microsoft/__tests__/microsoft-service.test.ts

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and documentation

- [ ] T045 [P] Add move-email tool documentation to README.md (usage examples, parameters, response format)
- [ ] T046 [P] Add move-emails-batch tool documentation to README.md (atomic behavior, batch size recommendations)
- [ ] T047 [P] Add error handling examples to README.md (folder not found, email not found, permission denied)
- [ ] T048 [P] Add quickstart usage examples from quickstart.md to README.md
- [ ] T049 [P] Verify TypeScript compilation with npm run build
- [ ] T050 [P] Run ESLint and fix any linting errors with npm run lint
- [ ] T051 [P] Verify test coverage meets 80% threshold with npm run test:coverage
- [ ] T052 [P] Run integration tests with mocked Graph API responses
- [ ] T053 Code cleanup and refactoring for consistency
- [ ] T054 Validate quickstart.md examples work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Reuses US1 moveEmail handler, validates nested path handling
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Uses similar validation patterns as US1 but adds batch logic

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Helpers before handlers
- Handlers before tool registration
- Tool registration before service integration tests
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T002) can run in parallel
- All Foundational tasks marked [P] can run in parallel (none in this plan - sequential helpers)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel (T008-T013, T022-T025, T030-T035)
- All documentation tasks (T045-T048) can run in parallel
- All validation tasks (T049-T052) can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task T008: "Unit test for single email move success case in tests/unit/email-move-handlers.test.ts"
Task T009: "Unit test for invalid email ID error in tests/unit/email-move-handlers.test.ts"
Task T010: "Unit test for folder not found error in tests/unit/email-move-handlers.test.ts"
Task T011: "Unit test for idempotent move (already in folder) in tests/unit/email-move-handlers.test.ts"
Task T012: "Unit test for markAsRead=false preserving status in tests/unit/email-move-handlers.test.ts"
Task T013: "Integration test for single email move with real Graph API mock in tests/integration/microsoft-email-move.test.ts"

# Then launch implementation tasks sequentially (T014-T021)
```

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together:
Task T022: "Unit test for nested folder path resolution in tests/unit/email-move-handlers.test.ts"
Task T023: "Unit test for deeply nested path (5 levels) in tests/unit/email-move-handlers.test.ts"
Task T024: "Unit test for nested path with missing intermediate folder in tests/unit/email-move-handlers.test.ts"
Task T025: "Integration test for nested folder move in tests/integration/microsoft-email-move.test.ts"

# Then launch implementation tasks sequentially (T026-T029)
```

## Parallel Example: User Story 3

```bash
# Launch all tests for User Story 3 together:
Task T030: "Unit test for batch move success (all valid emails) in tests/unit/email-move-handlers.test.ts"
Task T031: "Unit test for batch validation failure (one invalid email) in tests/unit/email-move-handlers.test.ts"
Task T032: "Unit test for batch move failure with compensation in tests/unit/email-move-handlers.test.ts"
Task T033: "Unit test for batch with mixed idempotent moves in tests/unit/email-move-handlers.test.ts"
Task T034: "Unit test for compensation (rollback) success in tests/unit/email-move-handlers.test.ts"
Task T035: "Integration test for batch move atomic behavior in tests/integration/microsoft-email-move.test.ts"

# Then launch implementation tasks sequentially (T036-T044)
```

## Parallel Example: Documentation

```bash
# Launch all documentation tasks together:
Task T045: "Add move-email tool documentation to README.md"
Task T046: "Add move-emails-batch tool documentation to README.md"
Task T047: "Add error handling examples to README.md"
Task T048: "Add quickstart usage examples from quickstart.md to README.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T007) - CRITICAL
3. Complete Phase 3: User Story 1 (T008-T021)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Complete Phase 6: Documentation for US1 (T045, T047-T049)
6. Deploy/demo if ready

**MVP Deliverable**: Single email move tool with idempotent behavior and read status control

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (nested paths)
4. Add User Story 3 → Test independently → Deploy/Demo (batch operations)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (T001-T007)
2. Once Foundational is done:
   - Developer A: User Story 1 (T008-T021)
   - Developer B: User Story 2 (T022-T029) - can start in parallel if staffed
   - Developer C: User Story 3 (T030-T044) - can start in parallel if staffed
3. Stories complete and integrate independently
4. Team completes Polish phase together (T045-T054)

---

## Task Summary

**Total Tasks**: 54

**Tasks by Phase**:
- Phase 1 (Setup): 2 tasks
- Phase 2 (Foundational): 5 tasks
- Phase 3 (User Story 1): 14 tasks (6 tests + 8 implementation)
- Phase 4 (User Story 2): 8 tasks (4 tests + 4 implementation)
- Phase 5 (User Story 3): 15 tasks (6 tests + 9 implementation)
- Phase 6 (Polish): 10 tasks

**Parallel Opportunities**: 32 tasks can run in parallel (marked with [P])
- Setup: 2 parallel
- US1 tests: 6 parallel
- US2 tests: 4 parallel
- US3 tests: 6 parallel
- Documentation: 4 parallel
- Validation: 4 parallel
- Plus 6 more polish tasks

**Independent Test Criteria**:
- US1: Move single email to folder, verify in destination with read status
- US2: Move email to nested folder path, verify correct nested location
- US3: Batch move multiple emails atomically, verify all-or-nothing behavior

**Suggested MVP Scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1 only) = 21 tasks

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Constitution requires 80% test coverage - all test tasks are mandatory
- Reuses existing folder resolution from feature 012-email-folder-filter
- Extends existing MicrosoftService without new dependencies
