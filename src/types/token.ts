/**
 * OAuth token types
 *
 * Defines structures for OAuth 2.0 token data and management.
 */

/**
 * OAuth token data stored for a service
 */
export interface TokenData {
  /** Access token for API requests */
  accessToken: string;

  /** Refresh token for obtaining new access tokens (optional, not all services provide) */
  refreshToken?: string;

  /** Token expiry timestamp (milliseconds since epoch) */
  expiresAt?: number;

  /** Token type (usually "Bearer") */
  tokenType?: string;

  /** Scopes granted to this token */
  scopes?: string[];

  /** Additional service-specific token metadata */
  metadata?: Record<string, unknown>;
}

/**
 * OAuth authorization code exchange request
 */
export interface TokenExchangeRequest {
  /** Authorization code from OAuth callback */
  code: string;

  /** Client ID */
  clientId: string;

  /** Client secret */
  clientSecret: string;

  /** Redirect URI (must match registered URI) */
  redirectUri: string;

  /** Grant type (usually "authorization_code") */
  grantType?: string;

  /** Additional parameters for token exchange */
  additionalParams?: Record<string, string>;
}

/**
 * OAuth token refresh request
 */
export interface TokenRefreshRequest {
  /** Refresh token */
  refreshToken: string;

  /** Client ID */
  clientId: string;

  /** Client secret */
  clientSecret: string;

  /** Grant type (usually "refresh_token") */
  grantType?: string;

  /** Scopes to request (optional) */
  scopes?: string[];
}

/**
 * OAuth token response from provider
 */
export interface TokenResponse {
  /** Access token */
  access_token: string;

  /** Refresh token (if provided) */
  refresh_token?: string;

  /** Token expiry in seconds */
  expires_in?: number;

  /** Token type */
  token_type?: string;

  /** Granted scopes */
  scope?: string;

  /** Additional response fields */
  [key: string]: unknown;
}

/**
 * Check if token is expired or expiring soon
 * @param tokenData Token data to check
 * @param bufferMs Buffer time in milliseconds (default 5 minutes)
 * @returns true if token is expired or expiring within buffer time
 */
export function isTokenExpired(tokenData: TokenData, bufferMs: number = 5 * 60 * 1000): boolean {
  if (!tokenData.expiresAt) {
    // If no expiry, assume token doesn't expire (e.g., Slack user tokens)
    return false;
  }

  const now = Date.now();
  return now >= tokenData.expiresAt - bufferMs;
}

/**
 * Convert TokenResponse to TokenData
 * @param response OAuth token response
 * @returns Normalized token data
 */
export function normalizeTokenResponse(response: TokenResponse): TokenData {
  const expiresAt = response.expires_in ? Date.now() + response.expires_in * 1000 : undefined;

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt,
    tokenType: response.token_type ?? 'Bearer',
    scopes: response.scope ? response.scope.split(' ') : undefined,
  };
}
