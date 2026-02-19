# Implementation Tasks: Journal Triage Heartbeat Task

**Feature**: 018-journal-triage | **Branch**: `018-journal-triage` | **Date**: 2026-02-18

## Task Format

```
- [ ] [TID] [P?] [Story?] Description with file path
```

- **TID**: Task ID (T001-T040)
- **P**: Parallelizable (can be done independently of other tasks in same phase)
- **Story**: User Story reference (US1, US2, US3) or blank for foundational work
- **Description**: Clear, actionable task description with exact file path

## Task Overview

| Phase | Tasks | Focus | Dependencies |
|-------|-------|-------|--------------|
| Phase 1: Setup | T001-T005 | Dependencies, structure, test fixtures | None |
| Phase 2: Foundational | T006-T010 | Journal library (all stories depend on this) | Phase 1 |
| Phase 3: US1 | T011-T020 | Calendar fetch, journal CRUD, merge logic, EventId matching | Phase 2 |
| Phase 4: US2 | T021-T025 | OneNote integration, retry logic, section/page creation | Phase 2, 3 |
| Phase 5: US3 | T026-T030 | Task registration, heartbeat config, scheduling | Phase 3, 4 |
| Phase 6: Polish | T031-T040 | Integration tests, documentation, config examples | Phase 5 |

---

## Phase 1: Setup & Infrastructure (T001-T005)

**Goal**: Install dependencies, create directory structure, and establish test fixtures.

**Independent Test**: Dependencies install successfully, directory structure exists, sample journal files can be read.

### Tasks

- [x] [T001] [P] Install `gray-matter@^4.0.3` dependency for frontmatter parsing in package.json and run `npm install`
- [x] [T002] [P] Create directory structure: `src/lib/journal/` and `src/lib/journal/__tests__/`
- [x] [T003] [P] Create test fixtures directory: `tests/fixtures/journal-samples/` with sample journal files
- [x] [T004] [P] Copy real journal examples to `tests/fixtures/journal-samples/2026-02-18.md` (simple case: 2-3 meetings, one with prep notes)
- [x] [T005] [P] Copy real journal examples to `tests/fixtures/journal-samples/2026-02-19.md` (complex case: 10+ meetings, multiple attendee formats, wiki links)

---

## Phase 2: Foundational - Journal Library (T006-T010)

**Goal**: Build core journal manipulation utilities that all user stories depend on. These utilities handle parsing, writing, and merging journal entries.

**Independent Test**: Can parse journal files with frontmatter, extract meetings by EventId, update calendar metadata without overwriting user notes, and write valid journal markdown.

### Tasks

- [x] [T006] Create `src/lib/journal/types.ts` with TypeScript interfaces:
  - `JournalFrontmatter` (date, day, type, energy-level, energy-description, end-energy-level?, end-energy-description?, shutdown-complete?)
  - `MeetingEntry` (time, title, attendees, location?, eventId, prepNotes, meetingNotes, related)
  - `DailyJournal` (frontmatter: JournalFrontmatter, meetings: MeetingEntry[], rawContent: string)
  - `JournalParseResult` (success: boolean, journal?: DailyJournal, error?: string)

- [x] [T007] Create `src/lib/journal/journal-parser.ts` using gray-matter:
  - Function `parseJournalFile(content: string): JournalParseResult` that extracts frontmatter with gray-matter
  - Function `extractMeetings(journalBody: string): MeetingEntry[]` using regex pattern `/### (.+?)\n\n([\s\S]+?)(?=\n---\n|$)/g`
  - Function `extractEventId(body: string): string | null` supporting both plain format (`EventId: AAMk...`) and markdown link format (`[eventId](AAMk...)`)
  - Function `extractSection(body: string, sectionName: string): string` for extracting Prep Notes and Meeting Notes content
  - Include validation for required frontmatter fields

