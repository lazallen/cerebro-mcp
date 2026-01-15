/**
 * Cerebro MCP TypeScript Server
 *
 * Main entry point for the MCP server.
 */

import { logger, globalConfig } from './common';
import { OAuthServer } from './auth-server';

let oauthServer: OAuthServer | undefined;

async function main(): Promise<void> {
  logger.info(
    {
      operation: 'server_start',
      version: globalConfig.serverVersion,
      nodeVersion: process.version,
    },
    `Starting ${globalConfig.serverName} v${globalConfig.serverVersion}`
  );

  // Start OAuth authentication server
  try {
    oauthServer = new OAuthServer();

    // Note: Services will be registered dynamically in future features
    // For now, the server starts with no services configured
    logger.info({
      operation: 'oauth_server_init',
      msg: 'OAuth server initialized. Services will be registered when service implementations are added.',
    });

    await oauthServer.start();

    logger.info({
      operation: 'server_ready',
      msg: 'Server ready. OAuth authentication server running.',
    });
  } catch (error) {
    logger.error({
      operation: 'oauth_server_start_error',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to start OAuth server',
    });
    throw error;
  }
}

// Graceful shutdown handler
async function shutdown(): Promise<void> {
  logger.info({ operation: 'shutdown', msg: 'Shutting down server...' });

  if (oauthServer) {
    try {
      await oauthServer.stop();
    } catch (error) {
      logger.error({
        operation: 'shutdown_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
