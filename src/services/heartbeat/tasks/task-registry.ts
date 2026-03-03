/**
 * Task registry for mapping task types to handler implementations
 */

import * as path from 'path';
import type { TaskHandler, TaskRegistry } from '../types';
import { logger } from '../../../common/logger';

/**
 * Create and populate task registry with available handlers
 * Registry maps task type strings to handler implementations
 *
 * @param dependencies Optional dependencies for task handlers (graphClient, lfClient, etc.)
 * @returns Task registry with registered handlers
 */
export function createTaskRegistry(dependencies?: {
  graphClient?: any;
  lfClient?: any;
  microsoftService?: any;
  rootDir?: string;
  /** Resolved system directory — use this instead of path.join(rootDir, 'system') */
  systemDir?: string;
  /** WebclientApiClient for Slack Saved Items ingestion (Feature 020) */
  slackSavedItemsApiClient?: any;
}): TaskRegistry {
  const registry: TaskRegistry = new Map();

  logger.info({
    operation: 'task_registry_init',
    message: 'Initializing task registry',
  });

  // Debug: Log what dependencies we received
  logger.info({
    operation: 'task_registry_dependencies',
    hasGraphClient: !!dependencies?.graphClient,
    hasLfClient: !!dependencies?.lfClient,
    hasMicrosoftService: !!dependencies?.microsoftService,
    hasRootDir: !!dependencies?.rootDir,
    rootDir: dependencies?.rootDir,
    message: 'Task registry dependencies check',
  });

  // Resolve system directory once: prefer explicit systemDir, fall back to {rootDir}/system
  const resolvedSystemDir: string | undefined =
    dependencies?.systemDir ??
    (dependencies?.rootDir ? require('path').join(dependencies.rootDir, 'system') : undefined);

  // Register email-ingestion task (Feature 019 — signals only, no LLM/move)
  if (dependencies?.graphClient && resolvedSystemDir) {
    try {
      const { EmailIngestionTask } = require('./email-ingestion-task');
      const emailIngestionHandler = new EmailIngestionTask(
        dependencies.graphClient,
        resolvedSystemDir
      );
      registry.set('email-ingestion', emailIngestionHandler);

      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'email-ingestion',
        message: 'Registered email-ingestion task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'email-ingestion',
        error: (error as Error).message,
        message: 'Failed to register email-ingestion task handler',
      });
    }
  }

  // Register calendar-ingestion task (feeds policy pipeline with calendar TriageEvents)
  if (dependencies?.microsoftService && resolvedSystemDir) {
    try {
      const { CalendarIngestionTask } = require('./calendar-ingestion-task');
      registry.set('calendar-ingestion', new CalendarIngestionTask(dependencies.microsoftService, resolvedSystemDir));
      logger.debug({ operation: 'task_handler_registered', taskType: 'calendar-ingestion', message: 'Registered calendar-ingestion task handler' });
    } catch (error) {
      logger.warn({ operation: 'task_handler_registration_error', taskType: 'calendar-ingestion', error: (error as Error).message, message: 'Failed to register calendar-ingestion task handler' });
    }
  }

  // Register journal-triage task if dependencies are provided
  if (dependencies?.microsoftService && dependencies?.rootDir) {
    try {
      const { JournalTriageTask } = require('./journal-triage-task');
      const journalTriageHandler = new JournalTriageTask(
        dependencies.microsoftService,
        dependencies.rootDir
      );
      registry.set('journal-triage', journalTriageHandler);

      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'journal-triage',
        message: 'Registered journal-triage task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'journal-triage',
        error: (error as Error).message,
        message: 'Failed to register journal-triage task handler',
      });
    }
  }


  // Register policy-pipeline task (Feature 019 — full evaluation pipeline)
  if (resolvedSystemDir) {
    try {
      const { PolicyPipelineTask } = require('./policy-pipeline-task');
      const { LocalEnrichmentService } = require('../../enrichment/local-enrichment-service');

      const systemDir = resolvedSystemDir;
      const policyDir = path.join(resolvedSystemDir, 'policies');

      // Optionally wire local enrichment if lfClient is available
      let localEnrichment: InstanceType<typeof LocalEnrichmentService> | undefined;
      if (dependencies?.lfClient) {
        localEnrichment = new LocalEnrichmentService(dependencies.lfClient);
      }

      const pipelineHandler = new PolicyPipelineTask(systemDir, policyDir, localEnrichment, dependencies?.rootDir);
      registry.set('policy-pipeline', pipelineHandler);

      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'policy-pipeline',
        hasLocalEnrichment: !!localEnrichment,
        message: 'Registered policy-pipeline task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'policy-pipeline',
        error: (error as Error).message,
        message: 'Failed to register policy-pipeline task handler',
      });
    }
  }

  // Register executor task — executes MOVE/CATEGORY/FLAG decisions via Microsoft Graph
  if (dependencies?.microsoftService && resolvedSystemDir) {
    try {
      const { ExecutorTask } = require('./executor-task');

      // Wire up Claude executor if ANTHROPIC_API_KEY is set
      let claudeExecutor: InstanceType<typeof import('../../enrichment/claude-executor-service').ClaudeExecutorService> | undefined;
      const anthropicKey = process.env['ANTHROPIC_API_KEY'];
      if (anthropicKey) {
        const { ClaudeExecutorService } = require('../../enrichment/claude-executor-service');
        claudeExecutor = new ClaudeExecutorService(anthropicKey);
      }

      registry.set('executor', new ExecutorTask(dependencies.microsoftService, resolvedSystemDir, dependencies.rootDir ?? './context', claudeExecutor));
      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'executor',
        message: 'Registered executor task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'executor',
        error: (error as Error).message,
        message: 'Failed to register executor task handler',
      });
    }
  }

  // Register pipeline-archive task — sweeps terminal-state artifacts to done/ directories
  if (resolvedSystemDir) {
    try {
      const { PipelineArchiveTask } = require('./pipeline-archive-task');
      registry.set('pipeline-archive', new PipelineArchiveTask(resolvedSystemDir));
      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'pipeline-archive',
        message: 'Registered pipeline-archive task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'pipeline-archive',
        error: (error as Error).message,
        message: 'Failed to register pipeline-archive task handler',
      });
    }
  }

  // Register slack-saved-items-ingestion task (Feature 020)
  if (dependencies?.slackSavedItemsApiClient && resolvedSystemDir) {
    try {
      const { SlackSavedItemsIngestionTask } = require('./slack-saved-items-ingestion-task');
      registry.set(
        'slack-saved-items-ingestion',
        new SlackSavedItemsIngestionTask(dependencies.slackSavedItemsApiClient, resolvedSystemDir)
      );
      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'slack-saved-items-ingestion',
        message: 'Registered slack-saved-items-ingestion task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'slack-saved-items-ingestion',
        error: (error as Error).message,
        message: 'Failed to register slack-saved-items-ingestion task handler',
      });
    }
  }

  logger.info({
    operation: 'task_registry_created',
    registeredTypes: Array.from(registry.keys()),
    message: `Task registry created with ${registry.size} handlers`,
  });

  return registry;
}

