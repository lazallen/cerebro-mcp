# Tasks: Scheduled Task Heartbeat System

**Input**: Design documents from `/specs/017-task-heartbeat/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are included per constitution requirement (80% coverage threshold)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- All paths are absolute from repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [ ] T001 Install npm dependencies: node-cron@^3.0.3, chokidar@^4.0.3, proper-lockfile@^4.1.2
- [ ] T002 Install dev dependencies: @types/node-cron@^3.0.11, @types/proper-lockfile@^4.1.4
- [ ] T003 [P] Update .env.example with HEARTBEAT_ROOT_DIR and HEARTBEAT_CONFIG_FILE variables
- [ ] T004 [P] Create directory structure: src/services/heartbeat/ with subdirectories (event-bus/, tasks/)
- [ ] T005 [P] Create directory structure: tests/unit/services/heartbeat/ with subdirectories
- [ ] T006 [P] Create directory structure: tests/integration/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Create heartbeat types in src/types/heartbeat.ts (TaskConfig, TaskExecutionRecord, EventFile schemas)
- [ ] T008 [P] Create heartbeat service types in src/services/heartbeat/types.ts (TaskHandler interface, TaskRegistry type)
- [ ] T009 [P] Create event ID generator in src/services/heartbeat/event-bus/id-generator.ts (base36 counter, daily reset logic)
- [ ] T010 Write unit tests for id-generator in tests/unit/services/heartbeat/event-bus/id-generator.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure and Monitor Scheduled Tasks (Priority: P1) 🎯 MVP

**Goal**: Core scheduler infrastructure that loads configuration, schedules tasks with cron, supports hot-reload, and prevents concurrent executions

**Independent Test**: Create a test configuration file with simple logging tasks, verify they execute on schedule, modify config and confirm hot-reload without restart, check logs for execution records

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T011 [P] [US1] Contract test for heartbeat-config.json schema validation in tests/unit/services/heartbeat/config-loader.test.ts
- [ ] T012 [P] [US1] Unit test for scheduler task lifecycle (start/stop/destroy) in tests/unit/services/heartbeat/scheduler.test.ts
- [ ] T013 [P] [US1] Integration test for config hot-reload in tests/integration/heartbeat-integration.test.ts

### Implementation for User Story 1

- [ ] T014 [P] [US1] Create config loader in src/services/heartbeat/config-loader.ts (load JSON, validate schema, watch for changes)
- [ ] T015 [P] [US1] Create task registry in src/services/heartbeat/tasks/task-registry.ts (Map<TaskType, TaskHandler>, register/get methods)
- [ ] T016 [US1] Implement scheduler in src/services/heartbeat/scheduler.ts (node-cron integration, task lifecycle, concurrency control)
- [ ] T017 [US1] Implement heartbeat service in src/services/heartbeat/heartbeat-service.ts (main orchestrator, hot-reload integration)
- [ ] T018 [US1] Add structured logging for task execution in src/services/heartbeat/scheduler.ts (pino logger with operation/context fields)
- [ ] T019 [US1] Implement error handling for invalid config in src/services/heartbeat/config-loader.ts (validation errors, schema violations)
- [ ] T020 [US1] Add execution record tracking in src/services/heartbeat/scheduler.ts (TaskExecutionRecord Map, metrics)

**Checkpoint**: At this point, User Story 1 should be fully functional - scheduler loads config, executes tasks on schedule, handles hot-reload, prevents concurrent execution

---

## Phase 4: User Story 2 - Automated Email Triage (Priority: P2)

**Goal**: Email processing task that fetches unread emails, uses LocalFoundry LLM to extract action items, and writes markdown event files

**Independent Test**: Configure email triage task in heartbeat-config.json to run every hour, send test emails with various content, verify markdown event files are created in events/ directory with extracted action items

### Tests for User Story 2

- [ ] T021 [P] [US2] Unit test for event writer with file locking in tests/unit/services/heartbeat/event-bus/event-writer.test.ts
- [ ] T022 [P] [US2] Unit test for event reader and markdown parsing in tests/unit/services/heartbeat/event-bus/event-reader.test.ts
- [ ] T023 [P] [US2] Unit test for email triage task in tests/unit/services/heartbeat/tasks/email-triage-task.test.ts (mock LocalFoundry and Graph API)
- [ ] T024 [US2] Integration test for end-to-end email triage in tests/integration/heartbeat-integration.test.ts (real email processing)

### Implementation for User Story 2

- [ ] T025 [P] [US2] Create event writer in src/services/heartbeat/event-bus/event-writer.ts (write markdown with frontmatter, atomic writes, file locking)
- [ ] T026 [P] [US2] Create event reader in src/services/heartbeat/event-bus/event-reader.ts (parse markdown, extract frontmatter and JSON blocks)
- [ ] T027 [P] [US2] Create event consumer in src/services/heartbeat/event-bus/event-consumer.ts (chokidar file watching, process new events)
- [ ] T028 [US2] Implement email triage task in src/services/heartbeat/tasks/email-triage-task.ts (fetch emails, batch processing with concurrency)
- [ ] T029 [US2] Integrate LocalFoundry LLM in src/services/heartbeat/tasks/email-triage-task.ts (action item extraction prompt, JSON parsing)
- [ ] T030 [US2] Add email-to-markdown conversion in src/services/heartbeat/tasks/email-triage-task.ts (format email metadata and body)
- [ ] T031 [US2] Implement error handling for LLM timeouts in src/services/heartbeat/tasks/email-triage-task.ts (retry logic, fallback)
- [ ] T032 [US2] Register email-triage task in src/services/heartbeat/tasks/task-registry.ts
- [ ] T033 [US2] Add batch processing logic in src/services/heartbeat/tasks/email-triage-task.ts (process 10 emails concurrently, meet 5-minute target)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - emails are automatically triaged on schedule and event files are created

---

## Phase 5: User Story 3 - Automated Meeting Preparation (Priority: P3)

**Goal**: Calendar review task that scans upcoming meetings and creates OneNote pages with meeting details and note-taking template

**Independent Test**: Configure calendar review task to run daily at 9am, schedule test meetings for next 7 days, verify OneNote pages are created with meeting metadata and structured template

### Tests for User Story 3

- [ ] T034 [P] [US3] Unit test for calendar review task in tests/unit/services/heartbeat/tasks/calendar-review-task.test.ts (mock Graph API and OneNote client)
- [ ] T035 [US3] Integration test for meeting page creation in tests/integration/heartbeat-integration.test.ts (real calendar and OneNote interaction)

### Implementation for User Story 3

- [ ] T036 [P] [US3] Implement calendar review task in src/services/heartbeat/tasks/calendar-review-task.ts (fetch meetings for lookahead window)
- [ ] T037 [US3] Add meeting filtering logic in src/services/heartbeat/tasks/calendar-review-task.ts (minHoursBefore, skipRecurring checks)
- [ ] T038 [US3] Integrate OneNote page creation in src/services/heartbeat/tasks/calendar-review-task.ts (use existing OneNoteClient from Feature 013)
- [ ] T039 [US3] Implement duplicate detection in src/services/heartbeat/tasks/calendar-review-task.ts (check for existing pages by meeting ID)
- [ ] T040 [US3] Add page template support in src/services/heartbeat/tasks/calendar-review-task.ts (variable substitution: {{title}}, {{date}}, {{attendees}})
- [ ] T041 [US3] Register calendar-review task in src/services/heartbeat/tasks/task-registry.ts
- [ ] T042 [US3] Add error handling for OneNote API failures in src/services/heartbeat/tasks/calendar-review-task.ts (retry logic, skip on error)

**Checkpoint**: All user stories should now be independently functional - scheduler, email triage, and calendar review all work together

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and cross-feature improvements

- [ ] T043 [P] Create sample heartbeat-config.json in repository root with both email and calendar tasks
- [ ] T044 [P] Update README.md with heartbeat system documentation (configuration, usage, monitoring)
- [ ] T045 [P] Add event archiver in src/common/event-archiver.ts (cleanup old events based on retention policy)
- [ ] T046 [P] Write unit test for event archiver in tests/unit/common/event-archiver.test.ts
- [ ] T047 Add comprehensive error scenarios to integration tests in tests/integration/heartbeat-integration.test.ts (config errors, API failures)
- [ ] T048 Validate quickstart.md examples against actual implementation
- [ ] T049 [P] Add JSDoc comments to all public interfaces in src/services/heartbeat/ and src/types/heartbeat.ts
- [ ] T050 Run TypeScript compilation check (tsc --noEmit) and fix any type errors
- [ ] T051 Run ESLint and fix any linting violations
- [ ] T052 Run Jest test suite and verify 80% coverage threshold
- [ ] T053 [P] Create example event files in docs/examples/ directory for reference
- [ ] T054 Performance test: Verify 50 emails processed in < 5 minutes (SC-003)
- [ ] T055 Performance test: Verify 20 meetings processed in < 3 minutes (SC-004)
- [ ] T056 Validate all contract JSON schemas against actual configuration and event files

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Requires US1 scheduler infrastructure but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Requires US1 scheduler infrastructure but independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Event bus components (writer, reader, consumer) before task implementations
- Task implementations before registry registration
- Core functionality before error handling and optimization
- Story complete before moving to next priority

### Parallel Opportunities

#### Phase 1 (Setup)
- T003, T004, T005, T006 can all run in parallel

#### Phase 2 (Foundational)
- T008, T009 can run in parallel after T007 completes

#### Phase 3 (User Story 1)
- T011, T012, T013 tests can all run in parallel
- T014, T015 can run in parallel after tests
- T018, T019, T020 can run in parallel after T016-T017

#### Phase 4 (User Story 2)
- T021, T022, T023 tests can all run in parallel
- T025, T026, T027 event bus components can run in parallel
- T029, T030, T031 email processing logic can run in parallel after T028

#### Phase 5 (User Story 3)
- T034, T035 tests can run in parallel
- T037, T038, T039, T040 can run in parallel after T036

#### Phase 6 (Polish)
- T043, T044, T045, T046, T049, T053 can all run in parallel
- T050, T051, T052 validation tasks can run in parallel
- T054, T055, T056 testing tasks can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract test for heartbeat-config.json schema validation in tests/unit/services/heartbeat/config-loader.test.ts"
Task: "Unit test for scheduler task lifecycle (start/stop/destroy) in tests/unit/services/heartbeat/scheduler.test.ts"
Task: "Integration test for config hot-reload in tests/integration/heartbeat-integration.test.ts"

# Launch both core implementations together:
Task: "Create config loader in src/services/heartbeat/config-loader.ts"
Task: "Create task registry in src/services/heartbeat/tasks/task-registry.ts"
```

