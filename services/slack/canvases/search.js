/**
 * Search Canvases Handler
 *
 * Searches for canvases using Slack search API.
 * Canvases can be found through search queries.
 */

const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');
const config = require('../config');

/**
 * Handle slack.search-canvases tool
 * @param {object} args - Tool arguments
 * @param {string} args.query - Search query to find canvases
 * @param {number} args.count - Maximum number of results to return (default: 10, max: 20)
 * @returns {Promise<object>} - MCP tool response
 */
async function handleSearchCanvases(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Parse parameters
    const query = args.query || '';
    const count = Math.min(args.count || 10, 20);

    // Use Slack's search.messages with a filter for canvases
    // We'll search for canvas_file_id or use the query directly
    const searchQuery = query ? `${query} canvas` : 'canvas';

    const response = await callSlackAPI(
      accessToken,
      'search.messages',
      {
        query: searchQuery,
        count: count,
        sort: 'timestamp',
        sort_dir: 'desc'
      }
    );

    // Extract canvas references from search results
    const messages = response.messages?.matches || [];
    const canvases = [];

    // Look for canvas file references in messages
    for (const message of messages) {
      if (message.files) {
        for (const file of message.files) {
          if (file.filetype === 'canvas' || file.subtype === 'canvas') {
            canvases.push({
              canvas_id: file.id,
              title: file.title || file.name || 'Untitled Canvas',
              permalink: file.permalink,
              created: file.created,
              updated: file.timestamp,
              channel: message.channel?.name || 'unknown'
            });
          }
        }
      }

      // Also check for canvas blocks in message content
      if (message.blocks) {
        for (const block of message.blocks) {
          if (block.type === 'file' && block.canvas_id) {
            canvases.push({
              canvas_id: block.canvas_id,
              title: block.title || 'Untitled Canvas',
              permalink: message.permalink,
              channel: message.channel?.name || 'unknown'
            });
          }
        }
      }
    }

    // Remove duplicates by canvas_id
    const uniqueCanvases = canvases.filter((canvas, index, self) =>
      index === self.findIndex((c) => c.canvas_id === canvas.canvas_id)
    );

    if (uniqueCanvases.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No canvases found matching query: "${query}"\n\nTip: Try searching for the canvas title or related keywords.`
        }]
      };
    }

    // Format response
    const text = `Found ${uniqueCanvases.length} canvas(es):\n\n` +
      uniqueCanvases.map(canvas =>
        `• ${canvas.title}\n  ID: ${canvas.canvas_id}\n  Channel: #${canvas.channel}\n  ${canvas.permalink || ''}`
      ).join('\n\n');

    return {
      content: [{
        type: "text",
        text: text
      }]
    };
  } catch (error) {
    console.error('Error searching Slack canvases:', error);
    return {
      content: [{
        type: "text",
        text: `Error searching canvases: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleSearchCanvases;
