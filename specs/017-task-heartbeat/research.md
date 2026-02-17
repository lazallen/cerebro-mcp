# Research: Scheduled Task Heartbeat System

**Feature**: 017-task-heartbeat
**Date**: 2026-02-17
**Status**: Complete

## Executive Summary

This research identifies the optimal technology choices for implementing a heartbeat system with cron-based scheduling, file-based event bus, and LLM-powered email triage.

**Key Decisions**:
- **Task Scheduling**: `node-cron` (lightweight, zero dependencies, perfect for single-process execution)
- **File Watching**: `chokidar` (robust cross-platform file system events)
- **File Locking**: `proper-lockfile` (prevents concurrent access issues)
- **Event Bus**: File-based with YYYYMMDD-{type}-{4char}.md naming (event sourcing pattern)
- **LLM Integration**: LocalFoundry via existing client (Feature 011)

---

## 1. Task Scheduling Technology

### Decision: node-cron

**Rationale**:
- Lightweight (< 10KB, zero dependencies)
- Standard cron syntax support (minute, hour, day, month, day-of-week)
- Simple lifecycle management (`start()`, `stop()`, `destroy()`)
- Perfect for single-process, single-threaded execution model
- No persistence overhead (fits skip-missed-executions requirement)
- Well-maintained with active community

### Alternatives Considered

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| **node-schedule** | More features (date-based, RRULE) | Larger footprint, more complexity | Over-engineered for our needs |
| **cron** | Low-level control | More boilerplate, less user-friendly | Too manual for benefits gained |
| **bull/agenda** | Job persistence, distributed support | Requires Redis/MongoDB, overkill | Not needed for single-process system |

### Implementation Pattern

```typescript
import cron from 'node-cron';

const task = cron.schedule('*/5 * * * *', async () => {
  // Prevent concurrent execution
  if (taskLock) return;

  taskLock = true;
  try {
    await executeTask();
  } finally {
    taskLock = false;
  }
});

// Hot-reload support
task.stop();
task.destroy();
```

**Key Features Used**:
- Standard cron expressions
- Task lifecycle control
- Built-in timezone support
- Manual concurrency control (in-memory flags)

### Dependencies

```json
{
  "node-cron": "^3.0.3",
  "@types/node-cron": "^3.0.11"
}
```

---

## 2. Configuration Hot-Reload

### Decision: chokidar

**Rationale**:
- Cross-platform consistency (macOS FSEvents, Linux inotify, Windows)
- Robust change detection with debouncing
- `awaitWriteFinish` option prevents partial file reads
- Handles atomic writes (temp file + rename pattern)
- Widely adopted and battle-tested

### Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **fs.watch()** | Built-in Node.js | Platform inconsistencies, unreliable | Too fragile for production |
| **fs.watchFile()** | Polling-based, works everywhere | High CPU/IO overhead | Not performant |
| **chokidar** | Reliable, efficient, feature-rich | External dependency | Best option |

### Implementation Pattern

```typescript
import chokidar from 'chokidar';

const watcher = chokidar.watch('config.json', {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  }
});

watcher.on('change', () => {
  // Stop all tasks
  tasks.forEach(task => task.stop());

  // Reload config
  const config = loadConfig();

  // Reschedule
  initializeTasks(config);
});
```

### Dependencies

```json
{
  "chokidar": "^4.0.3"
}
```

---

## 3. File-Based Event Bus

### Decision: Custom implementation with proper-lockfile

**Rationale**:
- File-based event sourcing provides durability and auditability
- Markdown format is human-readable for debugging
- YYYYMMDD-{type}-{id}.md naming enables chronological sorting
- 4-character IDs provide 1.6M unique IDs per day (36^4)
- Multiple consumers can process independently
- No external message broker required

### Event File Format

```markdown
---
type: email-triage
timestamp: 2026-02-17T10:30:00Z
---

# Event: email-triage

## Action Items

- [ ] **High Priority**: Respond to meeting request by EOD
- [ ] **Question**: Clarify requirements for Q2 planning

## Email Details

**From**: alice@company.com
**Subject**: Q2 Planning Session
**Received**: 2026-02-17 09:15

### Body

Let's schedule a planning session for Q2. Do you have availability next week?
We need to finalize the roadmap by end of month.

### Identified Action Items

```json
{
  "questions": ["Do you have availability next week?"],
  "requests": ["Schedule planning session"],
  "deadlines": ["Finalize roadmap by end of month"]
}
```
```

### Unique ID Generation Strategy

**Decision**: Base36 counter with daily reset

```typescript
// Counter-based: 0001, 0002, ..., zzzz
// Provides 1,679,616 unique IDs per day
// Deterministic ordering for debugging
// No collision risk

const id = counter.toString(36).padStart(4, '0');
// Examples: 0001, 00a5, 0zzz, zzzz
```

