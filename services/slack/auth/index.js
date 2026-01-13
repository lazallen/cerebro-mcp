/**
 * Slack Authentication Helpers
 *
 * Provides helper functions for authentication checks.
 * Main entry point for auth module.
 */

const tokenManager = require('./token-manager');

/**
 * Ensure user is authenticated, throw error if not
 * @param {boolean} forceNew - Force new authentication
 * @returns {Promise<string>} - Valid access token
 * @throws {Error} - If not authenticated
 */
async function ensureAuthenticated(forceNew = false) {
  if (forceNew) {
    throw new Error('Authentication required. Please use the slack.authenticate tool.');
  }

  const accessToken = await tokenManager.getAccessToken();

  if (!accessToken) {
    throw new Error('Authentication required. Please use the slack.authenticate tool.');
  }

  return accessToken;
}

/**
 * Check if user is authenticated
 * @returns {boolean} - True if authenticated
 */
function isAuthenticated() {
  const tokens = tokenManager.loadTokenCache();
  return !!(tokens && tokens.access_token);
}

module.exports = {
  ensureAuthenticated,
  isAuthenticated
};
