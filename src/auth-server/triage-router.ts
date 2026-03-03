/**
 * TriageRouter — handles all /triage/* requests for the Triage Review UI.
 *
 * Routes:
 *   GET  /triage                         → serve index.html
 *   GET  /triage/static/:file            → serve CSS/JS assets
 *   GET  /triage/api/items               → list items with status: triage (JSON)
 *   POST /triage/api/items/:id/resolve   → resolve a triage item
 *   GET  /triage/api/items/:id/calendar  → day view for meeting invites
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../common/logger';
import { listItems, getItem, updateItem } from '../lib/item/item-store';
import type { Item, Action } from '../lib/item/types';

export interface CalendarDayEvent {
  subject: string;
  startDateTime: string;
  endDateTime: string;
  isAllDay: boolean;
  showAs: string;
  id?: string;
  seriesMasterId?: string;
}

export interface RecurringConflicts {
  occurrencesChecked: number;
  conflictCount: number;
  conflicts: Array<{ date: string; conflictingSubject: string }>;
}

export interface CalendarResponder {
  respondToMeetingInviteEmail(
    messageId: string,
    response: 'accepted' | 'declined' | 'tentativelyAccepted'
  ): Promise<void>;
  getEventDetailsForMessage?(messageId: string): Promise<{
    startDateTime: string;
    endDateTime: string;
    eventId?: string;
    isRecurring?: boolean;
  } | null>;
  getCalendarView?(startDateTime: string, endDateTime: string): Promise<CalendarDayEvent[]>;
  getRecurringConflicts?(
    seriesMasterId: string,
    meetingStart: string,
    meetingEnd: string
  ): Promise<RecurringConflicts>;
}

export interface TriageItemView {
  id: string;
  source: string;
  title: string;
  question: string;
  createdAt: string;
  /** 'meeting-invite' triggers calendar response buttons in the UI */
  itemType: string;
  /** For backwards compat with app.js — same as id */
  eventRef: string;
  bodyMarkdown: string;
  messageId?: string;
}

interface ResolutionPayload {
  resolution:
    | 'done'
    | 'defer'
    | 'delegate'
    | 'execute-with-claude'
    | 'calendar-accepted'
    | 'calendar-tentative'
    | 'calendar-declined';
  answer?: string;
}

const STATIC_DIR = path.join(process.cwd(), 'src', 'auth-server', 'triage', 'public');
const ALLOWED_STATIC = new Set(['index.html', 'app.js', 'styles.css']);
const CONTENT_TYPES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
};

export class TriageRouter {
  private readonly absoluteSystemDir: string;
  private readonly calendarResponder?: CalendarResponder;