**Alternative Considered**: Crypto-random 4-char hex
- Pros: Stateless, works in distributed systems
- Cons: Collision possible (~1% at 300/day), no ordering
- Verdict: Counter approach safer for single-process

### File Locking Pattern

```typescript
import * as lockfile from 'proper-lockfile';

// Acquire lock before write
const release = await lockfile.lock(filepath, {
  retries: 5,
  stale: 10000 // 10s timeout
});

try {
  // Atomic write: temp file + rename
  await fs.writeFile(`${filepath}.tmp`, content);
  await fs.rename(`${filepath}.tmp`, filepath);
} finally {
  await release();
}
```

### Dependencies

```json
{
  "proper-lockfile": "^4.1.2",
  "@types/proper-lockfile": "^4.1.4"
}
```

---

## 4. Email Action Item Identification (LLM)

### Decision: LocalFoundry (Feature 011)

**Rationale**:
- Already integrated in codebase
- Supports phi-4 model (good for structured extraction)
- HTTP-based API with timeout control
- Proven pattern in existing `extract` tool
- No additional external dependencies

### Existing LocalFoundry Integration

**Client Location**: `src/services/localfoundry/localfoundry-client.ts`

**API Pattern**:
```typescript
const client = new LocalFoundryClient({
  endpoint: 'http://localhost:8080/v1/chat/completions',
  model: 'phi-4',
  timeout: 60000
});

const response = await client.chatCompletion([
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt }
], {
  temperature: 0.3, // Low for consistent extraction
  max_tokens: 2000
});
```

### Prompt Engineering Strategy

**System Prompt**:
```
You are an email triage assistant. Extract action items, questions,
requests, and deadlines. Return ONLY valid JSON.
```

**Schema** (JSON structure):
```json
{
  "action_items": [
    {
      "description": "string",
      "assigned_to": "string | null",
      "deadline": "string | null",
      "priority": "high | medium | low",
      "category": "question | request | task | deadline"
    }
  ],
  "questions": ["string"],
  "requests": ["string"],
  "deadlines": ["string"],
  "summary": "string"
}
```

**Temperature**: 0.3 (low for consistent, accurate extraction vs. 0.7 for creative tasks)

### Performance: Meeting 5-Minute Requirement for 50 Emails

**Constraint**: Email triage must complete for 50 emails within 5 minutes (SC-003)

**Analysis**:
- Single email processing: ~2-5 seconds
- Sequential processing: 100-250 seconds (50 emails) ❌ Too slow
- Parallel processing (batch size 10): ~30-60 seconds ✅ Meets requirement

**Implementation Strategy**:
```typescript
const BATCH_SIZE = 10; // Process 10 concurrently
const TIMEOUT_PER_EMAIL = 6000; // 6 seconds each

for (let i = 0; i < emails.length; i += BATCH_SIZE) {
  const batch = emails.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(
    batch.map(email => extractActionItems(email))
  );
}
```

### Error Handling Strategy

**Categories**:
1. **Timeout**: Reduce text length and retry
2. **Connection failure**: Fall back to rule-based extraction or skip
3. **Invalid JSON**: Log error, return empty action items
4. **HTTP errors**: Retry up to 2 times with exponential backoff

**Retry Pattern**:
```typescript
async function extractWithRetry(email: Email, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await extractActionItems(email);
    } catch (error) {
      if (attempt === maxRetries) {
        // Return empty action items on final failure
        return { action_items: [], questions: [], requests: [], deadlines: [], summary: 'Error processing' };
      }
      await delay(1000 * Math.pow(2, attempt)); // Exponential backoff
    }
  }
}
```

### Accuracy Target: 80% (SC-007)

**Achievability**: High confidence
- Phi-4 model is strong at structured extraction
- Clear prompt with JSON schema guidance
- Low temperature (0.3) reduces hallucination
- Test with sample emails to iterate on prompt

**Validation Strategy**:
- Create test set of 20 emails with manually labeled action items
- Run extraction and measure precision/recall
- Iterate on prompt and schema if below 80%

---

## 5. Integration Points

### Existing Dependencies (Feature 011, 013)

| Component | Integration Point | Notes |
|-----------|-------------------|-------|
| **Microsoft Graph API** | `src/services/microsoft/microsoft-service.ts` | Email and calendar access |
| **OneNote API** | `src/services/microsoft/onenote-client.ts` | Meeting page creation |
| **LocalFoundry** | `src/services/localfoundry/localfoundry-client.ts` | LLM inference |
| **OAuth Token Storage** | `.tokens/` directory | Existing auth mechanism |

### New Components Needed

| Component | Purpose | Files |
|-----------|---------|-------|
| **Heartbeat Scheduler** | Cron-based task execution | `src/services/heartbeat/scheduler.ts` |
| **Task Configuration** | Load cron config from file | `src/services/heartbeat/config-loader.ts` |
| **Event Bus** | File-based event storage | `src/services/heartbeat/event-bus.ts` |
| **Email Triage Task** | Process emails with LLM | `src/services/heartbeat/tasks/email-triage.ts` |
| **Calendar Review Task** | Create OneNote pages | `src/services/heartbeat/tasks/calendar-review.ts` |
| **Task Registry** | Register available task types | `src/services/heartbeat/task-registry.ts` |

