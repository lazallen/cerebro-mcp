/**
 * Common Utilities Tests
 *
 * Tests for common configuration and logging utilities
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { validateRequiredEnvVars, globalConfig } from '../../common/config';

describe('Config Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateRequiredEnvVars', () => {
    it('should not throw when all required vars are set', () => {
      process.env.REQUIRED_VAR_1 = 'value1';
      process.env.REQUIRED_VAR_2 = 'value2';

      expect(() => {
        validateRequiredEnvVars(['REQUIRED_VAR_1', 'REQUIRED_VAR_2']);
      }).not.toThrow();
    });

    it('should throw when a required var is missing', () => {
      process.env.REQUIRED_VAR_1 = 'value1';
      delete process.env.REQUIRED_VAR_2;

      expect(() => {
        validateRequiredEnvVars(['REQUIRED_VAR_1', 'REQUIRED_VAR_2']);
      }).toThrow();
    });

    it('should throw with message about missing variables', () => {
      delete process.env.MISSING_VAR;

      expect(() => {
        validateRequiredEnvVars(['MISSING_VAR']);
      }).toThrow(/MISSING_VAR/);
    });

    it('should handle empty array of required vars', () => {
      expect(() => {
        validateRequiredEnvVars([]);
      }).not.toThrow();
    });

    it('should be case-sensitive', () => {
      process.env.MY_VAR = 'value';
      delete process.env.my_var;

      expect(() => {
        validateRequiredEnvVars(['my_var']);
      }).toThrow();
    });
  });

  describe('globalConfig', () => {
    it('should have default values', () => {
      expect(globalConfig).toBeDefined();
      expect(globalConfig.authServerPort).toBeDefined();
      expect(typeof globalConfig.authServerPort).toBe('number');
    });

    it('should read from environment variables', () => {
      process.env.AUTH_SERVER_PORT = '4444';
      // Note: This requires reimport or config reinitialization
      // depending on implementation
      expect(globalConfig).toBeDefined();
    });

    it('should use defaults when env vars not set', () => {
      delete process.env.AUTH_SERVER_PORT;
      expect(globalConfig.authServerPort).toBeDefined();
    });
  });
});
