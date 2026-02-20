/**
 * Unit tests for config-loader
 * Tests JSON schema validation, hot-reload, and error handling
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigLoader } from '../../../../src/services/heartbeat/config-loader';
import type { HeartbeatConfig } from '../../../../src/types/heartbeat';

describe('ConfigLoader', () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(async () => {
    // Create temp directory for test configs
    testDir = path.join(__dirname, '../../../../.tmp-test-config');
    await fs.mkdir(testDir, { recursive: true });
    testConfigPath = path.join(testDir, 'test-heartbeat-config.json');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadConfig', () => {
    it('should load and validate a valid config file', async () => {
      const validConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'test-task',
            name: 'Test Task',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(validConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      const config = await loader.loadConfig();

      expect(config).toEqual(validConfig);
      expect(config.tasks).toHaveLength(1);
      expect(config.tasks[0].id).toBe('test-task');
    });

    it('should reject config with missing required fields', async () => {
      const invalidConfig = {
        // Missing rootDir
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow('Invalid heartbeat configuration');
    });

    it('should reject config with invalid task ID pattern', async () => {
      const invalidConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'Invalid Task!', // Invalid: contains spaces and special chars
            name: 'Test Task',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow('Invalid task ID');
    });

    it('should reject config with invalid cron expression', async () => {
      const invalidConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'test-task',
            name: 'Test Task',
            type: 'email-triage',
            schedule: 'invalid cron', // Invalid cron expression
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow('Invalid cron expression');
    });

    it('should reject config with invalid task type', async () => {
      const invalidConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'test-task',
            name: 'Test Task',
            type: 'invalid-type', // Not in enum
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow('Invalid task configuration');
    });

    it('should handle malformed JSON', async () => {
      await fs.writeFile(testConfigPath, '{ invalid json }');

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow();
    });

    it('should handle missing config file', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent.json');
      const loader = new ConfigLoader(nonExistentPath);
      await expect(loader.loadConfig()).rejects.toThrow();
    });

    it('should validate duplicate task IDs', async () => {
      const invalidConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'duplicate-id',
            name: 'Task 1',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
          {
            id: 'duplicate-id', // Duplicate!
            name: 'Task 2',
            type: 'calendar-ingestion',
            schedule: '0 9 * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await expect(loader.loadConfig()).rejects.toThrow('Duplicate task ID');
    });

    it('should allow empty task arrays', async () => {
      const emptyConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(emptyConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      const config = await loader.loadConfig();

      expect(config.tasks).toHaveLength(0);
    });
  });

  describe('watchConfig', () => {
    it('should detect config file changes and reload', async () => {
      const initialConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await loader.loadConfig();

      // Setup change handler
      const onChangeHandler = jest.fn();
      loader.watchConfig(onChangeHandler);

      // Wait a bit for watcher to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Modify config
      const updatedConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
          {
            id: 'task-2',
            name: 'Task 2',
            type: 'calendar-ingestion',
            schedule: '0 9 * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for file system event
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(onChangeHandler).toHaveBeenCalled();
      const reloadedConfig = onChangeHandler.mock.calls[0][0];
      expect(reloadedConfig.tasks).toHaveLength(2);

      // Cleanup
      loader.stopWatching();
    });

    it('should not trigger on invalid config changes', async () => {
      const initialConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await loader.loadConfig();

      const onChangeHandler = jest.fn();
      loader.watchConfig(onChangeHandler);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Write invalid config
      await fs.writeFile(testConfigPath, '{ invalid json }');

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not call handler for invalid config
      expect(onChangeHandler).not.toHaveBeenCalled();

      loader.stopWatching();
    });

    it('should stop watching when stopWatching is called', async () => {
      const initialConfig: HeartbeatConfig = {
        rootDir: './data',
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await loader.loadConfig();

      const onChangeHandler = jest.fn();
      loader.watchConfig(onChangeHandler);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop watching
      loader.stopWatching();

      // Modify config after stopping
      const updatedConfig: HeartbeatConfig = {
        rootDir: './data-new',
        tasks: [],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not have been called
      expect(onChangeHandler).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentConfig', () => {
    it('should return the currently loaded config', async () => {
      const config: HeartbeatConfig = {
        rootDir: './data',
        tasks: [
          {
            id: 'test-task',
            name: 'Test Task',
            type: 'email-triage',
            schedule: '0 * * * *',
            enabled: true,
            config: {},
          },
        ],
      };

      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      const loader = new ConfigLoader(testConfigPath);
      await loader.loadConfig();

      const currentConfig = loader.getCurrentConfig();
      expect(currentConfig).toEqual(config);
    });

    it('should throw if config not loaded yet', () => {
      const loader = new ConfigLoader(testConfigPath);
      expect(() => loader.getCurrentConfig()).toThrow('Config not loaded');
    });
  });
});
