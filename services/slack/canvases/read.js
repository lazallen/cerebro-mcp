/**
 * Read Canvas Handler
 *
 * Retrieves the content of a specific canvas by its ID.
 * Uses the canvases.edit method to read canvas content.
 */

const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Handle slack.read-canvas tool
 * @param {object} args - Tool arguments
 * @param {string} args.canvas_id - The ID of the canvas to read
 * @returns {Promise<object>} - MCP tool response
 */
async function handleReadCanvas(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Validate required parameters
    if (!args.canvas_id) {
      throw new Error('canvas_id is required');
    }

    // Call Slack API to get canvas content
    const response = await callSlackAPI(
      accessToken,
      'canvases.edit',
      {
        canvas_id: args.canvas_id
      }
    );

    // Extract canvas data
    const canvas = response.canvas;

    if (!canvas) {
      throw new Error('Canvas not found');
    }

    // Format the response with canvas details
    let text = `Canvas: ${canvas.title || 'Untitled'}\n`;
    text += `Canvas ID: ${canvas.id}\n`;
    text += `Owner: ${canvas.owner || 'Unknown'}\n`;

    if (canvas.created) {
      text += `Created: ${new Date(canvas.created * 1000).toLocaleString()}\n`;
    }

    if (canvas.updated) {
      text += `Last Updated: ${new Date(canvas.updated * 1000).toLocaleString()}\n`;
    }

    text += `\n---\n\n`;

    // Add canvas content
    if (canvas.content) {
      text += `Content:\n${canvas.content}`;
    } else if (canvas.markdown) {
      text += `Content:\n${canvas.markdown}`;
    } else {
      text += 'No content available';
    }

    return {
      content: [{
        type: "text",
        text: text
      }]
    };
  } catch (error) {
    console.error('Error reading Slack canvas:', error);
    return {
      content: [{
        type: "text",
        text: `Error reading canvas: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleReadCanvas;
