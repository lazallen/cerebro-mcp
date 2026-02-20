/**
 * Calendar Ingestion Task
 * Fetches upcoming calendar events and writes TriageEvent artifacts to system/triage/.
 *
 * Ingestion ONLY: no journal writes, no OneNote. Policy engine handles all actions.
 * Journal writing remains the responsibility of the journal-triage task.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveEvent } from '../../../lib/triage/triage-event-store';
import type { TriageEvent } from '../../../lib/policy/types';
import { logger } from '../../../common/logger';

interface CalendarIngestionConfig {
  /** Number of days ahead to fetch events (default: 7) */
  lookaheadDays?: number;
  /** Maximum events to fetch (default: 100) */
  maxEvents?: number;
}

export class CalendarIngestionTask implements TaskHandler {
  private readonly absoluteSystemDir: string;

  constructor(
    private readonly microsoftService: any,
    systemDir: string
  ) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = (taskConfig.config ?? {}) as CalendarIngestionConfig;
    const lookaheadDays = config.lookaheadDays ?? 7;
    const maxEvents = config.maxEvents ?? 100;

    logger.info({
      operation: 'calendar_ingestion_start',
      taskId: taskConfig.id,
      lookaheadDays,
      message: `Starting calendar ingestion: ${lookaheadDays} day lookahead`,
    });

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + lookaheadDays);

    let events: any[] = [];
    try {
      const response = await this.microsoftService.listEvents({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        count: maxEvents,
      });
      events = response.events ?? [];
    } catch (err) {
      logger.error({
        operation: 'calendar_ingestion_fetch_error',
        error: (err as Error).message,
        message: 'Failed to fetch calendar events',
      });
      throw err;
    }

    logger.info({
      operation: 'calendar_ingestion_fetched',
      count: events.length,
      message: `Fetched ${events.length} calendar events`,
    });

    let written = 0;
    for (const event of events) {
      try {
        const triageEvent = this.buildTriageEvent(event);
        await saveEvent(this.absoluteSystemDir, triageEvent);
        written++;
      } catch (err) {
        logger.warn({
          operation: 'calendar_ingestion_event_error',
          eventId: event.id,
          error: (err as Error).message,
          message: `Failed to write triage event for calendar event ${event.id}`,
        });
      }
    }

    logger.info({
      operation: 'calendar_ingestion_complete',
      written,
      total: events.length,
      message: `Calendar ingestion complete: ${written}/${events.length} events written`,
    });
  }

  private buildTriageEvent(event: any): TriageEvent {
    const startDate = (event.start?.dateTime ?? new Date().toISOString()).slice(0, 10).replace(/-/g, '');
    const eventId = `${startDate}-calendar-${String(event.id ?? '').slice(-8)}`;

    return {
      eventId,
      source: 'calendar',
      status: 'pending',
      title: event.subject ?? 'Untitled Meeting',
      author: 'calendar@system',
      receivedAt: event.start?.dateTime ?? new Date().toISOString(),
      snippet: event.location?.displayName
        ? `Meeting at ${event.location.displayName}: ${event.subject}`
        : `Meeting: ${event.subject}`,
      signals: {
        isAutomated: false,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: true,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
      passCount: 0,
      passes: [],
      sourceData: {
        calendarEventId: event.id,
        start: event.start?.dateTime,
        end: event.end?.dateTime,
        attendees: event.attendees,
        isCancelled: event.isCancelled ?? false,
        isAllDay: event.isAllDay ?? false,
      },
    };
  }
}
