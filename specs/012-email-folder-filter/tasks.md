# Tasks: Email Folder Filtering for List-Emails

**Input**: Design documents from `/specs/012-email-folder-filter/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit and integration tests are included as per Constitution III (Testing Standards).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Single project structure: `src/` and `tests/` at repository root
- Test files follow naming convention: `*.test.ts` for unit tests

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure build environment and testing infrastructure are ready

- [x] T001 Verify TypeScript 5.3.3 configuration and build setup in tsconfig.json and tsconfig.build.json
- [x] T002 Verify Jest testing configuration for 80% coverage threshold in jest.config.js
- [x] T003 [P] Verify ESLint and Prettier configurations are functional

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Review existing Microsoft Graph API client in src/services/microsoft/api-client.ts to understand request patterns
- [x] T005 Review existing list-emails tool implementation in src/services/microsoft/microsoft-service.ts (lines 389-406)
- [x] T006 Review existing error handling patterns in src/mcp-server/error-mapper.ts
- [x] T007 Review Microsoft Graph folder API documentation from specs/012-email-folder-filter/research.md

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Default Inbox-Only Email Listing (Priority: P1) 🎯 MVP

**Goal**: Make list-emails return only inbox emails by default, eliminating spam from email triage results

**Independent Test**: Call list-emails without folder parameter and verify only inbox emails are returned (no spam, junk, or other folder emails appear)

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T008 [P] [US1] Add unit test for default inbox filtering in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T009 [P] [US1] Add unit test for inbox parameter explicitly set in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T010 [P] [US1] Add unit test for case-insensitive "Inbox" parameter in src/services/microsoft/__tests__/microsoft-service.test.ts

### Implementation for User Story 1

- [x] T011 [US1] Add folder parameter to list-emails tool schema with default "inbox" in src/services/microsoft/microsoft-service.ts (lines 76-90)
- [x] T012 [US1] Create helper function to map user-friendly folder names to Microsoft Graph well-known names in src/services/microsoft/microsoft-service.ts
- [x] T013 [US1] Update listEmails method to extract and normalize folder parameter in src/services/microsoft/microsoft-service.ts (line 389)
- [x] T014 [US1] Implement endpoint selection logic (inbox → /me/mailFolders/inbox/messages) in src/services/microsoft/microsoft-service.ts (line 392)
- [x] T015 [US1] Add JSDoc documentation for folder parameter and default behavior in src/services/microsoft/microsoft-service.ts
- [x] T016 [US1] Verify response format unchanged (FR-007) - test with inbox folder filtering in src/services/microsoft/__tests__/microsoft-service.test.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Default behavior now returns inbox-only emails.

---

## Phase 4: User Story 2 - Explicit Folder Selection (Priority: P2)

**Goal**: Allow users to optionally specify which folder to retrieve emails from (spam, junk, sent, drafts)

**Independent Test**: Call list-emails with folder="spam" and verify only spam folder emails are returned, then test with sent, drafts, etc.

### Tests for User Story 2

- [x] T017 [P] [US2] Add unit test for folder="spam" parameter in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T018 [P] [US2] Add unit test for folder="junk" parameter (maps to junkemail) in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T019 [P] [US2] Add unit test for folder="sent" parameter (maps to sentitems) in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T020 [P] [US2] Add unit test for folder="drafts" parameter in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T021 [P] [US2] Add unit test for folder="trash" parameter (maps to deleteditems) in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T022 [P] [US2] Add unit test for folder="deleted" parameter (maps to deleteditems) in src/services/microsoft/__tests__/microsoft-service.test.ts

### Implementation for User Story 2

- [x] T023 [US2] Extend folder mapping to include spam→junkemail, junk→junkemail in src/services/microsoft/microsoft-service.ts
- [x] T024 [US2] Extend folder mapping to include sent→sentitems in src/services/microsoft/microsoft-service.ts
- [x] T025 [US2] Extend folder mapping to include trash→deleteditems, deleted→deleteditems in src/services/microsoft/microsoft-service.ts
- [x] T026 [US2] Update endpoint selection logic to handle all folder types in src/services/microsoft/microsoft-service.ts
- [x] T027 [US2] Verify pagination preserved (FR-009) across all folder types in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T028 [US2] Verify sorting preserved (FR-009) across all folder types in src/services/microsoft/__tests__/microsoft-service.test.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Users can request inbox or any specific folder.

---

## Phase 5: User Story 3 - All Folders Email Listing (Priority: P3)

**Goal**: Maintain backward compatibility by allowing cross-folder search with folder="all"

**Independent Test**: Call list-emails with folder="all" and verify emails from all folders are returned (inbox, spam, sent, drafts, etc.)

### Tests for User Story 3

- [x] T029 [P] [US3] Add unit test for folder="all" parameter returning all folders in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T030 [P] [US3] Add unit test for folder="ALL" (uppercase) in src/services/microsoft/__tests__/microsoft-service.test.ts

### Implementation for User Story 3

- [x] T031 [US3] Add "all" special case handling to endpoint selection (uses /me/messages) in src/services/microsoft/microsoft-service.ts
- [x] T032 [US3] Verify "all" returns emails from multiple folders in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T033 [US3] Document backward compatibility: folder="all" provides old behavior in src/services/microsoft/microsoft-service.ts JSDoc

**Checkpoint**: All user stories should now be independently functional. Users have inbox default, specific folder selection, and cross-folder search.

---

## Phase 6: Edge Cases & Error Handling

**Purpose**: Handle invalid input and error scenarios (FR-005, FR-008)

### Tests for Edge Cases

- [x] T034 [P] Add unit test for invalid folder name (e.g., "archive") in src/services/microsoft/__tests__/microsoft-service.test.ts
- [ ] T035 [P] Add unit test for empty folder (valid folder with zero emails) in src/services/microsoft/__tests__/microsoft-service.test.ts
- [x] T036 [P] Add unit test for whitespace-trimmed folder name in src/services/microsoft/__tests__/microsoft-service.test.ts
- [ ] T037 [P] Add unit test for Microsoft Graph 404 error handling in src/services/microsoft/__tests__/microsoft-service.test.ts
- [ ] T038 [P] Add unit test for Microsoft Graph 403 permission error in src/services/microsoft/__tests__/microsoft-service.test.ts

### Implementation for Edge Cases

- [x] T039 Implement client-side folder validation with supported folder list in src/services/microsoft/microsoft-service.ts
- [x] T040 Add clear error message for invalid folder names (FR-005) in src/services/microsoft/microsoft-service.ts
- [x] T041 Add whitespace trimming for folder parameter in src/services/microsoft/microsoft-service.ts
- [ ] T042 Implement Microsoft Graph error mapping for folder not found (404) in src/services/microsoft/microsoft-service.ts
- [ ] T043 Implement Microsoft Graph error mapping for access denied (403) in src/services/microsoft/microsoft-service.ts
- [ ] T044 Verify empty folder returns {emails: [], count: 0} not error in src/services/microsoft/__tests__/microsoft-service.test.ts

**Checkpoint**: All error scenarios handled gracefully with user-friendly messages

---

## Phase 7: Documentation & Polish

**Purpose**: Ensure feature is fully documented and production-ready

- [x] T045 [P] Update README.md to document folder parameter in list-emails tool section
- [x] T046 [P] Add usage examples for inbox, spam, sent, drafts, all folders in README.md
- [x] T047 [P] Document folder name mapping (spam→junkemail, sent→sentitems) in README.md
- [x] T048 [P] Document backward compatibility (default changed, use folder="all" for old behavior) in README.md
- [x] T049 [P] Add JSDoc comments for all new functions and parameters in src/services/microsoft/microsoft-service.ts
- [ ] T050 Run full test suite and verify 80% coverage threshold: npm test
- [x] T051 Run TypeScript type check: npm run type-check
- [ ] T052 Run ESLint: npm run lint
- [x] T053 Run build: npm run build
- [ ] T054 Verify quickstart.md scenarios manually (optional, for validation)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User Story 1 (P1) - Default Inbox Filtering: Independent after Phase 2
  - User Story 2 (P2) - Explicit Folder Selection: Independent after Phase 2, builds on US1 code
  - User Story 3 (P3) - All Folders Listing: Independent after Phase 2, builds on US1/US2 code
- **Edge Cases (Phase 6)**: Depends on User Stories 1-3 being implemented
- **Documentation (Phase 7)**: Depends on all implementation phases being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories - **THIS IS THE MVP**
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Extends US1 folder mapping - Independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Adds "all" special case - Independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation (T008-T010 before T011-T016)
- Helper functions before main implementation (T012 before T013-T014)
- Core implementation before verification (T011-T014 before T015-T016)
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T003) marked [P] can run in parallel
- All Foundational review tasks (T004-T007) can run in parallel within Phase 2
- Once Foundational phase completes, user stories CAN be worked on in parallel (if team capacity allows):
  - One developer on US1 (T008-T016)
  - Another developer on US2 (T017-T028)
  - Another developer on US3 (T029-T033)
- All tests for a user story marked [P] can be written in parallel
- All edge case tests (T034-T038) can be written in parallel
- All documentation tasks (T045-T049) can be done in parallel

---

## Parallel Example: User Story 1

```bash
# Write all tests for User Story 1 in parallel:
Task: "Add unit test for default inbox filtering in src/services/microsoft/__tests__/microsoft-service.test.ts"
Task: "Add unit test for inbox parameter explicitly set in src/services/microsoft/__tests__/microsoft-service.test.ts"
Task: "Add unit test for case-insensitive Inbox parameter in src/services/microsoft/__tests__/microsoft-service.test.ts"