- [x] [T008] Create `src/lib/journal/__tests__/journal-parser.test.ts`:
  - Test parsing valid journal with frontmatter and meetings
  - Test extracting EventId in both formats (plain and markdown link)
  - Test extracting meetings with various attendee formats (plain names, wiki links, truncated lists)
  - Test handling missing frontmatter fields
  - Test handling corrupted YAML
  - Test extracting prep notes and meeting notes sections
  - Use `tests/fixtures/journal-samples/*.md` as test data

- [x] [T009] Create `src/lib/journal/journal-writer.ts`:
  - Function `createDailyJournal(date: Date, frontmatter: JournalFrontmatter): string` that generates valid journal markdown with frontmatter using gray-matter
  - Function `formatMeetingEntry(meeting: MeetingEntry): string` that follows template: `### [TIME] - [TITLE]\n\n**Attendees:** ...\n**Location:** ...\n**Related:** ...\n**EventId:** [eventId](ID)\n\n**Prep Notes:**\n\n**Meeting Notes:**\n\n---`
  - Function `appendHeartbeatSummary(journal: string, summary: HeartbeatSummary): string` that adds/updates the heartbeat summary section at end of file
  - Function `writeJournalFile(journal: DailyJournal): string` that reconstructs full markdown file
  - Use 24-hour time format (HH:MM) in meeting headings

- [x] [T010] Create `src/lib/journal/__tests__/journal-writer.test.ts`:
  - Test creating daily journal with valid frontmatter
  - Test formatting meeting entry with all fields
  - Test formatting meeting entry with optional fields (location, related)
  - Test appendHeartbeatSummary appends to end of file without overwriting
  - Test writeJournalFile reconstructs valid markdown that can be re-parsed
  - Verify gray-matter can parse written frontmatter

---

## Phase 3: User Story 1 - Automatic Journal Creation from Calendar (T011-T020)

**Goal**: Implement core functionality to read calendar events and create/update journal entries with EventId tracking and intelligent merge logic.

**Independent Test**: Can fetch calendar events, create new journal entries for meetings without EventId matches, update existing entries when calendar changes, and preserve all user-added content.

### Tasks

- [x] [T011] [US1] Create `src/lib/journal/journal-merger.ts` with merge strategy:
  - Function `mergeCalendarToJournal(existingEntry: MeetingEntry | null, calendarEvent: CalendarEvent): MeetingEntry` that auto-updates calendar metadata (time, title, location, attendees, eventId) while preserving user content (prepNotes, meetingNotes, related)
  - Function `buildEventIdIndex(journal: DailyJournal): Map<string, MeetingEntry>` for O(1) EventId lookup
  - Function `markMeetingCancelled(entry: MeetingEntry): MeetingEntry` that adds cancellation marker to title while preserving notes (FR-006)
  - Use plain text comma-separated attendee format per research.md decision 6

- [x] [T012] [P] [US1] Create `src/lib/journal/__tests__/journal-merger.test.ts`:
  - Test merging calendar event into new entry (no existing)
  - Test merging calendar event into existing entry with empty notes
  - Test merging calendar event into existing entry with populated prep notes (must preserve)
  - Test merging calendar event with changed time/title/location (must update metadata)
  - Test buildEventIdIndex creates correct map from meetings array
  - Test markMeetingCancelled preserves prepNotes and meetingNotes

- [x] [T013] [US1] Create `src/services/heartbeat/tasks/journal-triage-task.ts` skeleton:
  - Implement `HeartbeatTask` interface from existing framework
  - Constructor accepts `TaskDependencies` (deps.microsoftService, deps.logger, deps.rootDir)
  - Stub `execute(config: TaskConfig): Promise<TaskExecutionResult>` method
  - Add private methods: `fetchCalendarEvents()`, `processJournals()`, `syncToOneNote()`
  - Import journal library utilities (parser, writer, merger)

- [x] [T014] [US1] Implement `fetchCalendarEvents()` method in `src/services/heartbeat/tasks/journal-triage-task.ts`:
  - Use Microsoft Graph API client from `deps.microsoftService`
  - Fetch events for configurable lookahead period (default: 7 days from current date)
  - Filter to calendar events only (not all-day events without times)
  - Map Graph API events to internal `CalendarEvent` type
  - Handle authentication errors gracefully (FR-012)
  - Add structured logging with pino for fetch operation

