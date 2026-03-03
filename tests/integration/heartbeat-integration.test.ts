/**
 * Integration tests for heartbeat system
 * Tests config hot-reload and end-to-end email triage workflow
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { HeartbeatService } from '../../src/services/heartbeat/heartbeat-service';
import type { HeartbeatConfig } from '../../src/types/heartbeat';

// Mock dependencies for email triage task
const mockGraphClient = {
  getEmailsForIngestion: jest.fn().mockResolvedValue([]),
};

const mockLfClient = {
  sendMessage: jest.fn().mockResolvedValue({
    choices: [{ message: { content: '{}' } }],
  }),
};

describe('Heartbeat Integration Tests', () => {
  let testDir: string;
  let testConfigPath: string;
  let heartbeatService: HeartbeatService;

  beforeEach(async () => {
    // Create temp directory for integration tests
    testDir = path.join(__dirname, '../../.tmp-integration-test');
    await fs.mkdir(testDir, { recursive: true });
    testConfigPath = path.join(testDir, 'heartbeat-config.json');
  });

  afterEach(async () => {
    // Stop service if running
    if (heartbeatService) {
      await heartbeatService.stop();
    }

    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Config Hot-Reload', () => {
    it('should detect config changes and reschedule tasks', async () => {
      // Create initial config with one task
      const initialConfig: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {
              maxEmails: 10,
            },
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      // Start heartbeat service with mock dependencies
      heartbeatService = new HeartbeatService(testConfigPath, {
        graphClient: mockGraphClient,
        lfClient: mockLfClient,
      });
      await heartbeatService.start();

      // Verify initial task is scheduled
      const initialRecords = heartbeatService.getExecutionRecords();
      expect(initialRecords).toHaveLength(1);
      expect(initialRecords[0].taskId).toBe('task-1');

      // Wait for watcher to stabilize
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Update config with two tasks
      const updatedConfig: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1 Updated',
            type: 'email-ingestion',
            schedule: '*/30 * * * *', // Changed schedule
            enabled: true,
            config: {
              maxEmails: 20, // Changed config
            },
          },
          {
            id: 'task-2',
            name: 'Task 2',
            type: 'email-ingestion',
            schedule: '0 9 * * *',
            enabled: true,
            config: {
              maxEmails: 50,
            },
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for file system event and reload
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify both tasks are now scheduled
      const updatedRecords = heartbeatService.getExecutionRecords();
      expect(updatedRecords).toHaveLength(2);
      expect(updatedRecords.map((r) => r.taskId)).toContain('task-1');
      expect(updatedRecords.map((r) => r.taskId)).toContain('task-2');
    }, 10000);

    it('should ignore invalid config changes and keep current config', async () => {
      // Create initial valid config
      const initialConfig: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      // Start heartbeat service with mock dependencies
      heartbeatService = new HeartbeatService(testConfigPath, {
        graphClient: mockGraphClient,
        lfClient: mockLfClient,
      });
      await heartbeatService.start();

      const initialRecords = heartbeatService.getExecutionRecords();
      expect(initialRecords).toHaveLength(1);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Write invalid config
      await fs.writeFile(testConfigPath, '{ "invalid": "config" }');

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should still have original task scheduled
      const currentRecords = heartbeatService.getExecutionRecords();
      expect(currentRecords).toHaveLength(1);
      expect(currentRecords[0].taskId).toBe('task-1');
    }, 10000);

    it('should handle task removal in config updates', async () => {
      // Create config with two tasks
      const initialConfig: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
          {
            id: 'task-2',
            name: 'Task 2',
            type: 'email-ingestion',
            schedule: '0 9 * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      heartbeatService = new HeartbeatService(testConfigPath, {
        graphClient: mockGraphClient,
        lfClient: mockLfClient,
      });
      await heartbeatService.start();

      expect(heartbeatService.getExecutionRecords()).toHaveLength(2);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Update config to remove task-2
      const updatedConfig: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should only have task-1 now
      const updatedRecords = heartbeatService.getExecutionRecords();
      expect(updatedRecords).toHaveLength(1);
      expect(updatedRecords[0].taskId).toBe('task-1');
    }, 10000);
  });

  describe('Task Execution', () => {
    it('should execute task manually and track execution record', async () => {
      const config: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'test-task',
            name: 'Test Task',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {
              maxEmails: 5,
            },
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      heartbeatService = new HeartbeatService(testConfigPath, {
        graphClient: mockGraphClient,
        lfClient: mockLfClient,
      });
      await heartbeatService.start();

      // Manually trigger task execution
      await heartbeatService.executeTask('test-task');

      // Verify execution record
      const records = heartbeatService.getExecutionRecords();
      expect(records).toHaveLength(1);

      const record = records[0];
      expect(record.taskId).toBe('test-task');
      expect(record.lastRun).not.toBeNull();
      expect(record.lastDuration).toBeGreaterThanOrEqual(0);
      expect(record.currentlyRunning).toBe(false);
    }, 10000);

    it('should prevent concurrent execution of same task', async () => {
      const config: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [
          {
            id: 'slow-task',
            name: 'Slow Task',
            type: 'email-ingestion',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      heartbeatService = new HeartbeatService(testConfigPath, {
        graphClient: mockGraphClient,
        lfClient: mockLfClient,
      });
      await heartbeatService.start();

      // Start first execution (don't await)
      const promise1 = heartbeatService.executeTask('slow-task');

      // Try second execution while first is running
      await expect(heartbeatService.executeTask('slow-task')).rejects.toThrow('already running');

      // Wait for first to complete
      await promise1;
    }, 10000);
  });

  describe('Service Lifecycle', () => {
    it('should start and stop cleanly', async () => {
      const config: HeartbeatConfig = {
        rootDir: testDir,
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      heartbeatService = new HeartbeatService(testConfigPath);

      await expect(heartbeatService.start()).resolves.not.toThrow();
      await expect(heartbeatService.stop()).resolves.not.toThrow();
    });

    it('should throw error when starting with invalid config path', async () => {
      const invalidPath = path.join(testDir, 'non-existent-config.json');
      heartbeatService = new HeartbeatService(invalidPath);

      await expect(heartbeatService.start()).rejects.toThrow();
    });
  });
});
