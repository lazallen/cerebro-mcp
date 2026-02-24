/**
 * Session Credential Storage for Slack Save for Later (Feature 020).
 *
 * Manages browser session credentials (xoxc/xoxd) at .tokens/slack-session-credentials.json.
 * These are short-lived (~12h) and managed exclusively via the auth dashboard.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../common/logger';
import type { SessionCredentials } from '../../types/slack-saved-items';

/** 12-hour credential lifetime (conservative estimate based on observed behaviour) */
const CREDENTIAL_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Warn when fewer than 2 hours remain before estimated expiry */
const EXPIRY_WARNING_MS = 2 * 60 * 60 * 1000;

/** Default storage path within the project root */
const DEFAULT_STORAGE_PATH = '.tokens/slack-session-credentials.json';

export class SessionCredentialStorage {
  private readonly storagePath: string;
  private credentials: SessionCredentials | undefined;

  constructor(storagePath?: string) {
    this.storagePath = storagePath
      ? path.isAbsolute(storagePath)
        ? storagePath
        : path.resolve(process.cwd(), storagePath)
      : path.resolve(process.cwd(), DEFAULT_STORAGE_PATH);
  }

  /**
   * Load credentials from disk.
   * Returns undefined if the file does not exist or is invalid.
   */
  async load(): Promise<SessionCredentials | undefined> {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw) as SessionCredentials;

      if (!parsed.xoxcToken || !parsed.xoxdCookie || !parsed.savedAt) {
        logger.warn({
          operation: 'slack_credentials_invalid_file',
          message: 'Slack session credentials file exists but is missing required fields',
        });
        return undefined;
      }

      this.credentials = parsed;
      return parsed;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return undefined;
      }
      logger.warn({
        operation: 'slack_credentials_load_error',
        error: error.message,
        message: 'Failed to load Slack session credentials',
      });
      return undefined;
    }
  }

  /**
   * Save new credentials to disk with 0o600 permissions.
   * Sets savedAt to the current time.
   */
  async save(xoxcToken: string, xoxdCookie: string): Promise<SessionCredentials> {
    const savedAt = Date.now();

    // Preserve existing workspaceUrl if present (will be re-resolved on next auth.test)
    const existingWorkspaceUrl = this.credentials?.workspaceUrl;

    const credentials: SessionCredentials = {
      xoxcToken,
      xoxdCookie,
      savedAt,
      ...(existingWorkspaceUrl ? { workspaceUrl: existingWorkspaceUrl } : {}),
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });

    // Write atomically: write to temp file then rename
    const tmpPath = `${this.storagePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(credentials, null, 2), 'utf-8');
    await fs.chmod(tmpPath, 0o600);
    await fs.rename(tmpPath, this.storagePath);

    this.credentials = credentials;

    logger.info({
      operation: 'slack_credentials_saved',
      savedAt: new Date(savedAt).toISOString(),
      estimatedExpiresAt: new Date(savedAt + CREDENTIAL_LIFETIME_MS).toISOString(),
      message: 'Slack session credentials saved',
    });

    return credentials;
  }

  /**
   * Update the cached workspaceUrl without resetting savedAt.
   */
  async updateWorkspaceUrl(workspaceUrl: string): Promise<void> {
    if (!this.credentials) return;

    this.credentials = { ...this.credentials, workspaceUrl };

    // Persist the update
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tmpPath = `${this.storagePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.credentials, null, 2), 'utf-8');
    await fs.chmod(tmpPath, 0o600);
    await fs.rename(tmpPath, this.storagePath);
  }

  /**
   * Return the currently loaded credentials (synchronous, no I/O).
   */
  getCurrent(): SessionCredentials | undefined {
    return this.credentials;
  }

  /**
   * Returns true if credentials exist but their estimated expiry has passed.
   */
  isExpired(): boolean {
    if (!this.credentials) return false;
    return this.credentials.savedAt + CREDENTIAL_LIFETIME_MS < Date.now();
  }

  /**
   * Returns true if credentials exist and will expire within the warning window (2h).
   */
  isExpiringSoon(): boolean {
    if (!this.credentials) return false;
    const remaining = this.credentials.savedAt + CREDENTIAL_LIFETIME_MS - Date.now();
    return remaining > 0 && remaining < EXPIRY_WARNING_MS;
  }

  /**
   * Returns the estimated expiry timestamp in ms, or undefined if no credentials.
   */
  getEstimatedExpiresAt(): number | undefined {
    if (!this.credentials) return undefined;
    return this.credentials.savedAt + CREDENTIAL_LIFETIME_MS;
  }
}
