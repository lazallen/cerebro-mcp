/**
 * Slack Service Entry Point
 *
 * Aggregates all Slack tools and exports service metadata.
 * This file is the main export for the Slack service.
 */

const config = require('./config');
const { authTools } = require('./auth/tools');
const { channelsTools } = require('./channels');
const { threadsTools } = require('./threads');

// Combine all tools from different modules
// Phase 1: Read-only operations only
const allTools = [
  ...authTools,      // authenticate, check-auth-status
  ...channelsTools,  // list-channels, get-channel-history
  ...threadsTools    // get-thread-replies
];

// Export service metadata
// The main server will add 'slack.' prefix to all tool names
module.exports = {
  // Service metadata
  name: 'slack',
  displayName: 'Slack',
  version: config.SERVICE_VERSION,
  description: 'Slack workspace integration for reading channels, messages, and threads. Phase 1: Read-only operations.',

  // All tools from this service (WITHOUT namespace prefix)
  // The main server adds the prefix automatically
  tools: allTools,

  // Service configuration
  config: config
};
