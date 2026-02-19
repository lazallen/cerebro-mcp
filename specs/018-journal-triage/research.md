# Research: Journal Triage Heartbeat Task

**Feature**: 018-journal-triage | **Phase**: 0 - Technical Research | **Date**: 2026-02-18

## Research Questions

1. What is the exact structure of journal frontmatter properties and their types?
2. How are meeting entries formatted (headings, sections, EventId links, attendees)?
3. What markdown parsing library should be used for reading/writing journal files?
4. How should calendar metadata be merged with user content without overwriting notes?
5. How does the existing OneNote integration create and manage sections?
6. What is the optimal EventId matching strategy for performance?

## Findings

### 1. Journal File Structure Analysis

**VALIDATED WITH ACTUAL FILES** ✅

**Location**: `context/areas/journal/YYYY-MM/YYYY-MM-DD.md`

**Directory Structure**:
- Monthly folders: `2026-01/`, `2026-02/`
- Daily files: `2026-01-26.md`, `2026-02-17.md`

#### Frontmatter Properties

Analyzed files: `2026-01-26.md`, `2026-01-29.md`, `2026-02-02.md`, `2026-02-17.md`, `2026-02-18.md`

**Core Properties (All Files)**:
```yaml
---
date: 2026-01-26           # string (YYYY-MM-DD format)
day: Monday                # string (day of week)
type: daily-planning       # string (always "daily-planning" for daily journals)
energy-level: 7            # number (1-10 scale)
energy-description: "..."  # string (quoted)
end-energy-level: 6        # number (optional, filled at shutdown)
end-energy-description: "..." # string (optional, filled at shutdown)
shutdown-complete: true    # boolean (optional, indicates shutdown review completed)
---
```

**Type Information**:
```typescript
interface JournalFrontmatter {
  date: string;              // YYYY-MM-DD
  day: string;               // Day name
  type: 'daily-planning';    // Literal type
  'energy-level': number;    // 1-10
  'energy-description': string;
  'end-energy-level'?: number;
  'end-energy-description'?: string;
  'shutdown-complete'?: boolean;
}
```

#### Meeting Entry Structure

**Two Format Variations Found**:

**Format 1: Simple EventId (2026-01-26.md)**:
```markdown
### 08:00 AM - Drop Kids At School

**Attendees:** You
**Related:**
**EventId:** AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNgFRAAgI3lxt2UvAAEYAAAAAh9hMMun-XkW1F2jj5jUovQcAewn2xvP8akidkLAGuDrGfgAAAJFwggAA4bxtABK99E_qP4WQ4__wbQAHl1wrwAAAEA==

**Prep Notes:**
-

**Meeting Notes:**
-

---
```

**Format 2: Markdown Link EventId (2026-01-29.md, 2026-02-02.md, 2026-02-17.md, 2026-02-18.md)**:
```markdown
### 08:00-09:00 - Drop Kids At School

**Related:**
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNgFRAAgI3l7JWIkAAEYAAAAAh9hMMun-XkW1F2jj5jUovQcAewn2xvP8akidkLAGuDrGfgAAAJFwggAA4bxtABK99E_qP4WQ4__wbQAHl1wrwAAAEA==)

**Prep Notes:**

**Meeting Notes:**

---
```

**Key Observations**:
- EventId can be plain text OR markdown link format `[eventId](...)`
- Attendees may include wiki-style links: `[[people/colleagues/Anne Doyle]]`
- Attendees may be truncated: `_(and 34 more attendees - list truncated)_`
- Location field appears in later files (2026-02-02.md onwards)
- Time format varies: `08:00 AM` vs `08:00-09:00` vs `08:00`
- Related field may contain wiki links to tasks/people
- Horizontal rule `---` separates meetings

**Standard Meeting Section Template**:
```markdown
### [TIME] - [MEETING TITLE]

**Attendees:** [NAME], [NAME] _(and N+ more attendees)_
**Location:** [LOCATION]
**Related:** [[task/link]]
**EventId:** [eventId](GRAPH_API_EVENT_ID)

**Prep Notes:**

**Meeting Notes:**

---
```

#### EventId Format

**Extracted Examples**:
- Format: Microsoft Graph API Event ID (base64-like string)
- Length: ~300 characters
- Contains: Uppercase letters, lowercase letters, numbers, special chars (`=`, `-`, `_`)
- Two styles found:
  1. Plain: `AAMkADA0ZWY5ODYyL...`
  2. Markdown link: `[eventId](AAMkADA0ZWY5ODYyL...)`

