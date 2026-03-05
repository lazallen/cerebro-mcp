# Feature Specification: Smart Meeting Scheduler

**Feature Branch**: `023-smart-meeting-scheduler`
**Created**: 2026-03-04
**Status**: Draft

## Core Scheduling Principles

These principles are the north star for all design decisions:

1. **Schedule 3 weeks in advance**: 1:1s and recurring meetings MUST be on people's calendars at least 21 days ahead. Sending invites on Monday for the same week prevents people from planning.
2. **Schedule once, leave it alone**: Once a meeting is booked, don't touch it unless there is a genuine conflict. Unnecessary rescheduling creates noise and erodes trust.
3. **48-hour protection**: Never reschedule a meeting within 48 hours of its start time — the disruption cost exceeds the benefit.
4. **Two-phase operation**:
   - **Forward scheduling** (runs daily): Look 21 days ahead, create any meeting instances not yet on the calendar
   - **Rebalancing** (runs periodically — cadence TBD): Scan the 3-week window for conflicts and imbalances, adjust as needed within the constraints above
5. **Time portfolio balance**: Laz's working week should maintain a healthy balance across three time categories:
   - **Focus time**: Uninterrupted deep work (no attendees, or explicitly blocked)
   - **Recurring meetings**: Operational/BAU 1:1s and team syncs — managed by this scheduler
   - **Ad hoc meetings**: Creative, alignment, spontaneous — not managed by this scheduler

   None of these categories should dominate for a prolonged period (currently defined as 2+ consecutive weeks). Short-term imbalance is acceptable — e.g. a sprint kick-off week heavy in ad hoc meetings — but Laz must be made aware when a sustained imbalance is detected. This awareness is the goal; the scheduler will not automatically cancel meetings to fix balance.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Schedule meetings 3 weeks in advance (Priority: P1)

Laz has a weekly 1:1 with Dorin. The daily heartbeat checks: is `Dorin:Laz 121` on the calendar for 3 weeks from now? If not, it finds a free slot in that target week and creates the event — giving Dorin 21 days notice. Laz never has to think about it, and Dorin can plan around it.

**Why this priority**: This is the core value proposition — proactive scheduling that respects people's planning horizon.

**Independent Test**: With one meeting in `smart-meetings-config.json` and no matching event in the 21-day window, the heartbeat creates the event targeted ~3 weeks out. Verifiable by checking the calendar.

**Acceptance Scenarios**:

1. **Given** a weekly meeting is configured and no event exists in the next 21 days, **When** the heartbeat runs, **Then** a new calendar event is created targeting the week 3 weeks from now
2. **Given** a fortnightly meeting is configured and the last occurrence was 10 days ago, **When** the heartbeat runs, **Then** a new event is created ~3 weeks from now (next expected cycle)
3. **Given** a meeting already exists within the next 21 days, **When** the heartbeat runs, **Then** no action is taken (leave it alone)

---

### User Story 2 — Rebalance: detect and resolve conflicts across the 3-week window (Priority: P2)

The periodic rebalance pass scans all smart meetings in the next 21 days. It finds that `Tim:Laz` on Thursday at 10:00 now clashes with a new all-hands booking. Since the meeting is more than 48 hours away, it reschedules Tim:Laz to Thursday at 14:00 where both are free.

**Why this priority**: Conflict detection after-the-fact (once meetings are scheduled 3 weeks out) is the key behaviour replacing Reclaim.

**Independent Test**: Schedule a smart meeting 2 weeks out, then create a conflicting event for the same slot. Run the rebalance pass — it should move the smart meeting.

**Acceptance Scenarios**:

1. **Given** a scheduled smart meeting has a conflict with a newer booking, **And** it is more than 48 hours away, **When** the rebalance pass runs, **Then** the meeting is moved to the next available slot in the same week
2. **Given** a scheduled smart meeting has a conflict, **But** it is within 48 hours, **When** the rebalance pass runs, **Then** no action is taken — flagged in logs only
3. **Given** no available slot exists in the same week after a conflict, **When** the rebalance pass runs, **Then** the meeting is moved to the following week and a log entry records why
4. **Given** a rescheduled meeting is moved, **Then** max 1 reschedule per meeting per rebalance run (no cascades)

