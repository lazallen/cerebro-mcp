/**
 * Email Ingestion Task
 * Fetches unread emails, computes heuristic signals, and writes MessageItem
 * artifacts to system/messages/.
 *
 * Ingestion ONLY: no LLM, no email moves. Policy pipeline + executor handle actions.
 */

import * as path from 'path';
import TurndownService from 'turndown';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveItem, getItem } from '../../../lib/item/item-store';
import type { Item, MessageItem, EventItem, Signals } from '../../../lib/item/types';
import { logger } from '../../../common/logger';

interface EmailIngestionConfig {
  maxEmails?: number;
  markAsRead?: boolean;
  filterFolder?: string;
  prioritySenderList?: string[];
}

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from: { emailAddress: { address: string; name?: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  subject: string;
  receivedDateTime: string;
  body: { content: string; contentType?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
  meetingMessageType?:
    | 'meetingRequest'
    | 'meetingCancelled'
    | 'meetingAccepted'
    | 'meetingDeclined'
    | 'meetingTentativelyAccepted'
    | 'meetingUpdated';
  event?: {
    id?: string;
    type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
    start?: { dateTime?: string; timeZone?: string };
    end?: { dateTime?: string; timeZone?: string };
    attendees?: Array<{
      emailAddress: { name?: string; address: string };
      type?: 'required' | 'optional' | 'resource';
    }>;
    location?: { displayName?: string };
  };
}

export class EmailIngestionTask implements TaskHandler {
  private turndown: TurndownService;
  private readonly absoluteSystemDir: string;

  constructor(
    private graphClient: any,
    systemDir: string
  ) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
    this.turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', linkStyle: 'referenced' });
    this.turndown.remove(['style', 'script', 'noscript', 'iframe', 'object', 'embed']);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = (taskConfig.config ?? {}) as EmailIngestionConfig;
    const maxEmails = config.maxEmails ?? 50;
    const folder = config.filterFolder ?? 'inbox';
    const markAsRead = config.markAsRead ?? false;

    logger.info({
      operation: 'email_ingestion_start',
      taskId: taskConfig.id,
      maxEmails,
      message: `Starting email ingestion: ${maxEmails} emails from ${folder}`,
    });

    let messages: GraphMessage[] = [];
    try {
      messages = await this.graphClient.getEmailsForIngestion({ count: maxEmails, folder });
    } catch (err) {
      logger.error({
        operation: 'email_ingestion_fetch_error',
        error: (err as Error).message,
        message: 'Failed to fetch emails',
      });
      throw err;
    }

    logger.info({
      operation: 'email_ingestion_fetched',
      count: messages.length,
      message: `Fetched ${messages.length} emails`,
    });

    let written = 0;
    const priorityList: string[] = config.prioritySenderList ?? [];

    for (const msg of messages) {
      try {
        // Skip re-ingest if item is already in the pipeline
        const existing = await getItem(this.absoluteSystemDir, msg.id);
        if (existing) {
          logger.debug({
            operation: 'email_ingestion_skip_existing',
            itemId: msg.id,
            status: existing.status,
            message: `Skipping already-ingested email: ${msg.id}`,
          });
          continue;
        }

        const item = this.buildItem(msg, priorityList);
        await saveItem(this.absoluteSystemDir, item);
        written++;

        if (markAsRead) {
          await this.graphClient.markEmailRead(msg.id);
        }
      } catch (err) {
        logger.warn({
          operation: 'email_ingestion_item_error',
          messageId: msg.id,
          error: (err as Error).message,
          message: `Failed to write item for message ${msg.id}`,
        });
      }
    }

    logger.info({
      operation: 'email_ingestion_complete',
      written,
      total: messages.length,
      message: `Email ingestion complete: ${written}/${messages.length} items written`,
    });
  }

  buildItem(msg: GraphMessage, priorityList: string[]): Item {
    const senderEmail = msg.from.emailAddress.address.toLowerCase();
    const isMeetingRequest = msg.meetingMessageType === 'meetingRequest';

    // Convert HTML body to markdown; always store full content
    // Decode Microsoft Safe Links before converting so references show real URLs
    const body =
      msg.body.contentType === 'html'
        ? this.turndown.turndown(this.decodeSafeLinks(msg.body.content))
        : msg.body.content;

    const signals: Signals = {
      isAutomated: this.detectAutomated(msg),
      isBulk: this.detectBulk(msg),
      hasUnsubscribe: this.detectUnsubscribe(body, msg.bodyPreview ?? ''),
      hasAttachments: msg.hasAttachments ?? false,
      mentionsMoney: this.detectMoney(msg.subject, body),
      mentionsMeeting: this.detectMeeting(msg.subject, body) || isMeetingRequest,
      isActionRequest: this.detectActionRequest(msg.subject, body),
      isPrioritySender: priorityList.some((p) => p.toLowerCase() === senderEmail),
    };

    const ingestAction = { type: 'INGEST' as const, at: new Date().toISOString(), status: 'done' as const };

    if (isMeetingRequest) {
      const ev = msg.event;
      const attendees = (ev?.attendees ?? []).map((a) => a.emailAddress.address);
      const eventItem: EventItem = {
        type: 'EVENT',
        source: 'meeting-invite',
        id: msg.id,
        status: 'inbox',
        createdAt: msg.receivedDateTime,
        title: msg.subject,
        start: ev?.start?.dateTime ?? msg.receivedDateTime,
        end: ev?.end?.dateTime ?? msg.receivedDateTime,
        description: body,
        organizer: senderEmail,
        attendees,
        location: ev?.location?.displayName,
        messageId: msg.id,   // needed for RESPOND_CALENDAR via /me/messages/{id}/accept
        calendarEventId: ev?.id,
        isOnlineMeeting: false,
        signals,
        actions: [ingestAction],
      };
      return eventItem;
    }

    const messageItem: MessageItem = {
      type: 'MESSAGE',
      source: 'email',
      id: msg.id,
      status: 'inbox',
      createdAt: msg.receivedDateTime,
      subject: msg.subject,
      from: senderEmail,
      to: msg.toRecipients?.map((r) => r.emailAddress.address) ?? [],
      date: msg.receivedDateTime,
      messageId: msg.id,
      body,
      signals,
      actions: [ingestAction],
    };
    return messageItem;
  }

  private detectAutomated(msg: GraphMessage): boolean {
    const from = msg.from.emailAddress.address.toLowerCase();
    const subject = msg.subject.toLowerCase();
    return (
      from.includes('noreply') ||
      from.includes('no-reply') ||
      from.includes('donotreply') ||
      subject.includes('automated') ||
      subject.includes('notification') ||
      subject.includes('auto-generated')
    );
  }

  private detectBulk(msg: GraphMessage): boolean {
    const from = msg.from.emailAddress.address.toLowerCase();
    return (
      from.includes('newsletter') ||
      from.includes('marketing') ||
      from.includes('news@') ||
      from.includes('info@') ||
      from.includes('updates@')
    );
  }

  private detectUnsubscribe(body: string, preview: string): boolean {
    const lower = (body + ' ' + preview).toLowerCase();
    return lower.includes('unsubscribe') || lower.includes('opt out') || lower.includes('opt-out');
  }

  private detectMoney(subject: string, body: string): boolean {
    const text = (subject + ' ' + body.slice(0, 500)).toLowerCase();
    return /£|\$|€|\d+\.\d{2}|invoice|receipt|payment|billing|total|amount/.test(text);
  }

  private detectMeeting(subject: string, body: string): boolean {
    const text = (subject + ' ' + body.slice(0, 500)).toLowerCase();
    return /meeting|calendar|invite|schedule|call|zoom|teams|standup|stand-up/.test(text);
  }

  private decodeSafeLinks(html: string): string {
    // Match the entire safelinks URL (including all trailing &data=...&reserved=0 params)
    // then extract and decode just the url= parameter
    return html.replace(
      /https?:\/\/[a-z0-9]+\.safelinks\.protection\.outlook\.com\/[^\s"'>]*/gi,
      (match) => {
        const urlParam = match.match(/[?&]url=([^&]+)/);
        if (!urlParam) return match;
        try { return decodeURIComponent(urlParam[1]); } catch { return match; }
      }
    );
  }

  private detectActionRequest(subject: string, body: string): boolean {
    const text = (subject + ' ' + body.slice(0, 500)).toLowerCase();
    return /please|action required|follow.?up|can you|could you|request|deadline|urgent/.test(text);
  }
}
