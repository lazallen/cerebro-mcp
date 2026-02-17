# Data Model: Scheduled Task Heartbeat System

**Feature**: 017-task-heartbeat
**Date**: 2026-02-17

## Overview

The heartbeat system uses a combination of in-memory structures, JSON configuration files, and file-based event storage. No database is required.

---

## 1. Task Configuration (JSON File)

**Purpose**: Define scheduled tasks with cron expressions and task-specific settings

**File Location**: Configurable via `HEARTBEAT_CONFIG_FILE` environment variable (default: `./heartbeat-config.json`)

### Schema

```typescript
interface HeartbeatConfig {
  rootDir: string; // Root directory for event storage
  tasks: TaskConfig[];
}

interface TaskConfig {
  id: string; // Unique task identifier
  name: string; // Human-readable task name
  type: TaskType; // Task implementation type
  schedule: string; // Cron expression (minute hour day month dayOfWeek)
  enabled: boolean; // Whether task is active
  config: Record<string, any>; // Task-specific configuration
}

type TaskType = 'email-triage' | 'calendar-review';
```

### Example

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

### Validation Rules

- `id`: Must be unique across all tasks, alphanumeric with hyphens
- `schedule`: Must be valid cron expression (5 fields: minute hour day month dayOfWeek)
- `type`: Must be registered in task registry
- `config`: Validated per task type

---

## 2. Task Execution Record (In-Memory)

**Purpose**: Track execution state and metrics for monitoring

**Storage**: In-memory Map (not persisted, resets on restart)

### Schema

```typescript
interface TaskExecutionRecord {
  taskId: string; // References TaskConfig.id
  currentlyRunning: boolean; // Lock flag for concurrency control
  lastRun: Date | null; // Timestamp of last execution start
  lastDuration: number; // Duration in milliseconds
  lastStatus: 'success' | 'error' | 'timeout'; // Last execution result
  lastError: string | null; // Error message if lastStatus === 'error'
  runCount: number; // Total successful executions
  errorCount: number; // Total failed executions
}
```

### Example

```typescript
{
  taskId: 'email-triage-hourly',
  currentlyRunning: false,
  lastRun: new Date('2026-02-17T14:00:00Z'),
  lastDuration: 42500, // 42.5 seconds
  lastStatus: 'success',
  lastError: null,
  runCount: 156,
  errorCount: 2
}
```

---

## 3. Event File (Markdown on Disk)

**Purpose**: Persist triage events for downstream processing (event bus pattern)

**File Location**: `{rootDir}/events/YYYYMMDD-{event-type}-{4-char-id}.md`

**Naming Convention**:
- Date: `YYYYMMDD` format (e.g., `20260217`)
- Event Type: Task-specific identifier (e.g., `email`, `calendar`)
- Unique ID: 4-character base36 string (0001-zzzz, providing 1.6M IDs/day)

### Schema (Markdown with Frontmatter)

```markdown
---
type: email-triage
timestamp: 2026-02-17T14:30:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata

- **From**: alice@company.com
- **Subject**: Q2 Planning Meeting
- **Received**: 2026-02-17 09:15:00Z
- **Message ID**: AAMkAGI2T...

## Action Items

### High Priority
- [ ] **Deadline**: Respond with availability by EOD Feb 18
- [ ] **Question**: Clarify budget allocation for Q2

### Medium Priority
- [ ] **Request**: Review attached agenda before meeting

## Email Body

> Let's schedule our Q2 planning session. I need your input on the
> budget allocation and would like to finalize the roadmap by end of month.
>
> Can you share your availability for next week?

## Extracted Data (JSON)

\`\`\`json
{
  "action_items": [
    {
      "description": "Respond with availability",
      "deadline": "2026-02-18T23:59:59Z",
      "priority": "high",
      "category": "request"
    },
    {
      "description": "Clarify budget allocation for Q2",
      "priority": "high",
      "category": "question"
    }
  ],
  "questions": [
    "Can you share your availability for next week?"
  ],
  "requests": [
    "Review attached agenda",
    "Share availability"
  ],
  "deadlines": [
    "Finalize roadmap by end of month"
  ],
  "summary": "Q2 planning meeting request with budget discussion"
}
\`\`\`
```