**Parsing Strategy**:
```typescript
// Extract EventId from either format
function extractEventId(text: string): string | null {
  // Try markdown link format first
  const linkMatch = text.match(/\[eventId\]\(([^)]+)\)/);
  if (linkMatch) return linkMatch[1];

  // Try plain format (EventId: followed by ID)
  const plainMatch = text.match(/EventId:\s*([A-Za-z0-9=_-]+)/);
  if (plainMatch) return plainMatch[1];

  return null;
}
```

#### Attendee Formatting

**Patterns Observed**:
- Simple names: `Anne Doyle, David Feng, Stuart Davidson`
- Wiki links: `[[people/colleagues/Lloyd Major]]`
- Pipe format: `[[people/direct-reports/Jacek Wojdel/Jacek Wojdel|Jacek Wojdel]]`
- Truncation: `_(and 12+ more attendees - list truncated)_`
- "You" for single-person events
- Combination: `[[people/colleagues/Ryan Crawford|Ryan Crawford]]` and plain names

**Recommendation**: Store attendees as comma-separated plain text, let user add wiki links manually if desired.

---

### 2. Markdown Parsing Library Comparison

**OPTIONS EVALUATED**:

#### Option A: gray-matter (Dedicated Frontmatter Parser)
- **NPM Package**: `gray-matter` v4.0.3
- **Current Status**: NOT installed in package.json
- **Pros**:
  - Purpose-built for frontmatter parsing
  - Handles YAML, JSON, TOML formats
  - Mature (10+ years old)
  - Simple API: `matter(content)` returns `{ data, content }`
  - Preserves original formatting
- **Cons**:
  - Additional dependency
  - Doesn't parse markdown content structure
- **Usage**:
```typescript
import matter from 'gray-matter';

const file = await fs.readFile('journal.md', 'utf-8');
const { data, content } = matter(file);
// data = frontmatter object
// content = markdown body
```

#### Option B: marked + js-yaml (Existing Dependencies)
- **NPM Packages**: `marked` v17.0.1 (installed), `js-yaml` v4.1.1 (installed)
- **Current Status**: BOTH already in package.json
- **Pros**:
  - No new dependencies
  - `marked` already used in OneNote integration (feature 013)
  - `js-yaml` available as transitive dependency
  - Full markdown parsing capability
- **Cons**:
  - Manual frontmatter extraction required
  - More complex implementation
- **Usage**:
```typescript
import { marked } from 'marked';
import yaml from 'js-yaml';

const file = await fs.readFile('journal.md', 'utf-8');

// Extract frontmatter manually
const frontmatterMatch = file.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
if (frontmatterMatch) {
  const frontmatter = yaml.load(frontmatterMatch[1]);
  const content = frontmatterMatch[2];
}
```

#### Option C: Custom Regex (Lightweight)
- **Dependencies**: None
- **Pros**:
  - Zero dependencies
  - Full control over parsing
  - Fast for simple extraction
- **Cons**:
  - Must handle edge cases manually
  - YAML parsing still needs js-yaml
  - Harder to maintain
- **Usage**:
```typescript
function parseFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = yaml.load(match[1]);
  const body = match[2];
  return { frontmatter, body };
}
```

**RECOMMENDATION**: **Option A (gray-matter)**

**Rationale**:
1. Purpose-built for this exact use case (frontmatter parsing)
2. Handles edge cases (multiple `---` in document, various YAML styles)
3. Small dependency (~20KB)
4. Industry standard (used by Gatsby, Next.js, many static site generators)
5. Preserves formatting when re-writing files
6. `marked` can still be used for markdown content parsing if needed
7. More maintainable than custom regex solution

---

### 3. Merge Strategy for Preserving User Content

**REQUIREMENT**: Update calendar metadata without overwriting user notes (FR-016)

**Fields from Calendar (Auto-Update)**:
- Meeting title (heading)
- Time/date
- Location
- Attendees list
- EventId (immutable identifier)

**Fields from User (Never Overwrite)**:
- Prep Notes section content
- Meeting Notes section content
- Related field (user-added wiki links)

**Implementation Strategy**:

