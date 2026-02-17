/**
 * Task scheduler using node-cron with concurrency control and execution tracking
 */

import * as cron from 'node-cron';
import type { TaskConfig, TaskExecutionRecord } from '../../types/heartbeat';
import type { TaskHandler, TaskRegistry } from './types';
import { logger } from '../../common/logger';

/**
 * Scheduled task wrapper
 */
interface ScheduledTask {
  config: TaskConfig;
  cronTask: cron.ScheduledTask;
  handler: TaskHandler;
}

/**
 * Scheduler manages cron-based task execution with concurrency control
 */
export class Scheduler {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private executionRecords: Map<string, TaskExecutionRecord> = new Map();

  constructor(private taskRegistry: TaskRegistry) {}

  /**
   * Schedule a task for execution based on cron expression
   * @param taskConfig Task configuration
   * @throws Error if task type not found or task already scheduled
   */
  scheduleTask(taskConfig: TaskConfig): void {
    // Validate task is enabled
    if (!taskConfig.enabled) {
      throw new Error(`Cannot schedule disabled task: ${taskConfig.id}`);
    }

    // Check if already scheduled
    if (this.scheduledTasks.has(taskConfig.id)) {
      throw new Error(`Task with ID ${taskConfig.id} already scheduled`);
    }

    // Get handler for task type
    const handler = this.taskRegistry.get(taskConfig.type);
    if (!handler) {
      throw new Error(`No handler found for task type: ${taskConfig.type}`);
    }

    logger.info({
      operation: 'task_schedule',
      taskId: taskConfig.id,
      taskType: taskConfig.type,
      schedule: taskConfig.schedule,
      message: `Scheduling task "${taskConfig.name}"`,
    });

    // Create cron task
    const cronTask = cron.schedule(
      taskConfig.schedule,
      async () => {
        // Execute task when cron triggers
        try {
          await this.executeTask(taskConfig.id);
        } catch (error) {
          // Error already logged in executeTask
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );

    // Store scheduled task
    this.scheduledTasks.set(taskConfig.id, {
      config: taskConfig,
      cronTask,
      handler,
    });

    // Initialize execution record
    this.executionRecords.set(taskConfig.id, {
      taskId: taskConfig.id,
      currentlyRunning: false,
      lastRun: null,
      lastDuration: 0,
      lastStatus: 'success',
      lastError: null,
      runCount: 0,
      errorCount: 0,
    });

    // Start the cron task
    cronTask.start();

    logger.info({
      operation: 'task_scheduled',
      taskId: taskConfig.id,
      message: `Task "${taskConfig.name}" scheduled successfully`,
    });
  }

  /**
   * Execute a task immediately (manual trigger or cron trigger)
   * @param taskId Task identifier
   * @throws Error if task not found or already running
   */
  async executeTask(taskId: string): Promise<void> {
    const scheduledTask = this.scheduledTasks.get(taskId);
    if (!scheduledTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    const executionRecord = this.executionRecords.get(taskId);
    if (!executionRecord) {
      throw new Error(`Execution record not found for task ${taskId}`);
    }

    // Concurrency control: prevent multiple executions
    if (executionRecord.currentlyRunning) {
      const error = `Task ${taskId} is already running`;
      logger.warn({
        operation: 'task_execution_skipped',
        taskId,
        reason: 'already_running',
        message: error,
      });
      throw new Error(error);
    }

    // Mark as running
    executionRecord.currentlyRunning = true;
    executionRecord.lastRun = new Date();

    const startTime = Date.now();

    logger.info({
      operation: 'task_execution_start',
      taskId,
      taskType: scheduledTask.config.type,
      taskName: scheduledTask.config.name,
      message: `Starting task execution for "${scheduledTask.config.name}"`,
    });

    try {
      // Execute task handler
      await scheduledTask.handler.execute(scheduledTask.config);

      // Update execution record on success
      const duration = Date.now() - startTime;
      executionRecord.lastDuration = duration;
      executionRecord.lastStatus = 'success';
      executionRecord.lastError = null;
      executionRecord.runCount++;

      logger.info({
        operation: 'task_execution_success',
        taskId,
        taskType: scheduledTask.config.type,
        duration,
        message: `Task "${scheduledTask.config.name}" completed successfully (${duration}ms)`,
      });
    } catch (error) {
      // Update execution record on error
      const duration = Date.now() - startTime;
      executionRecord.lastDuration = duration;
      executionRecord.lastStatus = 'error';
      executionRecord.lastError = (error as Error).message;
      executionRecord.errorCount++;

      logger.error({
        operation: 'task_execution_error',
        taskId,
        taskType: scheduledTask.config.type,
        duration,
        error: (error as Error).message,
        message: `Task "${scheduledTask.config.name}" failed after ${duration}ms`,
      });

      throw error;
    } finally {
      // Always clear running flag
      executionRecord.currentlyRunning = false;
    }
  }

  /**
   * Stop a scheduled task (can be restarted)
   * @param taskId Task identifier
   * @throws Error if task not found
   */
  stopTask(taskId: string): void {
    const scheduledTask = this.scheduledTasks.get(taskId);
    if (!scheduledTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    logger.info({
      operation: 'task_stop',
      taskId,
      message: `Stopping task "${scheduledTask.config.name}"`,
    });

    scheduledTask.cronTask.stop();
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll(): void {
    logger.info({
      operation: 'tasks_stop_all',
      taskCount: this.scheduledTasks.size,
      message: 'Stopping all scheduled tasks',
    });

    for (const [taskId, scheduledTask] of this.scheduledTasks) {
      try {
        scheduledTask.cronTask.stop();
      } catch (error) {
        logger.error({
          operation: 'task_stop_error',
          taskId,
          error: (error as Error).message,
          message: `Error stopping task ${taskId}`,
        });
      }
    }
  }

  /**
   * Destroy a scheduled task (cannot be restarted, must reschedule)
   * @param taskId Task identifier
   * @throws Error if task not found
   */
  destroyTask(taskId: string): void {
    const scheduledTask = this.scheduledTasks.get(taskId);
    if (!scheduledTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    logger.info({
      operation: 'task_destroy',
      taskId,
      message: `Destroying task "${scheduledTask.config.name}"`,
    });

    scheduledTask.cronTask.stop();
    // Note: node-cron doesn't have a destroy method, stop() is sufficient

    this.scheduledTasks.delete(taskId);
    this.executionRecords.delete(taskId);
  }

  /**
   * Destroy all scheduled tasks
   */
  destroyAll(): void {
    logger.info({
      operation: 'tasks_destroy_all',
      taskCount: this.scheduledTasks.size,
      message: 'Destroying all scheduled tasks',
    });

    for (const [taskId, scheduledTask] of this.scheduledTasks) {
      try {
        scheduledTask.cronTask.stop();
        // Note: node-cron doesn't have a destroy method, stop() is sufficient
      } catch (error) {
        logger.error({
          operation: 'task_destroy_error',
          taskId,
          error: (error as Error).message,
          message: `Error destroying task ${taskId}`,
        });
      }
    }

    this.scheduledTasks.clear();
    this.executionRecords.clear();
  }

  /**
   * Get execution record for a task
   * @param taskId Task identifier
   * @returns Execution record or undefined if not found
   */
  getExecutionRecord(taskId: string): TaskExecutionRecord | undefined {
    return this.executionRecords.get(taskId);
  }

  /**
   * Get all execution records
   * @returns Array of execution records
   */
  getAllExecutionRecords(): TaskExecutionRecord[] {
    return Array.from(this.executionRecords.values());
  }
}
