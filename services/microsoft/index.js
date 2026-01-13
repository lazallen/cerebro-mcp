/**
 * Microsoft 365 / Outlook Service Entry Point
 *
 * This module aggregates all Microsoft service tools and exports them
 * for the main MCP server to register with service namespace prefix.
 */

const config = require('./config');
const { authTools } = require('./auth/tools');
const { calendarTools } = require('./calendar');
const { emailTools } = require('./email');
const { folderTools } = require('./folder');
const { rulesTools } = require('./rules');

// Combine all tools from different modules
const allTools = [
  ...authTools,
  ...calendarTools,
  ...emailTools,
  ...folderTools,
  ...rulesTools
];

module.exports = {
  // Service metadata
  name: 'microsoft',
  displayName: 'Microsoft 365',
  version: config.SERVICE_VERSION,
  description: 'Microsoft 365 / Outlook integration providing access to email, calendar, contacts, and more',

  // All tools from this service
  tools: allTools,

  // Service configuration
  config: config
};
