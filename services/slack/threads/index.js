/**
 * Threads Module
 *
 * Exports all thread-related tools.
 */

const handleGetThreadReplies = require('./replies');

const threadsTools = [
  {
    name: "get-thread-replies",
    description: "Fetch all replies within a specific Slack thread. Shows the parent message and all responses in chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID where the thread is located (e.g., 'C12345678')"
        },
        thread_ts: {
          type: "string",
          description: "Thread timestamp - the 'ts' value of the parent message (e.g., '1234567890.123456'). Found in channel history messages that have reply_count > 0."
        }
      },
      required: ["channel", "thread_ts"]
    },
    handler: handleGetThreadReplies
  }
];

module.exports = {
  threadsTools,
  handleGetThreadReplies
};
