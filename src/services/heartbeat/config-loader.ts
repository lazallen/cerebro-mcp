/**
 * Configuration loader with JSON schema validation and hot-reload support
 */

import * as fs from 'fs/promises';
import * as chokidar from 'chokidar';
import type { HeartbeatConfig, TaskConfig } from '../../types/heartbeat';
import { logger } from '../../common/logger';

/**
 * Validates heartbeat configuration against schema
 * Performs both structure validation and business rule validation
 */
export class ConfigLoader {
  private currentConfig: HeartbeatConfig | null = null;
  private watcher: chokidar.FSWatcher | null = null;
  private isWatching = false;

  constructor(private configPath: string) {}

  /**
   * Load and validate configuration from file
   * @throws Error if config is invalid or file cannot be read
   */
  async loadConfig(): Promise<HeartbeatConfig> {
    try {
      logger.info({
        operation: 'config_load',
        configPath: this.configPath,
        message: 'Loading heartbeat configuration',
      });

      // Read file
      const content = await fs.readFile(this.configPath, 'utf-8');

      // Parse JSON
      let config: unknown;
      try {
        config = JSON.parse(content);
      } catch (error) {
        throw new Error(`Invalid JSON in config file: ${(error as Error).message}`);
      }

      // Validate structure and business rules
      this.validateConfig(config);

      // Type assertion after validation
      this.currentConfig = config as HeartbeatConfig;

      logger.info({
        operation: 'config_loaded',
        taskCount: this.currentConfig.tasks.length,
        rootDir: this.currentConfig.rootDir,
        message: 'Configuration loaded successfully',
      });

      return this.currentConfig;
    } catch (error) {
      logger.error({
        operation: 'config_load_error',
        configPath: this.configPath,
        error: (error as Error).message,
        message: 'Failed to load configuration',
      });
      throw error;
    }
  }

  /**
   * Validate configuration structure and business rules
   * @param config Configuration object to validate
   * @throws Error if validation fails
   */
  private validateConfig(config: unknown): void {
    // Type guard
    if (typeof config !== 'object' || config === null) {
      throw new Error('Invalid heartbeat configuration: must be an object');
    }

    const cfg = config as Record<string, unknown>;

    // Required fields
    if (!cfg.rootDir || typeof cfg.rootDir !== 'string') {
      throw new Error('Invalid heartbeat configuration: rootDir is required and must be a string');
    }

    if (cfg.systemDir !== undefined && typeof cfg.systemDir !== 'string') {
      throw new Error('Invalid heartbeat configuration: systemDir must be a string if provided');
    }

    if (!Array.isArray(cfg.tasks)) {
      throw new Error('Invalid heartbeat configuration: tasks must be an array');
    }

    // Validate each task
    const taskIds = new Set<string>();
    for (const task of cfg.tasks) {
      this.validateTaskConfig(task);

      // Check for duplicate IDs
      const taskId = (task as TaskConfig).id;
      if (taskIds.has(taskId)) {
        throw new Error(`Duplicate task ID: ${taskId}`);
      }
      taskIds.add(taskId);
    }
  }

  /**
   * Validate individual task configuration
   * @param task Task config to validate
   * @throws Error if validation fails
   */
  private validateTaskConfig(task: unknown): void {
    if (typeof task !== 'object' || task === null) {
      throw new Error('Invalid task configuration: must be an object');
    }

    const t = task as Record<string, unknown>;

    // Required fields
    if (!t.id || typeof t.id !== 'string') {
      throw new Error('Invalid task configuration: id is required and must be a string');
    }

    // Validate ID pattern (alphanumeric with hyphens)
    if (!/^[a-z0-9-]+$/.test(t.id)) {
      throw new Error(`Invalid task ID "${t.id}": must contain only lowercase letters, numbers, and hyphens`);
    }

    if (!t.name || typeof t.name !== 'string') {
      throw new Error(`Invalid task configuration for "${t.id}": name is required and must be a string`);
    }

    if (!t.type || typeof t.type !== 'string') {
      throw new Error(`Invalid task configuration for "${t.id}": type is required and must be a string`);
    }

    // Validate task type enum
    const supportedTypes = ['email-triage', 'journal-triage', 'email-ingestion', 'calendar-ingestion', 'policy-pipeline', 'executor', 'pipeline-archive', 'slack-saved-items-ingestion', 'smart-meeting-scheduler'];
    if (!supportedTypes.includes(t.type as string)) {
      throw new Error(
        `Invalid task configuration for "${t.id}": type "${t.type}" is not supported.\n\n` +
        `Supported task types:\n` +
        `- "email-triage": Process unread emails with LLM action item extraction\n` +
        `- "journal-triage": Sync calendar events to markdown journal entries with OneNote integration\n` +
        `- "email-ingestion": Ingest emails as TriageEvent artifacts for the policy pipeline\n` +
        `- "calendar-ingestion": Ingest calendar events as TriageEvent artifacts for the policy pipeline\n` +
        `- "policy-pipeline": Evaluate triage events against policy rules and execute file-based actions\n` +
        `- "executor": Execute Microsoft Graph API actions (MOVE, CATEGORY, FLAG) from pending decisions\n` +
        `- "pipeline-archive": Sweep terminal-state artifacts to done/ directories\n` +
        `- "slack-saved-items-ingestion": Ingest Slack saved items as TriageEvent artifacts\n\n` +
        `Current value: "${t.type}"`
      );
    }

    if (!t.schedule || typeof t.schedule !== 'string') {
      throw new Error(`Invalid task configuration for "${t.id}": schedule is required and must be a string`);
    }

    // Validate cron expression (5 fields)
    this.validateCronExpression(t.schedule, t.id);

    if (typeof t.enabled !== 'boolean') {
      throw new Error(`Invalid task configuration for "${t.id}": enabled is required and must be a boolean`);
    }

    if (t.config !== undefined && (typeof t.config !== 'object' || t.config === null || Array.isArray(t.config))) {
      throw new Error(`Invalid task configuration for "${t.id}": config must be an object if provided`);
    }
  }

