# Feature Specification: Journal Triage Heartbeat Task

**Feature Branch**: `018-journal-triage`
**Created**: 2026-02-18
**Status**: Draft
**Input**: User description: "I'd like to create my next heartbeat task. I would like a journal triage task that reads my calendar and creates/updates the associated journal entries, then updates the OneNote notes associated with each meeting in the journal."

## Clarifications

### Session 2026-02-18

- Q: When the heartbeat task runs, what time range of calendar meetings should it process for journal entry creation? → A: Seven days (configurable)
- Q: How should the system identify which journal entry corresponds to which calendar event (for updates and duplicate prevention)? → A: Use EventId as the unique identifier stored in journal
- Q: When OneNote sync fails for a meeting, what should the system do? → A: Retry with exponential backoff, then log if still failing
- Q: When a calendar event changes and the journal entry already has user-added prep notes or meeting notes, how should the system update the journal? → A: Update only calendar metadata fields, preserve all note sections
- Q: How should OneNote pages for meetings be organized within OneNote? → A: Create date-based sections with pages named for each meeting. Within each page, provide the Pre-Read text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Journal Creation from Calendar (Priority: P1)

As a user, I want the system to automatically read my calendar and create journal entries for upcoming meetings so that I have a consistent journaling structure without manual effort.

**Why this priority**: This is the core functionality that establishes the basic journal structure. Without this, there's no journal to manage or sync with OneNote.

**Independent Test**: Can be fully tested by scheduling a calendar event and verifying that a corresponding journal entry is created with the meeting details. Delivers immediate value by automating journal creation.

**Acceptance Scenarios**:

1. **Given** I have upcoming meetings in my calendar, **When** the heartbeat task runs, **Then** journal entries are created for each meeting that doesn't already have one
2. **Given** I have a new meeting added to my calendar, **When** the heartbeat task runs again, **Then** a new journal entry is created for that meeting
3. **Given** I have journal entries for meetings, **When** a meeting time or title changes in my calendar, **Then** the corresponding journal entry is updated to reflect the changes

---

### User Story 2 - OneNote Sync for Meeting Notes (Priority: P2)

As a user, I want the system to automatically update OneNote pages for each meeting in my journal so that my meeting notes are synchronized with my journal entries.

**Why this priority**: This adds value by connecting the journal system to the existing OneNote note-taking workflow, but the journal itself is useful even without OneNote sync.

**Independent Test**: Can be tested by creating a journal entry with meeting details and verifying that a corresponding OneNote page is created or updated. Delivers value by maintaining consistency between journal and notes.

**Acceptance Scenarios**:

1. **Given** I have journal entries for meetings, **When** the heartbeat task runs, **Then** corresponding OneNote pages are created or updated with the meeting information
2. **Given** I have a meeting with updated details in my journal, **When** the heartbeat task runs, **Then** the OneNote page is updated to reflect the current journal entry content
3. **Given** I have a meeting that was cancelled, **When** the heartbeat task runs, **Then** the journal entry and OneNote page reflect the cancellation status

---

### User Story 3 - Scheduled Heartbeat Execution (Priority: P3)

As a user, I want the journal triage task to run automatically on a regular schedule so that my journal and OneNote stay synchronized without manual intervention.

**Why this priority**: This is about automation frequency and reliability. While important for a good user experience, the core functionality can be tested and demonstrated with manual execution.

**Independent Test**: Can be tested by configuring a schedule (e.g., every hour) and observing that the task executes automatically at the specified intervals. Delivers value through hands-free operation.

**Acceptance Scenarios**:

1. **Given** the heartbeat task is configured with a schedule, **When** the scheduled time arrives, **Then** the task executes automatically
2. **Given** the task is running, **When** calendar events are added or modified, **Then** the changes are picked up within the next scheduled execution
3. **Given** the system is idle or user is offline, **When** the system becomes active again, **Then** the task resumes its scheduled execution

---

### Edge Cases

