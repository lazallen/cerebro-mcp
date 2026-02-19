# Data Model: Journal Triage Heartbeat Task

**Feature**: 018-journal-triage | **Phase**: 1 - Design | **Date**: 2026-02-18

## Entity Definitions

### 1. DailyJournal

Represents a complete daily journal file combining frontmatter, user-created content, and automated meeting entries.

**TypeScript Interface**:
```typescript
interface DailyJournal {
  filePath: string;                    // Absolute path: {rootDir}/areas/journal/2026-02/2026-02-18.md
  frontmatter: JournalFrontmatter;     // YAML frontmatter
  morningCheckIn?: string;             // Markdown content of Morning Check-In section
  priorities?: string;                 // Markdown content of Top 3 Priorities section
  schedule: MeetingEntry[];            // Array of meeting entries for the day
  heartbeatSummary?: HeartbeatSummary; // Automated task execution summary
  shutdownReview?: string;             // Markdown content of Shutdown Review section
}
```

**Field Sources**:
- **User-created**: morningCheckIn, priorities, shutdownReview, frontmatter (energy levels)
- **System-created**: schedule (auto-populated from calendar), heartbeatSummary
- **Mixed**: frontmatter.date, frontmatter.day (system-set, user-editable)

### 2. JournalFrontmatter

YAML frontmatter at the top of each daily journal file.

**TypeScript Interface**:
```typescript
interface JournalFrontmatter {
  date: string;                        // YYYY-MM-DD format (e.g., "2026-02-18")
  day: string;                         // Day of week (e.g., "Monday")
  type: 'daily-planning';              // Literal type for daily journals
  'energy-level': number;              // User's morning energy (1-10 scale)
  'energy-description': string;        // User's morning energy description
  'end-energy-level'?: number;         // User's evening energy (optional)
  'end-energy-description'?: string;   // User's evening energy description (optional)
  'shutdown-complete'?: boolean;       // Whether shutdown review was completed (optional)
}
```

**Validation Rules**:
- `date`: Must match filename and be valid YYYY-MM-DD
- `day`: Must match actual day of week for the date
- `energy-level` and `end-energy-level`: Must be integers 1-10
- `type`: Always "daily-planning" for consistency

**System Responsibility**:
- Create default frontmatter when creating new journal file
- Never modify energy fields or shutdown flags

### 3. MeetingEntry

Structured section within a daily journal representing one calendar meeting.

**TypeScript Interface**:
```typescript
interface MeetingEntry {
  // Calendar-sourced metadata (auto-updated)
  time: string;                        // "08:00-09:00" or "08:00 AM" or "All Day"
  title: string;                       // Meeting title
  attendees?: string;                  // Comma-separated, may include [[wiki-links]]
  location?: string;                   // Physical or virtual location
  eventId: EventIdLink;                // Microsoft Graph event ID

  // User-created content (never overwritten)
  relatedLinks?: string;               // Wiki links to related tasks/people
  prepNotes?: string;                  // User's prep notes (markdown)
  meetingNotes?: string;               // User's meeting notes (markdown)

  // System flags
  isCancelled?: boolean;               // Marks deleted calendar events
}

interface EventIdLink {
  id: string;                          // Microsoft Graph event ID
  format: 'plain' | 'markdown-link';   // Support both formats
}
```

**Markdown Representation**:
```markdown
### 08:00-09:00 - Team Standup

**Attendees:** [[people/colleagues/Alice]], [[people/colleagues/Bob]], _(and 5 more...)_
**Location:** https://zoom.us/j/123456789
**Related:** [[tasks/project-alpha]]
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**
- Review yesterday's action items
- Prepare sprint velocity update

**Meeting Notes:**
-

---
```

**Field Sources**:
- **Calendar (auto-update)**: time, title, attendees, location, eventId
- **User (preserve)**: relatedLinks, prepNotes, meetingNotes
- **System flags**: isCancelled

### 4. CalendarEvent

Represents a Microsoft Graph API calendar event.

**TypeScript Interface** (simplified from Graph API):
```typescript
interface CalendarEvent {
  id: string;                          // Unique event ID (matches EventId)
  subject: string;                     // Meeting title
  start: {
    dateTime: string;                  // ISO 8601: "2026-02-18T08:00:00"
    timeZone: string;                  // "UTC" or IANA timezone
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName?: string;              // Location description
    locationUri?: string;              // URL for virtual meetings
  };
  attendees?: Array<{
    emailAddress: {
      name?: string;
      address: string;
    };
    type: string;                      // "required", "optional", "resource"
  }>;
  isCancelled?: boolean;               // Graph API cancellation flag
  isAllDay?: boolean;                  // All-day event flag
}
```

