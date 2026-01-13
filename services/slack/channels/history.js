/**
 * Get Channel History Handler
 *
 * Retrieves recent messages from a Slack channel.
 */

const config = require('../config');
const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Handle slack.get-channel-history tool
 * @param {object} args - Tool arguments
 * @param {string} args.channel - Channel ID (e.g., 'C12345678')
 * @param {number} args.limit - Maximum number of messages to return (default: 10)
 * @returns {Promise<object>} - MCP tool response
 */
async function handleGetChannelHistory(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Validate required parameters
    if (!args.channel) {
      throw new Error('channel parameter is required');
    }

    // Parse parameters
    const channel = args.channel;
    const limit = args.limit || config.DEFAULT_HISTORY_LIMIT;

    // Build request parameters
    const params = {
      channel: channel,
      limit: Math.min(limit, config.MAX_PAGE_SIZE)
    };

    // Call Slack API
    const response = await callSlackAPI(accessToken, 'conversations.history', params);

    // Format response
    const messages = response.messages || [];

    if (messages.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No messages found in channel ${channel}`
        }]
      };
    }

    // Format messages for display
    const formattedMessages = messages.map(msg => {
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toLocaleString();
      const threadInfo = msg.reply_count ? `\n  [Thread: ${msg.reply_count} ${msg.reply_count === 1 ? 'reply' : 'replies'}]` : '';
      return `[${timestamp}] <@${msg.user}>\n  ${msg.text}${threadInfo}`;
    });

    const text = `Channel History (${channel}) - ${messages.length} message(s):\n\n` +
      formattedMessages.join('\n\n');

    return {
      content: [{
        type: "text",
        text: text
      }]
    };
  } catch (error) {
    console.error('Error getting channel history:', error);
    return {
      content: [{
        type: "text",
        text: `Error getting channel history: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleGetChannelHistory;
