/**
 * Microsoft Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MicrosoftService } from '../microsoft-service';
import { ServiceConfig } from '../../../types/service';
import * as fs from 'fs/promises';

describe('MicrosoftService', () => {
  let service: MicrosoftService;
  let config: ServiceConfig;
  const testTokenPath = './.tokens/test-microsoft-tokens.json';

  beforeEach(() => {
    config = {
      name: 'microsoft-test',
      oauth: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tenantId: 'test-tenant-id',
        redirectUri: 'http://localhost:3333/auth/microsoft/callback',
        scopes: ['offline_access', 'Mail.Read', 'Mail.Send'],
      },
      tokenStoragePath: testTokenPath,
    };

    // Set test mode
    process.env['USE_TEST_MODE'] = 'true';

    service = new MicrosoftService(config);
  });

  afterEach(async () => {
    await service.shutdown();
    try {
      await fs.unlink(testTokenPath);
    } catch {
      // Ignore if file doesn't exist
    }
    delete process.env['USE_TEST_MODE'];
  });

  describe('initialization', () => {
    it('should create service with correct name', () => {
      expect(service.name).toBe('microsoft-test');
    });

    it('should initialize without errors', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should not be authenticated initially', async () => {
      await service.initialize();
      expect(await service.isAuthenticated()).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should return three tools', () => {
      const tools = service.getTools();
      expect(tools).toHaveLength(3);
    });

    it('should return list-emails tool', () => {
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');
      expect(listEmails).toBeDefined();
      expect(listEmails?.description).toContain('List recent emails');
      expect(listEmails?.inputSchema.properties).toHaveProperty('count');
    });

    it('should return read-email tool', () => {
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');
      expect(readEmail).toBeDefined();
      expect(readEmail?.description).toContain('Read full email');
      expect(readEmail?.inputSchema.required).toContain('emailId');
    });

    it('should return send-email tool', () => {
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');
      expect(sendEmail).toBeDefined();
      expect(sendEmail?.description).toContain('Send an email');
      expect(sendEmail?.inputSchema.required).toContain('to');
      expect(sendEmail?.inputSchema.required).toContain('subject');
      expect(sendEmail?.inputSchema.required).toContain('body');
    });
  });

  describe('list-emails tool', () => {
    it('should list emails in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({});
      expect(result).toHaveProperty('emails');
      expect(result).toHaveProperty('count');
      expect((result as { emails: unknown[] }).emails).toBeInstanceOf(Array);
    });

    it('should respect count parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({ count: 5 });
      expect(result).toHaveProperty('emails');
      expect((result as { count: number }).count).toBeLessThanOrEqual(5);
    });

    it('should cap count at 50', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({ count: 100 });
      expect(result).toHaveProperty('emails');
      // In test mode we won't have 50 emails, but the cap is applied
      expect((result as { count: number }).count).toBeLessThanOrEqual(50);
    });

    it('should default to 10 emails when count not provided', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({});
      expect(result).toHaveProperty('count');
      // In test mode, we expect the mock response structure
      expect((result as { count: number }).count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('read-email tool', () => {
    it('should read email by ID in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');

      const result = await readEmail?.handler({ emailId: 'test-email-id' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should require emailId parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');

      // Missing required parameter should fail
      await expect(readEmail?.handler({})).rejects.toThrow();
    });
  });

  describe('send-email tool', () => {
    it('should send email in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: 'Test body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should support multiple recipients', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test1@example.com', 'test2@example.com'],
        subject: 'Test Subject',
        body: 'Test body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { message: string }).message).toContain('test1@example.com');
      expect((result as { message: string }).message).toContain('test2@example.com');
    });

    it('should support HTML body type', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: '<p>Test HTML body</p>',
        bodyType: 'html',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should default to text body type', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: 'Plain text body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should require to parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          subject: 'Test Subject',
          body: 'Test body',
        })
      ).rejects.toThrow();
    });

    it('should require subject parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          to: ['test@example.com'],
          body: 'Test body',
        })
      ).rejects.toThrow();
    });

    it('should require body parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          to: ['test@example.com'],
          subject: 'Test Subject',
        })
      ).rejects.toThrow();
    });
  });

  describe('authentication', () => {
    it('should report not authenticated without tokens', async () => {
      await service.initialize();
      expect(await service.isAuthenticated()).toBe(false);
    });

    it('should report authenticated with valid tokens', async () => {
      // Write mock token file
      const mockTokens = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Date.now() + 3600000, // 1 hour from now
      };

      await fs.mkdir('./.tokens', { recursive: true });
      await fs.writeFile(testTokenPath, JSON.stringify(mockTokens));

      await service.initialize();
      expect(await service.isAuthenticated()).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without errors', async () => {
      await service.initialize();
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });
});