- [x] [T015] [US1] Implement `processJournals()` method in `src/services/heartbeat/tasks/journal-triage-task.ts`:
  - For each calendar event, determine target daily journal path: `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`
  - Create monthly folder if it doesn't exist
  - Read existing journal file using `parseJournalFile()`, or create new journal using `createDailyJournal()` if file doesn't exist
  - Build EventId index using `buildEventIdIndex()`
  - For each event: check if EventId exists in index
  - If exists: merge calendar metadata using `mergeCalendarToJournal()` preserving user notes
  - If new: create meeting entry with empty prep/meeting notes sections
  - Use proper-lockfile to prevent concurrent writes (already installed from feature 017)
  - Batch write all updates to journal file at end (not per-meeting)
  - Add structured logging for each operation (created, updated, skipped)

- [x] [T016] [US1] Implement EventId duplicate prevention in `processJournals()` method:
  - Before creating new entry, check EventId index to prevent duplicates (FR-014)
  - Log warning if duplicate EventId detected
  - Skip creation if EventId already exists in journal
  - Handle case where EventId is missing from calendar event (log error, skip entry)

- [x] [T017] [US1] Implement cancelled meeting handling in `processJournals()` method:
  - Detect when journal entry exists but calendar event no longer exists
  - Call `markMeetingCancelled()` to update entry with cancellation marker
  - Preserve all prep notes and meeting notes (FR-006)
  - Add structured logging for cancellation detection

- [x] [T018] [US1] Implement heartbeat summary section in `processJournals()` method:
  - Track statistics: eventsProcessed, journalsCreated, journalsUpdated, meetingsCancelled
  - Create `HeartbeatSummary` object with timestamp and statistics
  - Append summary to daily journal using `appendHeartbeatSummary()` function (FR-011)
  - Format summary with markdown: timestamp, task name, statistics

- [ ] [T019] [P] [US1] Create unit tests `src/services/heartbeat/tasks/__tests__/journal-triage-task.test.ts`:
  - Mock Microsoft Graph API client
  - Mock filesystem operations (fs.readFile, fs.writeFile, fs.mkdir)
  - Test fetchCalendarEvents returns correct event mapping
  - Test processJournals creates new entry for new event
  - Test processJournals updates existing entry preserving notes
  - Test processJournals prevents duplicate EventId entries
  - Test processJournals marks cancelled meetings
  - Test heartbeat summary is appended to journal
  - Test file locking prevents concurrent writes

- [x] [T020] [US1] Add config types to `src/services/heartbeat/types.ts`:
  - Extend `TaskConfig` type with `JournalTriageConfig` interface
  - Properties: `lookaheadDays: number`, `journalDir: string`, `createOneNotePages: boolean`, `oneNoteSectionFormat: string`
  - Update `TaskType` union to include `'journal-triage'`
  - Add JSDoc comments for each config property

---

## Phase 4: User Story 2 - OneNote Sync for Meeting Notes (T021-T025)

**Goal**: Integrate with existing OneNote API to create/update pages in monthly sections with prep notes content and retry logic for transient failures.

**Independent Test**: Can create OneNote sections with YYYY-MM format, create pages for meetings with prep notes content, update existing pages, and retry failed operations with exponential backoff.

### Tasks

- [x] [T021] [US2] Implement `syncToOneNote()` method in `src/services/heartbeat/tasks/journal-triage-task.ts`:
  - Use existing `OneNoteClient` from `src/services/microsoft/onenote-client.ts` (feature 013)
  - For each processed meeting entry, extract prep notes
  - Determine target section name using monthly format: "YYYY-MM Meetings" (e.g., "2026-02 Meetings")
  - Call `ensureSectionExists()` to get or create section
  - Convert prep notes markdown to HTML using `marked.parse()` (already installed)
  - Include meeting metadata in page body: date, time, attendees, location
  - Call `findPageByTitle()` to check if page exists
  - If exists: call `updatePageContent()` with new prep notes
  - If new: call `createPage()` with prep notes content
  - Add structured logging for each OneNote operation

