/**
 * Service-specific types for the heartbeat system
 */

import type { TaskConfig } from '../../types/heartbeat';

/**
 * Handler interface for task implementations
 */
export interface TaskHandler {
  /**
   * Execute the task logic
   * @param taskConfig Task configuration from heartbeat-config.json
   * @throws Error if task execution fails
   */
  execute(taskConfig: TaskConfig): Promise<void>;
}

/**
 * Registry of task handlers keyed by task type
 */
export type TaskRegistry = Map<string, TaskHandler>;

/**
 * Configuration for event ID generator
 */
export interface IdGeneratorConfig {
  /** Directory for counter persistence */
  baseDir: string;
}

/**
 * Configuration for event writer
 */
export interface EventWriterConfig {
  /** Directory for event files */
  eventsDir: string;

  /** Timeout for file lock acquisition (ms) */
  lockTimeout?: number;

  /** Number of lock retries */
  lockRetries?: number;
}

/**
 * Configuration for event consumer
 */
export interface EventConsumerConfig {
  /** Directory to watch for event files */
  eventsDir: string;

  /** Whether to process existing files on startup */
  processExisting?: boolean;

  /** Whether to delete files after successful processing */
  deleteAfterProcessing?: boolean;
}

/**
 * Email triage task configuration
 */
export interface EmailTriageConfig {
  /** Maximum number of emails to process per execution */
  maxEmails?: number;

  /** Whether to mark processed emails as read */
  markAsRead?: boolean;

  /** Event type identifier for event file naming */
  eventType?: string;

  /** Optional: Filter emails from specific folder */
  filterFolder?: string;

  /** Timeout in milliseconds for LLM inference per email */
  llmTimeout?: number;

  /** Number of emails to process concurrently */
  batchSize?: number;

  /** Optional: Target folder to move emails after processing (e.g., "Cerebro/Triaged") */
  targetFolder?: string;
}

/**
 * Calendar review task configuration
 */
export interface CalendarReviewConfig {
  /** Number of days ahead to scan for meetings */
  lookaheadDays?: number;

  /** OneNote notebook name for meeting pages */
  notebookName?: string;

  /** OneNote section name within notebook */
  sectionName?: string;

  /** Minimum hours before meeting to create page */
  minHoursBefore?: number;

  /** Whether to skip recurring meeting series */
  skipRecurring?: boolean;

  /** Markdown template for OneNote page */
  pageTemplate?: string;
}

/**
 * Journal triage task configuration
 */
export interface JournalTriageConfig {
  /** Number of days ahead to process calendar events (default: 7) */
  lookaheadDays?: number;

  /** Root directory for journal storage relative to rootDir (default: "areas/journal") */
  journalDir?: string;

  /** Whether to create/update OneNote pages (default: false) */
  createOneNotePages?: boolean;

  /** OneNote section naming format (default: "YYYY-MM Meetings") */
  oneNoteSectionFormat?: string;

  /** Only create journal entries for workdays (Monday-Friday) (default: false) */
  workdaysOnly?: boolean;
}
