/**
 * Base Token Storage Class
 *
 * Abstract base class for managing OAuth tokens across different services.
 * Each service should extend this class and implement service-specific OAuth logic.
 */

const fs = require('fs').promises;
const https = require('https');
const querystring = require('querystring');

class BaseTokenStorage {
  /**
   * @param {object} config - Configuration for token storage
   * @param {string} config.tokenStorePath - Path to store tokens
   * @param {string} config.clientId - OAuth client ID
   * @param {string} config.clientSecret - OAuth client secret
   * @param {string} config.redirectUri - OAuth redirect URI
   * @param {string[]} config.scopes - OAuth scopes
   * @param {string} config.tokenEndpoint - OAuth token endpoint
   * @param {number} [config.refreshTokenBuffer=300000] - Buffer time (ms) before token expiration to trigger refresh
   */
  constructor(config) {
    if (this.constructor === BaseTokenStorage) {
      throw new Error('BaseTokenStorage is an abstract class and cannot be instantiated directly');
    }

    this.config = {
      refreshTokenBuffer: 5 * 60 * 1000, // 5 minutes default
      ...config
    };

    this.tokens = null;
    this._loadPromise = null;
    this._refreshPromise = null;

    if (!this.config.clientId || !this.config.clientSecret) {
      console.warn(`${this.constructor.name}: Client ID or Client Secret is not configured. Token operations might fail.`);
    }
  }

