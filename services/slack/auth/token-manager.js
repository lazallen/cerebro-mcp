/**
 * Slack Token Manager
 *
 * Simple wrapper around TokenStorage for easy access to tokens.
 * Follows the same pattern as Microsoft's token-manager.js
 */

const config = require('../config');
const TokenStorage = require('./token-storage');

// Create singleton instance
const tokenStorage = new TokenStorage(config.AUTH_CONFIG);

/**
 * Load tokens from cache
 * @returns {object|null} - Token object or null
 */
function loadTokenCache() {
  return tokenStorage.tokens;
}

/**
 * Get valid access token
 * @returns {Promise<string>} - Valid access token
 */
async function getAccessToken() {
  try {
    return await tokenStorage.getValidAccessToken();
  } catch (error) {
    console.error('Error getting access token:', error.message);
    throw error;
  }
}

/**
 * Clear tokens (logout)
 * @returns {Promise<void>}
 */
async function clearTokens() {
  await tokenStorage.clearTokens();
}

/**
 * Create test tokens for test mode
 * @returns {object} - Mock token object
 */
function createTestTokens() {
  tokenStorage.tokens = {
    access_token: 'xoxp-test-token-12345',
    token_type: 'user',
    scope: 'channels:read,channels:history',
    team_id: 'T12345678',
    team_name: 'Test Workspace',
    user_id: 'U12345678',
    obtained_at: Date.now()
  };
  return tokenStorage.tokens;
}

module.exports = {
  tokenStorage,
  loadTokenCache,
  getAccessToken,
  clearTokens,
  createTestTokens
};