**Mapping to MeetingEntry**:
- `id` → `eventId.id`
- `subject` → `title`
- `start` + `end` → `time` (formatted)
- `location` → `location`
- `attendees` → `attendees` (formatted with wiki links where possible)
- `isCancelled` → `isCancelled`

### 5. HeartbeatSummary

System-generated section documenting automated work performed by the journal triage task.

**TypeScript Interface**:
```typescript
interface HeartbeatSummary {
  timestamp: string;                   // ISO 8601 timestamp of execution
  taskName: string;                    // "journal-triage"
  entriesCreated: number;              // Count of new journal entries
  entriesUpdated: number;              // Count of updated entries
  onenotePagesSynced: number;          // Count of OneNote pages created/updated
  errors?: string[];                   // List of errors encountered
}
```

**Markdown Representation**:
```markdown
## Heartbeat Summary

**Last Run**: 2026-02-18T10:30:00Z
**Task**: journal-triage

- Created 3 new journal entries
- Updated 2 existing entries
- Synced 5 OneNote pages
- Errors: None

---
```

## State Transitions

### State Diagram

```
[Calendar Event] ──fetch──> [Task Execution]
                                  │
                                  ├──parse──> [Daily Journal File]
                                  │                │
                                  │                ├──match EventId──> [Existing Entry?]
                                  │                │                        │
                                  │                │              ┌─────────┴─────────┐
                                  │                │              │                   │
                                  │                │            Yes                  No
                                  │                │              │                   │
                                  │                │              v                   v
                                  │                │        [Merge Entry]      [Create Entry]
                                  │                │              │                   │
                                  │                │              └─────────┬─────────┘
                                  │                │                        │
                                  │                │                        v
                                  │                └─────────> [Write Journal File]
                                  │
                                  └──sync──> [OneNote Section]
                                                     │
                                                     ├──find/create section──> "2026-02 Meetings"
                                                     │
                                                     └──update page──> [OneNote Page]
                                                                            │
                                                                            v
                                                                      (Prep Notes Content)
```

### Transition Rules

#### 1. New Calendar Event → Create Journal Entry

**Conditions**:
- Calendar event exists within lookahead period (default: 7 days)
- No existing journal entry with matching EventId
- Event is not cancelled

**Actions**:
1. Determine target journal file: `{date}/YYYY-MM-DD.md`
2. Create file if doesn't exist (with default frontmatter)
3. Insert new meeting entry in chronological position
4. Set all calendar-sourced fields from event
5. Initialize empty prep notes and meeting notes sections
6. Write journal file
7. Create OneNote page with meeting title in "YYYY-MM Meetings" section

#### 2. Updated Calendar Event → Merge with Existing Entry

**Conditions**:
- Calendar event exists
- Existing journal entry found with matching EventId
- Calendar metadata has changed (title, time, location, attendees)

**Actions**:
1. Read existing journal file
2. Locate meeting entry by EventId
3. **Preserve**: prepNotes, meetingNotes, relatedLinks (user content)
4. **Update**: time, title, location, attendees (calendar metadata)
5. Maintain entry position in file
6. Write journal file
7. Update OneNote page with new metadata (preserve existing notes)

#### 3. Deleted Calendar Event → Mark as Cancelled

**Conditions**:
- Journal entry exists with EventId
- Calendar event no longer exists in Graph API

**Actions**:
1. Read existing journal file
2. Locate meeting entry by EventId
3. Set `isCancelled` flag to true
4. Add "(CANCELLED)" suffix to title
5. **Preserve all user content** (prep notes, meeting notes)
6. Write journal file
7. Update OneNote page to indicate cancellation

#### 4. Journal Entry → OneNote Page Sync

**Conditions**:
- Meeting entry exists in journal with EventId
- OneNote sync enabled in task config

**Actions**:
1. Determine OneNote section: "{YYYY-MM} Meetings" (e.g., "2026-02 Meetings")
2. Ensure section exists (create if needed)
3. Search for existing page by meeting title
4. If page exists: Update content with latest prep notes
5. If page doesn't exist: Create new page with meeting metadata + prep notes
6. Handle OneNote failures with exponential backoff retry