---

### User Story 3 — History-weighted scheduling and cadence debt (Priority: P3)

When choosing a slot, the scheduler uses the last 3+ occurrences of each meeting to weight the scheduling decision — preferring the same day/time pattern where it has worked historically. Crucially, if a meeting has fallen behind its intended cadence, it is treated as higher priority and scheduled sooner than on-schedule meetings of the same cadence.

**Why this priority**: Makes scheduling feel consistent and personal. Prevents chronic de-prioritisation of relationships — if a fortnightly 1:1 keeps slipping, the system notices and moves it forward, not just to the default 3-week horizon.

**Independent Test**: Set a meeting's last history entry to 5 weeks ago with a fortnightly cadence. Verify the scheduler targets a slot within 1 week (not 3 weeks), and schedules it before an on-schedule fortnightly meeting when both compete for the same slots.

**Acceptance Scenarios**:

1. **Given** a meeting has 3+ history entries predominantly on Tuesdays, **When** finding a slot, **Then** the scheduler passes Tuesday as the first preference in `findMeetingTimes`
2. **Given** a meeting has no history, **When** finding a slot, **Then** the `idealDays` from config is used as the preference
3. **Given** a meeting occurs, **Then** a history entry is added (date, day-of-week, start time, status: `occurred`) and entries beyond `historyRetentionCount` are pruned
4. **Given** a fortnightly meeting last occurred 3 weeks ago (1 week overdue), **When** the forward scheduling pass runs, **Then** the meeting is targeted for the next available slot within ~2 weeks (not the default 3-week horizon)
5. **Given** a fortnightly meeting last occurred 5+ weeks ago (3+ weeks overdue), **When** the forward scheduling pass runs, **Then** the meeting is targeted for the earliest available slot within 1 week
6. **Given** two fortnightly meetings both need scheduling — one on-schedule, one 2 weeks overdue — **When** a slot conflict forces a choice, **Then** the overdue meeting is allocated the better (earlier/preferred-day) slot

---

### User Story 4 — Time portfolio balance report (Priority: P4)

The rebalance pass calculates what proportion of Laz's working hours over the past 2 weeks (and the coming 3 weeks) falls into each category: focus time, recurring meetings, ad hoc meetings. If any category has been dominant for 2+ consecutive weeks, the `smart_meetings_status` tool surfaces a balance warning — e.g. "Recurring meetings have accounted for >50% of working hours for the past 2 weeks."

**Why this priority**: Scheduling decisions optimised for individual meetings can still produce an unhealthy aggregate picture. This is visibility, not automation — Laz decides what to do with the information.

**Independent Test**: Populate the calendar with a clearly unbalanced week (e.g. all day meetings). Run the status tool — it should show the imbalance in the balance report section.

**Acceptance Scenarios**:

1. **Given** recurring meetings have dominated (>50% of working hours) for 2+ consecutive weeks, **When** `smart_meetings_status` is called, **Then** a balance warning is included in the response
2. **Given** the balance is healthy or imbalance has been present for only 1 week, **When** `smart_meetings_status` is called, **Then** the balance section shows the current split with no warning
3. **Given** a balance warning is active, **Then** the forward scheduling pass notes the imbalance in its log — but does NOT skip creating meetings because of it

---

### User Story 5 — Smart meetings dashboard (Priority: P5)

Laz opens `https://localhost:3333/smart-meetings` in a browser and sees a live status page: every configured meeting listed with its last occurrence, next scheduled datetime, cadence, and cadence debt. The time portfolio balance summary appears at the top. The page is read-only — changes to config are made by asking Claude to edit `smart-meetings-config.json` directly.

**Why this priority**: A single-glance view of the state of all 35 meetings is more useful than reading raw JSON or calling MCP tools manually. Mirrors the existing `/triage` dashboard pattern.

