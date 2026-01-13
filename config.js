/**
 * Shared Configuration for Cerebro MCP Server
 * Service-specific configurations are in services/<service>/config.js
 */

module.exports = {
  // Server information
  SERVER_NAME: 'cerebro-mcp',
  SERVER_VERSION: '1.0.0',
  SERVER_DESCRIPTION: 'Multi-service MCP server for productivity tools',

  // Global test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Auth server configuration
  AUTH_SERVER_PORT: 3333,
  AUTH_SERVER_HOST: 'localhost',
};