/**
 * Register a task handler in the registry
 * @param registry Task registry
 * @param taskType Task type identifier
 * @param handler Task handler implementation
 */
export function registerTaskHandler(
  registry: TaskRegistry,
  taskType: string,
  handler: TaskHandler
): void {
  if (registry.has(taskType)) {
    logger.warn({
      operation: 'task_handler_replace',
      taskType,
      message: `Replacing existing handler for task type "${taskType}"`,
    });
  }

  registry.set(taskType, handler);

  logger.info({
    operation: 'task_handler_registered',
    taskType,
    message: `Registered handler for task type "${taskType}"`,
  });
}

/**
 * Get task handler for a given type
 * @param registry Task registry
 * @param taskType Task type identifier
 * @returns Task handler or undefined if not found
 */
export function getTaskHandler(
  registry: TaskRegistry,
  taskType: string
): TaskHandler | undefined {
  return registry.get(taskType);
}

/**
 * Check if a task type is registered
 * @param registry Task registry
 * @param taskType Task type identifier
 * @returns True if handler exists for this type
 */
export function hasTaskHandler(
  registry: TaskRegistry,
  taskType: string
): boolean {
  return registry.has(taskType);
}

/**
 * Get all registered task types
 * @param registry Task registry
 * @returns Array of task type strings
 */
export function getRegisteredTaskTypes(registry: TaskRegistry): string[] {
  return Array.from(registry.keys());
}

/**
 * Clear all registered handlers
 * @param registry Task registry
 */
export function clearTaskRegistry(registry: TaskRegistry): void {
  const count = registry.size;
  registry.clear();

  logger.info({
    operation: 'task_registry_cleared',
    clearedCount: count,
    message: `Cleared ${count} handlers from task registry`,
  });
}