```typescript
interface MeetingEntry {
  // Calendar-sourced (auto-update)
  time: string;
  title: string;
  location?: string;
  attendees: string[];
  eventId: string;

  // User-sourced (preserve)
  prepNotes: string;
  meetingNotes: string;
  related: string;
}

async function mergeCalendarToJournal(
  existingEntry: MeetingEntry | null,
  calendarEvent: CalendarEvent
): Promise<MeetingEntry> {
  return {
    // Auto-update from calendar
    time: calendarEvent.start,
    title: calendarEvent.subject,
    location: calendarEvent.location?.displayName,
    attendees: calendarEvent.attendees.map(a => a.emailAddress.name),
    eventId: calendarEvent.id,

    // Preserve existing user content
    prepNotes: existingEntry?.prepNotes || '',
    meetingNotes: existingEntry?.meetingNotes || '',
    related: existingEntry?.related || '',
  };
}
```

**Write Strategy**:
1. Parse existing journal file with `gray-matter`
2. Extract all meeting sections using regex
3. For each calendar event:
   - Check if EventId exists in journal
   - If exists: Extract user content, merge with calendar metadata
   - If new: Create new entry with empty user sections
4. Reconstruct markdown with updated entries
5. Preserve all non-meeting content (Morning Check-In, Top Priorities, Shutdown Review)

**Section Extraction Pattern**:
```typescript
// Match meeting sections (### heading through ---)
const meetingPattern = /### (.+?)\n\n([\s\S]+?)(?=\n---\n|$)/g;

function extractMeetings(journalBody: string): Map<string, MeetingEntry> {
  const meetings = new Map<string, MeetingEntry>();

  for (const match of journalBody.matchAll(meetingPattern)) {
    const [_, heading, body] = match;

    const eventIdMatch = body.match(/EventId:\s*(?:\[eventId\]\()?([^)\s]+)/);
    if (!eventIdMatch) continue;

    const eventId = eventIdMatch[1];
    const prepNotes = extractSection(body, 'Prep Notes:');
    const meetingNotes = extractSection(body, 'Meeting Notes:');

    meetings.set(eventId, {
      eventId,
      heading,
      prepNotes,
      meetingNotes,
      // ... other fields
    });
  }

  return meetings;
}
```

---

### 4. OneNote Integration Patterns

**EXISTING IMPLEMENTATION** (Feature 013)

**File**: `src/services/microsoft/onenote-client.ts`

#### Section Management

**Section Naming Convention**:
```typescript
// From feature 013 spec (research.md line 350)
// Format: "YYYY-MM-DD Meetings"
// Example: "2026-02-18 Meetings"
```

**Key Methods**:
```typescript
class OneNoteClient {
  // Find or create section
  async ensureSectionExists(notebookId: string, sectionName: string): Promise<OneNoteSection>

  // List pages in section
  async listPagesInSection(sectionId: string): Promise<OneNotePage[]>

  // Check for duplicate page
  async isDuplicatePage(sectionId: string, meetingTitle: string): Promise<boolean>

  // Create page with HTML content
  async createPage(sectionId: string, title: string, htmlContent: string): Promise<OneNotePage>

  // Update existing page
  async updatePageContent(pageId: string, title: string, htmlContent: string): Promise<OneNotePage>

  // Find page by title
  async findPageByTitle(sectionId: string, pageTitle: string): Promise<OneNotePage | null>
}
```

**Section Strategy for Journal Triage**:
- Create monthly sections: "2026-02 Meetings" (not daily like feature 013)
- Match journal folder structure: `journal/2026-02/` → "2026-02 Meetings"
- Reuse section throughout the month
- Each meeting gets its own page within the section

**Page Naming**:
- Use meeting title as page name
- OneNote API matches by exact title for duplicate detection
- Example: "Travel Platform ELT", "[SD/LM] 1:1"

#### Content Conversion

**Markdown to HTML** (already implemented in feature 013):
```typescript
import { marked } from 'marked';

function markdownToOneNoteHtml(title: string, markdown: string): string {
  const bodyHtml = marked.parse(markdown);
  return `
<!DOCTYPE html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta name="created" content="${new Date().toISOString()}" />
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>
  `.trim();
}
```

**For Journal Triage**:
- Extract Prep Notes from journal entry
- Convert to HTML using `marked`
- Include meeting metadata (date, time, attendees) in page body
- Structure:
  ```html
  <h2>Meeting Details</h2>
  <p><strong>Date:</strong> 2026-02-18</p>
  <p><strong>Time:</strong> 09:00</p>
  <p><strong>Attendees:</strong> Anne Doyle, Ryan Crawford</p>

  <h2>Preparation Notes</h2>
  [Converted prep notes markdown]
  ```

---

### 5. EventId Matching Strategy

**REQUIREMENT**: Efficiently match calendar events to journal entries (FR-004, FR-014)

