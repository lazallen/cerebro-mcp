/**
 * Calendar Ingestion Task
 * Fetches upcoming calendar events and writes EventItem artifacts to system/events/.
 *
 * Ingestion ONLY: no journal writes, no OneNote. Policy pipeline handles all actions.
 * Journal writing remains the responsibility of the journal-triage task.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveItem, getItem } from '../../../lib/item/item-store';
import type { EventItem } from '../../../lib/item/types';
import { logger } from '../../../common/logger';

interface CalendarIngestionConfig {
  lookaheadDays?: number;
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

    let calendarEvents: any[] = [];
    try {
      const response = await this.microsoftService.listEvents({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        count: maxEvents,
      });
      calendarEvents = response.events ?? [];
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
      count: calendarEvents.length,
      message: `Fetched ${calendarEvents.length} calendar events`,
    });

    let written = 0;
    for (const calEvent of calendarEvents) {
      try {
        // Use the graph event ID for deduplication
        const id = String(calEvent.id ?? '');
        const existing = await getItem(this.absoluteSystemDir, id);
        if (existing) {
          logger.debug({
            operation: 'calendar_ingestion_skip_existing',
            itemId: id,
            message: `Skipping already-ingested calendar event: ${id}`,
          });
          continue;
        }

        const item = this.buildEventItem(calEvent);
        await saveItem(this.absoluteSystemDir, item);
        written++;
      } catch (err) {
        logger.warn({
          operation: 'calendar_ingestion_event_error',
          eventId: calEvent.id,
          error: (err as Error).message,
          message: `Failed to write item for calendar event ${calEvent.id}`,
        });
      }
    }

    logger.info({
      operation: 'calendar_ingestion_complete',
      written,
      total: calendarEvents.length,
      message: `Calendar ingestion complete: ${written}/${calendarEvents.length} items written`,
    });
  }

  private buildEventItem(calEvent: any): EventItem {
    const attendees: string[] =
      (calEvent.attendees ?? []).map(
        (a: any) => a.emailAddress?.address ?? a.emailAddress?.name ?? ''
      );

    return {
      type: 'EVENT',
      source: 'calendar',
      id: String(calEvent.id ?? ''),
      status: 'inbox',
      createdAt: calEvent.start?.dateTime ?? new Date().toISOString(),
      title: calEvent.subject ?? 'Untitled Meeting',
      start: calEvent.start?.dateTime ?? new Date().toISOString(),
      end: calEvent.end?.dateTime ?? new Date().toISOString(),
      description: calEvent.bodyPreview ?? calEvent.body?.content ?? '',
      organizer: calEvent.organizer?.emailAddress?.address,
      attendees,
      location: calEvent.location?.displayName,
      isCancelled: calEvent.isCancelled ?? false,
      isOnlineMeeting: calEvent.isOnlineMeeting ?? false,
      calendarEventId: String(calEvent.id ?? ''),
      signals: {
        isAutomated: false,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: true,
        isActionRequest: false,
        isPrioritySender: false,
      },
      actions: [
        {
          type: 'INGEST',
          at: new Date().toISOString(),
          status: 'done',
        },
      ],
    };
  }
}
