# Data Model: Smart Meeting Scheduler (Feature 023)

**File**: `src/types/smart-meetings.ts`

All types defined here. Nothing is imported from `heartbeat.ts` — this is a standalone module. The `SmartMeetingTaskConfig` type is the only type that bridges into the heartbeat system (it lives in `TaskConfig.config`).

---

## Complete TypeScript Interfaces

```typescript
// src/types/smart-meetings.ts

/**
 * Day of the week for scheduling preferences and history records
 */
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

/**
 * Meeting recurrence frequency
 */
export type MeetingFrequency = 'weekly' | 'fortnightly' | 'monthly';

/**
 * Time window within which a meeting should be scheduled
 * Used by findMeetingTimes to constrain the search
 */
export interface MeetingWindow {
  /** How many days ahead to search for a slot */
  days: number;
  /** Earliest time of day acceptable (HH:MM, 24h) */
  startTime: string;
  /** Latest end time of day acceptable (HH:MM, 24h) */
  endTime: string;
}

/**
 * Cadence configuration for a meeting — how often it should occur
 * and which days of the week are preferred
 */
export interface MeetingCadence {
  /** How frequently the meeting should occur */
  frequency: MeetingFrequency;
  /**
   * Preferred days of the week, in priority order.
   * Used as the first preference when history is absent or inconclusive.
   */
  idealDays: DayOfWeek[];
}

/**
 * A managed meeting definition — the core unit of configuration.
 * Stored in smart-meetings-config.json under the `meetings` array.
 *
 * The scheduler creates and manages calendar events for each enabled definition.
 * History is appended here (not in a separate store) so the config file is
 * the single source of truth for scheduling state.
 */
export interface MeetingDefinition {
  /** Stable unique identifier (slug, e.g. "dorin-laz-121") */
  id: string;

  /** Calendar event subject — used for title-substring matching */
  title: string;

  /** Email addresses of all required attendees (including Laz) */
  attendees: string[];

  /** Duration of the meeting in minutes */
  durationMinutes: number;

  /** Recurrence configuration */
  cadence: MeetingCadence;

  /** Search window constraints passed to findMeetingTimes */
  window: MeetingWindow;

  /**
   * Occurrence history — appended by the scheduler after each action.
   * Pruned to settings.historyRetentionCount entries (oldest removed first).
   */
  history: MeetingHistory[];

  /** Whether the scheduler should actively manage this meeting */
  enabled: boolean;
}

/**
 * A single occurrence record for a managed meeting.
 * Persisted inside MeetingDefinition.history[].
 */
export interface MeetingHistory {
  /** ISO 8601 date string (YYYY-MM-DD) */
  date: string;

  /** Day of week this occurrence fell on */
  dayOfWeek: DayOfWeek;

  /** Start time (HH:MM, 24h) */
  startTime: string;

  /**
   * What happened to this occurrence:
   * - scheduled: the scheduler created/confirmed the event
   * - occurred:  the event has passed (updated retrospectively)
   * - skipped:   no slot was found; meeting was not created this cycle
   */
  status: 'scheduled' | 'occurred' | 'skipped';
}

/**
 * Cadence debt for a single meeting — derived on each scheduling pass,
 * never persisted. Surfaced in smart_meetings_status to show which
 * relationships are falling behind their intended cadence.
 *
 * debtDays = daysSinceLastOccurrence - expectedCadenceDays
 * Positive debt means the meeting is overdue.
 */
export interface CadenceDebt {
  /** References MeetingDefinition.id */
  meetingId: string;

  /**
   * Days since the most recent history entry with status 'occurred' or 'scheduled'.
   * Null if there is no history (meeting has never been scheduled).
   */
  daysSinceLastOccurrence: number | null;

  /** Expected interval in days derived from MeetingCadence.frequency */
  expectedCadenceDays: number;

  /**
   * Overdue indicator: daysSinceLastOccurrence - expectedCadenceDays.
   * Null when daysSinceLastOccurrence is null (no history).
   * Positive = overdue, zero/negative = on schedule.
   */
  debtDays: number | null;

  /**
   * How far ahead to target the next scheduling slot, derived from debtDays:
   *   debtDays ≤ 0        → 21 days (default lookAheadDays)
   *   debtDays 1–6        → 14 days
   *   debtDays 7–13       → 7 days
   *   debtDays ≥ 14       → 2 days (ASAP, subject to minNoticePeriodHours)
   *   daysSinceLastOcc null → 21 days (treat as on-schedule for new meetings)
   */
  targetHorizonDays: number;

  /** ISO 8601 date of last occurrence, or null if no history */
  lastOccurrenceDate: string | null;
}

/**
 * Configuration for time portfolio tracking and imbalance detection.
 * Stored under SmartMeetingsConfig.settings.timePortfolio.
 */
export interface TimePortfolioSettings {
  /** Working day start time (HH:MM, 24h) — e.g. "09:00" */
  workingHoursStart: string;

  /** Working day end time (HH:MM, 24h) — e.g. "18:00" */
  workingHoursEnd: string;

  /** Days of the week counted as working days */
  workingDays: DayOfWeek[];

  /**
   * Percentage threshold above which a single category is considered dominant.
   * Default: 50 (i.e. 50% of working hours).
   */
  imbalanceThresholdPct: number;

  /**
   * Number of consecutive weeks a category must exceed imbalanceThresholdPct
   * before a PortfolioImbalanceWarning is raised. Default: 2.
   */
  imbalanceWindowWeeks: number;

  /**
   * Substrings in an event title that classify it as 'focus' time,
   * even if attendees are present.
   * Case-insensitive. E.g. ["Focus", "Deep Work", "Blocked", "No meetings"].
   */
  focusKeywords: string[];
}

/**
 * Root configuration object — the content of smart-meetings-config.json.
 * Read and written directly with fs.readFile / fs.writeFile (not ConfigLoader).
 */
export interface SmartMeetingsConfig {
  /** Schema version — increment on breaking changes */
  version: number;

  settings: {
    /** How far ahead (days) to schedule meetings. Default: 21 */
    lookAheadDays: number;

    /**
     * Minimum notice period in hours before a scheduled meeting can be moved.
     * Default: 48. Enforces the "48-hour protection" scheduling principle.
     */
    minNoticePeriodHours: number;

    /** IANA timezone for all scheduling calculations. E.g. "Europe/London" */
    timezone: string;

    /**
     * Maximum history entries to retain per meeting.
     * Oldest entries are pruned after this limit is exceeded. Default: 10.
     */
    historyRetentionCount: number;

    /**
     * Cron expression for the rebalance pass (stored here for documentation;
     * the authoritative schedule is in heartbeat-config.json).
     * Default: "0 8 * * 1" (Monday 08:00).
     */
    rebalanceCadence: string;

    /** Time portfolio tracking settings */
    timePortfolio: TimePortfolioSettings;
  };

  /** All managed meeting definitions */
  meetings: MeetingDefinition[];
}

/**
 * A single week's time portfolio breakdown.
 * Produced by the rebalance pass from a calendarView query.
 */
export interface WeeklyPortfolioSlice {
  /** ISO 8601 date of Monday for this week (YYYY-MM-DD) */
  weekStart: string;

  /** Percentage of working hours spent in focus (booked + unbooked) */
  focusPct: number;

  /** Percentage of working hours in recurring meetings */
  recurringPct: number;

  /** Percentage of working hours in ad-hoc meetings */
  adHocPct: number;

  /** Minutes of focus time (booked focus events + unbooked working time) */
  focusMins: number;

  /** Minutes in recurring meetings */
  recurringMins: number;

  /** Minutes in ad-hoc meetings */
  adHocMins: number;

  /** Total working minutes in this week (Mon–Fri, workingHoursStart–End) */
  workingMins: number;
}

/**
 * Warning raised when a single time category has been dominant
 * for imbalanceWindowWeeks consecutive weeks.
 * Included in TimePortfolioSummary.warnings[].
 */
export interface PortfolioImbalanceWarning {
  /** Which category has been dominant */
  category: 'focus' | 'recurring' | 'adHoc';

  /** Number of consecutive weeks this category has exceeded the threshold */
  consecutiveWeeks: number;

  /** The threshold that was exceeded (copied from settings for context) */
  thresholdPct: number;

  /** Human-readable description suitable for display in the dashboard or MCP response */
  message: string;
}

/**
 * Time portfolio summary returned by smart_meetings_status.
 * Structured so downstream skills (e.g. morning-calendar) can include
 * it without calling additional tools (FR-021).
 */
export interface TimePortfolioSummary {
  /** Portfolio breakdown for the current calendar week */
  thisWeek: WeeklyPortfolioSlice;

  /** Portfolio breakdown for the previous calendar week */
  lastWeek: WeeklyPortfolioSlice;

  /** Direction of travel for each category (comparing lastWeek → thisWeek) */
  trend: {
    focus: 'improving' | 'stable' | 'worsening';
    recurring: 'improving' | 'stable' | 'worsening';
    adHoc: 'improving' | 'stable' | 'worsening';
  };

  /** Active imbalance warnings (empty array if none) */
  warnings: PortfolioImbalanceWarning[];
}

/**
 * Per-meeting status object — one entry per MeetingDefinition in the
 * smart_meetings_status MCP tool response.
 */
export interface MeetingStatus {
  /** References MeetingDefinition.id */
  meetingId: string;

  /** Meeting title (from MeetingDefinition.title) */
  title: string;

  /** Whether the scheduler is actively managing this meeting */
  enabled: boolean;

  /** Cadence configuration (frequency + idealDays) */
  cadence: MeetingCadence;

  /**
   * ISO 8601 datetime of the most recent occurrence, or null if no history.
   * Sourced from the most recent history entry with status 'occurred' | 'scheduled'.
   */
  lastOccurrence: string | null;

  /**
   * ISO 8601 datetime of the next scheduled occurrence, or null if not yet scheduled.
   * Sourced by querying the calendarView for a matching event in the lookAheadDays window.
   */
  nextScheduled: string | null;

  /** Derived cadence debt — recalculated on each tool call */
  cadenceDebt: CadenceDebt;

  /** Attendee email addresses (from MeetingDefinition.attendees) */
  attendees: string[];
}

/**
 * Top-level response from the smart_meetings_status MCP tool.
 */
export interface SmartMeetingsStatusResponse {
  /** ISO 8601 timestamp when this response was generated */
  generatedAt: string;

  /**
   * Status for all meetings in smart-meetings-config.json.
   * Enabled meetings sorted by cadenceDebt DESC (most overdue first);
   * disabled meetings appended at the end.
   */
  meetings: MeetingStatus[];

  /**
   * Time portfolio summary.
   * Sourced from portfolioRef.current (written by the last rebalance pass).
   * Null if the rebalance pass has never run (server just started).
   */
  timePortfolio: TimePortfolioSummary | null;
}

/**
 * Discriminated config type stored in TaskConfig.config for both
 * smart-meeting-scheduler task entries in heartbeat-config.json.
 *
 * The SmartMeetingSchedulerTask.execute() method casts
 * taskConfig.config to this type and branches on phase.
 */
export interface SmartMeetingTaskConfig {
  /** Which scheduling phase this task entry performs */
  phase: 'forward-scheduling' | 'rebalance';

  /** Path to smart-meetings-config.json, relative to process.cwd() */
  configPath: string;
}
```

---

## Derived Value Notes

### expectedCadenceDays mapping

```typescript
const CADENCE_DAYS: Record<MeetingFrequency, number> = {
  weekly:      7,
  fortnightly: 14,
  monthly:     30,
};
```

### Trend calculation

A category trend is derived by comparing `thisWeek.{category}Pct` vs `lastWeek.{category}Pct`:

- Difference > +3 percentage points → `'worsening'` (more time consumed)
- Difference < −3 percentage points → `'improving'` (less time consumed)
- Otherwise → `'stable'`

"Improving" and "worsening" are relative to balance, not absolute quantity. For `focus`, more is generally better; for `recurring` and `adHoc`, less is generally better — but this judgement is intentionally left to the user. The tool reports direction, not verdict.

### PortfolioRef (shared in-process object)

```typescript
// src/services/smart-meetings/portfolio-ref.ts
export interface PortfolioRef {
  current: TimePortfolioSummary | null;
  lastUpdated: Date | null;
}
```

The `PortfolioRef` instance is created once at server startup (in `oauth-server.ts` or the MCP server entry point), passed to both `SmartMeetingSchedulerTask` (writer) and `SmartMeetingsService` (reader). Because both live in the same Node process, no serialisation is needed.
