# Tasks: Meeting Room Booking for Calendar Triage

**Input**: Design documents from `/specs/016-meeting-room-booking/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are included per plan.md testing standards (80% coverage threshold)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and configuration for room booking feature

- [X] T001 Update package.json dependencies if needed (verify @modelcontextprotocol/sdk ^1.25.3)
- [X] T002 [P] Add Place.Read.All scope to Microsoft OAuth configuration in .env.example
- [X] T003 [P] Update README.md with room booking feature overview and prerequisites section

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Create MeetingRoom interface in src/types/room.ts with all properties per data-model.md
- [X] T005 [P] Create RoomAvailability interface in src/types/room.ts with availability view parsing
- [X] T006 [P] Create RoomBookingRequest interface in src/types/room.ts
- [X] T007 [P] Create RoomSearchCriteria interface in src/types/room.ts
- [X] T008 [P] Create OfficeLocation type in src/types/room.ts
- [X] T009 [P] Create RoomConflict interface in src/types/room.ts
- [X] T010 Export all room types from src/types/index.ts
- [X] T011 [P] Implement calculateRequiredCapacity function in src/common/capacity-calculator.ts with 20% buffer rounded up (FR-027)
- [X] T012 [P] Create validation functions in src/types/room.ts (isValidRoomEmail, isValidCapacity, isValidTimeRange, isValidBuilding)
- [X] T013 [P] Add unit tests for capacity-calculator.ts in src/common/__tests__/capacity-calculator.test.ts
- [X] T014 [P] Add unit tests for room type validators in src/types/__tests__/room-validators.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Automatic Room Booking During Calendar Triage (Priority: P1) 🎯 MVP

**Goal**: Enable automatic room discovery, availability checking, and booking integrated with calendar-triage workflow

**Independent Test**: Create test calendar with office location event and meetings with "Office" category. Run tools manually to verify: list rooms → check availability → book room → verify in calendar.

### Implementation for User Story 1

- [X] T015 [P] [US1] Implement searchRooms method in src/services/microsoft/room-booking-client.ts with OData filter construction (FR-001-004)
- [X] T016 [P] [US1] Implement checkRoomAvailability method in src/services/microsoft/room-booking-client.ts using getSchedule API (FR-005-007)
- [X] T017 [US1] Implement bookRoom method in src/services/microsoft/room-booking-client.ts with GET-then-PATCH atomic pattern (FR-008-010)
- [X] T018 [US1] Add permission error handling in room-booking-client.ts for Place.Read.All (FR-007a, FR-007b)
- [X] T019 [US1] Add availability verification in bookRoom method to block conflicts (FR-014a)
- [X] T020 [US1] Add alternative room suggestion logic when conflicts detected (FR-014b)
- [X] T021 [US1] Add duplicate booking prevention in bookRoom method (FR-013)
- [X] T022 [P] [US1] Implement listMeetingRooms handler in src/mcp-server/handlers/room-booking-tools.ts per contract list-meeting-rooms.json
- [X] T023 [P] [US1] Implement checkRoomAvailability handler in src/mcp-server/handlers/room-booking-tools.ts per contract check-room-availability.json
- [X] T024 [P] [US1] Implement bookMeetingRoom handler in src/mcp-server/handlers/room-booking-tools.ts per contract book-meeting-room.json
- [X] T025 [US1] Register list-meeting-rooms tool in src/services/microsoft/microsoft-service.ts getTools() method
- [X] T026 [US1] Register check-room-availability tool in src/services/microsoft/microsoft-service.ts getTools() method
- [X] T027 [US1] Register book-meeting-room tool in src/services/microsoft/microsoft-service.ts getTools() method
- [X] T028 [US1] Add listMeetingRooms method to MicrosoftApiClient in src/services/microsoft/api-client.ts
- [X] T029 [US1] Add getSchedule method to MicrosoftApiClient in src/services/microsoft/api-client.ts
- [X] T030 [P] [US1] Write unit tests for searchRooms in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T031 [P] [US1] Write unit tests for checkRoomAvailability in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T032 [P] [US1] Write unit tests for bookRoom in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T033 [US1] Write integration test for list→check→book flow in tests/integration/room-booking-integration.test.ts
- [X] T034 [US1] Implement office location detection logic (FR-015, FR-016, FR-017) in room-booking-client.ts
- [X] T035 [US1] Implement category-based meeting filter (FR-022, FR-022a) in room-booking-client.ts
- [X] T036 [US1] Implement room selection logic with capacity buffer (FR-026, FR-027) in room-booking-client.ts
- [X] T037 [US1] Implement video equipment prioritization (FR-028) in room-booking-client.ts
- [X] T038 [US1] Add logging for all room booking operations using pino logger
- [X] T039 [US1] Update README.md with automatic room booking workflow documentation and examples

**Checkpoint**: At this point, User Story 1 (automatic calendar-triage booking) should be fully functional and testable independently

---

## Phase 4: User Story 2 - Manual Room Lookup and Booking (Priority: P2)

**Goal**: Enable ad-hoc room search and booking outside calendar-triage workflow

**Independent Test**: Invoke list-meeting-rooms tool with specific filters (building, capacity). Verify results. Then invoke book-meeting-room with an event ID. Verify room is added to event in calendar.

### Implementation for User Story 2

- [X] T040 [US2] Enhance searchRooms method in src/services/microsoft/room-booking-client.ts with floor number filtering (FR-003)
- [X] T041 [US2] Enhance searchRooms method with amenity tag filtering (FR-004)
- [X] T042 [US2] Enhance searchRooms method with wheelchair accessibility filtering (FR-004)
- [X] T043 [US2] Add batch room availability checking (up to 20 rooms) in checkRoomAvailability method (FR-007)
- [X] T044 [US2] Add conflict details extraction from getSchedule response in checkRoomAvailability method
- [X] T045 [US2] Add user confirmation prompt handling in bookMeetingRoom handler (FR-024, FR-025)
- [X] T046 [P] [US2] Write unit tests for floor/amenity/accessibility filters in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T047 [P] [US2] Write unit tests for batch availability checking in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T048 [US2] Write integration test for manual search and booking flow in tests/integration/room-booking-integration.test.ts
- [X] T049 [US2] Update README.md with manual room booking examples (search by criteria, book specific room)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Room Removal and Rebooking (Priority: P3)

**Goal**: Enable removing room bookings when meetings become virtual or plans change

**Independent Test**: Create a meeting with a room booked. Invoke remove-meeting-room tool. Verify room is removed from attendees and location is cleared in calendar.

### Implementation for User Story 3

- [X] T050 [P] [US3] Implement removeRoom method in src/services/microsoft/room-booking-client.ts with GET-then-PATCH pattern (FR-011, FR-012)
- [X] T051 [P] [US3] Implement removeMeetingRoom handler in src/mcp-server/handlers/room-booking-tools.ts per contract remove-meeting-room.json
- [X] T052 [US3] Register remove-meeting-room tool in src/services/microsoft/microsoft-service.ts getTools() method
- [X] T053 [US3] Add location field clearing logic in removeRoom method when clearLocation=true (FR-012)
- [X] T054 [US3] Add virtual meeting link preservation in removeRoom method (ensure Teams/Zoom links remain)
- [X] T055 [US3] Add room-not-found error handling in removeRoom method
- [X] T056 [P] [US3] Write unit tests for removeRoom in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T057 [US3] Write integration test for remove and rebook flow in tests/integration/room-booking-integration.test.ts
- [X] T058 [US3] Update README.md with room removal examples (virtual-only meetings, rebooking)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T059 [P] Add comprehensive error handling for all Graph API error codes in src/services/microsoft/room-booking-client.ts
- [X] T060 [P] Implement retry logic with exponential backoff for 429/503/504 errors in room-booking-client.ts
- [X] T061 [P] Add Retry-After header handling for rate limiting in room-booking-client.ts
- [X] T062 [P] Add input validation for all tool handlers in room-booking-tools.ts
- [X] T063 [P] Add permission check health check for Place.Read.All in src/mcp-server/health-check.ts
- [X] T064 [P] Add performance monitoring for room booking operations (log timing metrics)
- [X] T065 [P] Write unit tests for error handling scenarios in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T066 [P] Write unit tests for retry logic in src/services/microsoft/__tests__/room-booking-client.test.ts
- [X] T067 [P] Update CLAUDE.md with room booking context (already done by update-agent-context.sh)
- [X] T068 [P] Add quickstart.md examples to README.md troubleshooting section
- [X] T069 Run linting (npm run lint) and fix any issues
- [X] T070 Run type checking (npm run type-check) and fix any type errors
- [X] T071 Run test coverage (npm test -- --coverage) and verify ≥80% for new code
- [X] T072 Run build (npm run build) and verify clean dist/ output
- [X] T073 Validate quickstart.md examples manually with test Microsoft account

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Enhances US1 but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Complements US1/US2 but independently testable

### Within Each User Story

- Client methods before handlers
- API client extensions before client methods
- Tool registration after handler implementation
- Unit tests can run in parallel with implementation (TDD approach)
- Integration tests after all components complete
- Documentation updates after feature complete

### Parallel Opportunities

**Phase 1 (Setup)**:
- T002, T003 can run in parallel

**Phase 2 (Foundational)**:
- T004-T009 (all type definitions) can run in parallel
- T011-T012 (utilities and validators) can run in parallel
- T013-T014 (tests) can run in parallel

**Phase 3 (User Story 1)**:
- T015-T016 (searchRooms, checkRoomAvailability) can run in parallel initially
- T022-T024 (all handlers) can run in parallel after client methods done
- T030-T032 (unit tests) can run in parallel

**Phase 4 (User Story 2)**:
- T040-T042 (filter enhancements) can run in parallel
- T046-T047 (tests) can run in parallel

**Phase 5 (User Story 3)**:
- T050-T051 (removeRoom method and handler) can run in parallel

**Phase 6 (Polish)**:
- T059-T066 (error handling, retries, validation, monitoring, tests) can all run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all type definitions together (Phase 2):
Task: "Create MeetingRoom interface in src/types/room.ts"
Task: "Create RoomAvailability interface in src/types/room.ts"
Task: "Create RoomBookingRequest interface in src/types/room.ts"
Task: "Create RoomSearchCriteria interface in src/types/room.ts"
Task: "Create OfficeLocation type in src/types/room.ts"

# Launch client core methods together (Phase 3):
Task: "Implement searchRooms method in room-booking-client.ts"
Task: "Implement checkRoomAvailability method in room-booking-client.ts"

# Launch all tool handlers together (Phase 3):
Task: "Implement listMeetingRooms handler in room-booking-tools.ts"
Task: "Implement checkRoomAvailability handler in room-booking-tools.ts"
Task: "Implement bookMeetingRoom handler in room-booking-tools.ts"

# Launch all unit tests together (Phase 3):
Task: "Write unit tests for searchRooms"
Task: "Write unit tests for checkRoomAvailability"
Task: "Write unit tests for bookRoom"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T014) - CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T015-T039)
4. **STOP and VALIDATE**: Test User Story 1 independently using quickstart.md examples
5. Deploy/demo if ready (automatic room booking during calendar-triage)

### Incremental Delivery

1. Complete Setup (Phase 1) + Foundational (Phase 2) → Foundation ready
2. Add User Story 1 (Phase 3) → Test independently → Deploy/Demo (MVP: automatic booking)
3. Add User Story 2 (Phase 4) → Test independently → Deploy/Demo (adds manual search/book)
4. Add User Story 3 (Phase 5) → Test independently → Deploy/Demo (adds room removal)
5. Add Polish (Phase 6) → Final testing → Production ready
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup (Phase 1) + Foundational (Phase 2) together
2. Once Foundational is done:
   - Developer A: User Story 1 (automatic booking) - Most critical
   - Developer B: User Story 2 (manual search/book) - Independent
   - Developer C: User Story 3 (room removal) - Independent
3. Stories complete and integrate independently
4. Team completes Polish (Phase 6) together

---

## Task Summary

**Total Tasks**: 73
- **Setup (Phase 1)**: 3 tasks
- **Foundational (Phase 2)**: 11 tasks (BLOCKING)
- **User Story 1 (Phase 3)**: 25 tasks (MVP)
- **User Story 2 (Phase 4)**: 10 tasks
- **User Story 3 (Phase 5)**: 9 tasks
- **Polish (Phase 6)**: 15 tasks

**Parallel Opportunities**: 32 tasks marked [P] (43.8%)

**User Story Breakdown**:
- US1: 25 tasks (automatic calendar-triage booking)
- US2: 10 tasks (manual room lookup and booking)
- US3: 9 tasks (room removal and rebooking)
- Shared: 29 tasks (setup, foundational, polish)

**Suggested MVP Scope**: Phases 1-3 (39 tasks total for US1 only)

**Independent Test Criteria**:
- **US1**: Create test calendar, run tools, verify automatic suggestions in triage
- **US2**: Directly invoke list/check/book tools, verify results
- **US3**: Create booked meeting, invoke remove tool, verify removal

---

## Notes

- [P] tasks = different files, no dependencies - can run in parallel
- [Story] label maps task to specific user story for traceability (US1, US2, US3)
- Each user story should be independently completable and testable
- Tests follow TDD approach where practical (write test, see it fail, implement, see it pass)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- 80% test coverage threshold must be maintained (per plan.md)
- All types must follow TypeScript strict mode
- Follow existing patterns: room-booking-client similar to onenote-client, event-response-client
- Use pino logger with structured data (operation, service, context fields)
- Error messages must be user-friendly and actionable (FR-007a, FR-007b)
