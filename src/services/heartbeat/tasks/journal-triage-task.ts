/**
 * Journal triage task implementation
 * Syncs calendar events to journal entries and updates OneNote pages
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import { marked } from 'marked';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import type { CalendarEvent, DailyJournal } from '../../../lib/journal/types';
import { parseJournalFile } from '../../../lib/journal/journal-parser';
import { appendHeartbeatSummary, writeJournalFile } from '../../../lib/journal/journal-writer';
import { mergeCalendarToJournal, buildEventIdIndex, markMeetingCancelled } from '../../../lib/journal/journal-merger';
import { OneNoteClient, GraphApiError } from '../../../services/microsoft/onenote-client';
import { logger } from '../../../common/logger';

/**
 * Journal triage task configuration
 */
export interface JournalTriageConfig {
  /** Number of days ahead to process calendar events */
  lookaheadDays?: number;

  /** Root directory for journal storage */
  journalDir?: string;

  /** Whether to create/update OneNote pages */
  createOneNotePages?: boolean;

  /** Only create journal entries for workdays (Monday-Friday) */
  workdaysOnly?: boolean;
}

/**
 * Statistics tracked during execution
 */
interface ExecutionStats {
  eventsProcessed: number;
  journalsCreated: number;
  journalsUpdated: number;
  meetingsCancelled: number;
  oneNotePagesCreated: number;
  oneNotePagesUpdated: number;
  errors: string[];
}

/**
 * Journal triage task handler
 */
export class JournalTriageTask implements TaskHandler {
  private absoluteRootDir: string;

  constructor(
    private microsoftService: any, // MicrosoftService instance
    rootDir: string
  ) {
    // Resolve rootDir to absolute path to ensure consistent path resolution
    this.absoluteRootDir = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);

