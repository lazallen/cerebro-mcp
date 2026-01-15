/**
 * Slack Service Configuration
 *
 * This file contains all configuration settings for the Slack integration.
 * It follows the same pattern as the Microsoft service configuration.
 */

const path = require('path');
const os = require('os');

// Get home directory for token storage
const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp';

module.exports = {
  // Service metadata
  SERVICE_NAME: 'slack',
  SERVICE_DISPLAY_NAME: 'Slack',
  SERVICE_VERSION: '1.0.0',

  // Test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Authentication configuration
  AUTH_CONFIG: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    // Slack whitelists localhost for HTTPS in development
    redirectUri: process.env.SLACK_REDIRECT_URI || 'https://localhost:3333/auth/slack/callback',

    // For Slack OAuth v2 with user tokens, we use user_scope
    // These are read-only scopes for Phase 1
    userScopes: [
      'channels:read',
      'channels:history',
      'canvases:read',
      'canvases:write'
    ],

    // OAuth endpoints
    authEndpoint: 'https://slack.com/oauth/v2/authorize',
    tokenEndpoint: 'https://slack.com/api/oauth.v2.access',

    // Token storage
    tokenStorePath: path.join(homeDir, '.slack-token.json'),

    // Auth server URL
    authServerUrl: 'http://localhost:3333',

    // Slack user tokens don't expire, but we keep this for consistency
    refreshTokenBuffer: 5 * 60 * 1000 // 5 minutes
  },

  // Slack API configuration
  SLACK_API_ENDPOINT: 'https://slack.com/api/',

  // Pagination settings
  DEFAULT_PAGE_SIZE: 20,
  MAX_RESULT_COUNT: 100,
  MAX_PAGE_SIZE: 200, // Slack's maximum

  // Channel history defaults
  DEFAULT_HISTORY_LIMIT: 10,

  // Thread defaults
  DEFAULT_THREAD_LIMIT: 100
};