# All tests should fail initially (TDD approach)
```

## Parallel Example: User Story 2

```bash
# Write all folder-specific tests in parallel:
Task: "Add unit test for folder=spam parameter"
Task: "Add unit test for folder=junk parameter"
Task: "Add unit test for folder=sent parameter"
Task: "Add unit test for folder=drafts parameter"
Task: "Add unit test for folder=trash parameter"
Task: "Add unit test for folder=deleted parameter"
```

## Parallel Example: Edge Cases

```bash
# Write all edge case tests in parallel:
Task: "Add unit test for invalid folder name"
Task: "Add unit test for empty folder"
Task: "Add unit test for whitespace-trimmed folder name"
Task: "Add unit test for Microsoft Graph 404 error"
Task: "Add unit test for Microsoft Graph 403 permission error"
```

## Parallel Example: Documentation

```bash
# Write all documentation in parallel:
Task: "Update README.md folder parameter section"
Task: "Add usage examples for all folders"
Task: "Document folder name mapping"
Task: "Document backward compatibility"
Task: "Add JSDoc comments"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T007) - CRITICAL checkpoint
3. Complete Phase 3: User Story 1 (T008-T016)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Run npm test, npm run build, npm run lint
6. Deploy/demo if ready - **THIS IS A COMPLETE MVP**

