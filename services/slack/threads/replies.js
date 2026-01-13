/**
 * Get Thread Replies Handler
 *
 * Retrieves all replies in a specific Slack thread.
 */

const config = require('../config');
const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Handle slack.get-thread-replies tool
 * @param {object} args - Tool arguments
 * @param {string} args.channel - Channel ID
 * @param {string} args.thread_ts - Thread timestamp (ts of parent message)
 * @returns {Promise<object>} - MCP tool response
 */
async function handleGetThreadReplies(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Validate required parameters
    if (!args.channel) {
      throw new Error('channel parameter is required');
    }

    if (!args.thread_ts) {
      throw new Error('thread_ts parameter is required');
    }

    // Parse parameters
    const channel = args.channel;
    const threadTs = args.thread_ts;

    // Build request parameters
    const params = {
      channel: channel,
      ts: threadTs,
      limit: config.DEFAULT_THREAD_LIMIT
    };

    // Call Slack API
    const response = await callSlackAPI(accessToken, 'conversations.replies', params);

    // Format response
    const messages = response.messages || [];

    if (messages.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No messages found in thread ${threadTs} in channel ${channel}`
        }]
      };
    }

    // First message is the parent
    const parentMessage = messages[0];
    const replies = messages.slice(1);

    // Format parent message
    const parentTimestamp = new Date(parseFloat(parentMessage.ts) * 1000).toLocaleString();
    const parentText = `**Thread Parent:**\n[${parentTimestamp}] <@${parentMessage.user}>\n${parentMessage.text}\n`;

    // Format replies
    let repliesText = '';
    if (replies.length > 0) {
      repliesText = `\n**Replies (${replies.length}):**\n\n` +
        replies.map(msg => {
          const timestamp = new Date(parseFloat(msg.ts) * 1000).toLocaleString();
          return `[${timestamp}] <@${msg.user}>\n  ${msg.text}`;
        }).join('\n\n');
    } else {
      repliesText = '\n*No replies yet*';
    }

    const text = `Thread in ${channel}:\n\n${parentText}${repliesText}`;

    return {
      content: [{
        type: "text",
        text: text
      }]
    };
  } catch (error) {
    console.error('Error getting thread replies:', error);
    return {
      content: [{
        type: "text",
        text: `Error getting thread replies: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleGetThreadReplies;