  constructor(systemDir: string, _contextDir: string, calendarResponder?: CalendarResponder) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
    this.calendarResponder = calendarResponder;
  }

  async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const method = req.method ?? 'GET';

    if (pathname === '/triage' || pathname === '/triage/') {
      return this.serveStatic(res, 'index.html');
    }

    const staticMatch = pathname.match(/^\/triage\/static\/(.+)$/);
    if (method === 'GET' && staticMatch) {
      return this.serveStatic(res, staticMatch[1]);
    }

    if (method === 'GET' && pathname === '/triage/api/items') {
      return this.handleListItems(res);
    }

    const resolveMatch = pathname.match(/^\/triage\/api\/items\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveMatch) {
      return this.handleResolve(req, res, decodeURIComponent(resolveMatch[1]));
    }

    const calendarMatch = pathname.match(/^\/triage\/api\/items\/([^/]+)\/calendar$/);
    if (method === 'GET' && calendarMatch) {
      return this.handleCalendarView(res, decodeURIComponent(calendarMatch[1]));
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  // ─── Static ───────────────────────────────────────────────────────────────

  private async serveStatic(res: http.ServerResponse, filename: string): Promise<void> {
    if (!ALLOWED_STATIC.has(filename)) {
      this.sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    try {
      const content = await fs.readFile(path.join(STATIC_DIR, filename));
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[filename] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      this.sendJson(res, 404, { ok: false, error: 'Static file not found' });
    }
  }

  // ─── List items ───────────────────────────────────────────────────────────

  private async handleListItems(res: http.ServerResponse): Promise<void> {
    try {
      const items = await this.loadPendingItems();
      this.sendJson(res, 200, { items });
    } catch (err) {
      logger.error({
        operation: 'triage_list_error',
        error: (err as Error).message,
        message: 'Failed to list triage items',
      });
      this.sendJson(res, 500, { ok: false, error: 'Could not read triage queue' });
    }
  }

  async loadPendingItems(): Promise<TriageItemView[]> {
    const items = await listItems(this.absoluteSystemDir, ['triage']);
    return items
      .map((item) => this.toTriageView(item))
      .filter((v): v is TriageItemView => v !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private toTriageView(item: Item): TriageItemView | null {
    // Find the pending TRIAGE action to get the question
    const triageAction = item.actions
      .filter((a) => a.type === 'TRIAGE' && a.status === 'pending')
      .pop();
    if (!triageAction) return null;

    const title =
      item.type === 'MESSAGE' ? (item.subject ?? `Message from ${item.source}`) : item.title;

    const bodyMarkdown = item.type === 'MESSAGE' ? (item.body ?? '') : this.buildEventBody(item);

    const messageId = item.type === 'MESSAGE' ? item.messageId : item.messageId;

    return {
      id: item.id,
      source: item.source,
      title,
      question: triageAction.question ?? 'Please review this item.',
      createdAt: item.createdAt,
      itemType: item.source === 'meeting-invite' ? 'meeting-invite' : item.type.toLowerCase(),
      eventRef: item.id,
      bodyMarkdown,
      messageId,
    };
  }

  private buildEventBody(item: Item): string {
    if (item.type !== 'EVENT') return '';
    const parts: string[] = [];
    if (item.organizer) parts.push(`**Organizer:** ${item.organizer}`);
    if (item.attendees && item.attendees.length > 0) {
      parts.push(`**Attendees:** ${item.attendees.join(', ')}`);
    }
    if (item.location) parts.push(`**Location:** ${item.location}`);
    if (item.start) parts.push(`**Start:** ${item.start}`);
    if (item.end) parts.push(`**End:** ${item.end}`);
    if (item.description) {
      parts.push('', '---', '', item.description);
    }
    return parts.join('\n');
  }

  // ─── Resolve ──────────────────────────────────────────────────────────────

  private async handleResolve(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: string
  ): Promise<void> {
    let payload: ResolutionPayload;
    try {
      payload = await this.parseJsonBody<ResolutionPayload>(req);
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }

    const { resolution, answer } = payload;
    const VALID = [
      'done',
      'defer',
      'delegate',
      'execute-with-claude',
      'calendar-accepted',
      'calendar-tentative',
      'calendar-declined',
    ];
    if (!VALID.includes(resolution)) {
      this.sendJson(res, 400, { ok: false, error: 'Invalid resolution' });
      return;
    }
    if (resolution === 'delegate' && !answer?.trim()) {
      this.sendJson(res, 400, { ok: false, error: 'answer required for delegate' });
      return;
    }

    const item = await getItem(this.absoluteSystemDir, id);
    if (!item) {
      this.sendJson(res, 404, { ok: false, error: 'Item not found' });
      return;
    }
    if (item.status !== 'triage') {
      this.sendJson(res, 409, { ok: false, error: 'Item is not in triage state' });
      return;
    }

    logger.info({
      operation: 'triage_resolve',
      id,
      resolution,
      message: `Resolving item ${id} as ${resolution}`,
    });

    try {
      switch (resolution) {
        case 'done':
          return await this.handleDone(res, item);
        case 'defer':
          return await this.handleDefer(res, item);
        case 'delegate':
          return await this.handleDelegate(res, item, answer);
        case 'execute-with-claude':
          return await this.handleExecuteWithClaude(res, item);
        case 'calendar-accepted':
        case 'calendar-tentative':
        case 'calendar-declined':
          return await this.handleCalendarResponse(res, item, resolution);
      }
    } catch (err) {
      logger.error({
        operation: 'triage_resolve_error',
        id,
        resolution,
        error: (err as Error).message,
      });
      this.sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  }

  // ─── Resolution handlers ──────────────────────────────────────────────────

  private async handleDone(res: http.ServerResponse, item: Item): Promise<void> {
    const now = new Date().toISOString();

    // Mark the pending TRIAGE action as done
    this.resolveTriageAction(item, 'done', now);

    // Queue ARCHIVE action — executor will mark item as done
    const archiveAction: Action = { type: 'ARCHIVE', at: now, status: 'pending' };
    item.actions.push(archiveAction);
    item.status = 'pending';

    await updateItem(this.absoluteSystemDir, item);
    this.sendJson(res, 200, { ok: true, id: item.id, resolution: 'done' });
  }

  private async handleDefer(res: http.ServerResponse, item: Item): Promise<void> {
    const now = new Date().toISOString();

    this.resolveTriageAction(item, 'deferred', now);

    // Queue CREATE_TASK — executor writes the task file
    const createTaskAction: Action = { type: 'CREATE_TASK', at: now, status: 'pending' };
    item.actions.push(createTaskAction);
    item.status = 'pending';

    await updateItem(this.absoluteSystemDir, item);
    this.sendJson(res, 200, { ok: true, id: item.id, resolution: 'defer' });
  }

  private async handleDelegate(
    res: http.ServerResponse,
    item: Item,
    answer: string
  ): Promise<void> {
    const now = new Date().toISOString();

    // Mark TRIAGE done with the human answer — policy will re-evaluate
    this.resolveTriageAction(item, answer.trim(), now);
    item.status = 'inbox';

    await updateItem(this.absoluteSystemDir, item);
    this.sendJson(res, 200, { ok: true, id: item.id, resolution: 'delegate' });
  }

  private async handleExecuteWithClaude(res: http.ServerResponse, item: Item): Promise<void> {
    const now = new Date().toISOString();

    // Mark TRIAGE done
    this.resolveTriageAction(item, 'execute-with-claude', now);

    // Build prompt from item content
    const title = item.type === 'MESSAGE'
      ? (item.subject ?? `Message from ${item.source}`)
      : item.title;
    const body = item.type === 'MESSAGE' ? (item.body ?? '') : (item.description ?? '');
    const prompt = `${title}\n\n${body}`.trim();

    // Queue CLAUDE_EXECUTE action — executor will pick it up
    const executeAction: Action = {
      type: 'CLAUDE_EXECUTE',
      at: now,
      status: 'pending',
      prompt,
    };
    item.actions.push(executeAction);
    item.status = 'pending';

    await updateItem(this.absoluteSystemDir, item);
    this.sendJson(res, 200, { ok: true, id: item.id, resolution: 'execute-with-claude' });
  }

  private async handleCalendarResponse(
    res: http.ServerResponse,
    item: Item,
    resolution: 'calendar-accepted' | 'calendar-tentative' | 'calendar-declined'
  ): Promise<void> {
    if (!this.calendarResponder) {
      this.sendJson(res, 503, { ok: false, error: 'Microsoft service not configured' });
      return;
    }
    const messageId = item.type === 'MESSAGE' ? item.messageId : item.messageId;
    if (!messageId) {
      this.sendJson(res, 422, { ok: false, error: 'No messageId on this item' });
      return;
    }

    const calendarResponseMap = {
      'calendar-accepted': 'accepted',
      'calendar-tentative': 'tentativelyAccepted',
      'calendar-declined': 'declined',
    } as const;
    const calendarResponse = calendarResponseMap[resolution];

    const now = new Date().toISOString();
    this.resolveTriageAction(item, calendarResponse, now);

    // Queue RESPOND_CALENDAR + MOVE to Archive + ARCHIVE (local)
    item.actions.push({ type: 'RESPOND_CALENDAR', at: now, status: 'pending', calendarResponse });
    item.actions.push({ type: 'MOVE', at: now, status: 'pending', folder: 'Cerebro/Archive/Meeting Invites' });
    item.actions.push({ type: 'ARCHIVE', at: now, status: 'pending' });
    item.status = 'pending';

    await updateItem(this.absoluteSystemDir, item);
    this.sendJson(res, 200, { ok: true, id: item.id, resolution });
  }

  // ─── Calendar day view ────────────────────────────────────────────────────

  private async handleCalendarView(res: http.ServerResponse, id: string): Promise<void> {
    if (!this.calendarResponder?.getCalendarView) {
      this.sendJson(res, 503, { ok: false, error: 'Calendar service not available' });
      return;
    }

    const item = await getItem(this.absoluteSystemDir, id);
    if (!item) {
      this.sendJson(res, 404, { ok: false, error: 'Item not found' });
      return;
    }

    try {
      let startDateTime: string;
      let endDateTime: string;
      let eventId: string | undefined;
      let isRecurring: boolean | undefined;

      const hasReliableTimes =
        item.type === 'EVENT' && item.start && item.end && item.start !== item.end;

      if (hasReliableTimes && item.type === 'EVENT') {
        // EventItems already have start/end stored — use them directly
        startDateTime = item.start;
        endDateTime = item.end;
        eventId = item.calendarEventId;
      } else {
        // MessageItem — look up the calendar event via Graph API
        const messageId = item.messageId;
        if (!messageId || !this.calendarResponder.getEventDetailsForMessage) {
          this.sendJson(res, 422, { ok: false, error: 'No messageId for this item' });
          return;
        }
        const details = await this.calendarResponder.getEventDetailsForMessage(messageId);
        if (!details) {
          this.sendJson(res, 404, { ok: false, error: 'Could not resolve calendar event' });
          return;
        }
        startDateTime = details.startDateTime;
        endDateTime = details.endDateTime;
        eventId = details.eventId;
        isRecurring = details.isRecurring;
      }

      const meetingDate = startDateTime.slice(0, 10);
      const dayStart = `${meetingDate}T00:00:00.000Z`;
      const dayEnd = `${meetingDate}T23:59:59.999Z`;

      const events = await this.calendarResponder.getCalendarView(dayStart, dayEnd);

      let recurringConflicts: RecurringConflicts | undefined;
      if (isRecurring && eventId && this.calendarResponder.getRecurringConflicts) {
        try {
          recurringConflicts = await this.calendarResponder.getRecurringConflicts(
            eventId,
            startDateTime,
            endDateTime
          );
        } catch (err) {
          logger.warn({
            operation: 'triage_recurring_conflicts_error',
            error: (err as Error).message,
          });
        }
      }

      this.sendJson(res, 200, {
        ok: true,
        date: meetingDate,
        meetingStart: startDateTime,
        meetingEnd: endDateTime,
        events,
        isRecurring: isRecurring ?? false,
        recurringConflicts,
      });
    } catch (err) {
      logger.error({
        operation: 'triage_calendar_view_error',
        id,
        error: (err as Error).message,
      });
      this.sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Mark the pending TRIAGE action as done with the given answer. */
  private resolveTriageAction(item: Item, answer: string, at: string): void {
    const triage = item.actions.filter((a) => a.type === 'TRIAGE' && a.status === 'pending').pop();
    if (triage) {
      triage.status = 'done';
      triage.answer = answer;
      triage.at = at;
    }
  }

  private parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
