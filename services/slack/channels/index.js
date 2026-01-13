/**
 * Channels Module
 *
 * Exports all channel-related tools.
 */

const handleListChannels = require('./list');
const handleGetChannelHistory = require('./history');

const channelsTools = [
  {
    name: "list-channels",
    description: "List public channels in your Slack workspace with pagination support. Returns channel IDs, names, member counts, and descriptions.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of channels to return (default: 20, max: 200)"
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response (for getting next page of results)"
        }
      },
      required: []
    },
    handler: handleListChannels
  },
  {
    name: "get-channel-history",
    description: "Retrieve recent messages from a Slack channel. Shows message content, timestamps, authors, and thread information.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID (e.g., 'C12345678') - use list-channels to find channel IDs"
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 10, max: 200)"
        }
      },
      required: ["channel"]
    },
    handler: handleGetChannelHistory
  }
];

module.exports = {
  channelsTools,
  handleListChannels,
  handleGetChannelHistory
};
