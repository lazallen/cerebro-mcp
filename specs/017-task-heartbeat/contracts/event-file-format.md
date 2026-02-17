# Event File Format Specification

## Overview

Event files are markdown documents with YAML frontmatter and structured JSON blocks, stored in the events directory with a standardized naming convention.

## File Naming Convention

```
YYYYMMDD-{event-type}-{unique-id}.md
```

### Components

- **YYYYMMDD**: Date in ISO 8601 format without hyphens (e.g., `20260217`)
- **{event-type}**: Event category identifier, lowercase alphanumeric with hyphens (e.g., `email`, `calendar`, `email-triage`)
- **{unique-id}**: 4-character unique identifier using base36 encoding (0-9, a-z)
  - Range: `0001` to `zzzz` (1,679,616 unique IDs per day)
  - Generated sequentially per day

### Examples

```
20260217-email-0001.md
20260217-email-0002.md
20260217-calendar-0001.md
20260218-email-0001.md  (counter resets daily)
```

## File Structure

### 1. YAML Frontmatter (Mandatory)

```yaml
---
type: string              # Event type (matches filename)
timestamp: string         # ISO 8601 timestamp of event creation
source_task_id: string    # ID of task that generated this event
---
```

### 2. Human-Readable Content (Markdown)

Freeform markdown content for human consumption. Structure varies by event type.

### 3. Structured Data Block (JSON)

One or more code-fenced JSON blocks with event-specific data.

```markdown
\`\`\`json
{
  "key": "value"
}
\`\`\`
```

## Event Type Schemas

### Email Triage Event

```markdown
---
type: email-triage
timestamp: 2026-02-17T14:30:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata

- **From**: sender@example.com
- **Subject**: Email subject line
- **Received**: 2026-02-17T09:15:00Z
- **Message ID**: <unique-message-id>

## Action Items

### High Priority
- [ ] Action item with high urgency

### Medium Priority
- [ ] Action item with medium urgency

### Low Priority
- [ ] Action item with low urgency

## Email Body

> Quoted email body content

## Extracted Data (JSON)

\`\`\`json
{
  "from": "sender@example.com",
  "subject": "Email subject line",
  "received": "2026-02-17T09:15:00Z",
  "message_id": "<unique-message-id>",
  "action_items": [
    {
      "description": "string",
      "assigned_to": "string | null",
      "deadline": "ISO 8601 string | null",
      "priority": "high | medium | low",
      "category": "question | request | task | deadline"
    }
  ],
  "questions": ["string"],
  "requests": ["string"],
  "deadlines": ["string"],
  "summary": "string"
}
\`\`\`
```

### Calendar Event

```markdown
---
type: calendar-review
timestamp: 2026-02-17T10:00:00Z
source_task_id: calendar-review-morning
---

# Calendar Review Event

## Meeting Details

- **Subject**: Meeting subject
- **Start**: 2026-02-20T14:00:00Z
- **End**: 2026-02-20T15:00:00Z
- **Attendees**: alice@company.com, bob@company.com

## OneNote Page

- **Notebook**: Meeting Notes
- **Section**: Auto-Generated
- **Page URL**: https://www.onenote.com/...

## Event Data (JSON)

\`\`\`json
{
  "meeting_id": "AAMkADU3...",
  "subject": "Meeting subject",
  "start": "2026-02-20T14:00:00Z",
  "end": "2026-02-20T15:00:00Z",
  "attendees": [
    {
      "email": "alice@company.com",
      "name": "Alice Smith",
      "type": "required"
    }
  ],
  "location": "Conference Room A",
  "onenote_page_id": "0-abc123def456",
  "onenote_page_url": "https://www.onenote.com/...",
  "created_hours_before": 48
}
\`\`\`
```

## Validation Rules

### Filename Validation

- Must match regex: `^\d{8}-[a-z0-9-]+-[0-9a-z]{4}\.md$`
- Date component must be valid calendar date
- Event type must be registered in system
- Unique ID must be 4 characters (base36)

### Frontmatter Validation

- Must be valid YAML
- `type` field is mandatory (string)
- `timestamp` field is mandatory (ISO 8601 format)
- `source_task_id` field is mandatory (string)

### JSON Block Validation

- Must be valid JSON (parseable)
- Schema varies by event type
- At least one JSON block is recommended

## File Operations

### Writing Events

1. Generate unique ID (counter-based, thread-safe)
2. Format filename: `YYYYMMDD-{type}-{id}.md`
3. Write to temp file: `{filename}.tmp`
4. Acquire file lock (prevents concurrent writes)
5. Atomic rename: `{filename}.tmp` → `{filename}`
6. Release lock

### Reading Events

1. Scan events directory for `*.md` files
2. Parse filename to extract date, type, ID
3. Read file content
4. Parse YAML frontmatter
5. Extract JSON blocks
6. Validate schema per event type

### Event Lifecycle

```
┌─────────────┐
│ Task Writes │
│   Event     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Active    │ ◄─── Consumers read and process
│   Events    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Completed  │ (Manual archival after processing)
│   Events    │
└─────────────┘
```

## Error Handling

### Malformed Files

- Invalid filename: Log warning, skip file
- Invalid frontmatter: Log error, attempt JSON extraction
- Invalid JSON: Log error, use markdown content only
- Missing mandatory fields: Log error, treat as incomplete event

### Concurrency

- Use file locking to prevent concurrent writes
- Readers do not require locks (read-only operations)
- Atomic writes ensure partial files are never visible

## Performance Considerations

- **File Size**: Keep individual event files under 100KB
- **Directory Size**: Use date-based subdirectories if > 10,000 files
- **Parsing**: Cache parsed events for repeated access
- **Indexing**: Maintain separate index file for quick lookups (future enhancement)

## Compatibility

- **Markdown Renderers**: Files should render correctly in GitHub, OneNote, VSCode
- **Version Control**: Human-readable format suitable for git tracking
- **Searchability**: Markdown content is full-text searchable
- **Tooling**: Standard JSON/YAML parsers work with structured sections

## Future Extensions

- Compression: gzip old events to save space
- Encryption: Encrypt sensitive event data at rest
- Indexing: SQLite index for fast querying
- Retention: Automatic archival and deletion policies
