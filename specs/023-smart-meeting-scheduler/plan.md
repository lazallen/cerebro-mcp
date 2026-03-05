# Implementation Plan: Smart Meeting Scheduler (Feature 023)

**Spec**: `specs/023-smart-meeting-scheduler/spec.md`
**Status**: Ready to implement

---

## Two-Phase Scheduling Model

The scheduler runs as two distinct heartbeat tasks sharing the same `type: 'smart-meeting-scheduler'` TaskType. A `phase` discriminator in `taskConfig.config` selects the behaviour at runtime.

| Phase | Schedule | Cron | Purpose |
|---|---|---|---|
| `forward-scheduling` | Daily, Mon–Fri at 07:00 | `0 7 * * 1-5` | Look ahead `lookAheadDays` (21 days), create any missing meeting instances |
| `rebalance` | Weekly, Monday at 08:00 | `0 8 * * 1` | Scan 3-week window for conflicts; calculate time portfolio from 4-week calendarView lookback |

Both phases are configured as separate entries in `heartbeat-config.json`, both with `type: 'smart-meeting-scheduler'`. The task class reads `(taskConfig.config as SmartMeetingTaskConfig).phase` to branch.

### heartbeat-config.json entries

```json
{
  "id": "smart-meeting-forward",
  "name": "Smart Meeting Scheduler — Forward Scheduling",
  "type": "smart-meeting-scheduler",
  "schedule": "0 7 * * 1-5",
  "enabled": false,
  "config": {
    "phase": "forward-scheduling",
    "configPath": "./smart-meetings-config.json"
  }
},
{
  "id": "smart-meeting-rebalance",
  "name": "Smart Meeting Scheduler — Weekly Rebalance",
  "type": "smart-meeting-scheduler",
  "schedule": "0 8 * * 1",
  "enabled": false,
  "config": {
    "phase": "rebalance",
    "configPath": "./smart-meetings-config.json"
  }
}
```

---

## Task Class: SmartMeetingSchedulerTask

**File**: `src/services/heartbeat/tasks/smart-meeting-scheduler-task.ts`

Implements `TaskHandler` (same interface as `EmailIngestionTask`, `CalendarIngestionTask`, etc.).

```typescript
export class SmartMeetingSchedulerTask implements TaskHandler {
  constructor(
    private readonly microsoftService: MicrosoftService,
    private readonly portfolioRef: PortfolioRef   // shared with SmartMeetingsService
  ) {}

  async execute(taskConfig: TaskConfig, context: TaskContext): Promise<void> {
    const cfg = taskConfig.config as SmartMeetingTaskConfig;
    const smConfig = await loadSmartMeetingsConfig(cfg.configPath);

    if (cfg.phase === 'forward-scheduling') {
      await this.runForwardScheduling(smConfig, cfg.configPath);
    } else {
      await this.runRebalance(smConfig, cfg.configPath);
    }
  }
}
```

The task is registered in `src/services/heartbeat/tasks/task-registry.ts` inside `createTaskRegistry()`, gated on `dependencies?.microsoftService`:

```typescript
// Register smart-meeting-scheduler task (Feature 023)
if (dependencies?.microsoftService && dependencies?.portfolioRef) {
  try {
    const { SmartMeetingSchedulerTask } = require('./smart-meeting-scheduler-task');
    registry.set(
      'smart-meeting-scheduler',
      new SmartMeetingSchedulerTask(dependencies.microsoftService, dependencies.portfolioRef)
    );
    logger.debug({ operation: 'task_handler_registered', taskType: 'smart-meeting-scheduler',
      message: 'Registered smart-meeting-scheduler task handler' });
  } catch (error) {
    logger.warn({ operation: 'task_handler_registration_error', taskType: 'smart-meeting-scheduler',
      error: (error as Error).message, message: 'Failed to register smart-meeting-scheduler task handler' });
  }
}
```

---

## Config Loading

**Config file**: `./smart-meetings-config.json` (at project root, alongside `heartbeat-config.json`)

The schema is incompatible with `ConfigLoader` (which manages `heartbeat-config.json`). `smart-meetings-config.json` is read and written directly using `fs.readFile` / `fs.writeFile`:

```typescript
// src/services/smart-meetings/config-io.ts
import * as fs from 'fs/promises';
import type { SmartMeetingsConfig } from '../../types/smart-meetings';

export async function loadSmartMeetingsConfig(configPath: string): Promise<SmartMeetingsConfig> {
  const raw = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(raw) as SmartMeetingsConfig;
}

export async function saveSmartMeetingsConfig(
  configPath: string,
  config: SmartMeetingsConfig
): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
```

The task mutates the config object (appends `history[]` entries, prunes old ones) then calls `saveSmartMeetingsConfig` to persist. This makes the config file the single source of truth for scheduling history.

---

## State Design