- [x] [T022] [US2] Implement retry logic with exponential backoff in `syncToOneNote()` method:
  - Wrap OneNote API calls in retry wrapper function
  - Configuration: maxRetries: 3, initialDelay: 1000ms, backoffMultiplier: 2
  - Retry on transient errors: network errors, 429 rate limiting, 503 service unavailable
  - Do not retry on: 401 authentication, 404 not found, 400 bad request
  - Log each retry attempt with delay and error message (FR-005)
  - After exhausting retries, log persistent error and continue to next meeting (do not fail entire task)
  - Track retry statistics in heartbeat summary

- [x] [T023] [US2] Create helper function `convertPrepNotesToHtml()` in `src/services/heartbeat/tasks/journal-triage-task.ts`:
  - Accept meeting entry and prep notes markdown
  - Use `marked.parse()` to convert markdown to HTML
  - Build complete HTML structure with meeting metadata section and prep notes section
  - Follow structure from research.md: `<h2>Meeting Details</h2>...<h2>Preparation Notes</h2>...`
  - Escape HTML in meeting metadata fields
  - Return complete HTML string for OneNote page creation

- [ ] [T024] [P] [US2] Add OneNote sync tests to `src/services/heartbeat/tasks/__tests__/journal-triage-task.test.ts`:
  - Mock OneNoteClient methods (ensureSectionExists, findPageByTitle, createPage, updatePageContent)
  - Test syncToOneNote creates section with monthly format
  - Test syncToOneNote creates new page for meeting with prep notes
  - Test syncToOneNote updates existing page when prep notes change
  - Test syncToOneNote skips meetings with empty prep notes
  - Test retry logic retries on transient errors (429, 503)
  - Test retry logic stops on permanent errors (401, 404)
  - Test retry logic logs persistent failures after max retries
  - Test convertPrepNotesToHtml generates valid HTML structure

- [x] [T025] [US2] Implement OneNote sync toggle in `execute()` method:
  - Check `config.config.createOneNotePages` boolean flag
  - Skip `syncToOneNote()` call if flag is false
  - Log message indicating OneNote sync is disabled
  - Include sync status in heartbeat summary (enabled/disabled, pages synced)

---

## Phase 5: User Story 3 - Scheduled Heartbeat Execution (T026-T030)

**Goal**: Register journal triage task with heartbeat framework, configure scheduling, and enable automatic execution on cron schedule.

**Independent Test**: Task appears in task registry, can be scheduled with cron expression, executes automatically on schedule, and logs execution results.

### Tasks

- [x] [T026] [US3] Register journal triage task in `src/services/heartbeat/tasks/task-registry.ts`:
  - Import `JournalTriageTask` class
  - Add `'journal-triage': new JournalTriageTask(deps)` to task registry map
  - Verify task follows existing pattern from EmailTriageTask

- [x] [T027] [US3] Update `TaskType` type in `src/types/heartbeat.ts`:
  - Add `'journal-triage'` to `TaskType` union type
  - Verify TypeScript compilation succeeds with new task type

- [x] [T028] [US3] Implement `execute()` method orchestration in `src/services/heartbeat/tasks/journal-triage-task.ts`:
  - Wrap entire execution in try-catch for error handling
  - Track execution start time and duration
  - Call `fetchCalendarEvents()` with lookahead config
  - Call `processJournals()` with fetched events
  - Call `syncToOneNote()` if enabled in config
  - Return `TaskExecutionResult` with status, duration, statistics (eventsProcessed, journalsUpdated, oneNotePagesCreated)
  - Handle errors gracefully and return error result (FR-012, FR-013)
  - Add structured logging for task start, completion, and errors

