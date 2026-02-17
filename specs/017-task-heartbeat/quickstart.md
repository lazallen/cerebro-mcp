# Quickstart Guide: Scheduled Task Heartbeat System

**Feature**: 017-task-heartbeat
**Audience**: Developers integrating heartbeat automation into their workflow
**Prerequisites**: Microsoft 365 account with email/calendar access, LocalFoundry running locally

---

## Overview

The heartbeat system automates recurring tasks on configurable schedules. This guide shows how to set up email triage and calendar review automation.

---

## Setup (5 minutes)

### 1. Install Dependencies

```bash
npm install node-cron@^3.0.3 chokidar@^4.0.3 proper-lockfile@^4.1.2
npm install -D @types/node-cron@^3.0.11 @types/proper-lockfile@^4.1.4
```

### 2. Configure Environment Variables

Add to `.env`:

```bash
# Heartbeat Configuration
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# LocalFoundry (for email triage)
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
LOCALFOUNDRY_TIMEOUT=60000

# Microsoft Graph API (already configured in Features 011-016)
MICROSOFT_CLIENT_ID=<your-client-id>
MICROSOFT_CLIENT_SECRET=<your-client-secret>
```

Add to `.env.example`:

```bash
# Heartbeat System
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# Heartbeat Root Directory: Base directory for event storage and logs
# Heartbeat Config File: Path to JSON configuration file for scheduled tasks
```

### 3. Create Heartbeat Configuration

Create `heartbeat-config.json`:

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "email-triage-hourly",
      "name": "Hourly Email Triage",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email"
      }
    },
    {
      "id": "calendar-review-morning",
      "name": "Morning Calendar Review",
      "type": "calendar-review",
      "schedule": "0 9 * * *",
      "enabled": true,
      "config": {
        "lookaheadDays": 7,
        "notebookName": "Meeting Notes",
        "sectionName": "Auto-Generated",
        "minHoursBefore": 2
      }
    }
  ]
}
```

---

## Usage Scenarios

### Scenario 1: Email Triage Every Hour

**Goal**: Automatically process unread emails and extract action items

**Configuration**:
```json
{
  "id": "email-triage-hourly",
  "name": "Hourly Email Triage",
  "type": "email-triage",
  "schedule": "0 * * * *",
  "enabled": true,
  "config": {
    "maxEmails": 50,
    "markAsRead": false,
    "eventType": "email",
    "llmTimeout": 10000,
    "batchSize": 10
  }
}
```

**What Happens**:
1. At the top of every hour (e.g., 9:00, 10:00, 11:00), the task executes
2. Fetches up to 50 unread emails from inbox (via Microsoft Graph)
3. Processes 10 emails concurrently using LocalFoundry LLM
4. Extracts action items (questions, requests, deadlines)
5. Writes markdown event files to `./data/events/YYYYMMDD-email-####.md`
6. Emails remain unread in inbox (set `markAsRead: true` to change)

**Output Example** (`./data/events/20260217-email-0001.md`):
```markdown
---
type: email-triage
timestamp: 2026-02-17T10:00:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Action Items

### High Priority
- [ ] **Deadline**: Respond to meeting request by EOD
- [ ] **Question**: Clarify Q2 budget allocation

## Email Body
> Q2 planning meeting request...

## Extracted Data (JSON)
\`\`\`json
{
  "action_items": [
    {"description": "Respond to meeting request", "deadline": "2026-02-17T23:59:59Z", "priority": "high"}
  ],
  "questions": ["What is your availability?"],
  "requests": ["Review budget proposal"],
  "summary": "Q2 planning meeting coordination"
}
\`\`\`
```

**Customization**:
- Change schedule to `*/30 * * * *` for every 30 minutes
- Set `maxEmails: 25` to process fewer emails per run
- Add `filterFolder: "inbox/priority"` to triage specific folder only
- Increase `batchSize: 20` for faster processing (if system can handle it)

---

### Scenario 2: Daily Morning Calendar Review

**Goal**: Create OneNote pages for upcoming meetings every morning

**Configuration**:
```json
{
  "id": "calendar-review-morning",
  "name": "Morning Calendar Review",
  "type": "calendar-review",
  "schedule": "0 9 * * *",
  "enabled": true,
  "config": {
    "lookaheadDays": 7,
    "notebookName": "Meeting Notes",
    "sectionName": "Auto-Generated",
    "minHoursBefore": 2,
    "skipRecurring": false
  }
}
```