    logger.debug({
      operation: 'journal_triage_init',
      rootDir,
      absoluteRootDir: this.absoluteRootDir,
      message: `Initialized journal triage task with root directory: ${this.absoluteRootDir}`,
    });
  }

  /**
   * Execute journal triage task
   * @param taskConfig Task configuration
   */
  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = taskConfig.config as JournalTriageConfig;
    const lookaheadDays = config.lookaheadDays ?? 7;

    logger.info({
      operation: 'journal_triage_start',
      taskId: taskConfig.id,
      lookaheadDays,
      message: 'Starting journal triage task',
    });

    const stats: ExecutionStats = {
      eventsProcessed: 0,
      journalsCreated: 0,
      journalsUpdated: 0,
      meetingsCancelled: 0,
      oneNotePagesCreated: 0,
      oneNotePagesUpdated: 0,
      errors: [],
    };

    try {
      // Fetch calendar events for lookahead period
      const calendarEvents = await this.fetchCalendarEvents(lookaheadDays);

      logger.info({
        operation: 'journal_triage_fetched',
        taskId: taskConfig.id,
        eventCount: calendarEvents.length,
        message: `Fetched ${calendarEvents.length} calendar events`,
      });

      // Process journal updates
      await this.processJournals(calendarEvents, config, stats);

      // Sync to OneNote if enabled — today's events only
      if (config.createOneNotePages) {
        const todayKey = new Date().toISOString().split('T')[0];
        const todaysEvents = calendarEvents.filter((e) => e.start.dateTime.startsWith(todayKey));
        await this.syncToOneNote(todaysEvents, config, stats);
      }

      logger.info({
        operation: 'journal_triage_complete',
        taskId: taskConfig.id,
        stats,
        message: `Journal triage completed`,
      });
    } catch (error) {
      logger.error({
        operation: 'journal_triage_error',
        taskId: taskConfig.id,
        error: error instanceof Error ? error.message : String(error),
        message: 'Journal triage failed',
      });
      throw error;
    }
  }

  /**
   * Fetch calendar events for the specified lookahead period
   * @param lookaheadDays Number of days ahead to fetch
   * @returns Array of calendar events
   */
  private async fetchCalendarEvents(lookaheadDays: number): Promise<CalendarEvent[]> {
    try {
      // Start from beginning of today (midnight) to capture all of today's events
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + lookaheadDays);

      const startDateTime = startDate.toISOString();
      const endDateTime = endDate.toISOString();

      logger.debug({
        operation: 'fetch_calendar_events',
        startDate: startDateTime,
        endDate: endDateTime,
        lookaheadDays,
        message: `Fetching calendar events from ${startDateTime} to ${endDateTime}`,
      });

      // Use Microsoft Graph API to fetch events
      const response = await this.microsoftService.listEvents({
        startDate: startDateTime,
        endDate: endDateTime,
        count: 1000, // Large limit to ensure we get all events
      });

      // Map Graph API events to CalendarEvent type
      const events: CalendarEvent[] = response.events.map((event: any) => ({
        id: event.id,
        subject: event.subject,
        start: {
          dateTime: event.start.dateTime,
          timeZone: event.start.timeZone,
        },
        end: {
          dateTime: event.end.dateTime,
          timeZone: event.end.timeZone,
        },
        location: event.location
          ? {
              displayName: event.location.displayName,
              locationUri: event.location.locationUri,
            }
          : undefined,
        attendees: event.attendees?.map((att: any) => ({
          emailAddress: {
            name: att.emailAddress.name,
            address: att.emailAddress.address,
          },
        })),
        isAllDay: event.isAllDay ?? false,
        isCancelled: event.isCancelled ?? false,
      }));

      logger.debug({
        operation: 'fetch_calendar_events_success',
        eventCount: events.length,
        message: `Successfully fetched ${events.length} calendar events`,
      });

      return events;
    } catch (error) {
      logger.error({
        operation: 'fetch_calendar_events_error',
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to fetch calendar events',
      });

      // Re-throw for task failure handling
      throw new Error(
        `Failed to fetch calendar events: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Process journal files with calendar event updates
   * @param events Calendar events to process
   * @param config Task configuration
   * @param stats Execution statistics
   */
  private async processJournals(
    events: CalendarEvent[],
    config: JournalTriageConfig,
    stats: ExecutionStats
  ): Promise<void> {
    const lookaheadDays = config.lookaheadDays ?? 7;
    const workdaysOnly = config.workdaysOnly ?? false;

    // Group events by date
    const eventsByDate = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const eventDate = new Date(event.start.dateTime);
      const dateKey = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, []);
      }
      eventsByDate.get(dateKey)!.push(event);
    }

    // Generate list of all dates in lookahead period
    const today = new Date();
    const datesToProcess = new Set<string>();

    for (let i = 0; i < lookaheadDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      // Skip weekends if workdaysOnly is enabled
      if (workdaysOnly) {
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          // 0 = Sunday, 6 = Saturday
          continue;
        }
      }

      const dateKey = date.toISOString().split('T')[0];
      datesToProcess.add(dateKey);
    }

    // Process each date (including those without events)
    for (const dateKey of datesToProcess) {
      const dayEvents = eventsByDate.get(dateKey) || [];
      await this.processDateJournal(dateKey, dayEvents, config, stats);
    }

    // Append heartbeat summary to today's journal
    const todayKey = today.toISOString().split('T')[0];
    await this.appendHeartbeatSummaryToJournal(todayKey, stats, config);
  }

  /**
   * Process journal file for a specific date
   * @param dateKey Date in YYYY-MM-DD format
   * @param events Calendar events for this date
   * @param config Task configuration
   * @param stats Execution statistics
   */
  private async processDateJournal(
    dateKey: string,
    events: CalendarEvent[],
    config: JournalTriageConfig,
    stats: ExecutionStats
  ): Promise<void> {
    const journalDir = config.journalDir
      ? path.join(this.absoluteRootDir, config.journalDir)
      : path.join(this.absoluteRootDir, 'areas', 'journal');

    // Determine journal file path: {journalDir}/YYYY-MM/YYYY-MM-DD.md
    const [year, month] = dateKey.split('-');
    const monthDir = path.join(journalDir, `${year}-${month}`);
    const journalPath = path.join(monthDir, `${dateKey}.md`);

    // Create monthly directory if needed
    await fs.mkdir(monthDir, { recursive: true });

    let journal: DailyJournal;
    let fileExists = false;

    try {
      // Try to read existing journal
      const content = await fs.readFile(journalPath, 'utf-8');
      const parseResult = parseJournalFile(content);

      if (!parseResult.success) {
        logger.warn({
          operation: 'process_date_journal_parse_error',
          dateKey,
          error: parseResult.error,
          message: `Failed to parse journal file at ${journalPath}`,
        });
        stats.errors.push(`Parse error for ${dateKey}: ${parseResult.error}`);
        return;
      }

      journal = parseResult.journal!;
      fileExists = true;

      logger.debug({
        operation: 'process_date_journal_loaded',
        dateKey,
        meetingCount: journal.meetings.length,
        message: `Loaded existing journal with ${journal.meetings.length} meetings`,
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Journal doesn't exist, create new one
        journal = {
          frontmatter: {
            date: dateKey,
            day: new Date(dateKey).toLocaleDateString('en-US', { weekday: 'long' }),
            type: 'daily-planning',
            'energy-level': 7,
            'energy-description': 'Ready to start the day',
          },
          meetings: [],
          rawContent: '',
        };

        logger.debug({
          operation: 'process_date_journal_new',
          dateKey,
          message: `Creating new journal for ${dateKey}`,
        });
      } else {
        logger.error({
          operation: 'process_date_journal_read_error',
          dateKey,
          error: error.message,
          message: `Failed to read journal file at ${journalPath}`,
        });
        stats.errors.push(`Read error for ${dateKey}: ${error.message}`);
        return;
      }
    }

    // Build EventId index for O(1) lookup
    const eventIdIndex = buildEventIdIndex(journal);

    // Track if we made any changes
    let hasChanges = false;

    // Process each calendar event
    for (const event of events) {
      stats.eventsProcessed++;

      // Check for missing EventId (FR-014)
      if (!event.id) {
        logger.warn({
          operation: 'process_date_journal_missing_eventid',
          dateKey,
          subject: event.subject,
          message: `Skipping event without EventId: ${event.subject}`,
        });
        stats.errors.push(`Missing EventId for event: ${event.subject}`);
        continue;
      }

      // Check if EventId already exists (duplicate prevention - FR-014)
      const existingEntry = eventIdIndex.get(event.id);

      if (existingEntry) {
        // Merge calendar metadata, preserve user notes
        const mergedEntry = mergeCalendarToJournal(existingEntry, event);

        // Replace in meetings array
        const index = journal.meetings.findIndex((m) => m.eventId === event.id);
        if (index !== -1) {
          journal.meetings[index] = mergedEntry;
          hasChanges = true;

          logger.debug({
            operation: 'process_date_journal_updated',
            dateKey,
            eventId: event.id,
            title: event.subject,
            message: `Updated existing meeting: ${event.subject}`,
          });
        }
      } else {
        // Create new entry
        const newEntry = mergeCalendarToJournal(null, event);
        journal.meetings.push(newEntry);
        eventIdIndex.set(event.id, newEntry);
        hasChanges = true;

        logger.debug({
          operation: 'process_date_journal_created',
          dateKey,
          eventId: event.id,
          title: event.subject,
          message: `Created new meeting entry: ${event.subject}`,
        });
      }
    }

    // Handle cancelled meetings (T017)
    // Compare current journal entries with fetched events
    // Only mark meetings as cancelled if they are in the future
    const fetchedEventIds = new Set(events.map((e) => e.id));
    const now = new Date();

    for (const meeting of journal.meetings) {
      if (!fetchedEventIds.has(meeting.eventId) && !meeting.isCancelled) {
        // Parse meeting end time to determine if it's in the past
        // Time format is "HH:MM-HH:MM" or "HH:MM - HH:MM"
        const timeMatch = meeting.time.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);

        if (timeMatch) {
          const [, , , endHour, endMinute] = timeMatch;
          const meetingDate = new Date(dateKey);
          meetingDate.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);

          // Only mark as cancelled if meeting end time is in the future
          if (meetingDate > now) {
            const cancelledEntry = markMeetingCancelled(meeting);
            const index = journal.meetings.findIndex((m) => m.eventId === meeting.eventId);
            if (index !== -1) {
              journal.meetings[index] = cancelledEntry;
              hasChanges = true;
              stats.meetingsCancelled++;

              logger.info({
                operation: 'process_date_journal_cancelled',
                dateKey,
                eventId: meeting.eventId,
                title: meeting.title,
                message: `Marked meeting as cancelled: ${meeting.title}`,
              });
            }
          } else {
            logger.debug({
              operation: 'process_date_journal_past_meeting',
              dateKey,
              eventId: meeting.eventId,
              title: meeting.title,
              message: `Meeting already happened, not marking as cancelled: ${meeting.title}`,
            });
          }
        } else {
          logger.warn({
            operation: 'process_date_journal_invalid_time',
            dateKey,
            eventId: meeting.eventId,
            time: meeting.time,
            message: `Could not parse meeting time format: ${meeting.time}`,
          });
        }
      }
    }

    // Sort meetings by time for chronological order
    journal.meetings.sort((a, b) => {
      // Simple string comparison works for HH:MM-HH:MM format
      return a.time.localeCompare(b.time);
    });

    // Write journal file if changes were made
    if (hasChanges) {
      await this.writeJournalFile(journalPath, journal);

      if (fileExists) {
        stats.journalsUpdated++;
      } else {
        stats.journalsCreated++;
      }

      logger.info({
        operation: 'process_date_journal_saved',
        dateKey,
        meetingCount: journal.meetings.length,
        message: `Saved journal with ${journal.meetings.length} meetings`,
      });
    }
  }

  /**
   * Write journal content to file with file locking
   * @param journalPath Path to journal file
   * @param journal Journal data structure
   */
  private async writeJournalFile(journalPath: string, journal: DailyJournal): Promise<void> {
    // Resolve the real path (following symlinks) by finding an existing parent
    // This is critical because lockfile.lock() resolves symlinks and needs the real dir to exist
    let realJournalPath: string;

    try {
      // Try to resolve the full path if it exists
      const parentDir = path.dirname(journalPath);
      const realParentDir = await fs.realpath(parentDir);
      realJournalPath = path.join(realParentDir, path.basename(journalPath));
    } catch (error) {
      // Directory doesn't exist - find the first existing parent and construct the real path
      let currentPath = path.dirname(journalPath);
      const missingSegments: string[] = [];

      // Walk up the directory tree until we find an existing directory
      while (true) {
        try {
          const realPath = await fs.realpath(currentPath);
          // Found an existing directory - construct the full real path
          realJournalPath = path.join(realPath, ...missingSegments.reverse(), path.basename(journalPath));
          break;
        } catch {
          // This directory doesn't exist either, keep going up
          missingSegments.push(path.basename(currentPath));
          const parentPath = path.dirname(currentPath);
          if (parentPath === currentPath) {
            // Reached the root without finding an existing directory - shouldn't happen
            throw new Error(`Cannot resolve real path for ${journalPath}: no existing parent directory found`);
          }
          currentPath = parentPath;
        }
      }

      // Now create the directory structure in the real location
      const realParentDir = path.dirname(realJournalPath);
      await fs.mkdir(realParentDir, { recursive: true });

      // Verify directory was created
      try {
        await fs.access(realParentDir);
        logger.debug({
          operation: 'write_journal_file_dir_created',
          realParentDir,
          message: `Directory verified: ${realParentDir}`,
        });
      } catch (accessError) {
        throw new Error(`Failed to create directory ${realParentDir}: ${accessError instanceof Error ? accessError.message : String(accessError)}`);
      }
    }

    logger.debug({
      operation: 'write_journal_file_prepare',
      path: journalPath,
      realPath: realJournalPath,
      message: `Resolved real path for locking: ${realJournalPath}`,
    });

    // Ensure file exists for lockfile (create empty file if needed)
    // lockfile.lock() fails if the parent directory doesn't exist or isn't accessible
    try {
      await fs.access(realJournalPath);
    } catch {
      // File doesn't exist - create an empty one so lockfile can work
      await fs.writeFile(realJournalPath, '', 'utf-8');
      logger.debug({
        operation: 'write_journal_file_created_placeholder',
        realPath: realJournalPath,
        message: `Created placeholder file for locking`,
      });
    }

    // Acquire file lock to prevent concurrent writes
    let release: (() => Promise<void>) | null = null;

    try {
      // Try to acquire lock with timeout (use real path for locking)
      release = await lockfile.lock(realJournalPath, {
        retries: {
          retries: 3,
          minTimeout: 100,
          maxTimeout: 1000,
          factor: 2,
        },
        stale: 5000, // 5 second stale timeout
      });

      // Use the journal-writer function to generate content that preserves existing sections
      const content = writeJournalFile(journal);

      // Write to file (use real path for writing)
      await fs.writeFile(realJournalPath, content, 'utf-8');

      logger.debug({
        operation: 'write_journal_file_success',
        path: journalPath,
        realPath: realJournalPath,
        message: `Successfully wrote journal file`,
      });
    } catch (error) {
      logger.error({
        operation: 'write_journal_file_error',
        path: journalPath,
        realPath: realJournalPath,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to write journal file',
      });
      throw error;
    } finally {
      // Release lock if acquired
      if (release) {
        await release();
      }
    }
  }

  /**
   * Append heartbeat summary to today's journal
   * @param dateKey Date in YYYY-MM-DD format
   * @param stats Execution statistics
   * @param config Task configuration
   */
  private async appendHeartbeatSummaryToJournal(
    dateKey: string,
    stats: ExecutionStats,
    config: JournalTriageConfig
  ): Promise<void> {
    const journalDir = config.journalDir
      ? path.join(this.absoluteRootDir, config.journalDir)
      : path.join(this.absoluteRootDir, 'areas', 'journal');
    const [year, month] = dateKey.split('-');
    const monthDir = path.join(journalDir, `${year}-${month}`);
    const journalPath = path.join(monthDir, `${dateKey}.md`);

    // Ensure directory exists
    await fs.mkdir(monthDir, { recursive: true });

    try {
      // Try to read existing journal content
      let content: string;

      try {
        content = await fs.readFile(journalPath, 'utf-8');
      } catch (readError: any) {
        if (readError.code === 'ENOENT') {
          // File doesn't exist, create a new journal for today
          const date = new Date(dateKey);
          const journal: DailyJournal = {
            frontmatter: {
              date: dateKey,
              day: date.toLocaleDateString('en-US', { weekday: 'long' }),
              type: 'daily-planning',
              'energy-level': 7,
              'energy-description': 'Ready to start the day',
            },
            meetings: [],
            rawContent: '',
          };

          content = writeJournalFile(journal);

          logger.info({
            operation: 'append_heartbeat_summary_created',
            dateKey,
            message: `Created new journal file for ${dateKey}`,
          });
        } else {
          throw readError;
        }
      }

      // Create heartbeat summary
      const summary = {
        timestamp: new Date().toISOString(),
        taskName: 'journal-triage',
        entriesCreated: stats.journalsCreated,
        entriesUpdated: stats.journalsUpdated,
        onenotePagesSynced: stats.oneNotePagesCreated + stats.oneNotePagesUpdated,
        errors: stats.errors.length > 0 ? stats.errors : undefined,
      };

      // Append summary
      const updatedContent = appendHeartbeatSummary(content, summary);

      // Write back with locking
      await fs.writeFile(journalPath, updatedContent, 'utf-8');

      logger.debug({
        operation: 'append_heartbeat_summary_success',
        dateKey,
        message: 'Successfully appended heartbeat summary',
      });
    } catch (error: any) {
      logger.error({
        operation: 'append_heartbeat_summary_error',
        dateKey,
        error: error.message,
        message: 'Failed to append heartbeat summary',
      });
      // Don't throw - this is non-critical
    }
  }

  /**
   * Sync journal entries to OneNote pages
   * @param events Calendar events to sync
   * @param config Task configuration
   * @param stats Execution statistics
   */
  private async syncToOneNote(
    events: CalendarEvent[],
    config: JournalTriageConfig,
    stats: ExecutionStats
  ): Promise<void> {
    try {
      // Get access token and create OneNote client
      const accessToken = await (this.microsoftService as any).tokenStorage.getValidAccessToken();
      const oneNoteClient = new OneNoteClient(accessToken);

      // Get default notebook
      const notebook = await oneNoteClient.getDefaultNotebook();

      logger.debug({
        operation: 'sync_onenote_start',
        notebookId: notebook.id,
        eventCount: events.length,
        message: `Starting OneNote sync for ${events.length} events`,
      });

      // Group events by day for section organization (one section per day)
      const eventsByDay = new Map<string, CalendarEvent[]>();

      for (const event of events) {
        const eventDate = new Date(event.start.dateTime);
        const dateKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`; // YYYY-MM-DD

        if (!eventsByDay.has(dateKey)) {
          eventsByDay.set(dateKey, []);
        }
        eventsByDay.get(dateKey)!.push(event);
      }

      // Process each day's events
      for (const [dateKey, dayEvents] of eventsByDay.entries()) {
        await this.syncDayEventsToOneNote(
          oneNoteClient,
          notebook.id,
          dateKey,
          dayEvents,
          config,
          stats
        );
      }

      logger.info({
        operation: 'sync_onenote_complete',
        pagesCreated: stats.oneNotePagesCreated,
        pagesUpdated: stats.oneNotePagesUpdated,
        message: `OneNote sync completed`,
      });
    } catch (error) {
      logger.error({
        operation: 'sync_onenote_error',
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to sync to OneNote',
      });
      stats.errors.push(`OneNote sync error: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw - allow task to complete even if OneNote sync fails
    }
  }

  /**
   * Sync events for a specific day to OneNote
   * @param oneNoteClient OneNote client instance
   * @param notebookId Notebook ID
   * @param dateKey Date in YYYY-MM-DD format
   * @param events Events for this day
   * @param config Task configuration
   * @param stats Execution statistics
   */
  private async syncDayEventsToOneNote(
    oneNoteClient: OneNoteClient,
    notebookId: string,
    dateKey: string,
    events: CalendarEvent[],
    config: JournalTriageConfig,
    stats: ExecutionStats
  ): Promise<void> {
    // Create section name from date (e.g., "2026-02-18")
    // OneNote sections are now organized by day (one section per day)
    const sectionName = dateKey;

    logger.debug({
      operation: 'sync_day_events',
      dateKey,
      sectionName,
      eventCount: events.length,
      message: `Syncing ${events.length} events to section ${sectionName}`,
    });

    try {
      // Ensure section exists with retry logic
      const section = await this.retryOperation(
        () => oneNoteClient.ensureSectionExists(notebookId, sectionName),
        'ensureSectionExists'
      );

      logger.debug({
        operation: 'section_ensured',
        sectionId: section.id,
        sectionName: section.displayName,
        message: `Using section: ${section.displayName}`,
      });

      // Get corresponding journal to extract prep notes
      const journalDir = config.journalDir
        ? path.join(this.absoluteRootDir, config.journalDir)
        : path.join(this.absoluteRootDir, 'areas', 'journal');
      const [year, month] = dateKey.split('-');

      // Process each event
      for (const event of events) {
        await this.syncEventToOneNote(
          oneNoteClient,
          section.id,
          event,
          journalDir,
          year,
          month,
          stats
        );
      }
    } catch (error) {
      logger.error({
        operation: 'sync_day_events_error',
        dateKey,
        sectionName,
        error: error instanceof Error ? error.message : String(error),
        message: `Failed to sync events for ${dateKey}`,
      });
      stats.errors.push(`OneNote sync error for ${dateKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync a single event to OneNote
   * @param oneNoteClient OneNote client instance
   * @param sectionId Section ID
   * @param event Calendar event
   * @param journalDir Journal directory path
   * @param year Year string
   * @param month Month string (padded)
   * @param stats Execution statistics
   */
  private async syncEventToOneNote(
    oneNoteClient: OneNoteClient,
    sectionId: string,
    event: CalendarEvent,
    journalDir: string,
    year: string,
    month: string,
    stats: ExecutionStats
  ): Promise<void> {
    try {
      // Get event date for journal lookup
      const eventDate = new Date(event.start.dateTime);
      const dateKey = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD

      // Read journal file to get prep notes
      const journalPath = path.join(journalDir, `${year}-${month}`, `${dateKey}.md`);

      // Skip solo events (no other attendees) — they don't get Prep Notes sections
      if (!event.attendees || event.attendees.length <= 1) {
        return;
      }

      let prepNotes: string | undefined;

      try {
        const content = await fs.readFile(journalPath, 'utf-8');
        const parseResult = parseJournalFile(content);

        if (parseResult.success) {
          // Find meeting entry by EventId
          const meeting = parseResult.journal?.meetings.find((m) => m.eventId === event.id);
          prepNotes = meeting?.prepNotes;
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          logger.warn({
            operation: 'read_journal_for_onenote',
            journalPath,
            error: error.message,
            message: 'Failed to read journal for prep notes',
          });
        }
        // Journal doesn't exist yet — still create the page without prep notes
      }

      // Check if page already exists
      const existingPage = await this.retryOperation(
        () => oneNoteClient.findPageByTitle(sectionId, event.subject),
        'findPageByTitle'
      );

      // Convert prep notes to HTML
      const htmlContent = this.convertPrepNotesToHtml(event, prepNotes);

      if (existingPage) {
        // Update existing page
        await this.retryOperation(
          () => oneNoteClient.updatePageContent(existingPage.id, event.subject, htmlContent),
          'updatePageContent'
        );

        stats.oneNotePagesUpdated++;

        logger.info({
          operation: 'onenote_page_updated',
          pageId: existingPage.id,
          title: event.subject,
          message: `Updated OneNote page: ${event.subject}`,
        });
      } else {
        // Create new page
        await this.retryOperation(
          () => oneNoteClient.createPage(sectionId, event.subject, htmlContent),
          'createPage'
        );

        stats.oneNotePagesCreated++;

        logger.info({
          operation: 'onenote_page_created',
          title: event.subject,
          message: `Created OneNote page: ${event.subject}`,
        });
      }
    } catch (error) {
      logger.error({
        operation: 'sync_event_to_onenote_error',
        eventId: event.id,
        title: event.subject,
        error: error instanceof Error ? error.message : String(error),
        message: `Failed to sync event to OneNote: ${event.subject}`,
      });
      stats.errors.push(`OneNote sync failed for "${event.subject}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Convert prep notes markdown to HTML for OneNote
   * @param event Calendar event
   * @param prepNotes Prep notes in markdown format
   * @returns HTML content for OneNote page
   */
  private convertPrepNotesToHtml(event: CalendarEvent, prepNotes: string | undefined): string {
    // Convert markdown to HTML (empty placeholder if no prep notes yet)
    const prepNotesHtml = prepNotes ? marked.parse(prepNotes) as string : '<p><em>No prep notes yet.</em></p>';

    // Build meeting metadata
    const eventDate = new Date(event.start.dateTime);
    const eventTime = event.isAllDay
      ? 'All Day'
      : `${String(eventDate.getHours()).padStart(2, '0')}:${String(eventDate.getMinutes()).padStart(2, '0')}`;

    const allAttendeeNames = event.attendees?.map((att) => att.emailAddress.name || att.emailAddress.address) ?? [];
    const attendees = allAttendeeNames.length === 0
      ? 'None'
      : allAttendeeNames.length > 10
        ? `${allAttendeeNames.slice(0, 10).join(', ')}, _(and ${allAttendeeNames.length - 10} more...)_`
        : allAttendeeNames.join(', ');

    const location = event.location?.displayName || event.location?.locationUri || 'No location';

    // Build complete HTML structure
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${this.escapeHtml(event.subject)}</title>
</head>
<body>
  <h2>Meeting Details</h2>
  <p><strong>Date:</strong> ${eventDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  <p><strong>Time:</strong> ${eventTime}</p>
  <p><strong>Location:</strong> ${this.escapeHtml(location)}</p>
  <p><strong>Attendees:</strong> ${this.escapeHtml(attendees)}</p>

  <h2>Preparation Notes</h2>
  ${prepNotesHtml}
</body>
</html>
`;

    return html.trim();
  }

  /**
   * Escape HTML special characters
   * @param text Text to escape
   * @returns Escaped text
   */
  private escapeHtml(text: string): string {
    const htmlEscapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
  }

  /**
   * Retry operation with exponential backoff
   * @param operation Operation to retry
   * @param operationName Name for logging
   * @returns Operation result
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const maxRetries = 3;
    const initialDelay = 1000; // 1 second
    const backoffMultiplier = 2;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError);

        if (!isRetryable || attempt === maxRetries) {
          // Don't retry on permanent errors or after max retries
          logger.error({
            operation: 'retry_operation_failed',
            operationName,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            error: lastError.message,
            isRetryable,
            message: `Operation ${operationName} failed permanently`,
          });
          throw lastError;
        }

        // Determine delay: explicit Retry-After header > 429 default (30s) > exponential backoff
        const is429 = lastError instanceof GraphApiError && lastError.status === 429;
        const retryAfterSeconds = lastError instanceof GraphApiError ? lastError.retryAfter : undefined;
        const delay = retryAfterSeconds != null
          ? retryAfterSeconds * 1000
          : is429
            ? 30_000
            : initialDelay * Math.pow(backoffMultiplier, attempt);

        logger.warn({
          operation: 'retry_operation_attempt',
          operationName,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          delayMs: delay,
          rateLimited: is429,
          retryAfterSeconds: retryAfterSeconds ?? (is429 ? 30 : undefined),
          error: lastError.message,
          message: is429
            ? `Rate limited (429). Waiting ${retryAfterSeconds ?? 30}s before retrying ${operationName}`
            : `Retrying ${operationName} after ${delay}ms delay`,
        });

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // This should never be reached, but TypeScript doesn't know that
    throw lastError || new Error('Operation failed without error');
  }

  /**
   * Check if an error is retryable
   * @param error Error to check
   * @returns True if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    // Retry on transient errors
    const retryablePatterns = [
      '429', // Rate limiting
      '503', // Service unavailable
      '502', // Bad gateway
      '504', // Gateway timeout
      'network',
      'timeout',
      'econnreset',
      'econnrefused',
    ];

    // Don't retry on permanent errors
    const permanentPatterns = [
      '401', // Unauthorized
      '403', // Forbidden
      '404', // Not found
      '400', // Bad request
    ];

    // Check for permanent errors first
    for (const pattern of permanentPatterns) {
      if (errorMessage.includes(pattern)) {
        return false;
      }
    }

    // Check for retryable errors
    for (const pattern of retryablePatterns) {
      if (errorMessage.includes(pattern)) {
        return true;
      }
    }

    // Default to not retrying unknown errors
    return false;
  }
}
