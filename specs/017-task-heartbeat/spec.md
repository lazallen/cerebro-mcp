# Feature Specification: Scheduled Task Heartbeat System

**Feature Branch**: `017-task-heartbeat`
**Created**: 2026-02-17
**Status**: Draft
**Input**: User description: "I want to add a heartbeat to this system and execute certain tasks on a cadence. I want to be able to configure what tasks are executed and at what cadence through a configurable crontab-like config file. As an example, the first two tasks I would like are an e-mail triage service that will convert my emails into markdown and assess for further actions, and a second service that will review my calendar on a regular basis and create OneNote pages in preparation for each meeting."

## Clarifications

### Session 2026-02-17

- Q: Where should the email triage markdown reports and consolidated summaries be stored? → A: Each triaged email will be saved in markdown format within a sub-directory called "events" within a configurable root directory. The "events" directory can contain emails and other event types. Each event will be available for other services to do additional triage - akin to an event bus.
- Q: How should the system handle missed task executions when it was offline or down during scheduled execution times? → A: Skip missed executions and resume at next scheduled time
- Q: What naming convention should be used for markdown event files in the events directory? → A: YYYYMMDD-{event-type}-{4-char-unique-id}.md format
- Q: When a task execution takes longer than its configured interval, what should happen? → A: Log warning and allow task to complete, prevent next execution until current completes
- Q: How should the system identify action items (questions, requests, deadlines) in email content? → A: AI/LLM analysis of email content using LocalFoundry

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure and Monitor Scheduled Tasks (Priority: P1)

As a system user, I need to configure recurring tasks to run automatically at specified intervals, so that routine operations happen without manual intervention.

**Why this priority**: This is the core infrastructure requirement - without the ability to configure and run scheduled tasks, none of the other features are possible. This establishes the foundation for automation.

**Independent Test**: Can be fully tested by creating a configuration file with simple test tasks (e.g., log a message every minute), verifying they execute on schedule, and observing logs to confirm execution timing and success/failure status.

**Acceptance Scenarios**:

1. **Given** a configuration file with multiple task definitions, **When** the heartbeat system starts, **Then** all configured tasks are loaded and scheduled according to their cadence specifications
2. **Given** a task configured to run every 5 minutes, **When** the scheduled time arrives, **Then** the task executes and completion status is recorded
3. **Given** a running heartbeat system, **When** the configuration file is modified, **Then** the system detects changes and reloads the schedule without requiring a restart
4. **Given** a task that fails during execution, **When** the failure occurs, **Then** the error is logged, the system remains stable, and subsequent scheduled executions continue

---

### User Story 2 - Automated Email Triage (Priority: P2)

As a busy professional, I want my emails automatically converted to markdown summaries with identified action items, so that I can quickly review what requires my attention without manually processing each message.

**Why this priority**: This is the first concrete business value application of the heartbeat system. It addresses a high-value use case (email management) and can operate independently once the core scheduler (P1) is functional.

**Independent Test**: Can be tested by configuring the email triage task to run every hour, sending test emails with various content types, and verifying that markdown summaries are generated with correctly identified action items (e.g., requests, deadlines, questions requiring responses).

**Acceptance Scenarios**:

1. **Given** unread emails in the inbox, **When** the email triage task executes, **Then** each email is converted to markdown format with sender, subject, date, and body content preserved and saved to the events directory
2. **Given** emails containing action items (questions, requests, deadlines), **When** the triage process analyzes the content, **Then** actionable items are identified and highlighted in the markdown output
3. **Given** multiple emails processed in a batch, **When** the triage task completes, **Then** each email is saved as a separate markdown file in the events directory
4. **Given** emails with attachments or special formatting, **When** converted to markdown, **Then** the essential information is preserved in a readable format with notes about attachments
5. **Given** triaged email events in the events directory, **When** other services scan the directory, **Then** they can access and process the markdown files for additional triage operations

---

### User Story 3 - Automated Meeting Preparation (Priority: P3)

As a meeting participant, I want OneNote pages automatically created for my upcoming meetings, so that I have a structured space for notes ready before each meeting starts.

**Why this priority**: This provides additional business value but depends on P1 (scheduler) and can be developed after P2. It's valuable but not blocking for the system to provide utility.

**Independent Test**: Can be tested by configuring the calendar review task to run hourly, scheduling test meetings, and verifying that OneNote pages are created with meeting details (title, time, participants, agenda if available) within the expected timeframe before the meeting.

**Acceptance Scenarios**:

1. **Given** upcoming meetings in the calendar, **When** the calendar review task executes, **Then** the system identifies all meetings scheduled for the next 7 days
2. **Given** a meeting identified for preparation, **When** a OneNote page is created, **Then** the page includes meeting title, date/time, participants list, and a structured template for notes
3. **Given** a meeting that already has a OneNote page, **When** the task runs again, **Then** the system detects the existing page and does not create a duplicate
4. **Given** a meeting with an agenda or description, **When** the OneNote page is created, **Then** the agenda content is included in the preparation template

---

### Edge Cases