- [x] [T029] [P] [US3] Create example heartbeat config in `heartbeat-config.example.json`:
  - Add journal-triage task configuration example
  - Include all config properties: lookaheadDays, journalDir, createOneNotePages, oneNoteSectionFormat
  - Set schedule to `"0 * * * *"` (every hour) as default
  - Add JSDoc-style comments explaining each property
  - Include multiple examples: basic (hourly), aggressive (every 15 min), daily (once per day)

- [x] [T030] [P] [US3] Update `.env.example` with journal configuration:
  - Document `rootDir` environment variable for journal base path
  - Add example: `rootDir=/home/user/context`
  - Add comment explaining journal directory structure: `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`

---

## Phase 6: Polish - Integration Tests & Documentation (T031-T040)

**Goal**: Comprehensive integration testing, documentation updates, and production readiness verification.

**Independent Test**: Full end-to-end flow works with real Microsoft Graph API (using test account), all documentation is complete and accurate, configuration examples work out-of-box.

### Tasks

- [ ] [T031] Create integration test `tests/integration/journal-triage-integration.test.ts`:
  - Set up test environment with real journal files in temp directory
  - Mock Microsoft Graph API responses with realistic calendar events
  - Execute full journal triage task
  - Verify journal files created/updated correctly
  - Verify EventId matching works across multiple executions
  - Verify heartbeat summary is appended
  - Verify file locking prevents corruption
  - Verify cancelled meetings are marked correctly
  - Clean up temp files after test

- [ ] [T032] Add OneNote integration to integration test:
  - Mock OneNoteClient with realistic responses
  - Verify monthly sections are created correctly
  - Verify pages are created with correct titles
  - Verify prep notes are converted to HTML correctly
  - Verify retry logic is invoked on transient errors
  - Verify persistent errors are logged after retries exhausted

- [x] [T033] Create `specs/018-journal-triage/quickstart.md` guide:
  - Section: Initial Setup (install dependencies, create journal directory)
  - Section: Configuration (heartbeat-config.json setup, environment variables)
  - Section: Authentication (Microsoft OAuth tokens, required permissions)
  - Section: Testing (manual execution, verifying journal creation, checking OneNote sync)
  - Section: Scheduling (cron expression examples, enabling/disabling task)
  - Section: Troubleshooting (common errors, authentication issues, file permissions, OneNote failures)
  - Include complete working example with sample config
  - Include screenshots or example output

- [x] [T034] Update main `README.md` with journal triage feature:
  - Add Journal Triage section under Features
  - Link to quickstart guide
  - Describe key functionality: automatic journal creation, EventId tracking, OneNote sync
  - Include quick setup snippet
  - Add to table of contents

- [x] [T035] Create `specs/018-journal-triage/contracts/journal-format.md` specification:
  - Document frontmatter schema with YAML examples
  - Document meeting entry template with all fields
  - Document EventId format (both plain and markdown link)
  - Document Prep Notes and Meeting Notes section format
  - Document heartbeat summary section format
  - Include validation rules for each field
  - Include complete example daily journal file
  - Reference this spec from quickstart.md

- [ ] [T036] Update `specs/018-journal-triage/data-model.md`:
  - Document all TypeScript interfaces with JSDoc comments
  - Include state transition diagram: Calendar Event → Journal Entry → OneNote Page
  - Document EventId matching algorithm with complexity analysis
  - Document merge strategy with examples (preserve vs overwrite)
  - Include entity relationship diagram if helpful
  - Cross-reference types defined in `src/lib/journal/types.ts`

- [ ] [T037] Add error handling documentation to quickstart.md:
  - Document authentication error scenarios (expired token, missing permissions)
  - Document file I/O errors (missing directory, permission denied, corrupted YAML)
  - Document OneNote API errors (rate limiting, service unavailable, network failures)
  - Document recovery procedures for each error type
  - Include sample error logs with explanations

