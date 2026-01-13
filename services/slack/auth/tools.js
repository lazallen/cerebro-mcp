/**
 * Slack Authentication Tools
 *
 * MCP tools for Slack authentication operations.
 */

const config = require('../config');
const tokenManager = require('./token-manager');

/**
 * Handle slack.authenticate tool
 * Initiates OAuth flow or creates test tokens in test mode
 * @param {object} args - Tool arguments
 * @param {boolean} args.force - Force re-authentication
 * @returns {Promise<object>} - MCP tool response
 */
async function handleAuthenticate(args) {
  const force = args && args.force === true;

  // Test mode: create mock tokens
  if (config.USE_TEST_MODE) {
    tokenManager.createTestTokens();
    return {
      content: [{
        type: "text",
        text: 'Successfully authenticated with Slack (test mode)\n\nMock tokens have been created for testing.'
      }]
    };
  }

  // Check if already authenticated
  const tokens = tokenManager.loadTokenCache();
  if (tokens && tokens.access_token && !force) {
    return {
      content: [{
        type: "text",
        text: `Already authenticated with Slack.\n\nWorkspace: ${tokens.team_name || tokens.team_id || 'Unknown'}\nUser ID: ${tokens.user_id || 'Unknown'}\n\nUse force=true to re-authenticate.`
      }]
    };
  }

  // Generate Slack OAuth URL
  const authUrl = `${config.AUTH_CONFIG.authServerUrl}/auth/slack/login`;

  return {
    content: [{
      type: "text",
      text: `Authentication with Slack required.\n\nPlease visit the following URL in your browser:\n${authUrl}\n\nAfter authentication, you will be redirected back and your access token will be saved.\n\nRequired scopes: ${config.AUTH_CONFIG.userScopes.join(', ')}`
    }]
  };
}

/**
 * Handle slack.check-auth-status tool
 * Check current authentication status
 * @returns {Promise<object>} - MCP tool response
 */
async function handleCheckAuthStatus() {
  const tokens = tokenManager.loadTokenCache();

  if (!tokens || !tokens.access_token) {
    return {
      content: [{
        type: "text",
        text: 'Not authenticated with Slack.\n\nPlease use the slack.authenticate tool to authenticate.'
      }]
    };
  }

  const scopeList = tokens.scope ? tokens.scope.split(',').join(', ') : 'unknown';

  return {
    content: [{
      type: "text",
      text: `Authenticated with Slack ✓\n\nWorkspace: ${tokens.team_name || tokens.team_id || 'Unknown'}\nUser ID: ${tokens.user_id || 'Unknown'}\nToken Type: ${tokens.token_type || 'user'}\nScopes: ${scopeList}\nObtained: ${tokens.obtained_at ? new Date(tokens.obtained_at).toLocaleString() : 'Unknown'}\n\nNote: Slack user tokens do not expire.`
    }]
  };
}

// Tool definitions
const authTools = [
  {
    name: "authenticate",
    description: "Authenticate with Slack to access your workspace. This will initiate the OAuth flow and save your access token.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Force re-authentication even if already authenticated (default: false)"
        }
      },
      required: []
    },
    handler: handleAuthenticate
  },
  {
    name: "check-auth-status",
    description: "Check your current Slack authentication status and view token information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    handler: handleCheckAuthStatus
  }
];

module.exports = {
  authTools,
  handleAuthenticate,
  handleCheckAuthStatus
};