**What Happens**:
1. Every day at 9:00 AM, the task executes
2. Fetches calendar events for next 7 days (via Microsoft Graph)
3. Filters meetings occurring at least 2 hours from now
4. For each meeting without a OneNote page:
   - Creates page in "Meeting Notes" notebook, "Auto-Generated" section
   - Includes meeting title, date, time, attendees, agenda
   - Adds structured template for notes and action items
5. Writes markdown event files to `./data/events/YYYYMMDD-calendar-####.md`

**Output Example** (`./data/events/20260217-calendar-0001.md`):
```markdown
---
type: calendar-review
timestamp: 2026-02-17T09:00:00Z
source_task_id: calendar-review-morning
---

# Calendar Review Event

## Meeting Details
- **Subject**: Q2 Planning Session
- **Start**: 2026-02-20T14:00:00Z
- **Attendees**: alice@company.com, bob@company.com

## OneNote Page
- **Page URL**: https://www.onenote.com/...

## Event Data (JSON)
\`\`\`json
{
  "meeting_id": "AAMkADU3...",
  "onenote_page_id": "0-abc123",
  "created_hours_before": 48
}
\`\`\`
```

**Customization**:
- Change schedule to `0 8,12,16 * * *` for 3 times per day (8am, 12pm, 4pm)
- Set `lookaheadDays: 14` to review 2 weeks ahead
- Set `minHoursBefore: 24` to create pages 1 day in advance
- Set `skipRecurring: true` to ignore recurring meeting series
- Customize `pageTemplate` for different note-taking structure

---

### Scenario 3: Priority Email Triage (High-Frequency)

**Goal**: Process high-priority emails every 15 minutes

**Configuration**:
```json
{
  "id": "email-priority-15min",
  "name": "Priority Email Triage (15min)",
  "type": "email-triage",
  "schedule": "*/15 * * * *",
  "enabled": true,
  "config": {
    "maxEmails": 10,
    "markAsRead": true,
    "eventType": "email-priority",
    "filterFolder": "inbox/important",
    "llmTimeout": 5000,
    "batchSize": 5
  }
}
```

**What Happens**:
- Runs every 15 minutes (e.g., 9:00, 9:15, 9:30, 9:45)
- Processes only emails in "inbox/important" folder
- Limits to 10 emails per execution (faster runs)
- Marks emails as read after processing
- Uses shorter timeout (5s) and smaller batch (5 concurrent) for responsiveness

---

## Monitoring

### View Event Files

```bash
# List today's events
ls -lt data/events/ | head -20

# View specific event
cat data/events/20260217-email-0001.md

# Count events by type
ls data/events/*.md | cut -d'-' -f2 | sort | uniq -c
```

### Check Logs

```bash
# View heartbeat logs
tail -f data/logs/heartbeat-$(date +%Y-%m-%d).log

# Search for errors
grep ERROR data/logs/heartbeat-*.log
```

### Monitor Task Execution

Execution metrics are logged for each task run:

```json
{
  "level": "info",
  "operation": "task_completed",
  "task_id": "email-triage-hourly",
  "duration_ms": 42500,
  "status": "success",
  "processed_count": 23
}
```

---

## Hot-Reload Configuration

### Update Task Schedule

1. Edit `heartbeat-config.json`:
```json
{
  "id": "email-triage-hourly",
  "schedule": "*/30 * * * *"  // Changed from hourly to every 30 minutes
}
```

2. Save file → System automatically detects change and reloads
3. Check logs for confirmation:
```
Config file changed, reloading tasks...
Stopped 2 existing tasks
Loaded 2 tasks from config
Scheduled task: email-triage-hourly (*/30 * * * *)
```

### Add New Task

1. Add to `tasks` array in `heartbeat-config.json`:
```json
{
  "id": "weekend-calendar-prep",
  "name": "Friday Evening Calendar Prep",
  "type": "calendar-review",
  "schedule": "0 17 * * 5",
  "enabled": true,
  "config": {
    "lookaheadDays": 3,
    "notebookName": "Weekend Meetings",
    "minHoursBefore": 48
  }
}
```

2. Save file → New task automatically scheduled
3. No restart required

### Disable Task

