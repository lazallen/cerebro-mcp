/**
 * Cerebro MCP TypeScript Server
 *
 * Main entry point for the MCP server.
 * This is a placeholder - full MCP server implementation will come in future features.
 */

import { logger, globalConfig } from './common';

function main(): void {
  logger.info(
    {
      operation: 'server_start',
      version: globalConfig.serverVersion,
      nodeVersion: process.version,
    },
    `Starting ${globalConfig.serverName} v${globalConfig.serverVersion}`
  );

  logger.info('Foundation phase complete. MCP server implementation coming in future features.');
}

// Run main function
try {
  main();
} catch (error) {
  logger.error(
    { operation: 'server_start', error: error instanceof Error ? error : String(error) },
    'Failed to start server'
  );
  process.exit(1);
}
