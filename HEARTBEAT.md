# Heartbeat System Guide

**Automated task scheduling with cron expressions, hot-reload configuration, and event-driven architecture.**

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [Task Types](#task-types)
- [Cron Schedules](#cron-schedules)
- [Event Files](#event-files)
- [Monitoring & Troubleshooting](#monitoring--troubleshooting)
- [Best Practices](#best-practices)
- [Examples](#examples)

---

## Quick Start

### 1. Setup Configuration

```bash
# Copy example config
cp heartbeat-config.example.json heartbeat-config.json

# Edit to enable/disable tasks and adjust schedules
nano heartbeat-config.json
```

### 2. Configure Environment

Ensure these variables are set in your `.env` file:

```bash
# Heartbeat system
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# For email-triage tasks (required)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
```

### 3. Start Server

```bash
npm start
```

The heartbeat service starts automatically and runs tasks according to their schedules.

### 4. Verify Operation

```bash
# Check server logs
./start-mcp.sh logs | grep heartbeat

# View event files
ls -lt data/events/ | head -10

# Monitor specific task
./start-mcp.sh logs | grep "email_triage"
```

---

## Configuration Reference

### File Structure

`heartbeat-config.json`:

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "unique-task-id",
      "name": "Human-readable task name",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        // Task-specific configuration
      }
    }
  ]
}
```

### Common Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rootDir` | string | ✅ | Base directory for event storage (e.g., `./data`) |
| `tasks` | array | ✅ | Array of task configurations |

### Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier (lowercase, alphanumeric, hyphens only) |
| `name` | string | ✅ | Human-readable name for logs and monitoring |
| `type` | string | ✅ | Task type: `"email-triage"` or `"calendar-review"` |
| `schedule` | string | ✅ | Cron expression (5-part format) |
| `enabled` | boolean | ✅ | Whether task is active |
| `config` | object | ✅ | Task-specific configuration (see Task Types) |

### Validation Rules

**Task ID:**
- Must be unique across all tasks
- Only lowercase letters, numbers, and hyphens
- Examples: `email-hourly`, `priority-triage-15min`

**Cron Expression:**
- Must have exactly 5 fields: `minute hour day month dayOfWeek`
- Each field uses standard cron syntax
- Test at [crontab.guru](https://crontab.guru/)

**Task Type:**
- Must be `"email-triage"` or `"calendar-review"`
- Case-sensitive
- More types coming in future releases

---

## Task Types

### Email Triage (`email-triage`)

Automatically processes unread emails using LocalFoundry LLM to extract action items, questions, and deadlines. Creates markdown event files for downstream processing.

**Dependencies:**
- Microsoft 365 authentication
- LocalFoundry endpoint running
- Microsoft Graph API scopes: `Mail.Read`, `User.Read`

**Configuration Options:**

```typescript
{
  "maxEmails": 50,           // Max emails per execution (default: 50)
  "markAsRead": false,       // Mark as read after processing (default: false)
  "eventType": "email",      // Event type prefix (default: "email")
  "filterFolder": "inbox",   // Optional: Specific folder to process
  "llmTimeout": 30000,       // LLM timeout in ms (default: 30000)
  "batchSize": 10            // Concurrent processing (default: 10)
}
```

**Field Details:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxEmails` | number | 50 | Maximum emails to fetch per execution. Range: 1-100. |
| `markAsRead` | boolean | false | If `true`, marks emails as read after processing. Useful for high-priority filters. |
| `eventType` | string | "email" | Prefix for event file type. Use different values for multiple triage tasks (e.g., "email-priority"). |
| `filterFolder` | string | - | Optional folder name to filter. Examples: "inbox/important", "Archive". Leave blank for all unread. |
| `llmTimeout` | number | 30000 | LocalFoundry request timeout in milliseconds. Increase for slow systems or large emails. |
| `batchSize` | number | 10 | Number of emails processed concurrently. Reduce if system is overloaded. |

**Example Configurations:**

*Standard hourly triage:*
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
    "eventType": "email"
  }
}
```

*High-priority every 15 minutes:*
```json
{
  "id": "priority-triage-15min",
  "name": "Priority Email Triage",
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

*Weekend catch-up (Saturday morning):*
```json
{
  "id": "weekend-catchup",
  "name": "Weekend Email Catchup",
  "type": "email-triage",
  "schedule": "0 9 * * 6",
  "enabled": true,
  "config": {
    "maxEmails": 100,
    "markAsRead": false,
    "eventType": "email-weekend",
    "llmTimeout": 60000,
    "batchSize": 20
  }
}
```

**Performance Tuning:**

For **faster** execution (reduced latency):
```json
{
  "maxEmails": 25,
  "batchSize": 15,
  "llmTimeout": 5000
}
```

For **thorough** processing (higher quality):
```json
{
  "maxEmails": 100,
  "batchSize": 5,
  "llmTimeout": 60000
}
```

### Calendar Review (`calendar-review`)

**Status:** Coming soon (User Story 3)

Creates OneNote pages for upcoming meetings with structured templates for notes and action items.

**Planned Configuration:**
```json
{
  "lookaheadDays": 7,
  "notebookName": "Meeting Notes",
  "sectionName": "Auto-Generated",
  "minHoursBefore": 2,
  "skipRecurring": false
}
```

---

## Cron Schedules

### Format

Standard 5-part cron expression:

```
minute hour day month dayOfWeek
```

| Field | Range | Special Characters |
|-------|-------|-------------------|
| minute | 0-59 | `*` `,` `-` `/` |
| hour | 0-23 | `*` `,` `-` `/` |
| day | 1-31 | `*` `,` `-` `/` |
| month | 1-12 | `*` `,` `-` `/` |
| dayOfWeek | 0-6 (0=Sunday) | `*` `,` `-` `/` |

**Special Characters:**
- `*` - Any value (e.g., "every")
- `,` - List of values (e.g., `1,15,30`)
- `-` - Range (e.g., `1-5` = Monday-Friday)
- `/` - Step (e.g., `*/15` = every 15 units)

### Common Examples

| Schedule | Description | Example Times |
|----------|-------------|---------------|
| `0 * * * *` | Every hour at :00 | 1:00, 2:00, 3:00 |
| `*/15 * * * *` | Every 15 minutes | 1:00, 1:15, 1:30, 1:45 |
| `*/30 * * * *` | Every 30 minutes | 1:00, 1:30, 2:00, 2:30 |
| `0 9 * * *` | Daily at 9:00 AM | 9:00 every day |
| `0 9 * * 1-5` | Weekdays at 9:00 AM | 9:00 Mon-Fri |
| `0 8,12,16 * * *` | Three times daily | 8:00, 12:00, 16:00 |
| `0 0 * * 0` | Weekly on Sunday | 12:00 AM Sunday |
| `0 9 1 * *` | Monthly on 1st | 9:00 on 1st of month |
| `0 */2 * * *` | Every 2 hours | 12:00, 2:00, 4:00, 6:00 |

### Use Case Patterns

**Email Triage:**
- Hourly (business hours): `0 9-17 * * 1-5`
- Every 15 min (high priority): `*/15 * * * *`
- Morning briefing: `0 8 * * 1-5`
- End of day: `0 17 * * 1-5`

**Calendar Review:**
- Morning prep: `0 8 * * 1-5`
- Midday check: `0 12 * * 1-5`
- Evening review: `0 17 * * 1-5`
- Weekly planning (Monday): `0 9 * * 1`

**Tips:**
- Test expressions at [crontab.guru](https://crontab.guru/)
- Start conservatively (hourly) and adjust based on volume
- Avoid very frequent schedules (< 5 min) unless necessary
- Consider system load during batch processing times

---

## Event Files

### File Format

**Location:** `${HEARTBEAT_ROOT_DIR}/events/`

**Filename:** `YYYYMMDD-{event-type}-{unique-id}.md`

**Examples:**
- `20260217-email-0001.md`
- `20260217-email-0002.md`
- `20260217-email-priority-0001.md`

**Unique IDs:**
- 4-character base36 (0-9, a-z)
- Sequential per day
- Reset at midnight
- Supports 1,679,616 unique events per day per type

### Structure

Event files use markdown with YAML frontmatter and JSON data blocks:

```markdown
---
type: email-triage
timestamp: 2026-02-17T14:30:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata
- **From**: sender@example.com (Sender Name)
- **Subject**: Q2 Planning Meeting Request
- **Received**: 2026-02-17T09:15:00Z
- **Message ID**: AAMkADU3...

## Action Items

- [ ] **high** (deadline): Complete project proposal by EOD
- [ ] **medium** (question): Clarify Q2 budget allocation
- [ ] **low** (task): Review meeting agenda

## Questions

- What is your availability for Q2 planning?
- Should we include remote team members?

## Requests

- Share availability for next week
- Review attached budget proposal

## Email Body

> Let us schedule our Q2 planning session. Can you share your
> availability for next week? I've attached the budget proposal
> for your review.
>
> Thanks,
> Alice

## Extracted Data (JSON)

\`\`\`json
{
  "from": "alice@company.com",
  "subject": "Q2 Planning Meeting Request",
  "received": "2026-02-17T09:15:00Z",
  "message_id": "AAMkADU3...",
  "action_items": [
    {
      "description": "Complete project proposal by EOD",
      "assigned_to": null,
      "deadline": "2026-02-17T23:59:59Z",
      "priority": "high",
      "category": "deadline"
    },
    {
      "description": "Clarify Q2 budget allocation",
      "assigned_to": null,
      "deadline": null,
      "priority": "medium",
      "category": "question"
    },
    {
      "description": "Review meeting agenda",
      "assigned_to": null,
      "deadline": null,
      "priority": "low",
      "category": "task"
    }
  ],
  "questions": [
    "What is your availability for Q2 planning?",
    "Should we include remote team members?"
  ],
  "requests": [
    "Share availability for next week",
    "Review attached budget proposal"
  ],
  "deadlines": ["2026-02-17T23:59:59Z"],
  "summary": "Request to schedule Q2 planning meeting and review budget proposal"
}
\`\`\`
```

### Processing Event Files

Event files are designed for downstream processing:

**Read event:**
```bash
# View latest event
cat data/events/$(ls -t data/events/*.md | head -1)

# Parse JSON data
grep -A 50 '```json' data/events/20260217-email-0001.md | grep -v '```'
```

**Count events:**
```bash
# Total events today
ls data/events/$(date +%Y%m%d)-*.md 2>/dev/null | wc -l

# Events by type
ls data/events/*.md | cut -d'-' -f2 | sort | uniq -c
```

**Search events:**
```bash
# Find emails with "urgent" in summary
grep -l "urgent" data/events/*-email-*.md

# Find high-priority action items
grep -l '"priority": "high"' data/events/*.md
```

---

## Monitoring & Troubleshooting

### Monitoring

**Server Logs:**
```bash
# Real-time logs
./start-mcp.sh logs

# Heartbeat operations only
./start-mcp.sh logs | grep heartbeat

# Specific task
./start-mcp.sh logs | grep "email_triage"
```

**Log Operations:**
- `heartbeat_started` - Service started
- `task_scheduled` - Task added to schedule
- `task_execution_start` - Task execution begins
- `task_execution_complete` - Task finished successfully
- `task_execution_error` - Task failed
- `config_reload` - Configuration reloaded
- `email_triage_start` - Email triage begins
- `email_processed` - Individual email processed
- `email_triage_complete` - Triage finished

**Execution Metrics:**

Each task execution logs performance metrics:

```json
{
  "level": "info",
  "operation": "task_completed",
  "task_id": "email-triage-hourly",
  "duration_ms": 42500,
  "status": "success",
  "processed_count": 23,
  "message": "Task completed successfully"
}
```

**Event Files:**
```bash
# List recent events
ls -lt data/events/ | head -20

# Count today's events
ls data/events/$(date +%Y%m%d)-*.md 2>/dev/null | wc -l

# View specific event
cat data/events/20260217-email-0001.md
```

### Common Issues

#### Tasks Not Executing

**Symptoms:** No log entries for task execution

**Check:**
```bash
# Verify task is enabled
cat heartbeat-config.json | jq '.tasks[] | select(.id=="your-task-id") | .enabled'

# Check logs for errors
./start-mcp.sh logs | grep -i "error.*heartbeat"

# Verify cron expression
# Test at https://crontab.guru/
```

**Solutions:**
1. Ensure `enabled: true` in config
2. Validate cron expression syntax
3. Check dependencies (Microsoft auth, LocalFoundry)
4. Verify no conflicting task IDs

#### Email Triage Not Finding Action Items

**Symptoms:** Event files have empty `action_items` arrays

**Check:**
```bash
# Verify LocalFoundry is running
curl http://localhost:8080/health

# Check LLM logs
./start-mcp.sh logs | grep "llm_analysis"
```

**Solutions:**
1. Ensure LocalFoundry endpoint is accessible
2. Increase `llmTimeout` to 60000ms (60 seconds)
3. Reduce `batchSize` to 5 (less concurrent load)
4. Check LocalFoundry model is loaded
5. Verify sufficient system memory for LLM

#### Tasks Running Concurrently

**Symptoms:** Logs show "Task already running, skipping execution"

**Expected Behavior:** System prevents concurrent execution of same task

**Solutions (if problematic):**
1. Reduce `maxEmails` to speed up execution
2. Increase `llmTimeout` if LLM requests are slow
3. Adjust schedule frequency (e.g., every 2 hours instead of hourly)
4. Increase `batchSize` for faster parallel processing

#### Configuration Not Reloading

**Symptoms:** Changes to config file not taking effect

**Check:**
```bash
# Verify file watcher is active
./start-mcp.sh logs | grep "config_watch"

# Check for JSON syntax errors
cat heartbeat-config.json | jq '.'
```

**Solutions:**
1. Validate JSON syntax (use `jq` or online validator)
2. Check file permissions (must be readable)
3. Restart server if watcher crashed
4. Verify no file system issues

#### Missed Executions After Restart

**Expected Behavior:** By design, missed executions are NOT queued

When the system is down, scheduled tasks don't execute. Upon restart, the system resumes at the next scheduled time. This prevents backlog accumulation.

**Example:**
- Task scheduled: `0 * * * *` (every hour)
- System down: 2:00 PM - 4:30 PM
- Missed executions: 2:00, 3:00, 4:00
- Resumes at: 5:00 PM (next scheduled time)

**This is intentional:** Email triage should process current state, not historical backlog.

### Debug Mode

Enable verbose logging:

```bash
# Set in .env
LOG_LEVEL=debug

# Restart server
./start-mcp.sh restart

# View debug logs
./start-mcp.sh logs | grep heartbeat
```

---

## Best Practices

### Configuration Management

1. **Version Control:** Track `heartbeat-config.json` in git
2. **Comments:** Use descriptive task names
3. **Validation:** Test config with `jq` before saving
4. **Backups:** Keep backup of working config

### Task Design

1. **Start Conservative:** Begin with hourly schedules, adjust based on volume
2. **Monitor First Week:** Watch logs and event files to tune settings
3. **Separate Concerns:** Use different tasks for different priorities/folders
4. **Avoid Overlap:** Don't schedule multiple tasks for same folder at same time

### Performance

1. **Batch Size:** Default 10 is good for most systems
   - Increase (15-20) for powerful systems
   - Decrease (5) for low-memory or slow LLM

2. **LLM Timeout:** Default 30s is reasonable
   - Increase (60s) for large emails or slow systems
   - Decrease (5s) for priority tasks with small emails

3. **Max Emails:** Default 50 is balanced
   - Increase (100) for high-volume processing
   - Decrease (25) for faster execution time

### Security

1. **Folder Filtering:** Use `filterFolder` to limit access
2. **Mark as Read:** Only enable for trusted automatic processing
3. **Event Files:** Consider permissions on `data/events/` directory
4. **Sensitive Data:** Event files contain email content - secure accordingly

### Maintenance

1. **Event Cleanup:** Periodically archive old event files
   ```bash
   # Archive events older than 30 days
   find data/events/ -name "*.md" -mtime +30 -exec mv {} data/events/archive/ \;
   ```

2. **Log Rotation:** Server logs rotate automatically
3. **Monitoring:** Set up alerts for task failures
4. **Updates:** Review changelog when updating Cerebro

---

## Examples

### Example 1: Balanced Email Triage

**Use Case:** Standard office worker, moderate email volume

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "email-hourly",
      "name": "Hourly Email Triage",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email"
      }
    }
  ]
}
```

**Result:** Processes up to 50 unread emails every hour, emails remain unread for manual review.

### Example 2: Priority + Bulk Processing

**Use Case:** High email volume, need urgent filtering

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "priority-15min",
      "name": "Priority Email Triage",
      "type": "email-triage",
      "schedule": "*/15 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 10,
        "markAsRead": true,
        "eventType": "email-priority",
        "filterFolder": "inbox/important",
        "llmTimeout": 5000,
        "batchSize": 10
      }
    },
    {
      "id": "bulk-triage",
      "name": "Bulk Email Triage",
      "type": "email-triage",
      "schedule": "0 */3 * * *",
      "enabled": true,
      "config": {
        "maxEmails": 100,
        "markAsRead": false,
        "eventType": "email-bulk",
        "llmTimeout": 60000,
        "batchSize": 5
      }
    }
  ]
}
```

