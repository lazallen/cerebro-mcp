/**
 * Slack Saved Items Ingestion Task (Feature 020)
 *
 * Fetches all uncompleted Slack saved items and writes a MessageItem for each
 * to system/messages/ — mirroring the email-ingestion-task pattern.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveItem, getItem } from '../../../lib/item/item-store';
import type { MessageItem, Signals } from '../../../lib/item/types';
import { logger } from '../../../common/logger';
import type { WebclientApiClient } from '../../slack-saved-items/webclient-api-client';
import {
  CredentialsExpiredError,
  CredentialsNotConfiguredError,
} from '../../slack-saved-items/webclient-api-client';
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

    let allItems: SavedItem[] = [];
    try {
      let cursor: string | undefined;
      do {
        const response = await this.apiClient.savedList(cursor);

        const pageItems = await Promise.all(
          response.saved_items
            .filter((raw) => raw.state === 'uncompleted')
            .map(async (raw) => {
              const { text, userName } = await this.apiClient.fetchMessageText(
                raw.item_id,
                raw.ts
              );
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
          message: `Slack saved-items ingestion aborted: ${(err as Error).message}`,
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

    let itemsWritten = 0;
    let itemsCompleted = 0;

    for (const item of allItems) {
      try {
        // Derive a stable ID from the slack item ID + timestamp
        const stableId = `slack-${item.itemId}-${item.ts}`;
        const existing = await getItem(this.absoluteSystemDir, stableId);
        if (existing) {
          logger.debug({
            operation: 'slack_ingestion_skip_existing',
            itemId: stableId,
            message: `Skipping already-ingested Slack item: ${stableId}`,
          });
          continue;
        }

        const messageItem = this.buildMessageItem(item, stableId);
        await saveItem(this.absoluteSystemDir, messageItem);
        itemsWritten++;

        if (markAsComplete) {
          try {
            await this.apiClient.savedUpdate(item.itemId, item.ts);
            itemsCompleted++;
          } catch (completeErr) {
            logger.warn({
              operation: 'slack_saved_items_mark_complete_error',
              itemId: item.itemId,
              error: (completeErr as Error).message,
              message: `Failed to mark item ${item.itemId} complete — continuing`,
            });
          }
        }
      } catch (err) {
        logger.warn({
          operation: 'slack_saved_items_ingestion_item_error',
          itemId: item.itemId,
          error: (err as Error).message,
          message: `Failed to write item for ${item.itemId} — continuing`,
        });
      }
    }

    logger.info({
      operation: 'slack_saved_items_ingestion_complete',
      itemsFetched: allItems.length,
      itemsWritten,
      itemsCompleted,
      message: `Slack ingestion complete: ${itemsWritten}/${allItems.length} items written`,
    });
  }

  buildMessageItem(item: SavedItem, id: string): MessageItem {
    const signals: Signals = {
      isAutomated: false,
      isBulk: false,
      hasUnsubscribe: false,
      hasAttachments: false,
      isActionRequest: this.detectActionRequest(item.messageText),
      mentionsMoney: this.detectMoney(item.messageText),
      mentionsMeeting: this.detectMeeting(item.messageText),
      isPrioritySender: false,
    };

    return {
      type: 'MESSAGE',
      source: 'slack-saved',
      id,
      status: 'inbox',
      createdAt: new Date(item.dateCreated * 1000).toISOString(),
      body: item.messageText,
      user: item.userId,
      slackTimestamp: item.ts,
      signals,
      actions: [
        {
          type: 'INGEST',
          at: new Date().toISOString(),
          status: 'done',
        },
      ],
    };
  }

  private detectMoney(text: string): boolean {
    return /£|\$|€|\d+\.\d{2}|invoice|receipt|payment|billing|total|amount/i.test(text);
  }

  private detectMeeting(text: string): boolean {
    return /meeting|calendar|invite|schedule|call|zoom|teams|standup|stand-up/i.test(text);
  }

  private detectActionRequest(text: string): boolean {
    return /please|action required|follow.?up|can you|could you|request|deadline|urgent/i.test(
      text
    );
  }
}
