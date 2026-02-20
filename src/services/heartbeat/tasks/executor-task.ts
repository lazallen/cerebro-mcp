/**
 * Executor Task
 *
 * Reads pending PolicyDecisions from system/decisions/ and executes the
 * Microsoft Graph API actions (MOVE, CATEGORY, FLAG) that the policy pipeline
 * evaluated but could not execute inline.
 *
 * File-based actions (CREATE_TASK, CREATE_READING_PACK, ASK_HUMAN) are already
 * executed by the policy-pipeline-task at evaluation time and are skipped here.
 *
 * Actions with requiresApproval: true are also skipped — they wait for human
 * queue resolution before being acted upon.
 *
 * ENRICH_CONFLUENCE: fetches the Confluence page linked in the email and appends
 * the page content to the reading pack entry for that day.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { lock } from 'proper-lockfile';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import type { ResolvedAction, TriageEvent } from '../../../lib/policy/types';
import { listPendingDecisions, markDecisionApplied } from '../../../lib/triage/decision-store';
import { getEvent, archiveEvent } from '../../../lib/triage/triage-event-store';
import type { AtlassianClient, ConfluencePageContent } from '../../../lib/atlassian';
import { logger } from '../../../common/logger';

interface ExecutorConfig {
  /** When true, log actions but do not call any external APIs (default: false) */
  dryRun?: boolean;
}

export class ExecutorTask implements TaskHandler {
  private readonly absoluteSystemDir: string;

  constructor(
    private readonly microsoftService: any,
    systemDir: string,
    private readonly atlassianClient?: AtlassianClient
  ) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = (taskConfig.config ?? {}) as ExecutorConfig;
    const dryRun = config.dryRun ?? false;

    logger.info({
      operation: 'executor_start',
      taskId: taskConfig.id,
      dryRun,
      absoluteSystemDir: this.absoluteSystemDir,
      message: 'ExecutorTask starting',
    });

    const decisions = await listPendingDecisions(this.absoluteSystemDir);

    logger.info({
      operation: 'executor_decisions_loaded',
      count: decisions.length,
      message: `Found ${decisions.length} pending decision(s)`,
    });

    let actioned = 0;
    let skipped = 0;
    let errors = 0;

    for (const decision of decisions) {
      // Only email events have API-executable actions currently
      const event = await getEvent(this.absoluteSystemDir, decision.eventId);
      if (!event) {
        logger.warn({
          operation: 'executor_event_not_found',
          eventId: decision.eventId,
          message: `Triage event not found for decision ${decision.eventId} — skipping`,
        });
        continue;
      }

      if (event.source !== 'email') {
        skipped++;
        continue;
      }

      if (!decision.actions || decision.actions.length === 0) {
        // Old decision written before actionsJson was added — skip
        skipped++;
        continue;
      }

      const messageId = event.sourceData?.messageId as string | undefined;
      if (!messageId) {
        logger.warn({
          operation: 'executor_no_message_id',
          eventId: decision.eventId,
          message: `No messageId in sourceData for ${decision.eventId} — skipping`,
        });
        skipped++;
        continue;
      }

      let anyExecuted = false;
      let anyError = false;

      for (const action of decision.actions) {
        if (action.applied) continue;

        if (action.requiresApproval) {
          logger.debug({
            operation: 'executor_action_awaiting_approval',
            eventId: decision.eventId,
            actionType: action.type,
            message: `Action ${action.type} requires approval — skipping`,
          });
          continue;
        }

        try {
          const executed = await this.executeApiAction(event, messageId, action, dryRun);
          if (executed) anyExecuted = true;
        } catch (err) {
          logger.error({
            operation: 'executor_action_error',
            eventId: decision.eventId,
            actionType: action.type,
            error: (err as Error).message,
            message: `Failed to execute ${action.type} for ${decision.eventId}`,
          });
          anyError = true;
        }
      }

      if (anyExecuted && !anyError && !dryRun) {
        await markDecisionApplied(this.absoluteSystemDir, decision.eventId);
        await archiveEvent(this.absoluteSystemDir, decision.eventId);
        actioned++;
      } else if (anyError) {
        errors++;
      } else if (!anyExecuted) {
        // All actions were file-based (already applied) or approval-gated — mark applied
        if (!dryRun) {
          await markDecisionApplied(this.absoluteSystemDir, decision.eventId);
          await archiveEvent(this.absoluteSystemDir, decision.eventId);
        }
        skipped++;
      }
    }

