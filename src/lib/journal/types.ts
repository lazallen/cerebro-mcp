/**
 * Type definitions for journal manipulation
 */

/**
 * Journal frontmatter structure matching existing format
 * Reference: context/areas/journal/2026-02/*.md
 */
export interface JournalFrontmatter {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Day of week (e.g., "Monday") */
  day: string;
  /** Always "daily-planning" for daily journals */
  type: 'daily-planning';
  /** Morning energy level (1-10) */
  'energy-level': number;
  /** Morning energy description */
  'energy-description': string;
  /** Evening energy level (1-10) - optional */
  'end-energy-level'?: number;
  /** Evening energy description - optional */
  'end-energy-description'?: string;
  /** Whether shutdown review was completed - optional */
  'shutdown-complete'?: boolean;
}

/**
 * Meeting entry within a daily journal
 */
export interface MeetingEntry {
  /** Meeting time (e.g., "08:00-09:00", "All Day") */
  time: string;
  /** Meeting title */
  title: string;
  /** Comma-separated attendees (may include [[wiki-links]]) */
  attendees?: string;
  /** Physical or virtual location */
  location?: string;
  /** Microsoft Graph event ID */
  eventId: string;
  /** Wiki links to related tasks/people */
  related?: string;
  /** User's prep notes (markdown) */
  prepNotes?: string;
  /** User's meeting notes (markdown) */
  meetingNotes?: string;
  /** Flag indicating meeting was cancelled */
  isCancelled?: boolean;
}

/**
 * Complete daily journal structure
 */
export interface DailyJournal {
  /** Parsed frontmatter */
  frontmatter: JournalFrontmatter;
  /** Array of meeting entries */
  meetings: MeetingEntry[];
  /** Raw markdown content (for sections we don't parse) */
  rawContent: string;
}

/**
 * Result of parsing a journal file
 */
export interface JournalParseResult {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed journal (if successful) */
  journal?: DailyJournal;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Heartbeat summary for task execution logging
 */
export interface HeartbeatSummary {
  /** ISO 8601 timestamp of execution */
  timestamp: string;
  /** Task name (always "journal-triage") */
  taskName: string;
  /** Count of new journal entries created */
  entriesCreated: number;
  /** Count of existing entries updated */
  entriesUpdated: number;
  /** Count of OneNote pages synced */
  onenotePagesSynced: number;
  /** List of errors encountered */
  errors?: string[];
}

/**
 * Calendar event from Microsoft Graph API
 */
export interface CalendarEvent {
  /** Unique event ID */
  id: string;
  /** Meeting title */
  subject: string;
  /** Start date/time */
  start: {
    dateTime: string;
    timeZone: string;
  };
  /** End date/time */
  end: {
    dateTime: string;
    timeZone: string;
  };
  /** Location information */
  location?: {
    displayName?: string;
    locationUri?: string;
  };
  /** List of attendees */
  attendees?: Array<{
    emailAddress: {
      name?: string;
      address: string;
    };
    type: string;
  }>;
  /** Whether event is cancelled */
  isCancelled?: boolean;
  /** Whether event is all-day */
  isAllDay?: boolean;
}