## Data Flow

### Primary Flow: Calendar → Journal → OneNote

```
┌─────────────────┐
│ Microsoft Graph │
│  Calendar API   │
└────────┬────────┘
         │
         │ fetch events (7 days)
         │
         v
┌─────────────────┐
│ Journal Triage  │
│      Task       │
└────────┬────────┘
         │
         ├─────> Read Daily Journal Files
         │       │
         │       ├─> Parse frontmatter
         │       ├─> Extract meeting entries
         │       └─> Build EventId → Entry map
         │
         ├─────> Match Events to Entries
         │       │
         │       ├─> New event? → Create entry
         │       ├─> Existing event? → Merge entry
         │       └─> Deleted event? → Mark cancelled
         │
         ├─────> Write Updated Journal Files
         │       │
         │       └─> Atomic file write with lock
         │
         └─────> Sync to OneNote
                 │
                 ├─> Find/Create section "{YYYY-MM} Meetings"
                 ├─> Find/Create page with meeting title
                 └─> Update page content with prep notes
```

### Merge Logic Detail

```
Existing Entry:
  time: "08:00-09:00"
  title: "Team Standup"
  attendees: "Alice, Bob"
  prepNotes: "- Review action items\n- Check sprint velocity"
  meetingNotes: "- Discussed blockers\n- Updated timeline"

Calendar Update:
  time: "08:30-09:30"        # Time changed
  title: "Team Standup"
  attendees: "Alice, Bob, Carol"  # Attendee added

Merged Entry:
  time: "08:30-09:30"        # ✅ UPDATED from calendar
  title: "Team Standup"      # ✅ No change
  attendees: "Alice, Bob, Carol"  # ✅ UPDATED from calendar
  prepNotes: "- Review action items\n- Check sprint velocity"  # ✅ PRESERVED
  meetingNotes: "- Discussed blockers\n- Updated timeline"     # ✅ PRESERVED
```

## Validation Rules

### File-Level Validation

- **Filename**: Must match pattern `YYYY-MM-DD.md`
- **Frontmatter**: Must be valid YAML between `---` delimiters
- **Date Consistency**: `frontmatter.date` must match filename date
- **Day Consistency**: `frontmatter.day` must match actual day of week

### Entry-Level Validation

- **EventId**: Must be non-empty string (Graph API format)
- **Time Format**: Must match one of:
  - `HH:MM-HH:MM` (e.g., "08:00-09:00")
  - `HH:MM AM/PM` (e.g., "08:00 AM")
  - `All Day`
- **Title**: Must be non-empty string
- **Section Markers**: Must have exact markdown:
  - `**Prep Notes:**`
  - `**Meeting Notes:**`
  - `**EventId:**`
  - Horizontal rule `---` between meetings

### OneNote Validation

- **Section Name**: Must match `YYYY-MM Meetings` format
- **Page Title**: Must match meeting title (max 255 characters for OneNote)
- **Content**: Must be valid HTML or markdown (depending on OneNote API format)

## Examples

### Complete Daily Journal File