**Independent Test**: Navigate to `https://localhost:3333/smart-meetings` after the heartbeat has run — the page renders without errors and shows at least one meeting with a populated "next scheduled" date.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** `https://localhost:3333/smart-meetings` is loaded, **Then** all configured meetings are listed with: title, attendees, cadence, last occurrence date, next scheduled date/time (or "not yet scheduled"), cadence debt (days), and enabled/disabled status
2. **Given** a meeting has positive cadence debt, **When** the page is loaded, **Then** that meeting is visually highlighted (e.g. amber/red) to indicate it is overdue
3. **Given** the time portfolio has an active imbalance warning, **When** the page is loaded, **Then** a banner at the top shows the current week/last week split and the warning
4. **Given** a meeting is disabled, **When** the page is loaded, **Then** it appears greyed out at the bottom of the list
5. **Given** the page is refreshed, **Then** it reflects the current state of `smart-meetings-config.json` and the calendar without requiring a server restart

---

### Out of Scope (v1)

- **Video conferencing links**: `isOnlineMeeting: true` via Microsoft Graph returns `provider: unknown` for this tenant — no Teams or Zoom link is generated. Existing Reclaim meetings also have no embedded links, so this is not a regression. **Planned for v2**: Zoom API (`POST /v2/users/me/meetings`) using Skyscanner Zoom OAuth credentials (same tenant that powers the Slack `/zoom` integration).

---

### Edge Cases

- What happens when `findMeetingTimes` returns no available slots? → Log a warning, skip for this run, try again next day
- What if both attendees have no mutual availability in the window? → Leave unscheduled, log reason
- What if the config file is missing or malformed? → Heartbeat task fails gracefully, logs error, does not crash other heartbeat tasks
- What if a meeting has the wrong attendee email (bounces)? → Graph API returns error, log it, mark meeting as `errored` in state
- What about meetings where Laz is not the organiser? → Out of scope for v1; scheduler only creates/manages events where Laz is organiser
- Monthly meetings: "this month" window is the current calendar month; if already past mid-month and not scheduled, look at first week of next month

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read meeting definitions from `smart-meetings-config.json` at the project root
- **FR-002**: For each enabled meeting, the forward-scheduling pass MUST check whether a matching event exists within the next `lookAheadDays` days (default: 21)
- **FR-003**: Matching MUST be by title substring match AND at least one attendee match (to survive title edits)
- **FR-004**: If no matching event exists, system MUST call `findMeetingTimes` to find an available slot within the configured `window` and `idealDays`
- **FR-005**: System MUST create a calendar event if a suitable slot is found
- **FR-006**: System MUST NOT reschedule a meeting within `minNoticePeriodHours` (48h) of its current scheduled time
- **FR-007**: System MUST detect conflicts by checking if any attendee has a conflicting event during the scheduled slot
- **FR-008**: System MUST record each scheduled/occurred meeting in the `history` array within the config JSON, retaining up to `historyRetentionCount` entries per meeting
- **FR-009**: History entries MUST include: `date` (ISO8601), `dayOfWeek`, `startTime` (HH:MM), `status` (`scheduled` | `occurred` | `skipped`)
- **FR-010**: When selecting a slot, system MUST use history to derive day-of-week preference (mode of last 3+ occurrences), falling back to `idealDays` from config
- **FR-010a**: System MUST calculate a **cadence debt** for each meeting: `daysSinceLastOccurrence - expectedCadenceDays`. Positive debt means the meeting is overdue.
- **FR-010b**: Overdue meetings MUST be scheduled sooner than the default `lookAheadDays` horizon, using this scale:
  - Debt 0–6 days (slightly late): target ~2 weeks out
  - Debt 7–13 days (1 week overdue): target ~1 week out
  - Debt 14+ days (2+ weeks overdue): target as soon as possible (minimum 48h from now)
