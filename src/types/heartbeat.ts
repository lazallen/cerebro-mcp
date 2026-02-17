/**
 * Type definitions for the heartbeat scheduling system
 */

/**
 * Task types supported by the heartbeat system
 */
export type TaskType = 'email-triage' | 'calendar-review';

/**
 * Configuration for a single scheduled task
 */
export interface TaskConfig {
  /** Unique identifier for this task */
  id: string;

  /** Human-readable task name */
  name: string;

  /** Task implementation type */
  type: TaskType;

  /** Cron expression (5 fields: minute hour day month dayOfWeek) */
  schedule: string;

  /** Whether this task is active */
  enabled: boolean;

  /** Task-specific configuration */
  config: Record<string, unknown>;
}

/**
 * Root configuration for the heartbeat system
 */
export interface HeartbeatConfig {
  /** Root directory for event storage and logs */
  rootDir: string;

  /** Array of scheduled task definitions */
  tasks: TaskConfig[];
}

/**
 * Execution status for a task
 */
export type TaskStatus = 'success' | 'error' | 'timeout';

/**
 * Record of a single task execution
 */
export interface TaskExecutionRecord {
  /** Task ID (references TaskConfig.id) */
  taskId: string;

  /** Lock flag for concurrency control */
  currentlyRunning: boolean;

  /** Timestamp of last execution start */
  lastRun: Date | null;

  /** Duration in milliseconds */
  lastDuration: number;

  /** Last execution result */
  lastStatus: TaskStatus;

  /** Error message if lastStatus === 'error' */
  lastError: string | null;

  /** Total successful executions */
  runCount: number;

  /** Total failed executions */
  errorCount: number;
}

/**
 * Event file metadata (YAML frontmatter)
 */
export interface EventFileFrontmatter {
  /** Event type (matches filename) */
  type: string;

  /** ISO 8601 timestamp of event creation */
  timestamp: string;

  /** ID of task that generated this event */
  source_task_id: string;

  /** Optional additional metadata fields (for email triage, calendar, etc.) */
  [key: string]: string | undefined;
}

/**
 * Email triage action item
 */
export interface ActionItem {
  /** What needs to be done */
  description: string;

  /** Person responsible (if mentioned in email) */
  assigned_to?: string;

  /** ISO 8601 timestamp (if mentioned) */
  deadline?: string;

  /** Based on urgency indicators */
  priority: 'high' | 'medium' | 'low';

  /** Type of action item */
  category: 'question' | 'request' | 'task' | 'deadline';
}

/**
 * Structured data extracted from email content
 */
export interface EmailTriageResult {
  /** From address */
  from: string;

  /** Email subject */
  subject: string;

  /** ISO 8601 timestamp */
  received: string;

  /** Unique message ID */
  message_id: string;

  /** Email classification (e.g., 'personal', 'work', 'newsletter', 'spam', 'automated', 'notification') */
  intent?: string;

  /** Email tone (e.g., 'urgent', 'casual', 'formal', 'friendly', 'neutral') */
  tone?: string;

  /** Extracted action items */
  action_items: ActionItem[];

  /** Questions asked in the email */
  questions: string[];

  /** Requests made in the email */
  requests: string[];

  /** Explicit deadlines mentioned */
  deadlines: string[];

  /** Brief summary of key points */
  summary: string;

  /** Email body converted to clean markdown (optional, from LLM) */
  body_markdown?: string;
}

/**
 * Counter state for unique ID generation
 */
export interface CounterState {
  /** YYYYMMDD format */
  date: string;

  /** Incremental counter (resets daily) */
  counter: number;
}

/**
 * Meeting preparation record
 */
export interface MeetingPreparationRecord {
  /** Calendar event ID from Microsoft Graph */
  meetingId: string;

  /** Event subject */
  meetingSubject: string;

  /** Event start time */
  meetingStart: Date;

  /** Created page ID (null if not yet created) */
  oneNotePageId: string | null;

  /** Page web URL */
  oneNotePageUrl: string | null;

  /** When page was created */
  createdAt: Date | null;

  /** Current status */
  status: 'pending' | 'created' | 'error';

  /** Error message if status === 'error' */
  error: string | null;
}
