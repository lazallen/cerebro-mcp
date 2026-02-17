/**
 * Unit tests for scheduler
 * Tests task lifecycle (start/stop/destroy), concurrency control, and execution tracking
 */

import { Scheduler } from '../../../../src/services/heartbeat/scheduler';
import type { TaskConfig, TaskExecutionRecord } from '../../../../src/types/heartbeat';
import type { TaskHandler, TaskRegistry } from '../../../../src/services/heartbeat/types';

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn((cronExpression: string, fn: () => void) => ({
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
  })),
  validate: jest.fn(() => true),
}));

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let mockTaskRegistry: TaskRegistry;
  let mockTaskHandler: TaskHandler;

  beforeEach(() => {
    mockTaskHandler = {
      execute: jest.fn().mockResolvedValue(undefined),
    };

    mockTaskRegistry = new Map([['email-triage', mockTaskHandler]]);
    scheduler = new Scheduler(mockTaskRegistry);
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  describe('scheduleTask', () => {
    it('should schedule a task with valid config', () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      expect(() => scheduler.scheduleTask(taskConfig)).not.toThrow();
    });

    it('should throw error for task with unknown type', () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'unknown-type' as any,
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      expect(() => scheduler.scheduleTask(taskConfig)).toThrow('No handler found for task type');
    });

    it('should throw error for disabled tasks', () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: false,
        config: {},
      };

      expect(() => scheduler.scheduleTask(taskConfig)).toThrow('Cannot schedule disabled task');
    });

    it('should prevent duplicate task IDs', () => {
      const taskConfig: TaskConfig = {
        id: 'duplicate-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig);

      expect(() => scheduler.scheduleTask(taskConfig)).toThrow('Task with ID duplicate-task already scheduled');
    });
  });

  describe('executeTask', () => {
    it('should execute task and update execution record', async () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig);

      await scheduler.executeTask('test-task');

      expect(mockTaskHandler.execute).toHaveBeenCalledWith(taskConfig);

      const record = scheduler.getExecutionRecord('test-task');
      expect(record).toBeDefined();
      expect(record?.lastStatus).toBe('success');
      expect(record?.runCount).toBe(1);
      expect(record?.errorCount).toBe(0);
      expect(record?.currentlyRunning).toBe(false);
    });

    it('should prevent concurrent execution of same task', async () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      // Make handler slow to allow concurrent calls
      mockTaskHandler.execute = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      );

      scheduler.scheduleTask(taskConfig);

      // Start first execution
      const promise1 = scheduler.executeTask('test-task');

      // Try to start second execution while first is running
      await expect(scheduler.executeTask('test-task')).rejects.toThrow('Task test-task is already running');

      // Wait for first to complete
      await promise1;

      expect(mockTaskHandler.execute).toHaveBeenCalledTimes(1);
    });

    it('should handle task execution errors gracefully', async () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      const testError = new Error('Task execution failed');
      mockTaskHandler.execute = jest.fn().mockRejectedValue(testError);

      scheduler.scheduleTask(taskConfig);

      await expect(scheduler.executeTask('test-task')).rejects.toThrow('Task execution failed');

      const record = scheduler.getExecutionRecord('test-task');
      expect(record?.lastStatus).toBe('error');
      expect(record?.errorCount).toBe(1);
      expect(record?.runCount).toBe(0);
      expect(record?.lastError).toBe('Task execution failed');
      expect(record?.currentlyRunning).toBe(false);
    });

    it('should track execution duration', async () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      mockTaskHandler.execute = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      scheduler.scheduleTask(taskConfig);

      await scheduler.executeTask('test-task');

      const record = scheduler.getExecutionRecord('test-task');
      expect(record?.lastDuration).toBeGreaterThanOrEqual(100);
    });

    it('should throw error for non-existent task ID', async () => {
      await expect(scheduler.executeTask('non-existent')).rejects.toThrow('Task non-existent not found');
    });
  });

  describe('stopTask', () => {
    it('should stop a scheduled task', () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig);
      expect(() => scheduler.stopTask('test-task')).not.toThrow();
    });

    it('should throw error when stopping non-existent task', () => {
      expect(() => scheduler.stopTask('non-existent')).toThrow('Task non-existent not found');
    });
  });

  describe('stopAll', () => {
    it('should stop all scheduled tasks', () => {
      const taskConfig1: TaskConfig = {
        id: 'task-1',
        name: 'Task 1',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      const taskConfig2: TaskConfig = {
        id: 'task-2',
        name: 'Task 2',
        type: 'email-triage',
        schedule: '0 9 * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig1);
      scheduler.scheduleTask(taskConfig2);

      expect(() => scheduler.stopAll()).not.toThrow();
    });
  });

  describe('destroyTask', () => {
    it('should destroy a scheduled task', () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig);
      expect(() => scheduler.destroyTask('test-task')).not.toThrow();
    });

    it('should throw error when destroying non-existent task', () => {
      expect(() => scheduler.destroyTask('non-existent')).toThrow('Task non-existent not found');
    });
  });

  describe('destroyAll', () => {
    it('should destroy all scheduled tasks', () => {
      const taskConfig1: TaskConfig = {
        id: 'task-1',
        name: 'Task 1',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      const taskConfig2: TaskConfig = {
        id: 'task-2',
        name: 'Task 2',
        type: 'email-triage',
        schedule: '0 9 * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig1);
      scheduler.scheduleTask(taskConfig2);

      expect(() => scheduler.destroyAll()).not.toThrow();
    });
  });

  describe('getExecutionRecord', () => {
    it('should return execution record for existing task', async () => {
      const taskConfig: TaskConfig = {
        id: 'test-task',
        name: 'Test Task',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig);
      await scheduler.executeTask('test-task');

      const record = scheduler.getExecutionRecord('test-task');
      expect(record).toBeDefined();
      expect(record?.taskId).toBe('test-task');
    });

    it('should return undefined for non-existent task', () => {
      const record = scheduler.getExecutionRecord('non-existent');
      expect(record).toBeUndefined();
    });
  });

  describe('getAllExecutionRecords', () => {
    it('should return all execution records', async () => {
      const taskConfig1: TaskConfig = {
        id: 'task-1',
        name: 'Task 1',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {},
      };

      const taskConfig2: TaskConfig = {
        id: 'task-2',
        name: 'Task 2',
        type: 'email-triage',
        schedule: '0 9 * * *',
        enabled: true,
        config: {},
      };

      scheduler.scheduleTask(taskConfig1);
      scheduler.scheduleTask(taskConfig2);

      await scheduler.executeTask('task-1');
      await scheduler.executeTask('task-2');

      const records = scheduler.getAllExecutionRecords();
      expect(records).toHaveLength(2);
      expect(records.map((r) => r.taskId)).toContain('task-1');
      expect(records.map((r) => r.taskId)).toContain('task-2');
    });

    it('should return empty array when no tasks scheduled', () => {
      const records = scheduler.getAllExecutionRecords();
      expect(records).toHaveLength(0);
    });
  });
});
