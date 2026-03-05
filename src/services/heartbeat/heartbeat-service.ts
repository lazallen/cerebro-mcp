/**
 * Heartbeat service - main orchestrator for scheduled task execution
 */

import { ConfigLoader } from './config-loader';
import { Scheduler } from './scheduler';
import { createTaskRegistry } from './tasks/task-registry';
import type { HeartbeatConfig, TaskExecutionRecord } from '../../types/heartbeat';
import type { TaskRegistry } from './types';
import { logger } from '../../common/logger';
import { SessionCredentialStorage } from '../slack-saved-items/session-credential-storage';
import { WebclientApiClient } from '../slack-saved-items/webclient-api-client';

/**
 * HeartbeatService orchestrates task scheduling, configuration management, and execution
 */
export class HeartbeatService {
  private configLoader: ConfigLoader;
  private scheduler: Scheduler | null = null;
  private taskRegistry: TaskRegistry | null = null;
  private isRunning = false;
  private slackSavedItemsApiClient: WebclientApiClient | undefined;

  constructor(
    private configPath: string,
    private dependencies?: {
      graphClient?: any;
      lfClient?: any;
      oneNoteClient?: any;
      microsoftService?: any;
      rootDir?: string;
      portfolioRef?: any;
    }
  ) {
    this.configLoader = new ConfigLoader(configPath);

    // Instantiate Slack Saved Items API client if credentials file exists (graceful on absence)
    try {
      const credStorage = new SessionCredentialStorage();
      this.slackSavedItemsApiClient = new WebclientApiClient(credStorage);
    } catch {
      // Non-fatal: service works without Slack saved-items integration
    }
  }

  /**
   * Start the heartbeat service
   * Loads configuration, initializes task registry, schedules tasks, and starts hot-reload watcher
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({
        operation: 'heartbeat_start_duplicate',
        message: 'Heartbeat service already running',
      });
      return;
    }

    logger.info({
      operation: 'heartbeat_start',
      configPath: this.configPath,
      message: 'Starting heartbeat service',
    });

    try {
      // Load configuration
      const config = await this.configLoader.loadConfig();

      // Ensure system/ subdirectories exist
      // systemDir can be overridden in config to decouple it from rootDir
      // (e.g. rootDir = "./context" for vault, systemDir = "./system" for repo-local artifacts)
      const systemDir = config.systemDir ?? `${config.rootDir}/system`;
      const fs = await import('fs/promises');
      await Promise.all([
        fs.mkdir(`${systemDir}/messages`, { recursive: true }),
        fs.mkdir(`${systemDir}/events`, { recursive: true }),
        fs.mkdir(`${systemDir}/policies`, { recursive: true }),
      ]);

      // Initialize task registry with dependencies
      this.taskRegistry = createTaskRegistry({
        graphClient: this.dependencies?.graphClient,
        lfClient: this.dependencies?.lfClient,
        microsoftService: this.dependencies?.microsoftService,
        rootDir: config.rootDir,
        systemDir,
        slackSavedItemsApiClient: this.slackSavedItemsApiClient,
        portfolioRef: this.dependencies?.portfolioRef,
      });

      // Initialize scheduler
      this.scheduler = new Scheduler(this.taskRegistry);

      // Schedule all enabled tasks
      this.scheduleTasks(config);

      // Start config hot-reload watcher
      this.configLoader.watchConfig((newConfig) => this.handleConfigReload(newConfig));

      this.isRunning = true;

      logger.info({
        operation: 'heartbeat_started',
        taskCount: config.tasks.length,
        enabledCount: config.tasks.filter((t) => t.enabled).length,
        message: 'Heartbeat service started successfully',
      });
    } catch (error) {
      logger.error({
        operation: 'heartbeat_start_error',
        error: (error as Error).message,
        message: 'Failed to start heartbeat service',
      });
      throw error;
    }
  }

  /**
   * Stop the heartbeat service
   * Stops all scheduled tasks and config watcher
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn({
        operation: 'heartbeat_stop_not_running',
        message: 'Heartbeat service not running',
      });
      return;
    }

    logger.info({
      operation: 'heartbeat_stop',
      message: 'Stopping heartbeat service',
    });

    try {
      // Stop config watcher
      this.configLoader.stopWatching();

      // Stop all scheduled tasks
      if (this.scheduler) {
        this.scheduler.stopAll();

        // Wait a bit for any running tasks to complete (timeout: 5 seconds)
        await this.waitForRunningTasks(5000);

        // Destroy all tasks
        this.scheduler.destroyAll();
      }

      this.isRunning = false;

      logger.info({
        operation: 'heartbeat_stopped',
        message: 'Heartbeat service stopped successfully',
      });
    } catch (error) {
      logger.error({
        operation: 'heartbeat_stop_error',
        error: (error as Error).message,
        message: 'Error stopping heartbeat service',
      });
      throw error;
    }
  }

  /**
   * Wait for all currently running tasks to complete
   * @param timeoutMs Maximum time to wait in milliseconds
   */
  private async waitForRunningTasks(timeoutMs: number): Promise<void> {
    if (!this.scheduler) {
      return;
    }

    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    while (Date.now() - startTime < timeoutMs) {
      const records = this.scheduler.getAllExecutionRecords();
      const runningTasks = records.filter((r) => r.currentlyRunning);

      if (runningTasks.length === 0) {
        return;
      }

      logger.info({
        operation: 'waiting_for_tasks',
        runningCount: runningTasks.length,
        taskIds: runningTasks.map((r) => r.taskId),
        message: `Waiting for ${runningTasks.length} running tasks to complete`,
      });

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    logger.warn({
      operation: 'wait_timeout',
      timeoutMs,
      message: 'Timeout waiting for running tasks to complete',
    });
  }

  /**
   * Schedule all enabled tasks from configuration
   * @param config Heartbeat configuration
   */
  private scheduleTasks(config: HeartbeatConfig): void {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }

    logger.info({
      operation: 'schedule_tasks',
      totalTasks: config.tasks.length,
      enabledTasks: config.tasks.filter((t) => t.enabled).length,
      message: 'Scheduling tasks from configuration',
    });

    for (const taskConfig of config.tasks) {
      if (!taskConfig.enabled) {
        logger.debug({
          operation: 'task_skipped',
          taskId: taskConfig.id,
          reason: 'disabled',
          message: `Skipping disabled task "${taskConfig.name}"`,
        });
        continue;
      }

      try {
        this.scheduler.scheduleTask(taskConfig);
      } catch (error) {
        logger.error({
          operation: 'task_schedule_error',
          taskId: taskConfig.id,
          taskType: taskConfig.type,
          error: (error as Error).message,
          message: `Failed to schedule task "${taskConfig.name}"`,
        });
        // Continue scheduling other tasks
      }
    }
  }