---

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together:
Task: "Unit test for event writer with file locking in tests/unit/services/heartbeat/event-bus/event-writer.test.ts"
Task: "Unit test for event reader and markdown parsing in tests/unit/services/heartbeat/event-bus/event-reader.test.ts"
Task: "Unit test for email triage task in tests/unit/services/heartbeat/tasks/email-triage-task.test.ts"

# Launch all event bus components together:
Task: "Create event writer in src/services/heartbeat/event-bus/event-writer.ts"
Task: "Create event reader in src/services/heartbeat/event-bus/event-reader.ts"
Task: "Create event consumer in src/services/heartbeat/event-bus/event-consumer.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup → Install dependencies, create structure
2. Complete Phase 2: Foundational → Types and ID generator (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 → Scheduler with config hot-reload
4. **STOP and VALIDATE**: Test with simple logging tasks, verify cron scheduling, test hot-reload
5. Deploy/demo if ready (basic automation infrastructure functional)

**Value Delivered**: Scheduled task execution framework ready for any task type

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → **Deploy/Demo (MVP!)** - Can schedule any custom tasks
3. Add User Story 2 → Test independently → **Deploy/Demo** - Email triage automation live
4. Add User Story 3 → Test independently → **Deploy/Demo** - Full automation suite with calendar prep
5. Each story adds value without breaking previous stories

**Release Strategy**:
- **v0.1**: User Story 1 (scheduler framework)
- **v0.2**: + User Story 2 (email triage)
- **v1.0**: + User Story 3 (calendar review)

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (1-2 days)
2. Once Foundational is done:
   - **Developer A**: User Story 1 (scheduler core) - MUST complete first as US2/US3 depend on it
   - Wait for US1 scheduler completion
   - **Developer B**: User Story 2 (email triage)
   - **Developer C**: User Story 3 (calendar review)
3. US2 and US3 can proceed in parallel after US1 completes
4. Stories integrate via the common scheduler and event bus infrastructure

**Note**: US2 and US3 have a practical dependency on US1 (scheduler), so true parallel work requires US1 to finish first. However, tests and design for US2/US3 can start in parallel with US1 implementation.

---

## Task Count Summary

| Phase | Task Count | Parallel Opportunities |
|-------|------------|------------------------|
| Phase 1: Setup | 6 tasks | 3 parallel groups (T003-T006) |
| Phase 2: Foundational | 4 tasks | 2 parallel (T008-T009) |
| Phase 3: User Story 1 (P1) | 10 tasks | 3 parallel groups (tests, loaders, handlers) |
| Phase 4: User Story 2 (P2) | 13 tasks | 4 parallel groups (tests, event bus, email logic) |
| Phase 5: User Story 3 (P3) | 9 tasks | 2 parallel groups (tests, calendar logic) |
| Phase 6: Polish | 14 tasks | 4 parallel groups (docs, tests, validation) |
| **TOTAL** | **56 tasks** | **18 parallel opportunities** |

---

## Independent Test Criteria

### User Story 1 (Scheduler Core)

✅ **Pass Criteria**:
- Create `heartbeat-config.json` with test task: `{ "id": "test-task", "schedule": "* * * * *", "type": "test-logger" }`
- Start heartbeat service → Task executes every minute
- Modify config schedule to `*/2 * * * *` → System reloads, task now runs every 2 minutes
- Check logs → See task execution records with timestamps, durations, success status
- Start two executions concurrently → Second execution skipped with "already running" log

### User Story 2 (Email Triage)

✅ **Pass Criteria**:
- Configure email triage task: `{ "type": "email-triage", "schedule": "0 * * * *", "config": { "maxEmails": 50 } }`
- Send 5 test emails with various content (questions, requests, deadlines)
- Wait for hourly execution → Check `data/events/` directory
- Verify 5 markdown files exist with pattern `YYYYMMDD-email-####.md`
- Open event files → See extracted action items, questions, requests in JSON blocks
- Verify emails remain unread in inbox (if `markAsRead: false`)

### User Story 3 (Calendar Review)

✅ **Pass Criteria**:
- Configure calendar review task: `{ "type": "calendar-review", "schedule": "0 9 * * *", "config": { "lookaheadDays": 7 } }`
- Schedule 3 test meetings for next 7 days in Outlook calendar
- Run task manually or wait for 9am execution
- Check OneNote "Meeting Notes" notebook → See 3 new pages created
- Open pages → Verify meeting title, date, time, attendees, structured template present
- Run task again → Verify no duplicate pages created (duplicate detection works)

---

## Notes

- [P] tasks = different files, no dependencies → Can execute in parallel
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD approach)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **MVP = User Story 1 only** (provides scheduling framework for any future task type)
- **Email triage (US2) delivers immediate business value** (automatic email processing)
- **Calendar review (US3) completes the automation suite** (meeting preparation)
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
