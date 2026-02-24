/**
 * Pipeline Archive Task
 *
 * Sweeps all pipeline artifact directories and moves terminal-state items to their
 * respective done/ subdirectories:
 *
 *   system/triage/   — status: actioned  → system/triage/done/
 *   system/decisions/ — actionsApplied: true → system/decisions/done/
 *   system/human/    — status: complete  → system/human/done/
 *
 * This replaces inline archiving that was previously done by the executor. Run this
 * task on a scheduled basis (e.g. nightly) to keep active directories clean.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { archiveActionedEvents } from '../../../lib/triage/triage-event-store';
import { archiveAppliedDecisions } from '../../../lib/triage/decision-store';
import { archiveCompletedItems } from '../../../lib/triage/human-queue-store';
import { logger } from '../../../common/logger';

export class PipelineArchiveTask implements TaskHandler {
  private readonly absoluteSystemDir: string;

  constructor(systemDir: string) {
    this.absoluteSystemDir = path.isAbsolute(systemDir)
      ? systemDir
      : path.resolve(process.cwd(), systemDir);
  }

  async execute(taskConfig: TaskConfig): Promise<void> {
    logger.info({
      operation: 'pipeline_archive_start',
      taskId: taskConfig.id,
      message: 'PipelineArchiveTask starting',
    });

    const [triageCount, decisionsCount, humanCount] = await Promise.all([
      archiveActionedEvents(this.absoluteSystemDir),
      archiveAppliedDecisions(this.absoluteSystemDir),
      archiveCompletedItems(this.absoluteSystemDir),
    ]);

    const total = triageCount + decisionsCount + humanCount;

    logger.info({
      operation: 'pipeline_archive_complete',
      taskId: taskConfig.id,
      triageCount,
      decisionsCount,
      humanCount,
      total,
      message: `PipelineArchiveTask complete: ${total} archived (triage: ${triageCount}, decisions: ${decisionsCount}, human: ${humanCount})`,
    });
  }
}