---

## 6. Configuration File Format

### Decision: JSON with cron expressions

**Format**:
```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "email-triage",
      "name": "Email Triage Service",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false
      }
    },
    {
      "id": "calendar-review",
      "name": "Calendar Review Service",
      "type": "calendar-review",
      "schedule": "0 9 * * *",
      "enabled": true,
      "config": {
        "lookaheadDays": 7,
        "notebookName": "Meeting Notes"
      }
    }
  ]
}
```

**Rationale**:
- JSON is easily parsed in Node.js
- Standard cron syntax for schedules
- Task-specific config in nested objects
- Enable/disable tasks without deletion

**Alternative Considered**: YAML
- Pros: More human-readable
- Cons: Requires additional parser, more fragile
- Verdict: JSON simpler and native to Node.js

---

## 7. Performance Considerations

### Scheduler Overhead

**Analysis**:
- node-cron uses ~1-2KB memory per scheduled task
- Cron evaluation happens at second boundaries (minimal CPU)
- Supporting 10-20 tasks: negligible impact

### File System Performance

**Considerations**:
- Event files: Keep under 100KB each
- Directory structure: Use date-based subdirectories (avoid > 10,000 files per directory)
- File watching: `chokidar` uses native OS events (efficient)
- File locking: Adds ~10-50ms per write (acceptable)

**Archival Strategy**:
```
events/
├── active/          # Current events (processed by consumers)
├── completed/       # Successfully processed (retained 30 days)
│   └── 2026/
│       └── 02/
└── failed/          # Failed processing (manual review)
```

### LLM Performance

**Targets**:
- Single email: 2-5 seconds
- Batch of 10: 20-50 seconds (parallel)
- Batch of 50: 100-250 seconds (5 batches × 50s)
- **Result**: Meets 5-minute requirement ✅

---

## 8. Testing Strategy

### Unit Tests

| Component | Test Focus |
|-----------|-----------|
| **Scheduler** | Cron expression parsing, task lifecycle |
| **Config Loader** | JSON parsing, validation, hot-reload detection |
| **Event Bus** | ID generation, file locking, concurrent writes |
| **Email Triage** | LLM prompt construction, JSON parsing, error handling |
| **Calendar Review** | Meeting detection, OneNote page creation, deduplication |

### Integration Tests

| Scenario | Test Goal |
|----------|-----------|
| **End-to-End Email Triage** | Real email → markdown event file |
| **Concurrent Task Execution** | Multiple tasks at same time don't interfere |
| **Config Hot-Reload** | File change → tasks restart |
| **Long-Running Task** | Task exceeding interval blocks next execution |
| **System Restart** | Missed executions are skipped (not queued) |

### Performance Tests

- Measure email triage throughput (50 emails target)
- Verify scheduler overhead (CPU/memory)
- Test event bus under concurrent load

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **LocalFoundry unavailable** | Fall back to rule-based extraction or skip with warning |
| **File system full** | Monitor disk space, implement retention/archival policy |
| **Task takes too long** | Timeout protection, log warnings, prevent next execution |
| **Config file corruption** | Validate JSON on load, keep last-known-good config |
| **Race conditions in event bus** | File locking with `proper-lockfile`, atomic writes |
| **LLM returns invalid JSON** | Catch parse errors, return empty action items, log failure |

---

## 10. Development Dependencies

### New Dependencies

```json
{
  "dependencies": {
    "node-cron": "^3.0.3",
    "chokidar": "^4.0.3",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@types/node-cron": "^3.0.11",
    "@types/proper-lockfile": "^4.1.4"
  }
}
```

### Existing Dependencies (Reused)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.3",
    "dotenv": "^16.4.1",
    "pino": "^8.19.0"
  }
}
```

---

## 11. Configuration Requirements

### Environment Variables

```bash
# Root directory for event storage
HEARTBEAT_ROOT_DIR=./data

# Path to heartbeat configuration file
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# LocalFoundry settings (existing)
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
LOCALFOUNDRY_TIMEOUT=60000

# Microsoft Graph API (existing)
MICROSOFT_CLIENT_ID=<your-client-id>
MICROSOFT_CLIENT_SECRET=<your-client-secret>
```

---

## Conclusion

All research questions resolved. Technology choices are optimized for:
- ✅ **Simplicity**: Minimal dependencies, standard patterns
- ✅ **Performance**: Meets all success criteria (SC-002, SC-003, SC-004)
- ✅ **Reliability**: Robust error handling, atomic operations, file locking
- ✅ **Maintainability**: Well-documented libraries, established patterns

**Ready to proceed to Phase 1: Design & Contracts**