| State type | Storage | Recalculated when |
|---|---|---|
| `history[]` per meeting | Persisted in `smart-meetings-config.json` | Appended on each scheduling action |
| Cadence debt | Derived, never persisted | Each forward-scheduling pass, from `history[last]` vs `expectedCadenceDays` |
| Time portfolio | Derived, never persisted | Each rebalance pass, from 4-week `calendarView` query |
| `portfolioRef` cache | In-process object | Updated by rebalance pass; read by MCP tool |

History entries beyond `settings.historyRetentionCount` (default: 10) are pruned from the tail of the array after each write.

---

## Cadence Debt Algorithm

For each enabled meeting:

```
daysSinceLastOccurrence = today - history[last].date   (days, integer)
expectedCadenceDays     = cadence frequency mapped to days (weekly→7, fortnightly→14, monthly→30)
debtDays                = daysSinceLastOccurrence - expectedCadenceDays
```

Positive debt = overdue. The `targetHorizonDays` (how far out to schedule) is derived from debt:

| Debt (days) | Meaning | targetHorizonDays |
|---|---|---|
| ≤ 0 | On schedule or early | 21 (default lookAheadDays) |
| 1 – 6 | Slightly overdue | 14 |
| 7 – 13 | ~1 week overdue | 7 |
| ≥ 14 | 2+ weeks overdue | 2 (ASAP — minimum notice period) |

Meetings are **sorted by `debtDays` DESC** before entering the scheduling loop. This means the most overdue meeting gets first pick of available slots (FR-010c).

```typescript
const withDebt = meetings
  .filter(m => m.enabled)
  .map(m => ({ meeting: m, debt: calculateCadenceDebt(m) }))
  .sort((a, b) => b.debt.debtDays - a.debt.debtDays);

for (const { meeting, debt } of withDebt) {
  await scheduleIfMissing(meeting, debt.targetHorizonDays, smConfig, configPath);
}
```

---

## Time Portfolio Calculation

The rebalance pass queries `calendarView` for a trailing 4-week window (28 days ending now). No persistent state is used — the calendar is the source of truth (FR-017).

**Categorisation logic** (FR-016):

```
recurring  = event.recurrence != null
             OR event.subject contains a managed smart-meeting title (substring match)
ad-hoc     = has attendees AND NOT recurring
focus      = no attendees
             OR subject contains a configurable focus keyword (e.g. "Focus", "Deep Work", "Blocked")
             [unbooked working time counted as implicit focus]
```

For each calendar week (Mon–Fri, `workingHoursStart`–`workingHoursEnd`):

```
workingMins    = working days in week × (workingHoursEnd - workingHoursStart) × 60
focusMins      = bookedFocusMins + unbookedMins
recurringMins  = sum of qualifying event durations
adHocMins      = sum of qualifying event durations
```

Sustained imbalance (FR-018): any category exceeds `imbalanceThresholdPct` (default 50%) for `imbalanceWindowWeeks` (default 2) consecutive weeks → `PortfolioImbalanceWarning` is appended.

The result is a `TimePortfolioSummary` stored in the shared `portfolioRef.current` object so the MCP tool can return it without re-querying Graph.

---

## SmartMeetingRouter (Dashboard)

**File**: `src/auth-server/smart-meeting-router.ts`

Mirrors `TriageRouter` exactly:

- New class `SmartMeetingRouter` taking `(microsoftService: MicrosoftService, configPath: string)`
- Exported function `registerSmartMeetingRouter(server: OAuthServer, deps): void` — mounts the router on the Express app
- Registered in `src/auth-server/oauth-server.ts` alongside `TriageRouter`

**Routes**:

```
GET  /smart-meetings              → serve HTML dashboard (inline or from static file)
GET  /smart-meetings/api/status   → JSON: SmartMeetingsStatusResponse
```

The HTML dashboard is a self-contained page (same approach as `/triage/index.html`). It fetches `/smart-meetings/api/status` on load and on refresh. Cadence debt colouring:

- `debtDays` 1–13 → amber highlight (`#f59e0b`)
- `debtDays` ≥ 14 → red highlight (`#ef4444`)
- `debtDays` ≤ 0 → no highlight
- `enabled: false` → greyed out, sorted to bottom

Time portfolio imbalance warning renders as a banner above the meeting list (FR-025).

---

## MCP Tool: SmartMeetingsService

**File**: `src/services/smart-meetings/smart-meetings-service.ts`

Exposes one MCP tool: `smart_meetings_status` (registered under tool namespace `smart-meetings`).

```typescript
export class SmartMeetingsService {
  constructor(
    private readonly microsoftService: MicrosoftService,
    private readonly configPath: string,
    private readonly portfolioRef: PortfolioRef   // shared object written by task
  ) {}

  getToolDefinitions(): Tool[] { ... }      // returns smart_meetings_status tool def
  async executeTool(name: string, args: unknown): Promise<CallToolResult> { ... }
}
```

The `portfolioRef` is a plain shared object:

```typescript
// src/services/smart-meetings/portfolio-ref.ts
export interface PortfolioRef {
  current: TimePortfolioSummary | null;
  lastUpdated: Date | null;
}

export function createPortfolioRef(): PortfolioRef {
  return { current: null, lastUpdated: null };
}
```

`SmartMeetingSchedulerTask` writes `portfolioRef.current` at the end of each rebalance pass. `SmartMeetingsService` reads it to populate the `timePortfolio` field in the tool response without an extra Graph call.

**Creation location**: `portfolioRef` is created once in `src/mcp-server/service-registration.ts` (alongside `SmartMeetingsService`), then passed to `index.ts` which threads it into `HeartbeatService`'s dependencies object — the same pattern used for `slackSavedItemsApiClient`. It is NOT created in `oauth-server.ts`.

---

## Changes to Existing Files

### `src/types/heartbeat.ts`

Append `'smart-meeting-scheduler'` to the `TaskType` union:

```typescript
export type TaskType =
  | 'email-triage'
  | 'journal-triage'
  | 'email-ingestion'
  | 'calendar-ingestion'
  | 'policy-pipeline'
  | 'executor'
  | 'pipeline-archive'
  | 'slack-saved-items-ingestion'
  | 'smart-meeting-scheduler';   // Feature 023
```

### `src/services/heartbeat/config-loader.ts`

Add `'smart-meeting-scheduler'` to the `supportedTypes` array used for validation:

```typescript
const supportedTypes: TaskType[] = [
  'email-triage', 'journal-triage', 'email-ingestion', 'calendar-ingestion',
  'policy-pipeline', 'executor', 'pipeline-archive', 'slack-saved-items-ingestion',
  'smart-meeting-scheduler',   // Feature 023
];
```

### `src/auth-server/oauth-server.ts`

Register the new router alongside the existing `TriageRouter` registration:

```typescript
import { registerSmartMeetingRouter } from './smart-meeting-router';

// Inside OAuthServer's registerSmartMeetingRouter call (post-construction,
// matching the registerTriageRouter pattern):
registerSmartMeetingRouter(app, {
  configPath,    // passed from index.ts
  portfolioRef,  // passed from index.ts (created in service-registration.ts)
});
```

### `src/services/heartbeat/tasks/task-registry.ts`

Add the `portfolioRef` dependency to `createTaskRegistry`'s dependencies parameter and register the task (see "Task Class" section above).

---

## Build Sequence

### Phase A — Types

1. Create `src/types/smart-meetings.ts` with all interfaces from `data-model.md`
2. Append `'smart-meeting-scheduler'` to `TaskType` in `src/types/heartbeat.ts`
3. Build and verify: `npm run build`

### Phase B — Task Implementation

4. Create `src/services/smart-meetings/config-io.ts` (loadSmartMeetingsConfig / saveSmartMeetingsConfig)
5. Create `src/services/smart-meetings/portfolio-ref.ts` (PortfolioRef, createPortfolioRef)
6. Create `src/services/smart-meetings/cadence-debt.ts` (calculateCadenceDebt, sortByDebtDesc)
7. Create `src/services/smart-meetings/portfolio-calculator.ts` (calcTimePortfolio)
8. Create `src/services/heartbeat/tasks/smart-meeting-scheduler-task.ts` (SmartMeetingSchedulerTask)
9. Update `src/services/heartbeat/tasks/task-registry.ts` to register the task
10. Update `src/services/heartbeat/config-loader.ts` to add `'smart-meeting-scheduler'` to supportedTypes
11. Build and verify: `npm run build`

### Phase C — MCP Tool

12. Create `src/services/smart-meetings/smart-meetings-service.ts` (SmartMeetingsService)
13. Register SmartMeetingsService in the MCP server entry point (alongside existing services)
14. Build and verify: `npm run build`

### Phase D — Dashboard

15. Create `src/auth-server/smart-meeting-router.ts` (SmartMeetingRouter, registerSmartMeetingRouter)
16. Create dashboard HTML (inline in router or as `src/auth-server/smart-meetings/index.html`)
17. Update `src/auth-server/oauth-server.ts` to call `registerSmartMeetingRouter`
18. Build and verify; manual smoke test: navigate to `https://localhost:3333/smart-meetings`

### Phase E — Heartbeat Config

19. Add two task entries to `heartbeat-config.json` (forward-scheduling + rebalance)
20. Create initial `smart-meetings-config.json` with version, settings, and first batch of meetings

### Phase F — Tests

21. Unit tests for `calculateCadenceDebt` (all debt brackets, edge cases)
22. Unit tests for `calcTimePortfolio` (categorisation logic, imbalance detection)
23. Unit tests for `SmartMeetingSchedulerTask.execute` (forward-scheduling: creates event when missing; rebalance: moves conflicting event)
24. Integration smoke test: run heartbeat with one meeting in config, no event in window → event created
25. Run full test suite: `npm test`
