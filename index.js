#!/usr/bin/env node
/**
 * Cerebro MCP Server - Multi-Service Entry Point
 *
 * A Model Context Protocol server that provides access to multiple
 * productivity services (Microsoft 365, Slack, etc.) through a unified interface.
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const config = require('./config');

// Load available services
const services = {};

// Try to load Microsoft service
try {
  const microsoftService = require('./services/microsoft');
  services.microsoft = microsoftService;
  console.error(`✓ Loaded service: ${microsoftService.displayName}`);
} catch (error) {
  console.error(`ℹ Microsoft service not available: ${error.message}`);
}

// Try to load Slack service
try {
  const slackService = require('./services/slack');
  services.slack = slackService;
  console.error(`✓ Loaded service: ${slackService.displayName}`);
} catch (error) {
  console.error(`ℹ Slack service not available: ${error.message}`);
}

// Log startup information
console.error(`STARTING ${config.SERVER_NAME.toUpperCase()} v${config.SERVER_VERSION}`);
console.error(`Test mode is ${config.USE_TEST_MODE ? 'enabled' : 'disabled'}`);
console.error(`Loaded ${Object.keys(services).length} service(s): ${Object.keys(services).join(', ')}`);

/**
 * Transform service tools to add namespace prefix
 * @param {string} serviceName - Service name (e.g., 'microsoft', 'slack')
 * @param {Array} tools - Array of tool definitions
 * @returns {Array} - Tools with namespaced names
 */
function namespaceTools(serviceName, tools) {
  return tools.map(tool => ({
    ...tool,
    name: `${serviceName}.${tool.name}`,
    originalName: tool.name // Keep original name for reference
  }));
}

// Combine all tools from all services with namespaces
const TOOLS = [];
const SERVICE_TOOL_MAP = {}; // Maps namespaced tool names to {service, originalName}

for (const [serviceName, service] of Object.entries(services)) {
  const namespacedTools = namespaceTools(serviceName, service.tools);
  TOOLS.push(...namespacedTools);

  // Build mapping for faster lookup
  namespacedTools.forEach(tool => {
    SERVICE_TOOL_MAP[tool.name] = {
      service: serviceName,
      originalName: tool.originalName,
      handler: tool.handler
    };
  });
}

console.error(`Total tools registered: ${TOOLS.length}`);

// Create server with tools capabilities
const server = new Server(
  {
    name: config.SERVER_NAME,
    version: config.SERVER_VERSION
  },
  {
    capabilities: {
      tools: TOOLS.reduce((acc, tool) => {
        acc[tool.name] = {};
        return acc;
      }, {})
    }
  }
);

// Handle all requests
server.fallbackRequestHandler = async (request) => {
  try {
    const { method, params, id } = request;
    console.error(`REQUEST: ${method} [${id}]`);

    // Initialize handler
    if (method === "initialize") {
      console.error(`INITIALIZE REQUEST: ID [${id}]`);
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: TOOLS.reduce((acc, tool) => {
            acc[tool.name] = {};
            return acc;
          }, {})
        },
        serverInfo: {
          name: config.SERVER_NAME,
          version: config.SERVER_VERSION,
          description: config.SERVER_DESCRIPTION
        }
      };
    }

    // Tools list handler
    if (method === "tools/list") {
      console.error(`TOOLS LIST REQUEST: ID [${id}]`);
      console.error(`TOOLS COUNT: ${TOOLS.length}`);
      console.error(`TOOLS NAMES: ${TOOLS.map(t => t.name).join(', ')}`);

      return {
        tools: TOOLS.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
    }

    // Required empty responses for other capabilities
    if (method === "resources/list") return { resources: [] };
    if (method === "prompts/list") return { prompts: [] };

    // Tool call handler
    if (method === "tools/call") {
      try {
        const { name, arguments: args = {} } = params || {};

        console.error(`TOOL CALL: ${name}`);

        // Look up the tool in the service map
        const toolInfo = SERVICE_TOOL_MAP[name];

        if (!toolInfo) {
          // Tool not found
          return {
            error: {
              code: -32601,
              message: `Tool not found: ${name}`
            }
          };
        }

        // Execute the tool handler
        if (toolInfo.handler) {
          console.error(`Executing ${toolInfo.service}.${toolInfo.originalName}`);
          return await toolInfo.handler(args);
        }

        // Handler not found (should not happen)
        return {
          error: {
            code: -32603,
            message: `Tool handler not found: ${name}`
          }
        };
      } catch (error) {
        console.error(`Error in tools/call:`, error);
        return {
          error: {
            code: -32603,
            message: `Error processing tool call: ${error.message}`
          }
        };
      }
    }

    // For any other method, return method not found
    return {
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    };
  } catch (error) {
    console.error(`Error in fallbackRequestHandler:`, error);
    return {
      error: {
        code: -32603,
        message: `Error processing request: ${error.message}`
      }
    };
  }
};

// Handle termination signals
process.on('SIGTERM', () => {
  console.error('SIGTERM received but staying alive');
});

// Start the server
const transport = new StdioServerTransport();
server.connect(transport)
  .then(() => console.error(`${config.SERVER_NAME} connected and listening`))
  .catch(error => {
    console.error(`Connection error: ${error.message}`);
    process.exit(1);
  });
