# Contract: Journal Entry Format Specification

**Feature**: 018-journal-triage | **Version**: 1.0 | **Date**: 2026-02-18

## Purpose

Formal specification of the daily journal markdown file format to ensure consistent parsing and writing by the journal triage task. This contract serves as the authoritative reference for implementers and validation logic.

## File Structure

### File Naming Convention

**Pattern**: `YYYY-MM-DD.md`

**Examples**:
- `2026-02-18.md`
- `2026-12-31.md`

**Validation**:
```typescript
const JOURNAL_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;
```

### Directory Structure

**Pattern**: `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`

**Example**: `./context/areas/journal/2026-02/2026-02-18.md`

**Rules**:
- Monthly subdirectories (`YYYY-MM`)
- Daily files within month directories
- Month directory created automatically if needed

## Frontmatter Schema

### YAML Format

```yaml
---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Feeling productive"
end-energy-level: 6
end-energy-description: "Good day overall"
shutdown-complete: true
---
```

### Field Specifications

| Field | Type | Required | Source | Validation |
|-------|------|----------|--------|------------|
| `date` | string | Yes | System | YYYY-MM-DD, must match filename |
| `day` | string | Yes | System | Must be valid day name (Monday-Sunday) |
| `type` | string | Yes | System | Literal "daily-planning" |
| `energy-level` | number | Yes | User | Integer 1-10 |
| `energy-description` | string | Yes | User | Non-empty quoted string |
| `end-energy-level` | number | No | User | Integer 1-10 |
| `end-energy-description` | string | No | User | Non-empty quoted string |
| `shutdown-complete` | boolean | No | User | true/false |

### TypeScript Schema

```typescript
interface JournalFrontmatter {
  date: string;                      // YYYY-MM-DD
  day: string;                       // Day name
  type: 'daily-planning';            // Literal
  'energy-level': number;            // 1-10
  'energy-description': string;
  'end-energy-level'?: number;       // 1-10
  'end-energy-description'?: string;
  'shutdown-complete'?: boolean;
}
```

## Meeting Entry Format

### Structure Template

```markdown
### {TIME} - {TITLE}

**Attendees:** {ATTENDEES}
**Location:** {LOCATION}
**Related:** {RELATED_LINKS}
**EventId:** {EVENT_ID}

**Prep Notes:**
{USER_PREP_NOTES}

**Meeting Notes:**
{USER_MEETING_NOTES}

---
```

### Field Specifications

#### Time Format

**Patterns**:
1. Range: `HH:MM-HH:MM` (e.g., `08:00-09:00`)
2. Start only: `HH:MM AM/PM` (e.g., `08:00 AM`)
3. All-day: `All Day`

**Regex**:
```typescript
const TIME_REGEX = /^(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?|\d{1,2}:\d{2}\s*(?:AM|PM)|All Day)$/i;
```

#### Title

- **Required**: Yes
- **Format**: Plain text, single line
- **Max Length**: 255 characters (OneNote page title limit)
- **Example**: `Team Standup`

#### Attendees

- **Required**: No
- **Format**: Comma-separated list, may include wiki-style links
- **Wiki Links**: `[[people/category/Name]]`
- **Truncation**: May end with `_(and N more...)_`
- **Example**: `[[people/colleagues/Alice]], Bob, _(and 5 more...)_`

#### Location

- **Required**: No
- **Format**: Plain text or URL
- **Examples**:
  - `EDI-L2 Conference Room A`
  - `https://zoom.us/j/123456789`

#### Related Links

- **Required**: No
- **Format**: Space or comma-separated wiki links
- **Example**: `[[tasks/sprint-planning]] [[people/manager/Jane]]`

#### EventId

- **Required**: Yes
- **Format**: Plain text OR markdown link
- **Patterns**:
  1. Plain: `AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...`
  2. Markdown Link: `[eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)`

**Extraction Regex**:
```typescript
const EVENT_ID_REGEX = /\*\*EventId:\*\*\s*(?:\[eventId\]\()?([A-Za-z0-9+/=\-_]+)(?:\))?/;
```

#### Prep Notes

- **Required**: Yes (field), No (content)
- **Format**: Markdown, may be empty
- **Marker**: `**Prep Notes:**`
- **Source**: User-created
- **Preservation**: **NEVER OVERWRITE**

#### Meeting Notes

- **Required**: Yes (field), No (content)
- **Format**: Markdown, may be empty
- **Marker**: `**Meeting Notes:**`
- **Source**: User-created
- **Preservation**: **NEVER OVERWRITE**

### Entry Separator

- **Required**: Yes
- **Format**: Horizontal rule `---`
- **Placement**: Between every meeting entry

## Heartbeat Summary Section

### Structure

```markdown
## Heartbeat Summary

**Last Run**: {ISO_TIMESTAMP}
**Task**: journal-triage

- Created {N} new journal entries
- Updated {N} existing entries
- Synced {N} OneNote pages
- Errors: {ERROR_LIST or "None"}

---
```

### Field Specifications

- **Last Run**: ISO 8601 timestamp (e.g., `2026-02-18T16:00:00Z`)
- **Task**: Always `journal-triage`
- **Statistics**: Bullet list with counts
- **Errors**: Comma-separated error messages or "None"

### Placement

- **Location**: After "Today's Schedule" section, before "Shutdown Review"
- **Behavior**: Append if missing, update if exists
- **Preservation**: Replace entire section on each execution

## Parsing Rules

### Section Detection

