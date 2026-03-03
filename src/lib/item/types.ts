/**
 * Unified item types for the triage system.
 *
 * Each MESSAGE (email, slack) or EVENT (calendar) is stored as a single YAML
 * file with an append-only actions array tracking the full pipeline lifecycle.
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type ItemType = 'MESSAGE' | 'EVENT';

export type ItemStatus = 'inbox' | 'pending' | 'triage' | 'done';

export type ItemSource =
  | 'email'
  | 'slack'
  | 'slack-saved'
  | 'calendar'
  | 'meeting-invite'
  | 'journal'
  | 'other';

export type ActionType =
  | 'INGEST'          // always first, always done
  | 'ENHANCE'         // LLM enrichment, always written as done (never pending)
  | 'TRIAGE'          // human review in the web UI
  | 'MOVE'            // move email/message to a folder (Graph API)
  | 'FLAG'            // flag an item (Graph API)
  | 'LABEL'           // label/category on an item (Graph API)
  | 'CREATE_TASK'     // write a task file to ./context/tasks/
  | 'JOURNAL_NOTE'    // append a note to today's journal file
  | 'RESPOND_CALENDAR' // respond to a meeting invite (Graph API)
  | 'ARCHIVE'         // terminal — move to done/, no API call
  | 'CLAUDE_EXECUTE'; // autonomous Claude execution (SpecKit workflow on a branch)

export type ActionStatus = 'done' | 'pending' | 'failed' | 'waiting';

// ---------------------------------------------------------------------------
// Action — single entry in the append-only audit log
// ---------------------------------------------------------------------------

export interface Action {
  type: ActionType;
  at: string;            // ISO timestamp
  status: ActionStatus;
  // ENHANCE fields
  intent?: string;
  confidence?: number;
  summary?: string;
  entities?: string[];
  relatedTasks?: string[];  // task slugs matched by the second enrichment call
  // TRIAGE fields
  question?: string;
  answer?: string;       // set when human resolves
  // MOVE fields
  folder?: string;
  // LABEL / FLAG fields
  name?: string;
  flagStatus?: string;
  // CREATE_TASK fields
  taskFile?: string;     // path to the created task file
  taskTitle?: string;
  // JOURNAL_NOTE fields
  note?: string;         // the note text to append to today's journal
  // RESPOND_CALENDAR fields
  calendarResponse?: 'accepted' | 'declined' | 'tentativelyAccepted';
  // CLAUDE_EXECUTE fields
  prompt?: string;           // the initial feature description / task prompt
  branchName?: string;       // git branch created for this job
  jobStep?: string;          // 'spec' | 'clarify' | 'plan' | 'tasks' | 'implement' | 'done'
  specDir?: string;          // relative path e.g. specs/025-my-feature/
  questionItemIds?: string[]; // IDs of inbox items created for clarification questions
  // Error info
  error?: string;
}

// ---------------------------------------------------------------------------
// Signals — heuristic metadata computed at ingest time
// ---------------------------------------------------------------------------

export interface Signals {
  isAutomated: boolean;
  isBulk: boolean;
  hasUnsubscribe: boolean;
  hasAttachments: boolean;
  mentionsMoney: boolean;
  mentionsMeeting: boolean;
  isActionRequest: boolean;
  isPrioritySender: boolean;
  isMeetingRequest?: boolean;
  /** Source-specific extensions, e.g. 'calendar.isOrganiser', 'slack.isDirectMessage' */
  [key: string]: boolean | string | number | undefined;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

interface BaseItem {
  type: ItemType;
  source: ItemSource;
  id: string;
  status: ItemStatus;
  createdAt: string;     // ISO timestamp
  signals: Signals;
  actions: Action[];
}

export interface MessageItem extends BaseItem {
  type: 'MESSAGE';
  body: string;          // full parsed content (not a snippet)
  // Email-specific
  subject?: string;
  from?: string;
  to?: string[];
  date?: string;
  messageId?: string;    // Microsoft Graph message ID for MOVE/FLAG
  // Slack-specific
  channel?: string;
  user?: string;
  slackTimestamp?: string;
}

export interface EventItem extends BaseItem {
  type: 'EVENT';
  title: string;
  start: string;         // ISO timestamp
  end: string;           // ISO timestamp
  description?: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  calendarEventId?: string;  // Microsoft Graph event ID
  messageId?: string;        // for meeting-invite responses
}

export type Item = MessageItem | EventItem;