- **FR-010c**: When multiple meetings compete for the same scheduling pass, overdue meetings MUST be processed first (highest debt → highest priority)
- **FR-011**: System MUST expose a `smart_meetings_status` MCP tool returning the scheduling state of all configured meetings
- **FR-012**: Forward-scheduling pass MUST run daily; rebalance pass cadence is configurable (default: weekly on Monday morning)
- **FR-013**: System MUST NOT modify meetings managed by other organisers
- **FR-014**: When creating a new event, target date MUST be approximately `lookAheadDays` (21) days from now, within the configured window and ideal days
- **FR-015**: Rebalance pass MUST NOT run more frequently than its configured cadence — no cascading reschedules within a single run
- **FR-016**: System MUST categorise calendar events into three buckets:
  - `recurring`: event title matches a managed smart meeting in config, OR the Graph API event has a `recurrence` property set
  - `ad-hoc`: has attendees and does not qualify as `recurring`
  - `focus`: no attendees, or title contains focus keywords (configurable list, e.g. "Focus", "Deep Work", "Blocked") — **unbooked working time is also counted as implicit focus time**
- **FR-017**: Balance calculation MUST be performed by querying `calendarView` for the trailing 4 weeks on each rebalance pass (no persistent state required — the calendar is the source of truth). For each week, calculate hours in each category as a percentage of total working hours (Mon–Fri within configured `workingHoursStart`–`workingHoursEnd`).
- **FR-018**: System MUST detect sustained imbalance: any single category exceeding `imbalanceThresholdPct` (default: 50%) for `imbalanceWindowWeeks` (default: 2) consecutive weeks
- **FR-019**: When sustained imbalance is detected, `smart_meetings_status` MUST include a balance warning — but the scheduler MUST NOT automatically cancel or defer meetings as a result
- **FR-020**: Balance thresholds, focus keywords, and the sustained-imbalance window MUST be configurable in `smart-meetings-config.json`
- **FR-021**: The `smart_meetings_status` response MUST include a `timePortfolio` summary section structured so that downstream skills (e.g. `morning-calendar`) can include it in their output without calling additional tools. The summary MUST include: this-week split (%), last-week split (%), trend (improving/stable/worsening per category), and any active imbalance warnings.
- **FR-022**: A web dashboard MUST be served at `GET /smart-meetings` on the existing OAuth server (port 3333), following the same pattern as the `/triage` UI
- **FR-023**: The dashboard MUST display for each meeting: title, attendees, cadence, last occurrence date, next scheduled datetime (or "not yet scheduled"), cadence debt in days, enabled/disabled status
- **FR-024**: Meetings with positive cadence debt MUST be visually distinguished (amber for 1–13 days overdue, red for 14+ days overdue)
- **FR-025**: The dashboard MUST show the time portfolio balance summary and any active imbalance warnings at the top of the page
- **FR-026**: The dashboard is read-only — no editing via the UI. Config changes are made by editing `smart-meetings-config.json` directly (via Claude or manually)

### Key Entities

- **MeetingDefinition**: Configuration entry — id, title, attendees, durationMinutes, cadence (frequency + idealDays), window (days/start/end), history[], enabled
- **MeetingHistory**: Per-occurrence record — date, dayOfWeek, startTime, status
- **CadenceDebt**: Derived value per meeting — `daysSinceLastOccurrence - expectedCadenceDays`. Surfaced in `smart_meetings_status` to show which relationships are falling behind.
- **SchedulerState**: Runtime state tracking last-run timestamps per meeting (to enforce 12h minimum run frequency)
- **SmartMeetingTask**: The heartbeat task class that implements the scheduling loop
- **SmartMeetingRouter**: Express router mounted at `/smart-meetings` on the OAuth server, serving the HTML dashboard (mirrors `TriageRouter` pattern from spec 022)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 34 active meetings from Reclaim are present in the config with correct cadence and attendees (35 originally extracted; 1 George-owned meeting excluded per FR-013)
- **SC-002**: Heartbeat runs and schedules at least one unscheduled meeting correctly in the first automated test
- **SC-003**: No meeting is rescheduled within 48 hours of its current time (zero tolerance)
- **SC-004**: After one month of operation, history arrays are populated for all active meetings with 3+ entries
- **SC-005**: System creates zero duplicate events (idempotent: running heartbeat twice in a row makes no changes if meetings are already scheduled)
- **SC-006**: Reclaim smart meetings can be fully disabled after this feature is live and all meetings are being managed by cerebro
