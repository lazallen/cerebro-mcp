/**
 * List Channels Handler
 *
 * Lists public channels in the Slack workspace with pagination support.
 */

const config = require('../config');
const { callSlackAPIPaginated } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Handle slack.list-channels tool
 * @param {object} args - Tool arguments
 * @param {number} args.limit - Maximum number of channels to return
 * @param {string} args.cursor - Pagination cursor
 * @returns {Promise<object>} - MCP tool response
 */
async function handleListChannels(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Parse parameters
    const limit = args.limit || config.DEFAULT_PAGE_SIZE;
    const cursor = args.cursor || null;

    // Build request parameters
    const params = {
      types: 'public_channel', // Only public channels
      exclude_archived: true,
      limit: Math.min(limit, config.MAX_PAGE_SIZE)
    };

    if (cursor) {
      params.cursor = cursor;
    }

    // Call Slack API with pagination
    const response = await callSlackAPIPaginated(
      accessToken,
      'conversations.list',
      params,
      limit
    );

    // Format response
    const channels = response.items || [];
    const channelList = channels.map(ch => ({
      id: ch.id,
      name: ch.name,
      is_private: ch.is_private || false,
      is_archived: ch.is_archived || false,
      num_members: ch.num_members || 0,
      topic: ch.topic?.value || '',
      purpose: ch.purpose?.value || ''
    }));

    const text = `Found ${channelList.length} channel(s):\n\n` +
      channelList.map(ch =>
        `• #${ch.name} (${ch.id})\n  Members: ${ch.num_members}\n  ${ch.topic || ch.purpose || 'No description'}`
      ).join('\n\n');

    return {
      content: [{
        type: "text",
        text: text
      }]
    };
  } catch (error) {
    console.error('Error listing Slack channels:', error);
    return {
      content: [{
        type: "text",
        text: `Error listing channels: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleListChannels;
