/**
 * Pipeline Archive Task
 *
 * In the new item-per-file design, archiving is handled inline by the executor:
 * when all pending actions on an item complete (including ARCHIVE), the executor
 * sets item.status = 'done'. This task is retained for logging/monitoring but
 * does no active archiving.
 */

import * as path from 'path';
import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { listItems } from '../../../lib/item/item-store';
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

    const done = await listItems(this.absoluteSystemDir, ['done']);

    logger.info({
      operation: 'pipeline_archive_complete',
      taskId: taskConfig.id,
      doneCount: done.length,
      message: `PipelineArchiveTask complete: ${done.length} done item(s) on disk`,
    });
  }
}
