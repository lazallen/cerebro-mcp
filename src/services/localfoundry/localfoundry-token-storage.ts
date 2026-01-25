/**
 * LocalFoundry Token Storage (Dummy Implementation)
 *
 * Minimal token storage implementation for LocalFoundry service.
 * LocalFoundry requires no OAuth authentication, so this is a no-op implementation
 * that satisfies the BaseTokenStorage interface requirements.
 */

import { BaseTokenStorage } from '../../common/base-token-storage';
import { TokenData } from '../../types/token';
import { logger } from '../../common/logger';

export class LocalFoundryTokenStorage extends BaseTokenStorage {
  constructor(tokenStorePath: string) {
    super(tokenStorePath, 'localfoundry');

    logger.debug(
      {
        operation: 'localfoundry_token_storage_init',
        path: tokenStorePath,
      },
      'LocalFoundry token storage initialized (no-op - no OAuth required)'
    );
  }

  /**
   * Exchange authorization code for tokens (not used for LocalFoundry)
   *
   * @param _code - Authorization code (unused)
   * @returns Dummy token data
   */
  override async exchangeCodeForTokens(_code: string): Promise<TokenData> {
    logger.debug(
      {
        operation: 'localfoundry_exchange_code',
      },
      'LocalFoundry does not require OAuth - returning dummy token'
    );

    // Return dummy token data with far-future expiration
    return Promise.resolve({
      accessToken: 'no-auth-required',
      tokenType: 'none',
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
      scopes: ['local'],
    });
  }

  /**
   * Refresh access token (not used for LocalFoundry)
   *
   * @param _refreshToken - Refresh token (unused)
   * @returns Dummy token data
   */
  override async refreshAccessToken(_refreshToken: string): Promise<TokenData> {
    logger.debug(
      {
        operation: 'localfoundry_refresh_token',
      },
      'LocalFoundry does not require OAuth - returning dummy token'
    );

    // Return dummy token data with far-future expiration
    return Promise.resolve({
      accessToken: 'no-auth-required',
      tokenType: 'none',
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
      scopes: ['local'],
    });
  }

  /**
   * Load tokens (no-op for LocalFoundry)
   * @returns Dummy token data
   */
  override async loadTokens(): Promise<TokenData | undefined> {
    logger.debug(
      {
        operation: 'localfoundry_load_tokens',
      },
      'LocalFoundry does not require OAuth - load is no-op'
    );
    // Set dummy token data
    this.tokenData = {
      accessToken: 'no-auth-required',
      tokenType: 'none',
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      scopes: ['local'],
    };

    return Promise.resolve(this.tokenData);
  }
}
