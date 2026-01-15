/**
 * Cerebro MCP TypeScript Server
 *
 * Main entry point for the MCP server.
 */

import { logger, globalConfig, ServiceRegistry } from './common';
import { OAuthServer } from './auth-server';
import { MCPServer } from './mcp-server';
import { registerServices } from './mcp-server/service-registration';

let oauthServer: OAuthServer | undefined;
let mcpServer: MCPServer | undefined;
const serviceRegistry = new ServiceRegistry();

async function main(): Promise<void> {
  logger.info(
    {
      operation: 'server_start',
      version: globalConfig.serverVersion,
      nodeVersion: process.version,
    },
    `Starting ${globalConfig.serverName} v${globalConfig.serverVersion}`
  );

  try {
    // 1. Initialize service registry and register available services
    await registerServices(serviceRegistry);

    // 2. Start OAuth authentication server (port 3333)
    oauthServer = new OAuthServer();
    logger.info({
      operation: 'oauth_server_init',
      msg: 'OAuth server initialized',
    });
    await oauthServer.start();

    // 3. Start MCP server (stdio transport)
    mcpServer = new MCPServer(serviceRegistry);
    await mcpServer.start();

    logger.info({
      operation: 'server_ready',
      oauthPort: globalConfig.authServerPort,
      servicesCount: serviceRegistry.list().length,
      msg: 'Server ready. OAuth server and MCP server running.',
    });
  } catch (error) {
    logger.error({
      operation: 'server_start_error',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to start server',
    });
    throw error;
  }
}

// Graceful shutdown handler
async function shutdown(): Promise<void> {
  logger.info({ operation: 'shutdown', msg: 'Shutting down server...' });

  // Stop MCP server first (close stdio transport)
  if (mcpServer) {
    try {
      await mcpServer.stop();
    } catch (error) {
      logger.error({
        operation: 'mcp_shutdown_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Stop OAuth server
  if (oauthServer) {
    try {
      await oauthServer.stop();
    } catch (error) {
      logger.error({
        operation: 'oauth_shutdown_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Shutdown all services
  try {
    await serviceRegistry.shutdownAll();
  } catch (error) {
    logger.error({
      operation: 'service_shutdown_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info({ operation: 'shutdown_complete', msg: 'Server shutdown complete' });
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

// Run main function
main().catch((error) => {
  logger.error(
    {
      operation: 'server_start_error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    'Failed to start server'
  );
  process.exit(1);
});
