# Quickstart Guide: Journal Triage Heartbeat Task

**Feature**: 018-journal-triage | **Version**: 1.0 | **Date**: 2026-02-18

## Overview

The Journal Triage heartbeat task automatically synchronizes your Microsoft calendar with structured markdown journal entries and OneNote meeting pages. It runs on a configurable schedule, creating and updating journal entries while preserving your manual notes.

**What it does**:
- ✅ Reads your calendar and creates journal entries for upcoming meetings
- ✅ Updates journal entries when meeting details change (time, location, attendees)
- ✅ Preserves your prep notes and meeting notes during updates
- ✅ Syncs prep notes to OneNote pages organized by month
- ✅ Marks cancelled meetings while keeping your notes intact

## Prerequisites

1. **Microsoft 365 Authentication**: You must have authenticated with Microsoft Graph API (feature 012)
2. **OneNote Integration**: OneNote sync requires authentication (feature 013)
3. **Heartbeat Framework**: Heartbeat service must be configured (feature 017)
4. **Journal Directory**: Create the journal directory structure

## Setup Instructions

### Step 1: Create Journal Directory Structure

```bash
# From your project root
mkdir -p context/areas/journal
```

The task will automatically create monthly subdirectories (e.g., `2026-02/`) as needed.

### Step 2: Configure Heartbeat Task

Edit `heartbeat-config.json` and add the journal-triage task:

```json
{
  "rootDir": "./context",
  "tasks": [
    {
      "id": "journal-triage-hourly",
      "name": "Hourly Journal Triage",
      "type": "journal-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "lookaheadDays": 7,
        "syncOneNote": true,
        "oneNotebookName": "Work",
        "preserveUserContent": true
      }
    }
  ]
}
```

**Configuration Options**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lookaheadDays` | number | 7 | How many days ahead to fetch calendar events and create journal entries |
| `journalDir` | string | "areas/journal" | Journal directory path relative to rootDir |
| `createOneNotePages` | boolean | false | Whether to sync prep notes to OneNote |
| `oneNoteSectionFormat` | string | "YYYY-MM Meetings" | OneNote section naming format |
| `workdaysOnly` | boolean | false | Only create journal entries for Monday-Friday (skips weekends) |

### Step 3: Set Environment Variable

Ensure `rootDir` is set in your `.env` file (or use the default in heartbeat-config.json):

```bash
# .env
ROOT_DIR=./context
```

### Step 4: Verify Microsoft Authentication

Check that you're authenticated with Microsoft:

```bash
# Check for OAuth tokens
ls .tokens/microsoft-*.json
```

If no tokens exist, authenticate using the MCP server dashboard or microsoft tools.

### Step 5: Start the Heartbeat Service

```bash
# Build the project
npm run build

# Start the MCP server
npm start
```

The heartbeat service will automatically load and schedule the journal-triage task.

## Manual Testing

### Test 1: Verify Task Registration

Check logs for task registration:

```bash
npm start | grep "journal-triage"
# Expected output:
# [INFO] Registered heartbeat task: journal-triage-hourly
# [INFO] Scheduled journal-triage-hourly: 0 * * * * (every hour)
```

### Test 2: Trigger Manual Execution

Create a test event in your calendar for tomorrow, then trigger the task manually (if manual trigger is supported) or wait for the next hourly execution.

**Check journal file**:
```bash
# Assuming today is 2026-02-18
cat context/areas/journal/2026-02/2026-02-19.md
```

**Expected output**:
```markdown
---
date: 2026-02-19
day: Wednesday
type: daily-planning
energy-level: 5
energy-description: "Default energy level"
---

# Wednesday, February 19, 2026

## Today's Schedule

### 10:00-11:00 - Test Meeting

**Attendees:** You
**Location:**
**Related:**
**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg...)

**Prep Notes:**


**Meeting Notes:**


---

## Heartbeat Summary

**Last Run**: 2026-02-18T15:30:00Z
**Task**: journal-triage

- Created 1 new journal entry
- Updated 0 existing entries
- Synced 1 OneNote page
- Errors: None