### Validation Rules

- Filename must match pattern: `YYYYMMDD-{type}-{id}.md`
- Frontmatter must be valid YAML
- JSON block must be parseable
- File must be written atomically (temp file + rename)

---

## 4. Counter Persistence (JSON File)

**Purpose**: Track daily counter for unique ID generation

**File Location**: `{rootDir}/events/.counter.json`

### Schema

```typescript
interface CounterState {
  date: string; // YYYYMMDD format
  counter: number; // Incremental counter (resets daily)
}
```

### Example

```json
{
  "date": "20260217",
  "counter": 42
}
```

### Behavior

- Counter increments on each `generateId()` call
- Counter resets to 0 when date changes
- File is written atomically on each increment (temp + rename)
- Missing file initializes counter to 0

---

## 5. Email Triage Result (LLM Output)

**Purpose**: Structured data extracted from email content by LocalFoundry

**Storage**: Embedded in event file JSON block (see Event File schema above)

### Schema

```typescript
interface EmailTriageResult {
  action_items: ActionItem[];
  questions: string[];
  requests: string[];
  deadlines: string[];
  summary: string;
}

interface ActionItem {
  description: string; // What needs to be done
  assigned_to?: string; // Person responsible (if mentioned in email)
  deadline?: string; // ISO 8601 timestamp (if mentioned)
  priority: 'high' | 'medium' | 'low'; // Based on urgency indicators
  category: 'question' | 'request' | 'task' | 'deadline';
}
```

### Example

```json
{
  "action_items": [
    {
      "description": "Schedule Q2 planning meeting",
      "assigned_to": "you",
      "deadline": "2026-02-24T23:59:59Z",
      "priority": "high",
      "category": "request"
    }
  ],
  "questions": ["What is your availability next week?"],
  "requests": ["Review budget proposal"],
  "deadlines": ["Finalize Q2 roadmap by end of month"],
  "summary": "Request to schedule Q2 planning meeting with budget review"
}
```

---

## 6. Meeting Preparation Record (In-Memory)

**Purpose**: Track OneNote page creation for upcoming meetings

**Storage**: In-memory state (used to prevent duplicate page creation)

### Schema

```typescript
interface MeetingPreparationRecord {
  meetingId: string; // Calendar event ID from Microsoft Graph
  meetingSubject: string; // Event subject
  meetingStart: Date; // Event start time
  oneNotePageId: string | null; // Created page ID (null if not yet created)
  oneNotePageUrl: string | null; // Page web URL
  createdAt: Date | null; // When page was created
  status: 'pending' | 'created' | 'error';
  error: string | null; // Error message if status === 'error'
}
```

### Example

```typescript
{
  meetingId: 'AAMkADU3...',
  meetingSubject: 'Q2 Planning Session',
  meetingStart: new Date('2026-02-20T14:00:00Z'),
  oneNotePageId: '0-abc123def456',
  oneNotePageUrl: 'https://www.onenote.com/...',
  createdAt: new Date('2026-02-18T10:00:00Z'),
  status: 'created',
  error: null
}
```

---

## 7. Task Registry (In-Memory)

**Purpose**: Map task types to implementation classes

**Storage**: In-memory Map (initialized at startup)

### Schema

```typescript
interface TaskHandler {
  execute(taskConfig: TaskConfig): Promise<void>;
}

type TaskRegistry = Map<TaskType, TaskHandler>;
```

### Example

```typescript
const registry = new Map<TaskType, TaskHandler>([
  ['email-triage', new EmailTriageTask(graphClient, lfClient, eventBus)],
  ['calendar-review', new CalendarReviewTask(graphClient, oneNoteClient, eventBus)]
]);
```

---

## Relationships

