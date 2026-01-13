/**
 * Slack Token Storage
 *
 * Handles OAuth token storage and management for Slack user tokens.
 * Extends BaseTokenStorage with Slack-specific OAuth v2 handling.
 */

const BaseTokenStorage = require('../../../common/base-token-storage');
const path = require('path');

class SlackTokenStorage extends BaseTokenStorage {
  constructor(config) {
    const defaultConfig = {
      tokenStorePath: path.join(process.env.HOME || process.env.USERPROFILE, '.slack-token.json'),
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      redirectUri: process.env.SLACK_REDIRECT_URI || 'https://localhost:3333/auth/slack/callback',
      userScopes: [
        'channels:read',
        'channels:history'
      ],
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
      refreshTokenBuffer: 5 * 60 * 1000,
      ...config
    };

    super(defaultConfig);
  }

  /**
   * Build request body for exchanging authorization code for tokens
   * Slack OAuth v2 specific implementation
   * @protected
   * @param {string} authCode - Authorization code from OAuth callback
   * @returns {string} - URL-encoded request body
   */
  buildAuthCodeRequest(authCode) {
    const querystring = require('querystring');
    return querystring.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: authCode,
      redirect_uri: this.config.redirectUri
    });
  }

  /**
   * Override token exchange to handle Slack's response format
   * Slack returns authed_user.access_token for user tokens
   * @param {string} authCode - Authorization code
   * @returns {Promise<object>} - Token data
   */
  async exchangeCodeForTokens(authCode) {
    console.log(`${this.constructor.name}: Exchanging authorization code for tokens...`);

    const requestBody = this.buildAuthCodeRequest(authCode);

    return new Promise((resolve, reject) => {
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(this.config.tokenEndpoint);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', async () => {
          try {
            const tokenResponse = JSON.parse(responseData);

            // Check Slack's ok field for success
            if (!tokenResponse.ok) {
              console.error(`${this.constructor.name}: Token exchange failed:`, tokenResponse.error);
              reject(new Error(`Slack token exchange failed: ${tokenResponse.error}`));
              return;
            }

            // Extract user token from authed_user object
            // Slack OAuth v2 user token response structure:
            // { ok: true, authed_user: { access_token, scope, ... }, team: {...}, ... }
            const userToken = tokenResponse.authed_user?.access_token || tokenResponse.access_token;

            if (!userToken) {
              console.error(`${this.constructor.name}: No access token in response`);
              reject(new Error('No access token received from Slack'));
              return;
            }

            // Store tokens in Slack format
            this.tokens = {
              access_token: userToken,
              token_type: 'user',
              scope: tokenResponse.authed_user?.scope || tokenResponse.scope || '',
              team_id: tokenResponse.team?.id,
              team_name: tokenResponse.team?.name,
              user_id: tokenResponse.authed_user?.id,
              // Slack user tokens don't expire, so no expires_in or refresh_token
              obtained_at: Date.now()
            };

            await this._saveTokensToFile();
            console.log(`${this.constructor.name}: Tokens obtained and saved successfully`);
            resolve(this.tokens);
          } catch (error) {
            console.error(`${this.constructor.name}: Error parsing token response:`, error);
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`${this.constructor.name}: Token exchange request error:`, error);
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Slack user tokens don't expire, so we override this method
   * @returns {Promise<object>} - Returns current tokens without refreshing
   */
  async getValidAccessToken() {
    const tokens = await this.getTokens();

    if (!tokens || !tokens.access_token) {
      throw new Error('No access token available. Please authenticate first.');
    }

    // Slack user tokens don't expire, so just return the access token
    console.log(`${this.constructor.name}: Using existing user token (user tokens don't expire)`);
    return tokens.access_token;
  }

  /**
   * Slack user tokens don't support refresh
   * Override to prevent refresh attempts
   * @protected
   */
  async refreshAccessToken() {
    throw new Error('Slack user tokens do not support refresh. They do not expire. If authentication fails, please re-authenticate.');
  }
}

module.exports = SlackTokenStorage;