**Heading Levels**:
- H1 (`#`): Day title (e.g., `# Tuesday, February 18, 2026`)
- H2 (`##`): Major sections (Morning Check-In, Top 3 Priorities, Today's Schedule, Heartbeat Summary, Shutdown Review)
- H3 (`###`): Meeting entries

**Section Order** (recommended):
1. Frontmatter
2. Day title (H1)
3. Morning Check-In (H2)
4. Top 3 Priorities (H2)
5. Today's Schedule (H2)
   - Meeting entries (H3)
6. Heartbeat Summary (H2)
7. Shutdown Review (H2)

### Meeting Entry Parsing

**Algorithm**:
1. Find all H3 headings under "Today's Schedule"
2. Extract time and title from heading
3. Locate field markers (`**Field:**`)
4. Extract field content until next field marker or separator
5. Preserve markdown formatting in note sections
6. Stop at horizontal rule `---`

### EventId Extraction

**Both Formats Supported**:
```markdown
**EventId:** AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)
```

**Implementation**:
```typescript
function extractEventId(markdown: string): string | null {
  const match = markdown.match(/\*\*EventId:\*\*\s*(?:\[eventId\]\()?([A-Za-z0-9+/=\-_]+)(?:\))?/);
  return match ? match[1] : null;
}
```

## Writing Rules

### File Creation

**If file doesn't exist**:
1. Create directory structure if needed
2. Generate default frontmatter with current date
3. Add day title (H1)
4. Add "Today's Schedule" section (H2)
5. Insert meeting entries
6. Add Heartbeat Summary (H2)

### Entry Insertion

**Chronological Order**:
- Insert meetings in time order (earliest first)
- If time is ambiguous, append to end
- Maintain separation with `---`

### Entry Update

**Merge Algorithm**:
1. Locate existing entry by EventId
2. **Preserve** (never modify):
   - Related links
   - Prep Notes content
   - Meeting Notes content
3. **Update** (from calendar):
   - Time
   - Title
   - Attendees
   - Location
4. Maintain entry position unless time changed significantly

### Atomic Writes

**File Locking**:
- Use `proper-lockfile` to acquire exclusive lock
- Lock timeout: 5 seconds
- Retry on lock failure: 3 attempts with exponential backoff

**Write Process**:
1. Acquire file lock
2. Read current content
3. Apply changes
4. Write to temp file
5. Atomic rename to target file
6. Release lock

## Validation

### File-Level Validation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateJournalFile(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Frontmatter present and valid YAML
  if (!content.startsWith('---')) {
    errors.push('Missing frontmatter delimiter');
  }

  // 2. Required frontmatter fields
  const requiredFields = ['date', 'day', 'type', 'energy-level', 'energy-description'];
  // ... validation logic

  // 3. Date consistency
  // frontmatter.date matches filename

  // 4. Day consistency
  // frontmatter.day matches actual day of week

  return { valid: errors.length === 0, errors, warnings };
}
```

### Entry-Level Validation

```typescript
function validateMeetingEntry(entry: MeetingEntry): ValidationResult {
  const errors: string[] = [];

  // 1. EventId present and non-empty
  if (!entry.eventId || entry.eventId.id.length === 0) {
    errors.push('EventId is required');
  }

  // 2. Title present and non-empty
  if (!entry.title || entry.title.trim().length === 0) {
    errors.push('Title is required');
  }

  // 3. Time format valid
  if (!TIME_REGEX.test(entry.time)) {
    errors.push(`Invalid time format: ${entry.time}`);
  }

  // 4. Required section markers present
  // Check for "**Prep Notes:**" and "**Meeting Notes:**"

  return { valid: errors.length === 0, errors, warnings: [] };
}
```

## Examples

### Minimal Valid Journal

```markdown
---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Feeling good"
---

# Tuesday, February 18, 2026

## Today's Schedule

### 08:00-09:00 - Team Standup

**Attendees:**
**Location:**
**Related:**
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**


**Meeting Notes:**


---

## Heartbeat Summary

**Last Run**: 2026-02-18T10:00:00Z
**Task**: journal-triage

- Created 1 new journal entry
- Updated 0 existing entries
- Synced 1 OneNote page
- Errors: None

---
```

### Complete Example

See data-model.md for full example with all sections populated.

## Backwards Compatibility

### EventId Format Evolution

**Support both formats indefinitely**:
- Old: Plain text EventId
- New: Markdown link `[eventId](...)`

**Migration Strategy**: None required - parser handles both

### Frontmatter Extensions

**Adding new fields**: Safe, older parsers ignore unknown fields

**Removing fields**: Breaking change, requires version bump

## Error Handling

### Parse Errors

| Error | Severity | Recovery |
|-------|----------|----------|
| Missing frontmatter | Error | Cannot process, log and skip |
| Invalid YAML | Error | Cannot process, log and skip |
| Missing EventId | Warning | Skip entry, log warning |
| Invalid time format | Warning | Keep entry, log warning |
| Corrupted section markers | Warning | Best-effort parse, log warning |

### Write Errors

| Error | Severity | Recovery |
|-------|----------|----------|
| Lock acquisition failure | Error | Retry with backoff, fail after 3 attempts |
| Disk full | Error | Fail immediately, log critical error |
| Permission denied | Error | Fail immediately, log critical error |
| Corrupted during write | Critical | Keep backup, attempt restore |

---

**Implementation Note**: All parsers and writers MUST validate against this specification. Any deviation requires spec update and version bump.
