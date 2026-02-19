/**
 * Task registry for mapping task types to handler implementations
 */

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
  eventsDir?: string;
  microsoftService?: any;
  rootDir?: string;
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
    hasEventsDir: !!dependencies?.eventsDir,
    hasMicrosoftService: !!dependencies?.microsoftService,
    hasRootDir: !!dependencies?.rootDir,
    eventsDir: dependencies?.eventsDir,
    rootDir: dependencies?.rootDir,
    message: 'Task registry dependencies check',
  });

  // Register email-triage task if dependencies are provided
  if (dependencies?.graphClient && dependencies?.lfClient && dependencies?.eventsDir) {
    try {
      const { EmailTriageTask } = require('./email-triage-task');
      const emailTriageHandler = new EmailTriageTask(
        dependencies.graphClient,
        dependencies.lfClient,
        dependencies.eventsDir
      );
      registry.set('email-triage', emailTriageHandler);

      logger.debug({
        operation: 'task_handler_registered',
        taskType: 'email-triage',
        message: 'Registered email-triage task handler',
      });
    } catch (error) {
      logger.warn({
        operation: 'task_handler_registration_error',
        taskType: 'email-triage',
        error: (error as Error).message,
        message: 'Failed to register email-triage task handler',
      });
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

  // Register calendar-review task when implemented
  // if (dependencies?.graphClient && dependencies?.oneNoteClient && dependencies?.eventsDir) {
  //   const { CalendarReviewTask } = require('./calendar-review-task');
  //   registry.set('calendar-review', new CalendarReviewTask(...));
  // }

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
