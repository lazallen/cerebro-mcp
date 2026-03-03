/**
 * Service Registration Tests
 *
 * Tests for service registration and credential checking
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  hasMicrosoftCredentials,
  hasSlackCredentials,
  registerServices,
} from '../service-registration';
import type { ServiceRegistry } from '../../common/service-registry';

// TODO: These tests fail because service-registration imports MicrosoftService → marked (ESM-only).
// Install babel-jest to re-enable.
describe.skip('Service Registration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all service credentials
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
    // Clear LocalFoundry config
    delete process.env.LOCALFOUNDRY_ENDPOINT;
    delete process.env.LOCALFOUNDRY_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('hasMicrosoftCredentials', () => {
    it('should return true when Microsoft credentials are set', () => {
      process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
      process.env.MICROSOFT_CLIENT_SECRET = 'test-secret';
      process.env.MICROSOFT_TENANT_ID = 'test-tenant';

      const result = hasMicrosoftCredentials();
      expect(result).toBe(true);
    });

    it('should return false when credentials are missing', () => {
      delete process.env.MICROSOFT_CLIENT_ID;
      delete process.env.MICROSOFT_CLIENT_SECRET;
      delete process.env.MICROSOFT_TENANT_ID;

      const result = hasMicrosoftCredentials();
      expect(result).toBe(false);
    });

    it('should return false when only some credentials are set', () => {
      process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
      delete process.env.MICROSOFT_CLIENT_SECRET;
      delete process.env.MICROSOFT_TENANT_ID;

      const result = hasMicrosoftCredentials();
      expect(result).toBe(false);
    });
  });

  describe('hasSlackCredentials', () => {
    it('should return true when Slack credentials are set', () => {
      process.env.SLACK_CLIENT_ID = 'test-client-id';
      process.env.SLACK_CLIENT_SECRET = 'test-secret';

      const result = hasSlackCredentials();
      expect(result).toBe(true);
    });

    it('should return false when credentials are missing', () => {
      delete process.env.SLACK_CLIENT_ID;
      delete process.env.SLACK_CLIENT_SECRET;

      const result = hasSlackCredentials();
      expect(result).toBe(false);
    });

    it('should return false when only some credentials are set', () => {
      process.env.SLACK_CLIENT_ID = 'test-client-id';
      delete process.env.SLACK_CLIENT_SECRET;

      const result = hasSlackCredentials();
      expect(result).toBe(false);
    });
  });

  describe('registerServices', () => {
    it('should register Microsoft service when credentials exist', async () => {
      process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
      process.env.MICROSOFT_CLIENT_SECRET = 'test-secret';
      process.env.MICROSOFT_TENANT_ID = 'test-tenant';

      const registerFn = jest.fn();
      const mockRegistry: Partial<ServiceRegistry> = {
        register: registerFn,
        list: jest.fn().mockReturnValue(['microsoft']),
      };

      await registerServices(mockRegistry as ServiceRegistry);

      // Microsoft service should be registered
      expect(registerFn).toHaveBeenCalledTimes(1);
      const call = registerFn.mock.calls[0][0];
      expect(call.name).toBe('microsoft');
    });

    it('should register Slack service when credentials exist', async () => {
      process.env.SLACK_CLIENT_ID = 'test-client-id';
      process.env.SLACK_CLIENT_SECRET = 'test-secret';

      const registerFn = jest.fn();
      const mockRegistry: Partial<ServiceRegistry> = {
        register: registerFn,
        list: jest.fn().mockReturnValue(['slack']),
      };

      await registerServices(mockRegistry as ServiceRegistry);

      // Slack service should be registered
      expect(registerFn).toHaveBeenCalledTimes(1);
      const call = registerFn.mock.calls[0][0];
      expect(call.name).toBe('slack');
    });

    it('should skip services with missing credentials', async () => {
      delete process.env.MICROSOFT_CLIENT_ID;
      delete process.env.SLACK_CLIENT_ID;

      const registerFn = jest.fn();
      const mockRegistry: Partial<ServiceRegistry> = {
        register: registerFn,
        list: jest.fn().mockReturnValue([]),
      };

      await registerServices(mockRegistry as ServiceRegistry);

      // Register should not be called
      expect(registerFn).not.toHaveBeenCalled();
    });

    it('should register both services when all credentials exist', async () => {
      process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
      process.env.MICROSOFT_CLIENT_SECRET = 'test-secret';
      process.env.MICROSOFT_TENANT_ID = 'test-tenant';
      process.env.SLACK_CLIENT_ID = 'test-client-id';
      process.env.SLACK_CLIENT_SECRET = 'test-secret';

      const registerFn = jest.fn();
      const mockRegistry: Partial<ServiceRegistry> = {
        register: registerFn,
        list: jest.fn().mockReturnValue(['microsoft', 'slack']),
      };

      await registerServices(mockRegistry as ServiceRegistry);

      // Both services should be registered
      expect(registerFn).toHaveBeenCalledTimes(2);
    });
  });
});
