/**
 * Base Token Storage
 *
 * Abstract base class for managing OAuth tokens with automatic refresh,
 * file-based persistence, and concurrent operation deduplication.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TokenData, isTokenExpired } from '../types/token';
import { APIError } from '../types/api';

export abstract class BaseTokenStorage {
  protected readonly tokenStorePath: string;
  protected readonly serviceName: string;
  protected tokenData?: TokenData;
  protected refreshPromise?: Promise<TokenData>;
  protected loadPromise?: Promise<TokenData | undefined>;

  /**
   * Create a new token storage instance
   * @param tokenStorePath Path to token storage file
   * @param serviceName Service name for error context
   */
  constructor(tokenStorePath: string, serviceName: string) {
    // Expand ~ to home directory
    if (tokenStorePath.startsWith('~/')) {
      tokenStorePath = path.join(os.homedir(), tokenStorePath.slice(2));
    }

    this.tokenStorePath = tokenStorePath;
    this.serviceName = serviceName;
  }

  /**
   * Exchange authorization code for tokens
   * Must be implemented by subclasses with service-specific logic
   * @param code Authorization code from OAuth callback
   * @returns Promise resolving to token data
   */
  abstract exchangeCodeForTokens(code: string): Promise<TokenData>;

  /**
   * Refresh access token using refresh token
   * Must be implemented by subclasses with service-specific logic
   * @param refreshToken Refresh token
   * @returns Promise resolving to new token data
   */
  abstract refreshAccessToken(refreshToken: string): Promise<TokenData>;

  /**
   * Get valid access token, automatically refreshing if expired
   * Deduplicates concurrent refresh attempts
   * @returns Promise resolving to valid access token
   * @throws APIError if no tokens available or refresh fails
   */
  async getValidAccessToken(): Promise<string> {
    // Load tokens if not already loaded
    if (!this.tokenData) {
      await this.loadTokens();
    }

    if (!this.tokenData) {
      throw new APIError(
        'No authentication tokens found. Please authenticate first.',
        401,
        this.serviceName,
        'getValidAccessToken'
      );
    }

    // Check if token is expired or expiring soon (5 minute buffer)
    if (isTokenExpired(this.tokenData, 5 * 60 * 1000)) {
      // Check if we have a refresh token
      if (!this.tokenData.refreshToken) {
        throw new APIError(
          'Access token expired and no refresh token available. Please re-authenticate.',
          401,
          this.serviceName,
          'getValidAccessToken'
        );
      }

      // Deduplicate concurrent refresh attempts
      if (this.refreshPromise) {
        this.tokenData = await this.refreshPromise;
      } else {
        this.refreshPromise = this.refreshAccessToken(this.tokenData.refreshToken);
        try {
          this.tokenData = await this.refreshPromise;
        } finally {
          this.refreshPromise = undefined;
        }
      }
    }

    return this.tokenData.accessToken;
  }

  /**
   * Load tokens from file
   * Deduplicates concurrent load attempts
   * @returns Promise resolving to token data or undefined if not found
   */
  async loadTokens(): Promise<TokenData | undefined> {
    // Deduplicate concurrent load attempts
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.doLoadTokens();
    try {
      this.tokenData = await this.loadPromise;
      return this.tokenData;
    } finally {
      this.loadPromise = undefined;
    }
  }

  /**
   * Internal method to load tokens from file
   * @returns Promise resolving to token data or undefined if not found
   */
  private async doLoadTokens(): Promise<TokenData | undefined> {
    try {
      if (!fs.existsSync(this.tokenStorePath)) {
        return undefined;
      }

      const data = await fs.promises.readFile(this.tokenStorePath, 'utf8');
      const parsed = JSON.parse(data) as TokenData;

      // Validate required fields
      if (!parsed.accessToken) {
        throw new Error('Invalid token data: missing accessToken');
      }

      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw new APIError(
        `Failed to load tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        this.serviceName,
        'loadTokens',
        { originalError: error }
      );
    }
  }

  /**
   * Save tokens to file
   * @param tokenData Token data to save
   * @returns Promise that resolves when tokens are saved
   */
  protected async saveTokens(tokenData: TokenData): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.tokenStorePath);
      await fs.promises.mkdir(dir, { recursive: true });

      // Write tokens to file
      const data = JSON.stringify(tokenData, null, 2);
      await fs.promises.writeFile(this.tokenStorePath, data, 'utf8');

      // Set restrictive permissions (0600 - owner read/write only)
      await fs.promises.chmod(this.tokenStorePath, 0o600);

      // Update in-memory cache
      this.tokenData = tokenData;
    } catch (error) {
      throw new APIError(
        `Failed to save tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        this.serviceName,
        'saveTokens',
        { originalError: error }
      );
    }
  }

  /**
   * Clear stored tokens
   * @returns Promise that resolves when tokens are cleared
   */
  async clearTokens(): Promise<void> {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        await fs.promises.unlink(this.tokenStorePath);
      }
      this.tokenData = undefined;
    } catch (error) {
      throw new APIError(
        `Failed to clear tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        this.serviceName,
        'clearTokens',
        { originalError: error }
      );
    }
  }

  /**
   * Check if tokens are available
   * @returns true if tokens are stored
   */
  async hasTokens(): Promise<boolean> {
    if (this.tokenData) {
      return true;
    }

    await this.loadTokens();
    return this.tokenData !== undefined;
  }

  /**
   * Get current token data (without refresh)
   * @returns Token data or undefined if not available
   */
  getCurrentTokenData(): TokenData | undefined {
    return this.tokenData;
  }
}
