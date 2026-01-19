/**
 * Cerebro MCP TypeScript Server
 *
 * Main entry point for the MCP server.
 */

import { logger, globalConfig, ServiceRegistry } from './common';
import { OAuthServer } from './auth-server';
import { MCPServer } from './mcp-server';
import { registerServices } from './mcp-server/service-registration';
import type { BaseService } from './types/service';
import type { BaseTokenStorage } from './common/base-token-storage';

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

    // Register services with OAuth server for authentication
    for (const [serviceName, service] of serviceRegistry.services.entries()) {
      // Get token storage - we need to cast to access it
      const serviceWithTokenStorage = service as BaseService & {
        tokenStorage?: BaseTokenStorage;
        getAuthorizationUrl?: () => string;
      };

      // Only register if service has token storage (authentication capability)
      if (serviceWithTokenStorage.tokenStorage && serviceWithTokenStorage.getAuthorizationUrl) {
        oauthServer.registerService(serviceName, {
          name: service.config.displayName,
          config: service.config,
          tokenStorage: serviceWithTokenStorage.tokenStorage,
        });

        logger.info({
          operation: 'oauth_service_registered',
          service: serviceName,
          msg: `Service registered with OAuth server: ${service.config.displayName}`,
        });
      }
    }

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
