# Journal Triage — Calendar-to-Journal Sync

The `journal-triage` heartbeat task keeps your markdown journal up-to-date with calendar events and optionally syncs prep notes to OneNote.

## Table of Contents

- [How It Works](#how-it-works)
- [Setup](#setup)
- [Configuration Options](#configuration-options)
- [Journal Format](#journal-format)
- [Workflow](#workflow)
- [OneNote Integration](#onenote-integration)

---

## How It Works

1. **Fetch** — Fetches calendar events for the next N days (configurable lookahead)
2. **Create/Update** — Creates new journal entries or updates existing ones by EventId
3. **Preserve** — All user content (prep notes, meeting notes, related links) is preserved
4. **Merge** — Only calendar metadata (time, title, location, attendees) is updated
5. **Cancel** — Meetings no longer in the calendar are marked as cancelled (notes preserved)

Journal entries are stored in `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`.

---

## Setup

Add to `heartbeat-config.json`:

```json
{
  "id": "journal-triage-hourly",
  "name": "Hourly Journal Triage",
  "type": "journal-triage",
  "schedule": "0 * * * *",
  "enabled": true,
  "config": {
    "lookaheadDays": 7,
    "journalDir": "areas/journal",
    "createOneNotePages": false,
    "oneNoteSectionFormat": "YYYY-MM Meetings"
  }
}
```

**Prerequisites:**
- Microsoft 365 authenticated (calendar access required)
- Heartbeat system running (`HEARTBEAT_ROOT_DIR` set in `.env`)

---

## Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lookaheadDays` | number | `7` | Days ahead to fetch calendar events |
| `journalDir` | string | `"areas/journal"` | Journal directory relative to `rootDir` |
| `createOneNotePages` | boolean | `false` | Enable OneNote sync for prep notes |
| `oneNoteSectionFormat` | string | `"YYYY-MM Meetings"` | Monthly section naming pattern |

---

## Journal Format

Files are stored at `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`:

```markdown
---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Ready to start the day"
---

# Tuesday, February 18, 2026

## Today's Schedule

### 09:00-10:00 - Team Standup

**Attendees:** Alice, Bob
**Location:** Conference Room A
**Related:** [[project/sprint-planning]]
**EventId:** [eventId](AAMkADA0ZWY5...)

**Prep Notes:**
- Review yesterday's progress
- Prepare blockers discussion

**Meeting Notes:**


---

## Heartbeat Summary

**Last Run**: 2026-02-18T10:00:00Z
**Task**: journal-triage

- Created 1 new journal entries
- Updated 2 existing entries
- Synced 1 OneNote pages
- Errors: None

---
```

**Key behaviours:**
- The `EventId` link is how the task identifies existing entries — do not remove it
- Everything under `**Prep Notes:**` and `**Meeting Notes:**` is preserved across updates
- Cancelled meetings remain in the file with a `~~strikethrough~~` title and `CANCELLED` note
- The Heartbeat Summary section is appended/updated after each run

---

## Workflow

On each execution, the task:

1. Fetches all calendar events for the next `lookaheadDays`
2. Opens (or creates) the daily journal file for each event's date
3. Checks if an entry with the matching `EventId` already exists:
   - **Existing entry**: Updates only the calendar metadata fields, leaves user content untouched
   - **New entry**: Appends a new meeting section with a blank prep/meeting notes template
4. Removes events that were cancelled since the last run (marks them, preserves notes)
5. Appends the heartbeat summary

**File locking** (`proper-lockfile`) prevents concurrent write corruption when multiple tasks run simultaneously.

**Retry logic**: OneNote API failures use exponential backoff (1s → 2s → 4s).

---

## OneNote Integration

When `createOneNotePages: true`, the task syncs prep notes to the user's OneNote notebook.

**How it works:**
- A new OneNote page is created in the section matching `oneNoteSectionFormat` (e.g., `2026-02 Meetings`)
- The page contains the meeting title, time, attendees, and any prep notes from the journal entry
- Syncing is one-way: journal → OneNote (OneNote changes are not pulled back)

**Section format examples:**
- `"YYYY-MM Meetings"` → `2026-02 Meetings`
- `"Meetings YYYY-MM"` → `Meetings 2026-02`

**Prerequisites:**
- `Notes.ReadWrite` permission granted during Microsoft OAuth
- OneNote notebook accessible via Microsoft Graph API
