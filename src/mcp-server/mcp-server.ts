/**
 * MCP Server Implementation
 *
 * Implements Model Context Protocol server with Streamable HTTP transport.
 * Handles tool discovery, tool execution, and error responses.
 * Uses per-session server instances to support reconnections.
 */

import * as http from 'http';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ServiceRegistry } from '../common/service-registry';
import { logger, generateCorrelationId, globalConfig } from '../common';
import {
  ToolNotFoundError,
  ToolValidationError,
  ToolExecutionError,
  AuthenticationRequiredError,
  ToolTimeoutError,
  mapErrorToJSONRPC,
} from './error-mapper';

/**
 * MCP Server class
 */
export class MCPServer {
  private readonly transport: StreamableHTTPServerTransport;
  private readonly serviceRegistry: ServiceRegistry;
  private readonly timeout: number;
  private readonly logToolInput: boolean;
  private readonly sessions: Map<string, Server>;

  constructor(serviceRegistry: ServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
    this.sessions = new Map();

    // Configuration
    this.timeout = parseInt(process.env['MCP_TIMEOUT'] ?? '30000', 10);
    this.logToolInput = process.env['MCP_LOG_TOOL_INPUT'] === 'true';

    // Create Streamable HTTP transport with per-session server creation
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    logger.info({
      operation: 'mcp_server_init',
      timeout: this.timeout,
      logToolInput: this.logToolInput,
      msg: 'MCP server initialized with per-session Streamable HTTP transport',
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    try {
      // Create a server instance for the transport
      // This will be the default server, but sessions can create their own
      const server = this.createServer();

      // Setup handlers for this server
      this.setupHandlers(server);

      // Connect transport
      await server.connect(this.transport);

      logger.info({
        operation: 'mcp_server_started',
        serviceCount: this.serviceRegistry.list().length,
        msg: 'MCP server started with Streamable HTTP transport',
      });
    } catch (error) {
      logger.error({
        operation: 'mcp_server_start_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to start MCP server',
      });
      throw error;
    }
  }

  /**
   * Create a new Server instance
   */
  private createServer(): Server {
    return new Server(
      {
        name: globalConfig.serverName,
        version: globalConfig.serverVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  /**
   * Handle HTTP request (GET for SSE or POST for messages)
   * This method handles both SSE connections and message posts
   */
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      logger.info({
        operation: 'mcp_http_request',
        method: req.method,
        url: req.url,
        msg: `MCP HTTP request: ${req.method ?? 'GET'} ${req.url ?? '/'}`,
      });

      // Delegate to the Streamable HTTP transport
      await this.transport.handleRequest(req, res);
    } catch (error) {
      logger.error({
        operation: 'mcp_http_request_error',
        method: req.method,
        url: req.url,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Error handling MCP HTTP request',
      });

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      logger.info({
        operation: 'mcp_server_shutdown',
        msg: 'Shutting down MCP server',
      });

      // Close all active sessions
      const closures = Array.from(this.sessions.values()).map((server) => server.close());
      await Promise.all(closures);
      this.sessions.clear();

      logger.info({
        operation: 'mcp_server_stopped',
        msg: 'MCP server stopped',
      });
    } catch (error) {
      logger.error({
        operation: 'mcp_server_stop_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Error stopping MCP server',
      });
      throw error;
    }
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(server: Server): void {
    // Tools list handler
    // eslint-disable-next-line @typescript-eslint/require-await
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const correlationId = generateCorrelationId();

      logger.info({
        operation: 'mcp_tools_list',
        correlationId,
        msg: 'Received tools/list request',
      });

      try {
        const tools = this.serviceRegistry.getAllTools();

        logger.info({
          operation: 'mcp_tools_list_success',
          correlationId,
          toolCount: tools.length,
          msg: `Returning ${tools.length} tool(s)`,
        });

        return {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };
      } catch (error) {
        logger.error({
          operation: 'mcp_tools_list_error',
          correlationId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Error listing tools',
        });

        throw mapErrorToJSONRPC(error, correlationId);
      }
    });

    // Tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const correlationId = generateCorrelationId();
      const toolName = request.params.name;
      const toolInput = request.params.arguments ?? {};

      logger.info({
        operation: 'mcp_tool_call',
        correlationId,
        toolName,
        ...(this.logToolInput && { input: toolInput }),
        msg: `Tool call: ${toolName}`,
      });

      const startTime = Date.now();

      try {
        // Parse namespaced tool name
        const parts = toolName.split('.');
        if (parts.length < 2) {
          throw new ToolNotFoundError(
            toolName,
            this.serviceRegistry.getAllTools().map((t) => t.name),
            correlationId
          );
        }

        const serviceName = parts[0];
        const actualToolName = parts.slice(1).join('.');

        // Get service
        const service = this.serviceRegistry.get(serviceName ?? '');
        if (!service) {
          throw new ToolNotFoundError(
            toolName,
            this.serviceRegistry.getAllTools().map((t) => t.name),
            correlationId
          );
        }

        // Check authentication
        const isAuthenticated = await service.isAuthenticated();
        if (!isAuthenticated) {
          const authUrl = `http://localhost:${globalConfig.authServerPort}/auth/${serviceName}/login`;
          throw new AuthenticationRequiredError(serviceName ?? '', authUrl, correlationId);
        }

        // Find tool
        const tools = service.getTools();
        const tool = tools.find((t) => t.name === actualToolName);
        if (!tool) {
          throw new ToolNotFoundError(
            toolName,
            this.serviceRegistry.getAllTools().map((t) => t.name),
            correlationId
          );
        }

        // Execute tool with timeout
        const result = await this.executeToolWithTimeout(
          tool.handler,
          toolInput,
          toolName,
          correlationId
        );

        const executionTime = Date.now() - startTime;

        logger.info({
          operation: 'mcp_tool_call_success',
          correlationId,
          toolName,
          executionTimeMs: executionTime,
          msg: `Tool call successful: ${toolName}`,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;

        logger.error({
          operation: 'mcp_tool_call_error',
          correlationId,
          toolName,
          executionTimeMs: executionTime,
          error: error instanceof Error ? error.message : String(error),
          msg: `Tool call failed: ${toolName}`,
        });

        // Wrap non-MCP errors
        if (
          !(error instanceof ToolNotFoundError) &&
          !(error instanceof ToolValidationError) &&
          !(error instanceof ToolExecutionError) &&
          !(error instanceof AuthenticationRequiredError) &&
          !(error instanceof ToolTimeoutError)
        ) {
          const wrappedError = new ToolExecutionError(
            toolName,
            error instanceof Error ? error : new Error(String(error)),
            correlationId
          );
          throw mapErrorToJSONRPC(wrappedError, correlationId);
        }

        throw mapErrorToJSONRPC(error, correlationId);
      }
    });
  }

  /**
   * Execute tool handler with timeout
   */
  private async executeToolWithTimeout(
    handler: (input: Record<string, unknown>) => Promise<unknown>,
    input: Record<string, unknown>,
    toolName: string,
    correlationId: string
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new ToolTimeoutError(toolName, this.timeout, correlationId));
      }, this.timeout);

      handler(input)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
}