**Performance Considerations**:
- 7-day lookahead (default) = ~30-50 calendar events
- Single daily journal file = ~10-20 meetings
- Operation runs on schedule (every hour or configurable)

**Strategy Recommendation**: **In-Memory Hash Map**

**Rationale**:
1. Small dataset (< 100 entries)
2. Single file per day (fast filesystem read)
3. O(1) lookup time
4. No database overhead

**Implementation**:
```typescript
interface JournalIndex {
  date: string;
  eventIdMap: Map<string, MeetingEntry>;
}

async function buildJournalIndex(journalPath: string): Promise<JournalIndex> {
  const file = await fs.readFile(journalPath, 'utf-8');
  const { data, content } = matter(file);

  const eventIdMap = new Map<string, MeetingEntry>();

  // Extract all meeting sections
  const meetingPattern = /### (.+?)\n\n([\s\S]+?)(?=\n---\n|$)/g;

  for (const match of content.matchAll(meetingPattern)) {
    const [_, heading, body] = match;
    const eventId = extractEventId(body);

    if (eventId) {
      eventIdMap.set(eventId, parseMeetingEntry(heading, body));
    }
  }

  return {
    date: data.date,
    eventIdMap,
  };
}

// Usage in heartbeat task
async function syncCalendarToJournal(events: CalendarEvent[]) {
  const journalsByDate = new Map<string, JournalIndex>();

  // Build index for affected dates
  for (const event of events) {
    const date = formatDate(event.start);
    if (!journalsByDate.has(date)) {
      const path = getJournalPath(date);
      journalsByDate.set(date, await buildJournalIndex(path));
    }
  }

  // Match events to journals
  for (const event of events) {
    const date = formatDate(event.start);
    const journal = journalsByDate.get(date);
    const existing = journal?.eventIdMap.get(event.id);

    if (existing) {
      // Update existing entry (merge strategy)
      await updateMeetingEntry(event, existing);
    } else {
      // Create new entry
      await createMeetingEntry(event);
    }
  }
}
```

**Optimization Notes**:
- Cache journal indices in memory during heartbeat execution
- Only re-read files if modification time changed
- Batch write operations (update entire journal file once)

---

### 6. Existing Heartbeat Task Framework

**FILE**: `src/services/heartbeat/heartbeat-service.ts`

**Architecture**:
- Task registry pattern (plugin-style)
- Cron-based scheduling
- Config hot-reload support
- Execution logging

**Task Registration** (`src/services/heartbeat/tasks/task-registry.ts`):
```typescript
export function createTaskRegistry(deps: TaskDependencies): TaskRegistry {
  return {
    'email-triage': new EmailTriageTask(deps),
    // Add new task here:
    'journal-triage': new JournalTriageTask(deps),
  };
}
```

**Task Type Definition** (`src/types/heartbeat.ts`):
```typescript
// Current types (line 8)
export type TaskType = 'email-triage' | 'calendar-review';

// Update to:
export type TaskType = 'email-triage' | 'calendar-review' | 'journal-triage';
```

**Task Config Format** (heartbeat.config.json):
```json
{
  "rootDir": "/home/user/context",
  "tasks": [
    {
      "id": "journal-triage-001",
      "name": "Journal Triage",
      "type": "journal-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "lookaheadDays": 7,
        "journalDir": "areas/journal",
        "createOneNotePages": true,
        "oneNoteSectionFormat": "YYYY-MM Meetings"
      }
    }
  ]
}
```

**Task Implementation Pattern** (from EmailTriageTask):
```typescript
export class JournalTriageTask implements HeartbeatTask {
  constructor(private deps: TaskDependencies) {}

  async execute(config: TaskConfig): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. Fetch calendar events (lookahead period)
      const events = await this.fetchCalendarEvents(config.config.lookaheadDays);

      // 2. Process each date's journal
      const results = await this.processJournals(events);

      // 3. Sync to OneNote
      if (config.config.createOneNotePages) {
        await this.syncToOneNote(results);
      }

      return {
        status: 'success',
        duration: Date.now() - startTime,
        eventsProcessed: events.length,
        journalsUpdated: results.length,
      };
    } catch (error) {
      return {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }
}
```

---

## Technical Decisions

### Decision 1: Markdown Parser Choice
**Selected**: `gray-matter` + `marked`
**Rationale**: Industry standard for frontmatter parsing, preserves formatting, small dependency. `marked` already available for content parsing.

### Decision 2: EventId Format Support
**Selected**: Support both plain and markdown link formats
**Rationale**: Existing journals use both styles. Regex pattern can handle both. Write new entries using markdown link format for consistency.