  /**
   * Validate cron expression format
   * @param schedule Cron expression to validate
   * @param taskId Task ID for error messages
   * @throws Error if cron expression is invalid
   */
  private validateCronExpression(schedule: string, taskId: string): void {
    const parts = schedule.trim().split(/\s+/);

    if (parts.length !== 5) {
      const examples = [
        '"0 * * * *" = Every hour at :00',
        '"*/15 * * * *" = Every 15 minutes',
        '"0 9 * * *" = Daily at 9:00 AM',
        '"0 9 * * 1-5" = Weekdays at 9:00 AM',
      ];
      throw new Error(
        `Invalid cron expression for task "${taskId}": must have 5 fields (minute hour day month dayOfWeek).\n\n` +
        `Current expression: "${schedule}"\n\n` +
        `Examples:\n${examples.join('\n')}\n\n` +
        `Test your expression at: https://crontab.guru/`
      );
    }

    // Basic pattern validation for each field
    // Simplified: just check that each field is either * or contains only valid characters
    const patterns = [
      /^(\*|\d+|[\d,\-*/]+)$/, // minute
      /^(\*|\d+|[\d,\-*/]+)$/, // hour
      /^(\*|\d+|[\d,\-*/]+)$/, // day
      /^(\*|\d+|[\d,\-*/]+)$/, // month
      /^(\*|\d+|[\d,\-*/]+)$/, // day of week
    ];

    const fieldNames = ['minute', 'hour', 'day', 'month', 'dayOfWeek'];
    const fieldRanges = ['0-59', '0-23', '1-31', '1-12', '0-6 (0=Sunday)'];

    for (let i = 0; i < parts.length; i++) {
      if (!patterns[i].test(parts[i])) {
        throw new Error(
          `Invalid cron expression for task "${taskId}": invalid ${fieldNames[i]} field "${parts[i]}".\n\n` +
          `The ${fieldNames[i]} field must be:\n` +
          `- A number in range ${fieldRanges[i]}\n` +
          `- An asterisk (*) for "any"\n` +
          `- A range (e.g., "1-5")\n` +
          `- A list (e.g., "1,3,5")\n` +
          `- A step (e.g., "*/15")\n\n` +
          `Test your expression at: https://crontab.guru/`
        );
      }
    }
  }

  /**
   * Watch configuration file for changes and reload on modification
   * @param onConfigChange Callback invoked when config is reloaded
   */
  watchConfig(onConfigChange: (config: HeartbeatConfig) => void): void {
    if (this.isWatching) {
      logger.warn({
        operation: 'config_watch_duplicate',
        message: 'Config watcher already running',
      });
      return;
    }

    logger.info({
      operation: 'config_watch_start',
      configPath: this.configPath,
      message: 'Starting config file watcher',
    });

    this.watcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', async () => {
      logger.info({
        operation: 'config_change_detected',
        configPath: this.configPath,
        message: 'Config file change detected, reloading',
      });

      try {
        const newConfig = await this.loadConfig();
        onConfigChange(newConfig);

        logger.info({
          operation: 'config_reloaded',
          taskCount: newConfig.tasks.length,
          message: 'Configuration reloaded successfully',
        });
      } catch (error) {
        logger.error({
          operation: 'config_reload_error',
          error: (error as Error).message,
          message: 'Failed to reload configuration, keeping current config',
        });
        // Don't call onConfigChange if reload fails
      }
    });

    this.watcher.on('error', (error) => {
      logger.error({
        operation: 'config_watch_error',
        error: (error as Error).message,
        message: 'Config file watcher error',
      });
    });

    this.isWatching = true;
  }

  /**
   * Stop watching configuration file
   */
  stopWatching(): void {
    if (this.watcher) {
      logger.info({
        operation: 'config_watch_stop',
        message: 'Stopping config file watcher',
      });

      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
    }
  }

  /**
   * Get the currently loaded configuration
   * @returns Current config
   * @throws Error if config not loaded yet
   */
  getCurrentConfig(): HeartbeatConfig {
    if (!this.currentConfig) {
      throw new Error('Config not loaded - call loadConfig() first');
    }
    return this.currentConfig;
  }
}