**MVP Scope**: 16 tasks total (T001-T016)
- Delivers core value: inbox-only filtering, eliminates spam from triage
- Independently testable and deployable
- Solves primary user problem (spec SC-001: zero spam in default results)

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready (T001-T007: 7 tasks)
2. Add User Story 1 → Test independently → Deploy/Demo (T008-T016: 9 tasks) **MVP COMPLETE**
3. Add User Story 2 → Test independently → Deploy/Demo (T017-T028: 12 tasks)
4. Add User Story 3 → Test independently → Deploy/Demo (T029-T033: 5 tasks)
5. Add Edge Cases → Test error scenarios → Deploy/Demo (T034-T044: 11 tasks)
6. Add Documentation → Production ready → Deploy/Demo (T045-T054: 10 tasks)

Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (T001-T007)
2. Once Foundational is done:
   - Developer A: User Story 1 (T008-T016) - MVP priority
   - Developer B: User Story 2 (T017-T028) - Can start in parallel
   - Developer C: User Story 3 (T029-T033) - Can start in parallel
3. Developer A: Edge Cases (T034-T044) - After US1-3 complete
4. All developers: Documentation (T045-T054) - Can parallelize

**With single developer** (recommended order):
1. Setup (T001-T003)
2. Foundational (T004-T007)
3. User Story 1 (T008-T016) - **VALIDATE MVP HERE**
4. User Story 2 (T017-T028)
5. User Story 3 (T029-T033)
6. Edge Cases (T034-T044)
7. Documentation (T045-T054)

---

## Task Summary

**Total Tasks**: 54 tasks

**Breakdown by Phase**:
- Phase 1 (Setup): 3 tasks
- Phase 2 (Foundational): 4 tasks
- Phase 3 (User Story 1 - P1): 9 tasks (3 tests + 6 implementation)
- Phase 4 (User Story 2 - P2): 12 tasks (6 tests + 6 implementation)
- Phase 5 (User Story 3 - P3): 5 tasks (2 tests + 3 implementation)
- Phase 6 (Edge Cases): 11 tasks (5 tests + 6 implementation)
- Phase 7 (Documentation): 10 tasks

**Parallelizable Tasks**: 30 tasks marked [P] (56% of total)

**MVP Scope** (User Story 1 only): 16 tasks
- Estimated effort: 2-4 hours for experienced developer
- Delivers: Inbox-only default filtering (core user value)
- Success criteria: SC-001 achieved (zero spam in default results)

**Full Feature Scope**: 54 tasks
- Estimated effort: 6-10 hours for experienced developer
- Delivers: Complete folder filtering with all folders, edge cases, documentation
- Success criteria: All SC-001 through SC-006 achieved

**Files Modified**: 2 files
1. src/services/microsoft/microsoft-service.ts (main implementation)
2. src/services/microsoft/__tests__/microsoft-service.test.ts (unit tests)

**Files Documented**: 1 file
1. README.md (user-facing documentation)

**No New Files Created** (modification-only feature)

---

## Notes

- [P] tasks = different files or independent operations, no blocking dependencies
- [Story] label maps task to specific user story for traceability (US1, US2, US3)
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD approach recommended)
- Commit after each logical task group or user story completion
- Stop at any checkpoint to validate story independently
- Constitution compliance: All tasks align with Testing Standards (80% coverage), Documentation-First (README, JSDoc), and MCP Tool Design (schema, errors)

## Success Validation

After completing each user story, validate:

**User Story 1 Validation**:
- [ ] list-emails() with no params returns only inbox emails
- [ ] list-emails() with no params excludes spam/junk
- [ ] Tests pass for default inbox behavior

**User Story 2 Validation**:
- [ ] list-emails({folder: "spam"}) returns only spam emails
- [ ] list-emails({folder: "sent"}) returns only sent emails
- [ ] All folder types work correctly

**User Story 3 Validation**:
- [ ] list-emails({folder: "all"}) returns emails from all folders
- [ ] Backward compatibility maintained

**Edge Cases Validation**:
- [ ] Invalid folder name returns clear error message
- [ ] Empty folder returns {emails: [], count: 0}
- [ ] Case-insensitive folder names work

**Final Validation**:
- [ ] npm test passes with 80% coverage
- [ ] npm run build succeeds
- [ ] npm run lint passes
- [ ] README.md updated and clear
- [ ] All success criteria (SC-001 through SC-006) met
