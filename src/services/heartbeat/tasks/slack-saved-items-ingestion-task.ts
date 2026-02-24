/**
 * Slack Saved Items Ingestion Task (Feature 020)
 *
 * Heartbeat task that fetches all uncompleted Slack saved items, writes a
 * TriageEvent for each, and optionally marks them complete in Slack — mirroring
 * the email-ingestion-task pattern exactly.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveEvent } from '../../../lib/triage/triage-event-store';
import type { TriageEvent, EventSignals } from '../../../lib/policy/types';
import { logger } from '../../../common/logger';
import type { WebclientApiClient } from '../../slack-saved-items/webclient-api-client';
import { CredentialsExpiredError, CredentialsNotConfiguredError } from '../../slack-saved-items/webclient-api-client';
import type { SavedItem } from '../../../types/slack-saved-items';

interface SlackSavedItemsIngestionConfig {
  markAsComplete?: boolean;
}

export class SlackSavedItemsIngestionTask implements TaskHandler {
  private readonly absoluteSystemDir: string;

  constructor(
    private readonly apiClient: WebclientApiClient,
    systemDir: string
  ) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = (taskConfig.config ?? {}) as SlackSavedItemsIngestionConfig;
    const markAsComplete = config.markAsComplete !== false;

    logger.info({
      operation: 'slack_saved_items_ingestion_start',
      taskId: taskConfig.id,
      markAsComplete,
      message: `Starting Slack saved-items ingestion (markAsComplete=${markAsComplete})`,
    });

    // Paginate through all uncompleted saved items
    let allItems: SavedItem[] = [];
    try {
      let cursor: string | undefined;
      do {
        const response = await this.apiClient.savedList(cursor);

        // Fetch message text for each item
        const pageItems = await Promise.all(
          response.saved_items
            .filter((raw) => raw.state === 'uncompleted')
            .map(async (raw) => {
              const { text, userName } = await this.apiClient.fetchMessageText(raw.item_id, raw.ts);
              return {
                itemId: raw.item_id,
                itemType: raw.item_type,
                ts: raw.ts,
                state: 'uncompleted' as const,
                dateCreated: raw.date_created,
                dateDue: raw.date_due,
                dateCompleted: raw.date_completed,
                dateUpdated: raw.date_updated,
                dateSnoozedUntil: raw.date_snoozed_until,
                isArchived: raw.is_archived,
                messageText: text,
                userId: userName,
              };
            })
        );

        allItems = allItems.concat(pageItems);
        cursor = response.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch (err) {
      if (err instanceof CredentialsNotConfiguredError || err instanceof CredentialsExpiredError) {
        logger.error({
          operation: 'slack_saved_items_ingestion_auth_error',
          error: (err as Error).message,
          message: `Slack saved-items ingestion aborted: ${(err as Error).message}. Visit http://localhost:3333/auth/slack-saved-items/credentials to refresh.`,
        });
        return;
      }
      throw err;
    }

    logger.info({
      operation: 'slack_saved_items_ingestion_fetched',
      count: allItems.length,
      message: `Fetched ${allItems.length} uncompleted saved items`,
    });

    let eventsWritten = 0;
    let itemsCompleted = 0;

    for (const item of allItems) {
      try {
        const event = this.buildTriageEvent(item);
        await saveEvent(this.absoluteSystemDir, event);
        eventsWritten++;

        if (markAsComplete) {
          try {
            await this.apiClient.savedUpdate(item.itemId, item.ts);
            itemsCompleted++;
          } catch (completeErr) {
            logger.warn({
              operation: 'slack_saved_items_mark_complete_error',
              itemId: item.itemId,
              ts: item.ts,
              error: (completeErr as Error).message,
              message: `Failed to mark item ${item.itemId}/${item.ts} complete — continuing`,
            });
          }
        }
      } catch (err) {
        logger.warn({
          operation: 'slack_saved_items_ingestion_item_error',
          itemId: item.itemId,
          error: (err as Error).message,
          message: `Failed to write triage event for item ${item.itemId} — continuing`,
        });
      }
    }

    logger.info({
      operation: 'slack_saved_items_ingestion_complete',
      itemsFetched: allItems.length,
      eventsWritten,
      itemsCompleted,
      message: `Slack saved-items ingestion complete: ${eventsWritten}/${allItems.length} events written, ${itemsCompleted} marked complete`,
    });
  }

  buildTriageEvent(item: SavedItem): TriageEvent {
    const tsForId = item.ts.replace('.', '-');
    const date = new Date(item.dateCreated * 1000);
    const datePrefix = date.toISOString().slice(0, 10).replace(/-/g, '');

    const title = item.messageText.slice(0, 80) || `Slack message ${item.ts}`;
    const snippet = item.messageText.slice(0, 500);

    const signals: EventSignals = {
      asksForAction: this.detectActionRequest(item.messageText),
      mentionsMoney: this.detectMoney(item.messageText),
      mentionsMeeting: this.detectMeeting(item.messageText),
      isAutomated: false,
      isBulk: false,
      hasAttachments: false,
      hasUnsubscribe: false,
      prioritySender: false,
      outlookFirstSender: false,
    };

    return {
      eventId: `${datePrefix}-slack-${tsForId}`,
      source: 'slack-saved',
      status: 'pending',
      title,
      author: item.userId,
      receivedAt: new Date(item.dateCreated * 1000).toISOString(),
      snippet,
      signals,
      extracted: {},
      passCount: 0,
      passes: [],
      sourceData: {
        itemId: item.itemId,
        ts: item.ts,
        state: item.state,
        dateCreated: item.dateCreated,
        dateSnoozedUntil: item.dateSnoozedUntil,
        isArchived: item.isArchived,
      },
    };
  }

  private detectMoney(text: string): boolean {
    return /£|\$|€|\d+\.\d{2}|invoice|receipt|payment|billing|total|amount/i.test(text);
  }

  private detectMeeting(text: string): boolean {
    return /meeting|calendar|invite|schedule|call|zoom|teams|standup|stand-up/i.test(text);
  }

  private detectActionRequest(text: string): boolean {
    return /please|action required|follow.?up|can you|could you|request|deadline|urgent/i.test(text);
  }
}