- [ ] [T038] Create end-to-end test with real Microsoft Graph API:
  - Use test Microsoft account with calendar and OneNote permissions
  - Create test calendar events via Graph API
  - Execute journal triage task
  - Verify journal files created in test directory
  - Verify OneNote pages created in test notebook
  - Clean up test data after execution
  - Document how to run this test in CI/CD (environment variables, test account setup)
  - Mark as manual test or skip in CI if credentials unavailable

- [ ] [T039] Run full test suite and verify coverage:
  - Execute `npm test` and ensure all tests pass
  - Verify code coverage meets 80% threshold
  - Review coverage report for untested error paths
  - Add missing tests for low-coverage areas
  - Document any intentionally untested code (e.g., external API clients)

- [ ] [T040] Final validation checklist:
  - All user stories have acceptance scenarios verified
  - All functional requirements (FR-001 to FR-017) are met
  - All success criteria (SC-001 to SC-007) are measurable
  - Configuration examples work without modification
  - Documentation is complete and accurate (README, quickstart, contracts, data-model)
  - TypeScript compilation succeeds with no errors
  - Linting passes (`npm run lint`)
  - No console.log statements in production code (use pino logger)
  - All TODOs and FIXMEs are addressed or tracked as issues
  - Git commit message follows convention (includes feature branch and summary)

---

## Dependencies Between Phases

```
Phase 1 (Setup)
    ↓
Phase 2 (Journal Library)
    ↓
    ├─→ Phase 3 (US1: Calendar Integration)
    │       ↓
    ├─→ Phase 4 (US2: OneNote Sync)
    │       ↓
    └─→ Phase 5 (US3: Scheduling)
            ↓
        Phase 6 (Polish)
```

## Task Status Tracking

**Phase 1**: 0/5 complete (0%)
**Phase 2**: 0/5 complete (0%)
**Phase 3**: 0/10 complete (0%)
**Phase 4**: 0/5 complete (0%)
**Phase 5**: 0/5 complete (0%)
**Phase 6**: 0/10 complete (0%)

**Overall**: 0/40 complete (0%)

---

## Notes for Implementation

### Key Patterns to Follow

1. **gray-matter for Frontmatter**: Use `matter(content)` to parse/write frontmatter (research.md decision 1)
2. **In-Memory EventId Index**: Build `Map<string, MeetingEntry>` for O(1) lookup (research.md decision 5)
3. **Section-Level Merge**: Preserve Prep Notes and Meeting Notes, overwrite calendar metadata (research.md decision 3)
4. **Monthly OneNote Sections**: Use "YYYY-MM Meetings" format matching journal folder structure (research.md decision 4)
5. **File Locking**: Use proper-lockfile for concurrent access protection (already installed)
6. **Structured Logging**: Use pino logger with context (task name, operation, eventId)
7. **Retry Logic**: Exponential backoff for OneNote API (maxRetries: 3, initialDelay: 1s, multiplier: 2)
8. **Heartbeat Summary**: Append dedicated section at end of daily journal (research.md decision 8)

### Testing Strategy

- **Unit Tests**: Test each library module independently (parser, writer, merger)
- **Integration Tests**: Test full flow with mocked Graph API and file system
- **End-to-End Tests**: Test with real Graph API using test account (manual or CI)
- **Fixtures**: Use real journal examples from `context/areas/journal/` as test data
- **Coverage Target**: 80% minimum, focus on error paths and edge cases

### Success Metrics (from spec.md)

- **SC-001**: All meetings within 7 days have journal entries within 1 hour (test: schedule task every hour, verify entries exist)
- **SC-002**: Calendar changes reflected within 1 hour (test: modify event, wait for next execution, verify journal updated)
- **SC-003**: 95% OneNote sync success rate (test: track sync failures, calculate percentage)
- **SC-004**: Task completes in <2 minutes for 100 events (test: generate 100 test events, measure execution time)
- **SC-006**: Zero data loss (test: modify prep notes, run task, verify notes unchanged)
- **SC-007**: 90% first-attempt sync success (test: track retries, calculate first-attempt success rate)

---

**Ready to begin Phase 1 setup.**