- When the system is offline during a scheduled task execution time, missed executions are skipped and the system resumes at the next scheduled time
- When a task execution takes longer than its configured interval, the system logs a warning, allows the task to complete, and prevents the next scheduled execution until the current execution finishes
- What happens when the configuration file contains syntax errors or invalid cron expressions?
- How does the system handle tasks that require external services (email, calendar, OneNote) when those services are unavailable?
- What happens when a task execution is still running when the system needs to shut down?
- How does the system handle timezone considerations for scheduled tasks?
- What happens when multiple tasks are scheduled to run at the same time?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load task configurations from a file using crontab-like syntax for schedule definitions
- **FR-002**: System MUST support standard cron expressions including minute, hour, day, month, and day-of-week specifications
- **FR-003**: System MUST execute configured tasks at their specified intervals without manual intervention
- **FR-004**: System MUST log all task executions including start time, end time, success/failure status, and any error messages
- **FR-005**: System MUST continue operating and executing scheduled tasks even if individual tasks fail
- **FR-006**: System MUST detect when the configuration file is modified and reload the schedule at the next heartbeat cycle
- **FR-007**: System MUST prevent multiple concurrent executions of the same task instance
- **FR-007A**: System MUST skip missed task executions that occurred while the system was offline or unavailable, resuming at the next scheduled execution time
- **FR-007B**: When a task execution exceeds its configured interval, the system MUST log a warning, allow the task to complete, and skip the next scheduled execution until the current execution finishes
- **FR-008**: Email triage task MUST connect to the user's email account and retrieve unread messages
- **FR-009**: Email triage task MUST convert email content (subject, sender, date, body) to markdown format
- **FR-010**: Email triage task MUST analyze email content using AI/LLM to identify action items such as questions, requests, and deadlines
- **FR-011**: Email triage task MUST save each triaged email as a separate markdown file in the events sub-directory within a configurable root directory
- **FR-011A**: Event files MUST follow the naming convention YYYYMMDD-{event-type}-{unique-id}.md where the unique ID is no more than 4 characters and ensures uniqueness within a day
- **FR-012-NEW**: System MUST support a configurable root directory path for storing event files, with an "events" sub-directory for triaged items
- **FR-013**: Calendar review task MUST connect to the user's calendar and retrieve upcoming meetings
- **FR-014**: Calendar review task MUST create OneNote pages for identified meetings that don't already have preparation pages
- **FR-015**: Calendar review task MUST populate OneNote pages with meeting metadata (title, time, participants) and a note-taking template
- **FR-016**: System MUST handle task execution failures gracefully, logging errors and continuing with other scheduled tasks
- **FR-017**: System MUST persist task execution history for troubleshooting and monitoring purposes

### Key Entities

- **Task Configuration**: Represents a scheduled job definition including task identifier, cron schedule expression, task type (email triage, calendar review, etc.), task-specific parameters, and output directory paths
- **Task Execution Record**: Represents a single execution instance including task identifier, execution start time, end time, status (success/failure), output/error messages, and execution duration
- **Event File**: Represents a markdown file stored in the events directory following the naming convention YYYYMMDD-{event-type}-{4-char-id}.md, containing triaged content (emails or other event types) available for processing by other services in an event bus pattern
- **Email Triage Result**: Represents the processed output of an email stored as an Event File, including original message metadata, markdown-converted content, identified action items, and assessed priority level
- **Meeting Preparation Record**: Represents a meeting preparation task outcome including meeting identifier, calendar event details, OneNote page reference, and preparation status

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can configure new scheduled tasks by editing the configuration file and having them execute within one heartbeat cycle
- **SC-002**: Scheduled tasks execute within 30 seconds of their scheduled time under normal system load
- **SC-003**: Email triage process completes for batches of up to 50 emails within 5 minutes
- **SC-004**: Calendar review and OneNote page creation completes for up to 20 meetings within 3 minutes
- **SC-005**: System maintains 99% uptime for task execution (scheduled tasks run as expected without system crashes)
- **SC-006**: Users can review task execution history and identify failed tasks within 1 minute of system access
- **SC-007**: Email action item identification achieves 80% accuracy in detecting questions, requests, and deadlines from email content
- **SC-008**: Meeting preparation pages are created at least 2 hours before meeting start time for all identified meetings

## Assumptions

- The system has existing integration with Microsoft Graph API for email and calendar access (per CLAUDE.md)
- The system has existing integration with OneNote API (per Feature 013)
- Users have appropriate permissions configured for email, calendar, and OneNote access
- The configuration file format will support standard cron syntax that Node.js cron libraries can parse
- Task execution will be single-threaded per task type to avoid resource contention
- Email triage will process only unread emails by default to avoid re-processing
- Email action item identification will use AI/LLM analysis via LocalFoundry integration
- Email triage output will be stored in an "events" sub-directory within a configurable root directory path
- Event files follow naming convention: YYYYMMDD-{event-type}-{4-char-unique-id}.md for chronological sorting and uniqueness
- The events directory serves as an event bus, allowing other services to process triaged content
- Event files in the events directory can include emails and other event types for extensibility
- Calendar review will look ahead a configurable time window (default: 7 days)
- The system will use file-based logging for task execution history
- The root directory for events storage is configurable via the task configuration file
- Configuration file hot-reload will be triggered by file system watch events
- Tasks that exceed their execution interval will be logged as warnings, allowed to complete, and will block subsequent scheduled executions until completion
- Missed task executions (due to system downtime) are not executed retroactively; the system resumes at the next scheduled time

## Dependencies

- Existing Microsoft Graph API authentication (OAuth token storage in `.tokens/` directory)
- Existing OneNote API integration from Feature 013
- Existing LocalFoundry integration (Feature 011) for AI/LLM analysis
- Node.js cron scheduling library (e.g., node-cron)
- File system watch capability for configuration hot-reload