    logger.info({
      operation: 'executor_complete',
      taskId: taskConfig.id,
      actioned,
      skipped,
      errors,
      dryRun,
      message: `ExecutorTask complete: ${actioned} actioned, ${skipped} skipped, ${errors} errors`,
    });
  }

  /**
   * Execute a single action that requires an external API call.
   * Returns true if an API call was made, false if the action is file-based / not applicable.
   */
  private async executeApiAction(
    event: TriageEvent,
    messageId: string,
    action: ResolvedAction,
    dryRun: boolean
  ): Promise<boolean> {
    switch (action.type) {
      case 'MOVE': {
        const folder = action.folder;
        if (!folder) return false;
        logger.info({
          operation: 'executor_move',
          eventId: event.eventId,
          messageId,
          folder,
          dryRun,
          message: dryRun ? `[DRY RUN] Would move to "${folder}"` : `Moving email to "${folder}"`,
        });
        if (!dryRun) {
          await this.microsoftService.moveEmail(messageId, folder, true);
        }
        return true;
      }

      case 'CATEGORY': {
        const categoryName = action.name;
        if (!categoryName) return false;
        logger.info({
          operation: 'executor_category',
          eventId: event.eventId,
          messageId,
          category: categoryName,
          dryRun,
          message: dryRun
            ? `[DRY RUN] Would apply category "${categoryName}"`
            : `Applying category "${categoryName}"`,
        });
        if (!dryRun) {
          await this.microsoftService.applyCategories(messageId, [categoryName]);
        }
        return true;
      }

      case 'FLAG': {
        const flagStatus = (action.flagStatus ?? 'flagged') as
          | 'flagged'
          | 'notFlagged'
          | 'complete';
        logger.info({
          operation: 'executor_flag',
          eventId: event.eventId,
          messageId,
          flagStatus,
          dryRun,
          message: dryRun
            ? `[DRY RUN] Would set flag to "${flagStatus}"`
            : `Setting email flag to "${flagStatus}"`,
        });
        if (!dryRun) {
          await this.microsoftService.setEmailFlag(messageId, flagStatus);
        }
        return true;
      }

      case 'ENRICH_CONFLUENCE': {
        return await this.enrichConfluence(event, messageId, dryRun);
      }

      // File-based or deferred actions — not handled here
      case 'CREATE_TASK':
      case 'CREATE_READING_PACK':
      case 'ASK_HUMAN':
      case 'DRAFT_REPLY':
      case 'LABEL':
        return false;

      default:
        return false;
    }
  }

  /**
   * ENRICH_CONFLUENCE action handler.
   *
   * 1. Fetches the full email HTML body from Microsoft Graph.
   * 2. Extracts the Confluence page URL from the HTML.
   * 3. Calls the Atlassian API to fetch the page content.
   * 4. Appends a rich page-content section to the reading pack file for the event date.
   */
  private async enrichConfluence(
    event: TriageEvent,
    messageId: string,
    dryRun: boolean
  ): Promise<boolean> {
    if (!this.atlassianClient) {
      logger.warn({
        operation: 'executor_confluence_skip',
        eventId: event.eventId,
        message:
          'ENRICH_CONFLUENCE skipped — Atlassian client not configured ' +
          '(set ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN)',
      });
      return false;
    }

    // Fetch full email HTML body
    const rawHtml = await this.microsoftService.getEmailBodyHtml(messageId);
    if (!rawHtml) {
      logger.warn({
        operation: 'executor_confluence_no_body',
        eventId: event.eventId,
        message: 'Could not fetch email body HTML for Confluence enrichment',
      });
      return false;
    }

    // Extract Confluence page URL from HTML
    const urlMatch = rawHtml.match(
      /https:\/\/[^"'\s<>]*\.atlassian\.net\/wiki\/(?:spaces\/[^"'\s<>]*\/)?pages\/\d+[^"'\s<>]*/
    );
    if (!urlMatch) {
      logger.warn({
        operation: 'executor_confluence_no_url',
        eventId: event.eventId,
        message: 'Could not extract Confluence page URL from email HTML',
      });
      return false;
    }

    const pageUrl = urlMatch[0];
    // Strip trailing HTML entities or punctuation that crept in
    const cleanUrl = pageUrl.replace(/[&?].*$/, '').replace(/\/$/, '');

    const pageId = (await import('../../../lib/atlassian')).AtlassianClient.parsePageId(cleanUrl);
    if (!pageId) {
      logger.warn({
        operation: 'executor_confluence_no_page_id',
        eventId: event.eventId,
        pageUrl: cleanUrl,
        message: 'Could not parse Confluence page ID from URL',
      });
      return false;
    }

    if (dryRun) {
      logger.info({
        operation: 'executor_confluence_dry_run',
        eventId: event.eventId,
        pageUrl: cleanUrl,
        pageId,
        message: `[DRY RUN] Would fetch Confluence page ${pageId} and enrich reading pack`,
      });
      return true;
    }

    const page = await this.atlassianClient.getPageContent(pageId);
    await this.appendConfluenceContext(event, page);

    logger.info({
      operation: 'executor_confluence_enriched',
      eventId: event.eventId,
      pageId,
      pageTitle: page.title,
      message: `Confluence page context appended to reading pack: ${page.title}`,
    });

    return true;
  }

  /**
   * Append a Confluence page content section to the reading pack file for the event's date.
   */
  private async appendConfluenceContext(
    event: TriageEvent,
    page: ConfluencePageContent
  ): Promise<void> {
    const packsDir = path.join(this.absoluteSystemDir, 'artifacts', 'reading-packs');
    const date = event.receivedAt.slice(0, 10);
    const filepath = path.join(packsDir, `${date}.md`);

    const lines: string[] = [
      '',
      `### Confluence Page — ${page.title} (v${page.version})`,
      '',
      `- **URL**: ${page.webUrl}`,
    ];

    if (page.lastModifiedAt) {
      lines.push(`- **Last modified**: ${page.lastModifiedAt}`);
    }
    if (page.lastModifiedBy) {
      lines.push(`- **Modified by**: ${page.lastModifiedBy}`);
    }

    lines.push('', page.bodyMarkdown.slice(0, 3000), '', '---', '');
    const section = lines.join('\n');

    // Ensure file exists (reading pack may not have been created yet on first run)
    await fs.mkdir(packsDir, { recursive: true });
    await fs.writeFile(filepath, '', { flag: 'a' });

    const releaseFn = await lock(filepath, { retries: { retries: 5, minTimeout: 50 } });
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      await fs.writeFile(filepath, existing + section, 'utf-8');
    } finally {
      await releaseFn();
    }
  }
}