```json
{
  "id": "email-triage-hourly",
  "enabled": false  // Task will be removed from schedule
}
```

---

## Troubleshooting

### Problem: Email triage not finding action items

**Symptoms**: Event files show empty `action_items` array

**Solutions**:
1. Check LocalFoundry is running: `curl http://localhost:8080/health`
2. Increase `llmTimeout` to 15000ms (15 seconds)
3. Reduce `batchSize` to 5 (less concurrent load)
4. Check logs for LLM errors: `grep "localfoundry" data/logs/*.log`

### Problem: Calendar review not creating OneNote pages

**Symptoms**: Event files created but no `onenote_page_id`

**Solutions**:
1. Verify OneNote notebook exists: Check `notebookName` in config
2. Check Microsoft Graph permissions: Ensure `Notes.ReadWrite` scope
3. Increase `minHoursBefore` if meetings are too soon
4. Check logs for OneNote API errors

### Problem: Tasks running concurrently

**Symptoms**: Logs show "Task already running, skipping execution"

**Solutions**:
- This is normal if previous execution hasn't finished
- Reduce `maxEmails` or `lookaheadDays` to speed up execution
- Check for long-running LLM requests (increase `llmTimeout` or reduce `batchSize`)

### Problem: Missed executions after system restart

**Symptoms**: No event files for time when system was down

**Expected Behavior**:
- By design, missed executions are skipped (not queued)
- System resumes at next scheduled time
- This prevents backlog accumulation

---

## Cron Expression Reference

| Expression | Description | Example Times |
|------------|-------------|---------------|
| `0 * * * *` | Every hour at :00 | 1:00, 2:00, 3:00 |
| `*/15 * * * *` | Every 15 minutes | 1:00, 1:15, 1:30, 1:45 |
| `0 9 * * *` | Daily at 9:00 AM | 9:00 every day |
| `0 9 * * 1-5` | Weekdays at 9:00 AM | 9:00 Mon-Fri |
| `0 8,12,16 * * *` | 3 times daily | 8:00, 12:00, 16:00 |
| `0 0 * * 0` | Weekly on Sunday midnight | 12:00 AM Sunday |

**Format**: `minute hour day month dayOfWeek` (0-59, 0-23, 1-31, 1-12, 0-6 where 0=Sunday)

---

## Advanced Configuration

### Custom Page Template (Calendar Review)

```json
{
  "config": {
    "pageTemplate": "# Meeting: {{title}}\n\n**Date**: {{date}} at {{time}}\n**Attendees**: {{attendees}}\n\n## Pre-Meeting\n- [ ] Review agenda\n- [ ] Prepare questions\n\n## During Meeting\n\n## Post-Meeting\n- [ ] Send summary\n- [ ] Update tickets\n"
  }
}
```

### Multiple Email Triage Tasks

```json
{
  "tasks": [
    {
      "id": "inbox-triage",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "config": { "filterFolder": "inbox" }
    },
    {
      "id": "important-triage",
      "type": "email-triage",
      "schedule": "*/15 * * * *",
      "config": { "filterFolder": "inbox/important", "maxEmails": 10 }
    }
  ]
}
```

---

## Performance Tuning

### For Faster Email Triage

```json
{
  "maxEmails": 25,        // Process fewer emails per run
  "batchSize": 15,        // Increase concurrent processing
  "llmTimeout": 5000      // Reduce timeout for faster failures
}
```

### For More Thorough Calendar Review

```json
{
  "lookaheadDays": 14,    // Check 2 weeks ahead
  "minHoursBefore": 48,   // Create pages 2 days in advance
  "skipRecurring": false  // Include all meetings
}
```

---

## Next Steps

1. **Test with dry run**: Set `enabled: false` initially, enable one task at a time
2. **Monitor first 24 hours**: Check logs and event files for any issues
3. **Adjust schedules**: Fine-tune based on email volume and meeting frequency
4. **Extend with custom tasks**: Implement new task types in `src/services/heartbeat/tasks/`

---

## Support

- **Logs**: `data/logs/heartbeat-YYYY-MM-DD.log`
- **Event Files**: `data/events/YYYYMMDD-{type}-{id}.md`
- **Configuration**: Validate JSON at [jsonlint.com](https://jsonlint.com/)
- **Cron Syntax**: Test expressions at [crontab.guru](https://crontab.guru/)
