/**
 * Unit tests for SessionCredentialStorage (Feature 020)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionCredentialStorage } from '../../../src/services/slack-saved-items/session-credential-storage';

describe('SessionCredentialStorage', () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: SessionCredentialStorage;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebro-slack-creds-'));
    storagePath = path.join(tmpDir, 'slack-session-credentials.json');
    storage = new SessionCredentialStorage(storagePath);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── load() ───────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('returns undefined when file does not exist', async () => {
      const result = await storage.load();
      expect(result).toBeUndefined();
    });

    it('returns undefined when file is invalid JSON', async () => {
      await fs.writeFile(storagePath, 'not-json', 'utf-8');
      const result = await storage.load();
      expect(result).toBeUndefined();
    });

    it('returns undefined when required fields are missing', async () => {
      await fs.writeFile(storagePath, JSON.stringify({ xoxcToken: 'xoxc-123' }), 'utf-8');
      const result = await storage.load();
      expect(result).toBeUndefined();
    });

    it('returns credentials when file is valid', async () => {
      const creds = {
        xoxcToken: 'xoxc-1234',
        xoxdCookie: 'xoxd-5678',
        savedAt: Date.now(),
      };
      await fs.writeFile(storagePath, JSON.stringify(creds), 'utf-8');

      const result = await storage.load();
      expect(result).toMatchObject(creds);
    });

    it('preserves workspaceUrl when present', async () => {
      const creds = {
        xoxcToken: 'xoxc-1234',
        xoxdCookie: 'xoxd-5678',
        savedAt: Date.now(),
        workspaceUrl: 'https://test.slack.com',
      };
      await fs.writeFile(storagePath, JSON.stringify(creds), 'utf-8');

      const result = await storage.load();
      expect(result?.workspaceUrl).toBe('https://test.slack.com');
    });
  });

  // ─── save() ───────────────────────────────────────────────────────────────

  describe('save()', () => {
    it('writes file with correct content', async () => {
      const before = Date.now();
      const result = await storage.save('xoxc-token', 'xoxd-cookie');
      const after = Date.now();

      expect(result.xoxcToken).toBe('xoxc-token');
      expect(result.xoxdCookie).toBe('xoxd-cookie');
      expect(result.savedAt).toBeGreaterThanOrEqual(before);
      expect(result.savedAt).toBeLessThanOrEqual(after);
    });

    it('file is readable after save', async () => {
      await storage.save('xoxc-token', 'xoxd-cookie');
      const content = await fs.readFile(storagePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.xoxcToken).toBe('xoxc-token');
    });

    it('sets file permissions to 0o600', async () => {
      await storage.save('xoxc-token', 'xoxd-cookie');
      const stat = await fs.stat(storagePath);
      // On POSIX: mode & 0o777 should be 0o600
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('getCurrent() returns saved credentials without re-reading disk', async () => {
      await storage.save('xoxc-token', 'xoxd-cookie');
      const current = storage.getCurrent();
      expect(current?.xoxcToken).toBe('xoxc-token');
    });

    it('creates directory if it does not exist', async () => {
      const nestedPath = path.join(tmpDir, 'nested', 'dir', 'creds.json');
      const nestedStorage = new SessionCredentialStorage(nestedPath);
      await expect(nestedStorage.save('xoxc-token', 'xoxd-cookie')).resolves.not.toThrow();
      await expect(fs.access(nestedPath)).resolves.not.toThrow();
    });
  });

  // ─── isExpired() ──────────────────────────────────────────────────────────

  describe('isExpired()', () => {
    it('returns false when no credentials loaded', () => {
      expect(storage.isExpired()).toBe(false);
    });

    it('returns false just before 12h boundary', async () => {
      const savedAt = Date.now() - (12 * 60 * 60 * 1000 - 60_000); // 1 minute before expiry
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      expect(storage.isExpired()).toBe(false);
    });

    it('returns true just after 12h boundary', async () => {
      const savedAt = Date.now() - (12 * 60 * 60 * 1000 + 60_000); // 1 minute after expiry
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      expect(storage.isExpired()).toBe(true);
    });
  });

  // ─── isExpiringSoon() ─────────────────────────────────────────────────────

  describe('isExpiringSoon()', () => {
    it('returns false when no credentials loaded', () => {
      expect(storage.isExpiringSoon()).toBe(false);
    });

    it('returns false when more than 2h remain', async () => {
      const savedAt = Date.now() - (10 * 60 * 60 * 1000 - 60_000); // 2h1m remaining
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      expect(storage.isExpiringSoon()).toBe(false);
    });

    it('returns true when within the 2h warning window', async () => {
      const savedAt = Date.now() - (10 * 60 * 60 * 1000 + 60_000); // 1h59m remaining
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      expect(storage.isExpiringSoon()).toBe(true);
    });

    it('returns false once fully expired', async () => {
      const savedAt = Date.now() - (12 * 60 * 60 * 1000 + 60_000);
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      // isExpiringSoon should return false when already expired (remaining <= 0)
      expect(storage.isExpiringSoon()).toBe(false);
    });
  });

  // ─── getEstimatedExpiresAt() ──────────────────────────────────────────────

  describe('getEstimatedExpiresAt()', () => {
    it('returns undefined when no credentials', () => {
      expect(storage.getEstimatedExpiresAt()).toBeUndefined();
    });

    it('returns savedAt + 12h', async () => {
      const savedAt = 1_700_000_000_000;
      await fs.writeFile(storagePath, JSON.stringify({
        xoxcToken: 'xoxc-token', xoxdCookie: 'xoxd-cookie', savedAt,
      }));
      await storage.load();
      expect(storage.getEstimatedExpiresAt()).toBe(savedAt + 12 * 60 * 60 * 1000);
    });
  });
});