```
TaskConfig (JSON file)
    ↓ (loaded at startup, watched for changes)
Scheduler (in-memory)
    ↓ (executes on cron schedule)
TaskHandler (implementation)
    ↓ (reads emails/calendar via Microsoft Graph)
LLM Client (LocalFoundry)
    ↓ (extracts action items)
Event Bus (file system)
    ↓ (writes markdown files with unique IDs)
Event File (disk)
    ← (consumed by downstream services)
```

---

## File System Layout

```
{rootDir}/
├── events/
│   ├── 20260217-email-0001.md
│   ├── 20260217-email-0002.md
│   ├── 20260217-calendar-0001.md
│   └── .counter.json
├── logs/
│   └── heartbeat-2026-02-17.log
└── config/
    └── heartbeat-config.json
```

---

## State Management

### Startup Sequence

1. Load `heartbeat-config.json` from disk
2. Validate task configurations
3. Initialize task registry
4. Initialize event bus (create directories, load counter)
5. Schedule all enabled tasks with node-cron
6. Start file watcher on config file

### Shutdown Sequence

1. Stop all scheduled tasks (`task.stop()`)
2. Wait for currently running tasks to complete (timeout: 30s)
3. Destroy task instances (`task.destroy()`)
4. Close file watcher
5. Flush logs

### Hot-Reload Sequence

1. File watcher detects config change
2. Load new config from disk
3. Validate new config (reject invalid configs)
4. Stop all existing scheduled tasks
5. Clear task registry
6. Re-initialize tasks from new config
7. Reschedule all enabled tasks

---

## Concurrency Control

### Task Execution Lock

**Mechanism**: In-memory boolean flag per task ID

```typescript
if (executionRecords.get(taskId).currentlyRunning) {
  logger.warn('Task already running, skipping execution', { taskId });
  return;
}

executionRecords.get(taskId).currentlyRunning = true;
try {
  await executeTask(taskId);
} finally {
  executionRecords.get(taskId).currentlyRunning = false;
}
```

### File Write Lock

**Mechanism**: `proper-lockfile` with lock files

```typescript
const release = await lockfile.lock(filepath, {
  retries: 5,
  stale: 10000 // 10 seconds
});

try {
  await fs.writeFile(`${filepath}.tmp`, content);
  await fs.rename(`${filepath}.tmp`, filepath); // Atomic
} finally {
  await release();
}
```

---

## Data Retention

### Event Files

- **Active**: Retained indefinitely in `events/` directory
- **Archive**: Manual archival after processing (future feature)
- **Cleanup**: No automatic deletion (downstream consumers responsible)

### Execution Records

- **Lifetime**: In-memory only, lost on restart
- **Persistence**: Future feature (optional logging to disk)

### Logs

- **Rotation**: Daily log files (pino configuration)
- **Retention**: 30 days (configurable)

---

## Error Handling

### Invalid Configuration

**Action**: Log error, refuse to start/reload
**Recovery**: Fix config file, restart or wait for hot-reload

### Task Execution Failure

**Action**: Log error, update execution record, continue scheduling
**Recovery**: Automatic retry on next scheduled execution

### File System Errors

**Action**: Log error, skip current task execution
**Recovery**: Next execution will retry

### LLM Timeout/Failure

**Action**: Return empty action items, log warning
**Recovery**: Mark email event with error status, allow manual review

---

## Performance Characteristics

| Operation | Expected Time | Constraint |
|-----------|---------------|------------|
| Config load/parse | < 100ms | Blocking on startup |
| Task schedule | < 10ms per task | Blocking on startup |
| File write (event) | 10-50ms | Atomic with locking |
| ID generation | < 5ms | Includes counter persistence |
| Email triage (1 email) | 2-5 seconds | LLM inference time |
| Email triage (50 emails, parallel) | 30-60 seconds | Batch processing (10 concurrent) |
| Calendar review (20 meetings) | 2-3 minutes | OneNote API calls |
| Config hot-reload | < 1 second | Blocking, stops all tasks |
