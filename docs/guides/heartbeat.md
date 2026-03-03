# Heartbeat System — Scheduled Tasks

The heartbeat system automates recurring tasks on configurable schedules using cron expressions. Tasks run as part of the MCP server process with hot-reload configuration and concurrent execution protection.

## Table of Contents

- [Quick Setup](#quick-setup)
- [Configuration Format](#configuration-format)
- [Cron Schedule Format](#cron-schedule-format)
- [Task Types](#task-types)
- [Event Files](#event-files)
- [Hot-Reload Configuration](#hot-reload-configuration)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Performance Tuning](#performance-tuning)

---

## Quick Setup

1. **Copy example config:**
```bash
cp heartbeat-config.example.json heartbeat-config.json
```

2. **Configure your tasks:** Edit `heartbeat-config.json` to enable/disable tasks and adjust schedules.

3. **Ensure environment variables are set:**
```bash
# .env
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# Required for email triage
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
```

4. **Start the server:** `npm start`

The heartbeat service automatically starts with the MCP server and runs tasks according to their schedules.

---

## Configuration Format

`heartbeat-config.json` structure:

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
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email",
        "llmTimeout": 30000,
        "batchSize": 10
      }
    }
  ]
}
```

**Common Fields:**
- `id` (string, required): Unique identifier (alphanumeric, hyphens, underscores)
- `name` (string, required): Human-readable task name
- `type` (string, required): Task type — see [Task Types](#task-types)
- `schedule` (string, required): Cron expression (5-part format)
- `enabled` (boolean, required): Whether task is active
- `config` (object, required): Task-specific configuration

---

## Cron Schedule Format

Standard 5-part cron expression: `minute hour day month dayOfWeek`

**Common Examples:**
- `"0 * * * *"` — Every hour at :00
- `"*/15 * * * *"` — Every 15 minutes
- `"0 9 * * *"` — Daily at 9:00 AM
- `"0 9 * * 1-5"` — Weekdays at 9:00 AM
- `"0 8,12,16 * * *"` — Three times daily (8:00, 12:00, 16:00)
- `"0 0 * * 0"` — Weekly on Sunday at midnight

**Fields:** `minute` (0–59) · `hour` (0–23) · `day` (1–31) · `month` (1–12) · `dayOfWeek` (0–6, Sunday=0)

Tip: Test expressions at [crontab.guru](https://crontab.guru/).

---

## Task Types

### Email Triage (`email-triage`)

Processes unread emails using LocalFoundry LLM to extract action items and creates markdown event files.

**Config Options:**
```typescript
{
  "maxEmails": 50,           // Max emails to process per run (default: 50)
  "markAsRead": false,       // Mark emails as read after processing (default: false)
  "eventType": "email",      // Event type prefix for filenames (default: "email")
  "filterFolder": "inbox",   // Optional: filter to specific folder
  "llmTimeout": 30000,       // LLM request timeout in ms (default: 30000)
  "batchSize": 10            // Concurrent email processing (default: 10)
}
```

**Examples:**

*Hourly inbox triage:*
```json
{
  "id": "email-triage-hourly",
  "name": "Hourly Email Triage",
  "type": "email-triage",
  "schedule": "0 * * * *",
  "enabled": true,
  "config": { "maxEmails": 50, "markAsRead": false }
}
```

*High-priority emails every 15 minutes:*
```json
{
  "id": "priority-triage",
  "name": "Priority Email Triage",
  "type": "email-triage",
  "schedule": "*/15 * * * *",
  "enabled": true,
  "config": {
    "maxEmails": 10,
    "markAsRead": true,
    "filterFolder": "inbox/important",
    "llmTimeout": 5000,
    "batchSize": 5
  }
}
```

### Email Ingestion (`email-ingestion`)

Fetches emails and writes `TriageEvent` files for the policy pipeline (preferred over email-triage for policy-based workflows).

```json
{
  "id": "email-ingestion-hourly",
  "name": "Email Ingestion",
  "type": "email-ingestion",
  "schedule": "5 * * * *",
  "enabled": true,
  "config": { "maxEmails": 50, "markAsRead": false }
}
```

### Policy Pipeline (`policy-pipeline`)

Evaluates triage events against the policy YAML. Schedule after ingestion tasks so all new events are on disk before evaluation.

```json
{
  "id": "policy-pipeline-hourly",
  "name": "Policy Pipeline",
  "type": "policy-pipeline",
  "schedule": "10 * * * *",
  "enabled": true,
  "config": {}
}
```

See [policy-engine.md](policy-engine.md) for full policy pipeline setup.

### Journal Triage (`journal-triage`)

Syncs calendar events to markdown journal files with optional OneNote integration.

See [journal-triage.md](journal-triage.md) for full setup.

### Slack Saved Items Ingestion (`slack-saved-items-ingestion`)

Fetches Slack saved items and writes them as triage events for the policy pipeline.

See [slack-saved-items.md](slack-saved-items.md) for full setup.

---

## Event Files

Email triage creates markdown event files in `${HEARTBEAT_ROOT_DIR}/events/`:

**Filename Format:** `YYYYMMDD-{event-type}-{unique-id}.md`
- Example: `20260217-email-0001.md`
- Unique IDs are 4-character base36 (0–9, a–z), reset daily

**File Structure:**
```markdown
---
type: email-triage
timestamp: 2026-02-17T14:30:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata
- **From**: sender@example.com
- **Subject**: Email subject
- **Received**: 2026-02-17T09:15:00Z

## Action Items
- [ ] **high** (deadline): Complete project proposal by EOD
- [ ] **medium** (question): Clarify budget allocation

## Email Body
> Original email content...

## Extracted Data (JSON)
```json
{
  "action_items": [...],
  "questions": [...],
  "summary": "..."
}
```
```

---

## Hot-Reload Configuration

The heartbeat system automatically detects changes to `heartbeat-config.json` and reloads within ~1 second.

**What reloads:**
- Task schedules (cron expressions)
- Task enabled/disabled state
- Task configuration (maxEmails, batchSize, etc.)
- New tasks added or removed

**What requires a server restart:**
- Environment variables (`HEARTBEAT_ROOT_DIR`, `LOCALFOUNDRY_ENDPOINT`)
- Server port changes

---

## Monitoring

**View event files:**
```bash
# List today's events
ls -lt data/events/ | head -20

# Count events by type
ls data/events/*.md | cut -d'-' -f2 | sort | uniq -c
```

**Check logs:**
```bash
# Real-time server logs
./start-mcp.sh logs

# Search for specific operations
grep "email_triage" logs/cerebro-*.log
```

**Execution metrics** are logged for each task:
```json
{
  "operation": "task_completed",
  "task_id": "email-triage-hourly",
  "duration_ms": 42500,
  "status": "success",
  "processed_count": 23
}
```

---

## Troubleshooting

**Tasks not executing**

Check logs:
```bash
./start-mcp.sh logs | grep -i "error\|heartbeat"
```

Common causes:
- Invalid cron expression — check at crontab.guru
- `enabled: false` in task config
- Missing dependencies (Microsoft auth not set up, LocalFoundry not running)

**Email triage not finding action items**

1. Verify LocalFoundry is running: `curl http://localhost:8080/health`
2. Increase `llmTimeout` to 60000ms
3. Reduce `batchSize` to 5 for less concurrent load
4. Check LocalFoundry logs for model issues

**Tasks running concurrently**

Expected if the previous execution hasn't finished. Logs show:
```
"Task already running, skipping execution"
```

Solutions: reduce `maxEmails`, increase `llmTimeout`, or reduce schedule frequency.

**Missed executions after restart**

Expected behaviour — missed executions are skipped (not queued). System resumes at next scheduled time to prevent backlog accumulation.

---

## Performance Tuning

**Faster (lower thoroughness):**
```json
{ "maxEmails": 25, "batchSize": 15, "llmTimeout": 5000 }
```

**More thorough (slower):**
```json
{ "maxEmails": 100, "batchSize": 5, "llmTimeout": 60000 }
```
