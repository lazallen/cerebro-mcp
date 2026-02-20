/**
 * Email Ingestion Task (Feature 019)
 * Fetches unread emails, computes deterministic heuristic signals,
 * and writes TriageEvent artifacts to system/triage/.
 *
 * This replaces the email-triage-task's combined fetch+LLM+move approach.
 * Ingestion ONLY: no LLM, no email moves. Policy engine + executor handle all actions.
 */

import * as path from 'path';
import TurndownService from 'turndown';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { saveEvent } from '../../../lib/triage/triage-event-store';
import type { TriageEvent, EventSignals } from '../../../lib/policy/types';
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
    this.turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
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

    // Fetch emails via the public ingestion method (includes all required fields)
    let messages: GraphMessage[] = [];
    try {
      messages = await this.graphClient.getEmailsForIngestion({
        count: maxEmails,
        folder,
      });
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
        const event = this.buildTriageEvent(msg, priorityList);
        await saveEvent(this.absoluteSystemDir, event);
        written++;
        if (markAsRead) {
          await this.graphClient.markEmailRead(msg.id);
        }
      } catch (err) {
        logger.warn({
          operation: 'email_ingestion_event_error',
          messageId: msg.id,
          error: (err as Error).message,
          message: `Failed to write triage event for message ${msg.id}`,
        });
      }
    }

    logger.info({
      operation: 'email_ingestion_complete',
      written,
      total: messages.length,
      message: `Email ingestion complete: ${written}/${messages.length} events written`,
    });
  }

  private buildTriageEvent(msg: GraphMessage, priorityList: string[]): TriageEvent {
    const senderEmail = msg.from.emailAddress.address.toLowerCase();
    const date = msg.receivedDateTime.slice(0, 10).replace(/-/g, '');
    const eventId = `${date}-email-${msg.id.slice(-8)}`;

    // Convert HTML body to plain text for snippet
    const bodyText = msg.body.contentType === 'html'
      ? this.turndown.turndown(msg.body.content)
      : msg.body.content;

    const snippet = this.normalizeSnippet(msg.bodyPreview ?? bodyText.slice(0, 500));

    const signals: EventSignals = {
      isAutomated: this.detectAutomated(msg),
      isBulk: this.detectBulk(msg),
      hasUnsubscribe: this.detectUnsubscribe(bodyText, msg.bodyPreview ?? ''),
      hasAttachments: msg.hasAttachments ?? false,
      mentionsMoney: this.detectMoney(msg.subject, snippet),
      mentionsMeeting: this.detectMeeting(msg.subject, snippet),
      asksForAction: this.detectActionRequest(msg.subject, snippet),
      prioritySender: priorityList.some(
        (p) => p.toLowerCase() === senderEmail
      ),
      // Outlook/Exchange injects this banner for senders outside your contact list
      outlookFirstSender: /you don'?t often get email from/i.test(msg.bodyPreview ?? ''),
    };

    return {
      eventId,
      source: 'email',
      status: 'pending',
      title: msg.subject,
      author: senderEmail,
      receivedAt: msg.receivedDateTime,
      snippet,
      signals,
      extracted: {},
      passCount: 0,
      passes: [],
      sourceData: {
        messageId: msg.id,
        internetMessageId: msg.internetMessageId,
        conversationId: msg.conversationId,
        from: msg.from.emailAddress,
        bodyPreview: msg.bodyPreview,
      },
    };
  }

  private normalizeSnippet(raw: string): string {
    return raw
      .replace(/\r\n/g, '\n')           // CRLF → LF
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())  // collapse intra-line whitespace
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')       // collapse 3+ blank lines to one
      .trim()
      .slice(0, 500);
  }

  private detectAutomated(msg: GraphMessage): boolean {
    const subject = msg.subject.toLowerCase();
    const from = msg.from.emailAddress.address.toLowerCase();
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

  private detectUnsubscribe(bodyText: string, bodyPreview: string): boolean {
    const lower = (bodyText + ' ' + bodyPreview).toLowerCase();
    return lower.includes('unsubscribe') || lower.includes('opt out') || lower.includes('opt-out');
  }

  private detectMoney(subject: string, snippet: string): boolean {
    const text = (subject + ' ' + snippet).toLowerCase();
    return /£|\$|€|\d+\.\d{2}|invoice|receipt|payment|billing|total|amount/.test(text);
  }

  private detectMeeting(subject: string, snippet: string): boolean {
    const text = (subject + ' ' + snippet).toLowerCase();
    return /meeting|calendar|invite|schedule|call|zoom|teams|standup|stand-up/.test(text);
  }

  private detectActionRequest(subject: string, snippet: string): boolean {
    const text = (subject + ' ' + snippet).toLowerCase();
    return /please|action required|follow.?up|can you|could you|request|deadline|urgent/.test(text);
  }
}
