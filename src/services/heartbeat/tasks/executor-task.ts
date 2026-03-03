/**
 * ExecutorTask — carries out pending API actions on items.
 *
 * Scans items with status: pending, executes each pending action, and marks
 * them done. When all pending actions on an item are done, moves the item to
 * status: done.
 *
 * Handles: MOVE, FLAG, LABEL (Graph API), CREATE_TASK (file write),
 *          RESPOND_CALENDAR (Graph API), ARCHIVE (terminal no-op).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { listItems, updateItem, archiveItem } from '../../../lib/item/item-store';
import type { Item, Action, MessageItem } from '../../../lib/item/types';
import type { ClaudeExecutorService } from '../../enrichment/claude-executor-service';
import { logger } from '../../../common/logger';

interface ExecutorConfig {
  rootDir?: string;
}

export class ExecutorTask implements TaskHandler {
  private readonly absoluteSystemDir: string;

  constructor(
    private readonly graphClient: any,
    systemDir: string,
    private readonly rootDir: string = './context',
    private readonly claudeExecutor?: ClaudeExecutorService
  ) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    const cfg = (taskConfig.config ?? {}) as ExecutorConfig;
    const rootDir = cfg.rootDir
      ? path.isAbsolute(cfg.rootDir)
        ? cfg.rootDir
        : path.resolve(process.cwd(), cfg.rootDir)
      : path.resolve(process.cwd(), this.rootDir);

    logger.info({
      operation: 'executor_start',
      taskId: taskConfig.id,
      message: 'ExecutorTask starting',
    });

    const pendingItems = await listItems(this.absoluteSystemDir, ['pending']);

    // Also check 'waiting' items whose CLAUDE_EXECUTE questions may now be answered
    if (this.claudeExecutor) {
      const waitingItems = await listItems(this.absoluteSystemDir, ['waiting' as any]);
      for (const item of waitingItems) {
        const waitingAction = item.actions.find(
          (a) => a.type === 'CLAUDE_EXECUTE' && a.status === 'waiting'
        );
        if (!waitingAction) continue;
        const answers = await this.claudeExecutor.checkResume(waitingAction, this.absoluteSystemDir);
        if (answers !== null) {
          // Questions answered — transition back to pending so next cycle executes
          item.status = 'pending';
          await updateItem(this.absoluteSystemDir, item);
          logger.info({
            operation: 'executor_claude_resume',
            itemId: item.id,
            message: `CLAUDE_EXECUTE job ${item.id} questions answered — resuming`,
          });
        }
      }
    }

    if (pendingItems.length === 0) {
      logger.info({ operation: 'executor_no_pending', message: 'No pending items' });
      return;
    }

    logger.info({
      operation: 'executor_items_loaded',
      count: pendingItems.length,
      message: `Processing ${pendingItems.length} pending item(s)`,
    });

    for (const item of pendingItems) {
      await this.processItem(item, rootDir);
    }

    logger.info({
      operation: 'executor_complete',
      taskId: taskConfig.id,
      processed: pendingItems.length,
      message: 'ExecutorTask complete',
    });
  }

  private async processItem(item: Item, rootDir: string): Promise<void> {
    const pendingActions = item.actions.filter(
      (a) => a.status === 'pending' || a.status === 'waiting'
    );

    for (const action of pendingActions) {
      try {
        await this.executeAction(item, action, rootDir);
        action.status = 'done';
      } catch (err) {
        const message = (err as Error).message;
        const isPermanent = this.isPermanentFailure(err);
        logger.warn({
          operation: 'executor_action_error',
          itemId: item.id,
          actionType: action.type,
          permanent: isPermanent,
          error: message,
          message: `Action ${action.type} failed for ${item.id}: ${message}`,
        });
        action.status = isPermanent ? 'failed' : 'pending';
        action.error = message;
      }
    }

    // All pending actions done → terminal
    const stillPending = item.actions.some((a) => a.status === 'pending');
    if (!stillPending) {
      item.status = 'done';
    }

    await updateItem(this.absoluteSystemDir, item);

    // If item is done and has a completed ARCHIVE action, move it to done/
    const wasArchived = item.actions.some((a) => a.type === 'ARCHIVE' && a.status === 'done');
    if (item.status === 'done' && wasArchived) {
      try {
        await archiveItem(this.absoluteSystemDir, item);
      } catch (err) {
        logger.warn({
          operation: 'executor_archive_move_error',
          itemId: item.id,
          error: (err as Error).message,
          message: `Failed to move item to done/: ${item.id}`,
        });
      }
    }
  }

  private async executeAction(item: Item, action: Action, rootDir: string): Promise<void> {
    switch (action.type) {
      case 'MOVE':
        await this.executeMove(item, action);
        break;
      case 'FLAG':
        await this.executeFlag(item, action);
        break;
      case 'LABEL':
        await this.executeLabel(item, action);
        break;
      case 'CREATE_TASK':
        await this.executeCreateTask(item, action, rootDir);
        break;
      case 'JOURNAL_NOTE':
        await this.executeJournalNote(item, action, rootDir);
        break;
      case 'RESPOND_CALENDAR':
        await this.executeRespondCalendar(item, action);
        break;
      case 'ARCHIVE':
        // Terminal — no API call needed
        logger.debug({
          operation: 'executor_terminal',
          itemId: item.id,
          actionType: action.type,
        });
        break;
      case 'CLAUDE_EXECUTE':
        await this.executeClaudeJob(item, action, rootDir);
        // Job may have set status='waiting' — don't override to 'done' in that case
        if (action.status === 'waiting') return;
        break;
      default:
        logger.warn({
          operation: 'executor_unknown_action',
          itemId: item.id,
          actionType: action.type,
          message: `Unknown action type: ${action.type}`,
        });
    }
  }

  private async executeMove(item: Item, action: Action): Promise<void> {
    const messageId = item.messageId;
    if (!messageId) throw new Error(`No messageId on ${item.id}`);
    if (!action.folder) throw new Error(`MOVE on ${item.id} missing folder`);
    await this.graphClient.moveEmail(messageId, action.folder);
    logger.info({ operation: 'executor_moved', itemId: item.id, folder: action.folder });
  }

  private async executeFlag(item: Item, action: Action): Promise<void> {
    const messageId = (item as MessageItem).messageId;
    if (!messageId) throw new Error(`No messageId on ${item.id}`);
    await this.graphClient.setEmailFlag(messageId, action.flagStatus ?? 'flagged');
    logger.info({ operation: 'executor_flagged', itemId: item.id });
  }

  private async executeLabel(item: Item, action: Action): Promise<void> {
    const messageId = (item as MessageItem).messageId;
    if (!messageId) throw new Error(`No messageId on ${item.id}`);
    if (!action.name) throw new Error(`LABEL on ${item.id} missing name`);
    await this.graphClient.applyCategories(messageId, [action.name]);
    logger.info({ operation: 'executor_labelled', itemId: item.id, label: action.name });
  }

  private async executeCreateTask(item: Item, action: Action, rootDir: string): Promise<void> {
    const tasksDir = path.join(rootDir, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    const date = item.createdAt.slice(0, 10).replace(/-/g, '');
    const existing = await fs.readdir(tasksDir).catch(() => [] as string[]);
    const count = existing.filter((f) => f.startsWith(date) && f.endsWith('.md')).length;
    const filename = `${date}-task-${String(count + 1).padStart(3, '0')}.md`;
    const filepath = path.join(tasksDir, filename);

    const title =
      action.taskTitle ??
      (item.type === 'MESSAGE' ? (item.subject ?? `Task from ${item.source}`) : item.title);

    const enhance = item.actions.find((a) => a.type === 'ENHANCE' && a.status === 'done');
    const triage = [...item.actions]
      .reverse()
      .find((a) => a.type === 'TRIAGE' && a.status === 'done' && a.answer);

    const bodyLines = [
      `## ${title}`,
      '',
      `- **Source**: ${item.source}`,
      `- **Created**: ${item.createdAt}`,
    ];
    if (item.type === 'MESSAGE' && item.from) {
      bodyLines.push(`- **From**: ${item.from}`);
    }
    if (enhance?.summary) {
      bodyLines.push('', '## Summary', '', enhance.summary);
    }
    if (triage?.answer) {
      bodyLines.push('', '## Notes', '', triage.answer);
    }
    const bodyContent = item.type === 'MESSAGE' ? (item.body ?? '') : (item.description ?? '');
    if (bodyContent) {
      bodyLines.push('', '## Content', '', bodyContent.slice(0, 1000));
    }

    const fileContent = matter.stringify(bodyLines.join('\n'), {
      type: 'task',
      source: item.source,
      itemId: item.id,
      title,
      createdAt: new Date().toISOString(),
      status: 'open',
    });
    await fs.writeFile(filepath, fileContent, 'utf-8');

    action.taskFile = filepath;
    logger.info({ operation: 'executor_task_created', itemId: item.id, taskFile: filepath });
  }

  private async executeRespondCalendar(item: Item, action: Action): Promise<void> {
    const messageId = item.messageId;
    if (!messageId) throw new Error(`No messageId on ${item.id}`);
    if (!action.calendarResponse)
      throw new Error(`RESPOND_CALENDAR on ${item.id} missing response`);
    await this.graphClient.respondToMeetingInviteEmail(messageId, action.calendarResponse);
    logger.info({
      operation: 'executor_calendar_responded',
      itemId: item.id,
      response: action.calendarResponse,
    });
  }

  private async executeJournalNote(item: Item, action: Action, rootDir: string): Promise<void> {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const journalDir = path.join(rootDir, 'areas', 'journal', `${yyyy}-${mm}`);
    const journalPath = path.join(journalDir, `${yyyy}-${mm}-${dd}.md`);

    const noteText =
      action.note ??
      (item.type === 'MESSAGE'
        ? (item.subject ?? `Notification from ${item.from ?? item.source}`)
        : item.title);

    const noteLine = `- **[${hhmm}]** ${noteText}`;
    const sectionHeader = '## Notifications';

    let existing = '';
    try {
      existing = await fs.readFile(journalPath, 'utf-8');
    } catch {
      // Journal doesn't exist yet — create a minimal one
      await fs.mkdir(journalDir, { recursive: true });
    }

    let updated: string;
    if (existing.includes(sectionHeader)) {
      // Append to existing Notifications section
      updated = existing.replace(sectionHeader, `${sectionHeader}\n${noteLine}`);
    } else {
      // Append a new Notifications section at the end
      updated = `${existing.trimEnd()}\n\n${sectionHeader}\n\n${noteLine}\n`;
    }

    await fs.writeFile(journalPath, updated, 'utf-8');
    logger.info({ operation: 'executor_journal_note', itemId: item.id, journalPath, note: noteText });
  }

  private async executeClaudeJob(item: Item, action: Action, _rootDir: string): Promise<void> {
    if (!this.claudeExecutor) {
      throw new Error('ClaudeExecutorService not configured — set ANTHROPIC_API_KEY');
    }
    await this.claudeExecutor.executeJob({
      item,
      action,
      workDir: process.cwd(),
      systemDir: this.absoluteSystemDir,
    });
    // If job completed (not paused), mark item status appropriately
    if (action.jobStep === 'done') {
      action.status = 'done';
      // Add ARCHIVE to clean up the item
      const now = new Date().toISOString();
      item.actions.push({ type: 'ARCHIVE', at: now, status: 'pending' });
    } else if (action.status === 'waiting') {
      item.status = 'waiting' as any;
    }
  }

  private isPermanentFailure(err: unknown): boolean {
    const msg = (err as Error).message ?? '';
    return msg.includes('404') || msg.toLowerCase().includes('not found');
  }
}