- What happens when a calendar event has no end time or is all-day?
- How does the system handle duplicate calendar events with the same title and time?
- What happens when OneNote is unavailable or returns an error? (System retries with exponential backoff, logs persistent failures)
- How does the system handle very long meeting titles or descriptions?
- What happens when a journal entry exists but the corresponding calendar event was deleted?
- How does the system handle recurring meetings vs one-time meetings?
- What happens when multiple calendar events occur at the same time?
- How does the system handle meetings that span multiple days?
- What happens when the journal file format is corrupted or unreadable?
- How does the system handle calendar events from different calendars (personal, work, shared)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read calendar events from the user's Microsoft calendar via Graph API for a configurable time range (default: 7 days from current date)
- **FR-002**: System MUST create journal entries for calendar events within the configured lookahead period that don't have corresponding journal entries
- **FR-003**: System MUST update existing journal entries when calendar event details change (title, time, location, attendees)
- **FR-004**: System MUST identify which journal entries correspond to which calendar events using the EventId as the unique identifier
- **FR-005**: System MUST create or update OneNote pages for each meeting organized in date-based sections (e.g., "2026-02 Meetings"), with each page named after the meeting title and containing the prep notes content from the journal entry, with retry logic using exponential backoff for transient failures, logging persistent errors after retries are exhausted
- **FR-006**: System MUST mark deleted calendar events as cancelled in the journal entry to preserve any prep notes or meeting context that may be valuable for future reference
- **FR-007**: System MUST run automatically on a configurable schedule as a heartbeat task
- **FR-008**: System MUST store journal entries as markdown files in `./areas/journal.YYYY-MM/YYYY-MM-DD.md` relative to the rootDir configuration variable, with frontmatter properties and structured sections for programmatic access
- **FR-009**: System MUST include frontmatter properties matching the existing journal format (date, day, type, etc.)
- **FR-010**: System MUST structure meeting entries with sections for EventId, Attendees, Location, Prep Notes, and Meeting Notes following the existing journal format
- **FR-011**: System MUST include a dedicated section in each daily journal for heartbeat task summaries documenting all automated work performed that day
- **FR-012**: System MUST handle authentication errors gracefully and notify the user
- **FR-013**: System MUST log execution results for monitoring and debugging
- **FR-014**: System MUST prevent duplicate journal entries for the same calendar event by checking for existing EventId references before creating new entries
- **FR-015**: System MUST create separate journal entries for each occurrence of recurring calendar events to allow independent note-taking and tracking for each instance
- **FR-016**: System MUST preserve existing journal entry content when updating by only modifying calendar-sourced metadata fields (title, time, location, attendees) while keeping all user-created content in Prep Notes and Meeting Notes sections intact
- **FR-017**: System MUST sync meeting metadata (date, time, attendees, location) from calendar to journal to OneNote

### Key Entities

- **Calendar Event**: Represents a scheduled meeting or appointment with attributes including title, start time, end time, location, attendees, recurrence pattern, and cancellation status
- **Daily Journal File**: A markdown file representing one day's journal (YYYY-MM-DD.md) containing frontmatter properties (date, day, type, energy levels, shutdown status), morning check-in, priorities, scheduled meetings with sections, shutdown review, and heartbeat task summary
- **Meeting Entry**: A structured section within the daily journal for a specific calendar event, containing meeting time, title, attendees, location, EventId reference, prep notes section, and meeting notes section
- **OneNote Page**: Represents a note-taking page in OneNote associated with a meeting, named after the meeting title, containing prep notes (pre-read text) from the journal entry, organized within date-based sections (YYYY-MM format, e.g., "2026-02 Meetings")
- **Heartbeat Summary**: A dedicated section in the daily journal documenting all automated work performed by heartbeat tasks that day, including journal entries created/updated

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All calendar meetings within the configured lookahead period (default: 7 days) have corresponding journal entries within 1 hour of the heartbeat task running
- **SC-002**: Calendar event changes (title, time, location) are reflected in journal entries within 1 hour of modification
- **SC-003**: Journal entries are successfully synced to corresponding OneNote pages with 95% success rate
- **SC-004**: The heartbeat task completes execution within 2 minutes for a calendar containing up to 100 events
- **SC-005**: Users spend 50% less time manually creating and updating meeting journal entries
- **SC-006**: System maintains data consistency between calendar, journal, and OneNote with zero data loss
- **SC-007**: 90% of journal-OneNote sync operations complete successfully on first attempt

## Dependencies & Assumptions *(optional)*

### Dependencies

- Existing Microsoft Graph API integration for calendar access (from feature 012)
- Existing OneNote integration for page creation/updates (from feature 013)
- Existing heartbeat task framework (from feature 017)
- User must have valid Microsoft OAuth tokens with calendar and OneNote permissions

### Assumptions

- Users want automatic journal creation for all calendar meetings (not selective)
- Journal entries should preserve user-added content (prep notes, meeting notes) when auto-updating from calendar metadata
- OneNote pages are organized in date-based sections matching the journal's YYYY-MM structure
- Page names match meeting titles for easy identification
- Prep notes content from journal entries serves as the "pre-read" text in OneNote pages
- The heartbeat task has adequate permissions to read/write journal files in the rootDir location
- Calendar events are the source of truth for meeting metadata (title, time, location, attendees)
- Journal files follow the existing format with frontmatter properties and structured meeting sections
- Each occurrence of a recurring meeting warrants its own journal entry for independent note-taking
- Cancelled/deleted calendar events should be marked as such in journal to preserve prep notes and context
- The heartbeat summary section will be appended to daily journal files without overwriting existing content
- Journal directory structure follows YYYY-MM folders with YYYY-MM-DD.md daily files

## Out of Scope *(optional)*

- Manual journal entry creation or editing through the MCP tool (this is an automated task only)
- Syncing journal content back to calendar events (one-way sync from calendar to journal)
- Integration with calendar systems other than Microsoft Graph
- Natural language processing or summarization of meeting content
- Reminder notifications or alerts for upcoming meetings
- Conflict detection between overlapping meetings
- Calendar event creation from journal entries
- Filtering or categorizing meetings by type, priority, or project
- Integration with task management systems
- Bulk import of historical calendar events into journal