  /**
   * Load tokens from file storage
   * @protected
   * @returns {Promise<object|null>}
   */
  async _loadTokensFromFile() {
    try {
      const tokenData = await fs.readFile(this.config.tokenStorePath, 'utf8');
      this.tokens = JSON.parse(tokenData);
      console.log(`${this.constructor.name}: Tokens loaded from file.`);
      return this.tokens;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`${this.constructor.name}: Token file not found. No tokens loaded.`);
      } else {
        console.error(`${this.constructor.name}: Error loading token cache:`, error);
      }
      this.tokens = null;
      return null;
    }
  }

  /**
   * Save tokens to file storage
   * @protected
   * @returns {Promise<void>}
   */
  async _saveTokensToFile() {
    if (!this.tokens) {
      console.warn(`${this.constructor.name}: No tokens to save.`);
      return;
    }
    try {
      await fs.writeFile(this.config.tokenStorePath, JSON.stringify(this.tokens, null, 2));
      console.log(`${this.constructor.name}: Tokens saved successfully.`);
    } catch (error) {
      console.error(`${this.constructor.name}: Error saving token cache:`, error);
      throw error;
    }
  }

  /**
   * Get tokens, loading from file if not in memory
   * Deduplicates concurrent load attempts
   * @returns {Promise<object|null>}
   */
  async getTokens() {
    if (this.tokens) {
      return this.tokens;
    }
    if (!this._loadPromise) {
      this._loadPromise = this._loadTokensFromFile().finally(() => {
        this._loadPromise = null;
      });
    }
    return this._loadPromise;
  }

  /**
   * Get token expiry timestamp
   * @returns {number} - Expiry time in milliseconds since epoch
   */
  getExpiryTime() {
    return this.tokens && this.tokens.expires_at ? this.tokens.expires_at : 0;
  }

  /**
   * Check if current token is expired or nearing expiration
   * @returns {boolean}
   */
  isTokenExpired() {
    if (!this.tokens || !this.tokens.expires_at) {
      return true;
    }
    return Date.now() >= (this.tokens.expires_at - this.config.refreshTokenBuffer);
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string|null>}
   */
  async getValidAccessToken() {
    await this.getTokens();

    if (!this.tokens || !this.tokens.access_token) {
      console.log(`${this.constructor.name}: No access token available.`);
      return null;
    }

    if (this.isTokenExpired()) {
      console.log(`${this.constructor.name}: Access token expired or nearing expiration. Attempting refresh.`);
      if (this.tokens.refresh_token) {
        try {
          return await this.refreshAccessToken();
        } catch (refreshError) {
          console.error(`${this.constructor.name}: Failed to refresh access token:`, refreshError);
          this.tokens = null;
          await this._saveTokensToFile();
          return null;
        }
      } else {
        console.warn(`${this.constructor.name}: No refresh token available. Cannot refresh access token.`);
        this.tokens = null;
        await this._saveTokensToFile();
        return null;
      }
    }
    return this.tokens.access_token;
  }

  /**
   * Refresh the access token using refresh token
   * Deduplicates concurrent refresh attempts
   * @returns {Promise<string>} - New access token
   */
  async refreshAccessToken() {
    if (!this.tokens || !this.tokens.refresh_token) {
      throw new Error('No refresh token available to refresh the access token.');
    }

    if (this._refreshPromise) {
      console.log(`${this.constructor.name}: Refresh already in progress, returning existing promise.`);
      return this._refreshPromise.then(tokens => tokens.access_token);
    }

    console.log(`${this.constructor.name}: Attempting to refresh access token...`);

    const postData = this.buildRefreshTokenRequest(this.tokens.refresh_token);

    this._refreshPromise = this._makeTokenRequest(postData, 'refresh')
      .then(async (responseBody) => {
        this.tokens.access_token = responseBody.access_token;
        if (responseBody.refresh_token) {
          this.tokens.refresh_token = responseBody.refresh_token;
        }
        this.tokens.expires_in = responseBody.expires_in;
        this.tokens.expires_at = Date.now() + (responseBody.expires_in * 1000);

        await this._saveTokensToFile();
        console.log(`${this.constructor.name}: Access token refreshed and saved successfully.`);
        return this.tokens;
      })
      .finally(() => {
        this._refreshPromise = null;
      });

    return this._refreshPromise.then(tokens => tokens.access_token);
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} authCode - Authorization code from OAuth flow
   * @returns {Promise<object>} - Token object
   */
  async exchangeCodeForTokens(authCode) {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID or Client Secret is not configured. Cannot exchange code for tokens.');
    }

    console.log(`${this.constructor.name}: Exchanging authorization code for tokens...`);

    const postData = this.buildAuthCodeRequest(authCode);

    const responseBody = await this._makeTokenRequest(postData, 'exchange');

    this.tokens = {
      access_token: responseBody.access_token,
      refresh_token: responseBody.refresh_token,
      expires_in: responseBody.expires_in,
      expires_at: Date.now() + (responseBody.expires_in * 1000),
      scope: responseBody.scope,
      token_type: responseBody.token_type
    };

    await this._saveTokensToFile();
    console.log(`${this.constructor.name}: Tokens exchanged and saved successfully.`);
    return this.tokens;
  }

  /**
   * Make an HTTPS request to the token endpoint
   * @protected
   * @param {string} postData - URL-encoded form data
   * @param {string} operation - Operation type for logging ('refresh' or 'exchange')
   * @returns {Promise<object>} - Response body
   */
  async _makeTokenRequest(postData, operation) {
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(this.config.tokenEndpoint, requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const responseBody = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(responseBody);
            } else {
              console.error(`${this.constructor.name}: Error during ${operation}:`, responseBody);
              reject(new Error(responseBody.error_description || `Token ${operation} failed with status ${res.statusCode}`));
            }
          } catch (e) {
            console.error(`${this.constructor.name}: Error processing ${operation} response:`, e);
            reject(new Error(`Error processing token response: ${e.message}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`${this.constructor.name}: HTTP error during ${operation}:`, error);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Build the refresh token request body
   * Can be overridden by subclasses for service-specific requirements
   * @protected
   * @param {string} refreshToken - The refresh token
   * @returns {string} - URL-encoded form data
   */
  buildRefreshTokenRequest(refreshToken) {
    return querystring.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: this.config.scopes.join(' ')
    });
  }

  /**
   * Build the authorization code exchange request body
   * Can be overridden by subclasses for service-specific requirements
   * @protected
   * @param {string} authCode - The authorization code
   * @returns {string} - URL-encoded form data
   */
  buildAuthCodeRequest(authCode) {
    return querystring.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' ')
    });
  }

  /**
   * Clear tokens from memory and file storage
   * @returns {Promise<void>}
   */
  async clearTokens() {
    this.tokens = null;
    try {
      await fs.unlink(this.config.tokenStorePath);
      console.log(`${this.constructor.name}: Token file deleted successfully.`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`${this.constructor.name}: Token file not found, nothing to delete.`);
      } else {
        console.error(`${this.constructor.name}: Error deleting token file:`, error);
      }
    }
  }
}

module.exports = BaseTokenStorage;