  /**
   * Handle configuration reload
   * Stops all current tasks and reschedules based on new configuration
   * @param newConfig New configuration
   */
  private handleConfigReload(newConfig: HeartbeatConfig): void {
    logger.info({
      operation: 'config_reload',
      oldTaskCount: this.scheduler?.getAllExecutionRecords().length ?? 0,
      newTaskCount: newConfig.tasks.length,
      message: 'Reloading configuration and rescheduling tasks',
    });

    try {
      if (!this.scheduler) {
        throw new Error('Scheduler not initialized');
      }

      // Stop and destroy all current tasks
      this.scheduler.destroyAll();

      // Recreate task registry with dependencies (in case task implementations changed)
      const reloadedSystemDir = newConfig.systemDir ?? `${newConfig.rootDir}/system`;
      this.taskRegistry = createTaskRegistry({
        graphClient: this.dependencies?.graphClient,
        lfClient: this.dependencies?.lfClient,
        microsoftService: this.dependencies?.microsoftService,
        rootDir: newConfig.rootDir,
        systemDir: reloadedSystemDir,
        slackSavedItemsApiClient: this.slackSavedItemsApiClient,
        portfolioRef: this.dependencies?.portfolioRef,
      });

      // Create new scheduler with updated registry
      this.scheduler = new Scheduler(this.taskRegistry);

      // Schedule tasks from new configuration
      this.scheduleTasks(newConfig);

      logger.info({
        operation: 'config_reloaded',
        taskCount: newConfig.tasks.length,
        enabledCount: newConfig.tasks.filter((t) => t.enabled).length,
        message: 'Configuration reloaded and tasks rescheduled',
      });
    } catch (error) {
      logger.error({
        operation: 'config_reload_error',
        error: (error as Error).message,
        message: 'Failed to reload configuration',
      });
      // Service continues with old configuration
    }
  }

  /**
   * Manually execute a task by ID
   * @param taskId Task identifier
   */
  async executeTask(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized - service not started');
    }

    return this.scheduler.executeTask(taskId);
  }

  /**
   * Get execution records for all scheduled tasks
   * @returns Array of execution records
   */
  getExecutionRecords(): TaskExecutionRecord[] {
    if (!this.scheduler) {
      return [];
    }

    return this.scheduler.getAllExecutionRecords();
  }

  /**
   * Get execution record for a specific task
   * @param taskId Task identifier
   * @returns Execution record or undefined if not found
   */
  getExecutionRecord(taskId: string): TaskExecutionRecord | undefined {
    if (!this.scheduler) {
      return undefined;
    }

    return this.scheduler.getExecutionRecord(taskId);
  }

  /**
   * Check if service is running
   * @returns True if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }
}