**Result:**
- Priority folder checked every 15 minutes, marked as read
- Bulk processing every 3 hours for remaining emails

### Example 3: Business Hours Only

**Use Case:** Only triage during work hours, avoid weekend processing

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "business-hours-triage",
      "name": "Business Hours Email Triage",
      "type": "email-triage",
      "schedule": "0 9-17 * * 1-5",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email"
      }
    }
  ]
}
```

**Result:** Runs every hour from 9 AM - 5 PM, Monday-Friday only.

### Example 4: Multiple Folders

**Use Case:** Different handling for different email categories

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "inbox-triage",
      "name": "Inbox Triage",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email",
        "filterFolder": "inbox"
      }
    },
    {
      "id": "project-triage",
      "name": "Project Emails Triage",
      "type": "email-triage",
      "schedule": "0 9 * * 1-5",
      "enabled": true,
      "config": {
        "maxEmails": 20,
        "markAsRead": true,
        "eventType": "email-project",
        "filterFolder": "Projects"
      }
    }
  ]
}
```

**Result:**
- Inbox checked hourly
- Project folder checked daily at 9 AM on weekdays

---

## Resources

- **Cron Expression Tester:** [crontab.guru](https://crontab.guru/)
- **Detailed Guide:** [specs/017-task-heartbeat/quickstart.md](specs/017-task-heartbeat/quickstart.md)
- **Event File Spec:** [specs/017-task-heartbeat/contracts/event-file-format.md](specs/017-task-heartbeat/contracts/event-file-format.md)
- **Data Model:** [specs/017-task-heartbeat/data-model.md](specs/017-task-heartbeat/data-model.md)

---

## Support

For issues or questions:

1. Check logs: `./start-mcp.sh logs | grep heartbeat`
2. Validate config: `cat heartbeat-config.json | jq '.'`
3. Review this guide and quickstart documentation
4. File issue in project repository