### Decision 3: Meeting Entry Merge Strategy
**Selected**: Preserve user content, overwrite calendar metadata
**Rationale**: Satisfies FR-016. Calendar is source of truth for metadata (time, location, attendees). User content (notes) is sacred and never auto-updated.

### Decision 4: OneNote Section Organization
**Selected**: Monthly sections ("2026-02 Meetings")
**Rationale**: Matches journal folder structure. Reuses sections throughout month (less API calls). Easier to navigate than daily sections.

### Decision 5: EventId Matching Strategy
**Selected**: In-memory hash map per journal file
**Rationale**: Fast O(1) lookup, small dataset, no database overhead. Simple implementation.

### Decision 6: Attendee Formatting
**Selected**: Plain text comma-separated names
**Rationale**: Simplest approach. Preserves existing wiki links if present. Let users manually format if desired.

### Decision 7: Time Format
**Selected**: Use 24-hour format (HH:MM) without time ranges in heading
**Rationale**: Simplest, most consistent. Example: "09:00 - Meeting Title"

### Decision 8: Heartbeat Summary Section
**Selected**: Append dedicated section at end of daily journal
**Rationale**: Satisfies FR-011. Non-intrusive, easy to implement, clear audit trail.

---

## Dependencies Required

```json
{
  "dependencies": {
    "gray-matter": "^4.0.3",
    "marked": "^17.0.1",        // Already installed
    "js-yaml": "^4.1.1"         // Already installed (transitive)
  }
}
```

**Installation**:
```bash
npm install gray-matter
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| EventId format changes in future | Low | High | Support multiple extraction patterns, log warnings for unrecognized formats |
| Large journal files (> 100 meetings/day) | Low | Medium | Batch write operations, consider pagination for very large files |
| OneNote API rate limiting | Medium | Medium | Implement exponential backoff (already in FR-005), batch operations |
| Corrupted YAML frontmatter | Low | High | Validate frontmatter schema, provide clear error messages, skip malformed files |
| Calendar event deleted but journal entry exists | High | Low | Mark as cancelled per FR-006, preserve prep notes |
| Concurrent writes to journal file | Low | High | Use file locking (proper-lockfile already installed from feature 017) |
| User manually edits journal during heartbeat execution | Low | Medium | File locking, detect modification time changes, retry logic |

---

## Open Questions

1. ✅ **Resolved**: Which frontmatter properties are required? → See analysis above
2. ✅ **Resolved**: How to handle two EventId formats? → Support both, write new entries with markdown link format
3. ✅ **Resolved**: How to structure OneNote sections? → Monthly sections matching journal folders
4. **For Implementation**: Should we create missing monthly journal folders automatically? → Recommend yes
5. **For Implementation**: How to handle meetings spanning multiple days (overnight/multi-day)? → Create entry on start date only
6. **For Implementation**: Should we update journal entries for cancelled meetings? → Yes, mark as cancelled but preserve notes per FR-006
7. **For Testing**: How to generate test journal files? → Use extracted real examples as fixtures

---

## Example Journal File Structure

**File**: `context/areas/journal/2026-02/2026-02-18.md`

```markdown
---
date: 2026-02-18
day: Wednesday
type: daily-planning
energy-level: 6
energy-description: "Ready to focus on deep work"
---

# Wednesday, February 18, 2026

## Morning Check-In

**Energy Level:** 6/10 - Ready to focus on deep work

[User content...]

## Today's Schedule

### 09:00 - Travel Platform ELT

**Attendees:** David Anderson, Kumar Gaurav, Jacek Wojdel
**Location:** https://zoom.us/j/12345
**Related:** [[areas/team-leadership]]
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**
- Review Q1 roadmap
- Discuss headcount planning

**Meeting Notes:**
- Discussed platform evolution strategy
- Action: Follow up on API gateway proposal

---

[More meetings...]

## Shutdown Review

[User content...]

## Heartbeat Summary

**Last Updated**: 2026-02-18 15:00

**Journal Triage**:
- Processed 7 calendar events
- Created 2 new journal entries
- Updated 5 existing entries
- Synced 7 OneNote pages
```

---

## Next Phase

**Phase 1 Deliverables**:
- `data-model.md`: Define TypeScript interfaces for JournalEntry, MeetingEntry, JournalFrontmatter
- `contracts/`: Define heartbeat task config schema
- `quickstart.md`: Document usage and configuration

**Ready to Proceed**: Yes - all critical research complete with real data analysis.