---
```

### Test 3: Verify OneNote Sync

1. Open OneNote
2. Navigate to the "Work" notebook
3. Look for section "2026-02 Meetings"
4. Find page "Test Meeting"
5. Verify it contains the meeting metadata

### Test 4: Test Update Preservation

1. Add prep notes to your journal entry:
   ```markdown
   **Prep Notes:**
   - Review project timeline
   - Prepare questions about budget
   ```

2. Update the meeting time in your calendar

3. Wait for next hourly execution (or trigger manually)

4. Verify journal entry:
   - ✅ Time is updated
   - ✅ Prep notes are preserved
   - ✅ OneNote page is updated

## Usage Patterns

### Daily Workflow

1. **Morning**: Review auto-generated journal entries for today's meetings
2. **Before Meetings**: Add prep notes to relevant entries
3. **During/After Meetings**: Add meeting notes
4. **Evening**: Task runs hourly, keeping journal and OneNote in sync

### Calendar Changes

- **Reschedule Meeting**: Time updated automatically, notes preserved
- **Add Attendees**: Attendees list updated, notes preserved
- **Cancel Meeting**: Entry marked as "(CANCELLED)", notes preserved
- **New Meeting**: Entry created automatically within 1 hour

### OneNote Integration

- **Monthly Sections**: Meetings organized by month ("2026-02 Meetings")
- **Page Per Meeting**: Each meeting gets its own page
- **Prep Notes Sync**: Prep notes from journal synced to OneNote
- **Manual Edits**: Edit in either journal or OneNote (journal is source of truth)

## Troubleshooting

### Issue: No Journal Entries Created

**Symptoms**: Task runs but no files appear in `context/areas/journal/`

**Solutions**:
1. Check `rootDir` configuration in `heartbeat-config.json`
2. Verify directory permissions: `ls -la context/areas/journal/`
3. Check logs for errors: `npm start | grep ERROR`
4. Verify Microsoft authentication: `ls .tokens/microsoft-*.json`

### Issue: User Notes Being Overwritten

**Symptoms**: Your prep notes or meeting notes disappear after task runs

**Solutions**:
1. Verify `preserveUserContent: true` in task config
2. Check that notes are under `**Prep Notes:**` or `**Meeting Notes:**` markers
3. Ensure horizontal rule `---` separates meeting entries
4. Review logs for parse errors

### Issue: OneNote Sync Failures

**Symptoms**: Journal entries created but OneNote pages not syncing

**Solutions**:
1. Verify `syncOneNote: true` in task config
2. Check OneNote authentication tokens: `ls .tokens/microsoft-*.json`
3. Verify notebook name: `oneNotebookName` matches actual notebook
4. Check logs for OneNote API errors
5. Retry count: Task retries with exponential backoff

### Issue: Duplicate Journal Entries

**Symptoms**: Multiple entries for the same meeting

**Solutions**:
1. Check that EventId is present and unique
2. Verify EventId format: `[eventId](...)` or plain text
3. Look for corrupted EventId links
4. Check logs for EventId extraction errors

### Issue: Performance Slow (>2 minutes)

**Symptoms**: Task takes longer than expected to complete

**Solutions**:
1. Reduce `lookaheadDays` (default: 7)
2. Check calendar size: >100 events may exceed performance target
3. Disable OneNote sync temporarily: `syncOneNote: false`
4. Check disk I/O performance
5. Review logs for slow API calls

## Advanced Configuration

### Custom Schedule

```json
{
  "schedule": "*/30 * * * *"  // Every 30 minutes
}
```

### Multiple Task Instances

```json
{
  "tasks": [
    {
      "id": "journal-triage-frequent",
      "schedule": "*/15 * * * *",
      "config": {
        "lookaheadDays": 2  // Next 2 days, runs every 15 minutes
      }
    },
    {
      "id": "journal-triage-weekly",
      "schedule": "0 0 * * 0",
      "config": {
        "lookaheadDays": 14  // Next 2 weeks, runs weekly
      }
    }
  ]
}
```

### Disable OneNote Sync

```json
{
  "config": {
    "syncOneNote": false
  }
}
```

## Best Practices

### Journal Organization

1. **Keep One Journal Per Day**: Don't manually create multiple files for the same date
2. **Use Wiki Links**: Link to people and tasks using `[[category/name]]` format
3. **Preserve Frontmatter**: Don't manually edit system-generated frontmatter fields
4. **Consistent Formatting**: Follow the format specification for best results

### Meeting Prep

1. **Add Prep Notes Early**: Add prep notes as soon as meeting is created
2. **Review OneNote Pages**: Use OneNote for detailed prep work
3. **Link Related Tasks**: Use `**Related:**` field to link to relevant tasks
4. **Post-Meeting Notes**: Add meeting notes immediately after meetings

### Performance Optimization

1. **Optimize Lookahead**: Don't fetch more days than you need
2. **Schedule Wisely**: Run hourly during work hours, less frequently otherwise
3. **Monitor Logs**: Watch for errors and performance warnings
4. **Clean Up Old Journals**: Archive journals older than 6 months

## FAQ

**Q: Can I edit journal entries manually?**
A: Yes! Manual edits to prep notes, meeting notes, and related links are always preserved. Calendar metadata (time, attendees, location) will be auto-updated from calendar events.

**Q: What happens if I delete a calendar event?**
A: The journal entry is marked as "(CANCELLED)" but all your notes are preserved.

**Q: Can I use this with non-Microsoft calendars?**
A: Not currently. This feature requires Microsoft Graph API access (Office 365/Outlook calendar).

**Q: How do I backup my journals?**
A: Journal files are plain markdown. Use git, Dropbox, or any backup solution. Commit them to version control for history.

**Q: Can I customize the journal format?**
A: The format is standardized for reliable parsing. For custom sections, add them outside the "Today's Schedule" section.

**Q: What if two meetings have the same title?**
A: EventId ensures uniqueness. Meetings with the same title are differentiated by EventId.

**Q: Can I run the task on demand?**
A: Currently runs on schedule only. For manual execution, trigger via heartbeat service API (if exposed).

## Support

- **Documentation**: See [data-model.md](./data-model.md) for detailed structure
- **Format Spec**: See [contracts/journal-format.md](./contracts/journal-format.md) for validation rules
- **Issues**: Report bugs via project issue tracker
- **Logs**: Check application logs for detailed error messages

## Next Steps

1. ✅ Complete setup and run first test
2. ✅ Add prep notes to a few upcoming meetings
3. ✅ Verify OneNote sync is working
4. ✅ Adjust schedule and lookahead as needed
5. ✅ Integrate into daily workflow

---

**Version**: 1.0 | **Last Updated**: 2026-02-18
