/**
 * Slack Canvases Module
 *
 * Provides canvas-related tools for the Slack service.
 */

const handleReadCanvas = require('./read');
const handleSearchCanvases = require('./search');

// Tool definitions
const canvasesTools = [
  {
    name: "read-canvas",
    description: "Retrieve the content of a specific Slack canvas by its ID. Returns the canvas title, metadata, and full content.",
    inputSchema: {
      type: "object",
      properties: {
        canvas_id: {
          type: "string",
          description: "The ID of the canvas to read (e.g., 'F1234567890')"
        }
      },
      required: ["canvas_id"]
    },
    handler: handleReadCanvas
  },
  {
    name: "search-canvases",
    description: "Search for Slack canvases using keywords. Helps find canvases by title, content, or related terms.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find canvases (e.g., 'Weekly 1:1', 'meeting notes')"
        },
        count: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 20)"
        }
      },
      required: []
    },
    handler: handleSearchCanvases
  }
];

module.exports = {
  canvasesTools,
  handleReadCanvas,
  handleSearchCanvases
};