```markdown
---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Feeling productive and focused"
end-energy-level: 6
end-energy-description: "Good day, slightly tired"
shutdown-complete: true
---

# Tuesday, February 18, 2026

## Morning Check-In

**Energy Level:** 7/10 - Feeling productive and focused

**Exercise Plans:** 30-minute run after work

**Other Thoughts:** Focus on finishing the journal triage feature today.

## Top 3 Priorities

1. **Complete journal triage implementation** - Finish merge logic and tests
2. **Review PR from Alice** - Provide feedback on authentication changes
3. **Prep for tomorrow's planning meeting** - Review Q1 roadmap

## Today's Schedule

### 08:00-09:00 - Team Standup

**Attendees:** [[people/colleagues/Alice]], [[people/colleagues/Bob]], _(and 5 more...)_
**Location:** https://zoom.us/j/123456789
**Related:** [[tasks/sprint-planning]]
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**
- Review yesterday's action items
- Prepare sprint velocity update

**Meeting Notes:**
- Discussed blockers with the authentication service
- Updated timeline for Q1 deliverables

---

### 10:00-11:00 - 1:1 with Manager

**Attendees:** [[people/manager/Jane]]
**Location:** EDI-L2 Conference Room A
**Related:** [[career/growth-plan]]
**EventId:** [eventId](BBNkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNh...)

**Prep Notes:**
- Discuss promotion timeline
- Ask about new project opportunities

**Meeting Notes:**
-

---

### 14:00-15:00 - Architecture Review (CANCELLED)

**Attendees:** Engineering Team
**Location:** Virtual
**Related:**
**EventId:** [eventId](CCNkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNh...)

**Prep Notes:**
- Review proposed design documents

**Meeting Notes:**
-

---

## Heartbeat Summary

**Last Run**: 2026-02-18T16:00:00Z
**Task**: journal-triage

- Created 2 new journal entries
- Updated 1 existing entry
- Synced 3 OneNote pages
- Errors: None

---

## Shutdown Review

**Energy Level:** 6/10 - Good day, slightly tired

**Accomplishments:**
- Completed journal triage merge logic
- Reviewed Alice's PR and provided detailed feedback
- Prepared materials for tomorrow's planning meeting

**Priority After Holiday:** Continue work on authentication refactor

**Challenges/Blockers:** Authentication service had intermittent issues this morning

**Gratitude:** Alice for the thorough code review

**Exercise Completed:** Yes - 30-minute run

**Additional Reflections:** Productive day overall. Ready for tomorrow's planning session.
```

### Meeting Entry Before/After Update

**Before (Initial Creation from Calendar)**:
```markdown
### 08:00-09:00 - Team Standup

**Attendees:** Alice, Bob
**Location:** https://zoom.us/j/123456789
**Related:**
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**


**Meeting Notes:**


---
```

**User Adds Content**:
```markdown
### 08:00-09:00 - Team Standup

**Attendees:** Alice, Bob
**Location:** https://zoom.us/j/123456789
**Related:** [[tasks/sprint-planning]]
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**
- Review yesterday's action items
- Prepare sprint velocity update

**Meeting Notes:**
- Discussed blockers
- Updated timeline

---
```

**After (Calendar Update - Time Changed, Attendee Added)**:
```markdown
### 08:30-09:30 - Team Standup

**Attendees:** Alice, Bob, Carol
**Location:** https://zoom.us/j/123456789
**Related:** [[tasks/sprint-planning]]
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**
- Review yesterday's action items
- Prepare sprint velocity update

**Meeting Notes:**
- Discussed blockers
- Updated timeline

---
```

**Key**: Time and attendees updated from calendar, but Related links and all notes preserved.

### OneNote Page Structure

**Section**: "2026-02 Meetings"

**Page Title**: "Team Standup"

**Page Content** (HTML for OneNote API):
```html
<html>
<body>
  <h1>Team Standup</h1>

  <p><strong>Time:</strong> 08:30-09:30</p>
  <p><strong>Date:</strong> Tuesday, February 18, 2026</p>
  <p><strong>Location:</strong> <a href="https://zoom.us/j/123456789">https://zoom.us/j/123456789</a></p>
  <p><strong>Attendees:</strong> Alice, Bob, Carol</p>

  <h2>Pre-Read / Prep Notes</h2>
  <ul>
    <li>Review yesterday's action items</li>
    <li>Prepare sprint velocity update</li>
  </ul>

  <h2>Meeting Notes</h2>
  <p><em>(Space for notes during/after meeting)</em></p>

  <hr />
  <p><small>Auto-generated from calendar | <a href="[journal-file-link]">View Journal Entry</a></small></p>
</body>
</html>
```

## Performance Characteristics

### Memory Footprint

- **Daily Journal File**: ~5-20 KB (10-30 meetings)
- **Parsed Journal Object**: ~50-200 KB in memory
- **EventId Map**: ~1 KB per 100 events
- **Total Memory**: <10 MB for 7-day processing

### Time Complexity

- **Parse Journal**: O(n) where n = file size in lines
- **EventId Lookup**: O(1) with hash map
- **Merge Entry**: O(n) where n = number of meetings in day
- **Write Journal**: O(n) where n = file size in lines
- **OneNote Sync**: O(m) where m = number of meetings to sync

### Expected Performance

- Parse + merge + write one journal file: <50ms
- Process 100 events across 7 days: <1 second
- OneNote sync for 20 meetings: <5 seconds (including retries)
- **Total execution time**: <2 minutes for 100 events (within SC-004 requirement)

---

**Next**: Generate contracts/journal-format.md with formal specification and validation rules.
