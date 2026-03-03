/**
 * Cerebro MCP TypeScript Server
 *
 * Main entry point for the MCP server.
 */

import * as http from 'http';
import * as path from 'path';
import { logger, globalConfig, ServiceRegistry } from './common';
import { OAuthServer } from './auth-server';
import { MCPServer } from './mcp-server';
import { HealthCheckHandler } from './mcp-server/health-check';
import { registerServices } from './mcp-server/service-registration';
import { HeartbeatService } from './services/heartbeat/heartbeat-service';
import type { BaseService } from './types/service';
import type { BaseTokenStorage } from './common/base-token-storage';

let oauthServer: OAuthServer | undefined;
let mcpServer: MCPServer | undefined;
let mcpHttpServer: http.Server | undefined;
let healthCheckHandler: HealthCheckHandler | undefined;
let heartbeatService: HeartbeatService | undefined;
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

    // 2. Create MCP server (without transport - will use HTTP)
    mcpServer = new MCPServer(serviceRegistry);
    await mcpServer.start();

    // 3. Create health check handler
    healthCheckHandler = new HealthCheckHandler(
      serviceRegistry,
      globalConfig.serverName,
      globalConfig.serverVersion
    );

    // 4. Start OAuth authentication server (unified HTTP server on port 3333)
    oauthServer = new OAuthServer();

    // Register MCP server with OAuth server for unified routing
    oauthServer.registerMCPServer(mcpServer);

    // Register Triage Review UI at /triage (pass MS service for meeting-invite calendar responses)
    // Cast is safe: MicrosoftService implements CalendarResponder (has respondToMeetingInviteEmail)
    oauthServer.registerTriageRouter(
      process.env['SYSTEM_DIR'] ?? './system',
      process.env['ROOT_DIR'] ?? './context',
      serviceRegistry.get('microsoft') as unknown as import('./auth-server/triage-router').CalendarResponder | undefined
    );

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
      msg: 'Unified HTTP server initialized (OAuth + MCP)',
    });
    await oauthServer.start();

    // 5. Start standalone MCP HTTP server on separate port with health checks
    mcpHttpServer = http.createServer(async (req, res) => {
      try {
        const urlPath = req.url || '/';

        // Handle health check requests
        if (healthCheckHandler && HealthCheckHandler.isHealthCheckRequest(urlPath)) {
          await healthCheckHandler.handleHealthCheck(req, res);
          return;
        }

        // Handle MCP requests
        if (!mcpServer) {
          logger.error({ operation: 'mcp_http_request_error', msg: 'MCP server not initialized' });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'MCP Server Not Initialized' }));
          return;
        }

        await mcpServer.handleRequest(req, res);
      } catch (error) {
        logger.error({
          operation: 'mcp_http_request_error',
          error: error instanceof Error ? error.message : String(error),
          msg: 'Error handling MCP HTTP request',
        });

        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      }
    });

    // Configure server keep-alive settings for better connection stability
    mcpHttpServer.keepAliveTimeout = 65000; // 65 seconds
    mcpHttpServer.headersTimeout = 66000; // 66 seconds (slightly higher than keepAlive)

    // Start listening on MCP port with connection tracking
    await new Promise<void>((resolve, reject) => {
      // Track active connections for better management
      const connections = new Set<any>();

      mcpHttpServer!.on('connection', (socket) => {
        connections.add(socket);
        socket.on('close', () => connections.delete(socket));

        // Set keep-alive on individual connections
        socket.setKeepAlive(true, 60000);
        socket.setTimeout(120000); // 2 minute socket timeout
      });

      mcpHttpServer!.listen(globalConfig.mcpServerPort, 'localhost', () => {
        logger.info({
          operation: 'mcp_http_server_started',
          port: globalConfig.mcpServerPort,
          protocol: 'http',
          endpoint: `http://localhost:${globalConfig.mcpServerPort}/mcp`,
          healthEndpoint: `http://localhost:${globalConfig.mcpServerPort}/health`,
          msg: `MCP HTTP server listening on http://localhost:${globalConfig.mcpServerPort}`,
        });
        resolve();
      });

      mcpHttpServer!.on('error', (error) => {
        logger.error({
          operation: 'mcp_http_server_error',
          port: globalConfig.mcpServerPort,
          error: error.message,
          msg: 'MCP HTTP server error',
        });
        reject(error);
      });

      // Log connection events for debugging
      mcpHttpServer!.on('listening', () => {
        logger.info({
          operation: 'mcp_http_server_listening',
          port: globalConfig.mcpServerPort,
          msg: 'MCP HTTP server is now listening',
        });
      });

      mcpHttpServer!.on('close', () => {
        logger.info({
          operation: 'mcp_http_server_closed',
          msg: 'MCP HTTP server closed',
        });
      });
    });

    // Determine OAuth protocol
    const protocol = oauthServer['protocol'] || 'http';

    // 6. Start heartbeat service if configured
    const heartbeatConfigPath = process.env.HEARTBEAT_CONFIG_FILE;
    if (heartbeatConfigPath) {
      try {
        const absolutePath = path.isAbsolute(heartbeatConfigPath)
          ? heartbeatConfigPath
          : path.resolve(process.cwd(), heartbeatConfigPath);

        logger.info({
          operation: 'heartbeat_init',
          configPath: absolutePath,
          msg: 'Initializing heartbeat service',
        });

        // Get Microsoft and LocalFoundry services for task dependencies
        const microsoftService = serviceRegistry.get('microsoft');
        const localFoundryService = serviceRegistry.get('local');

        heartbeatService = new HeartbeatService(absolutePath, {
          graphClient: microsoftService,
          lfClient: localFoundryService,
          microsoftService: microsoftService,
          rootDir: process.env.ROOT_DIR || './context',
        });

        await heartbeatService.start();

        logger.info({
          operation: 'heartbeat_started',
          msg: 'Heartbeat service started successfully',
        });
      } catch (error) {
        // Don't fail server startup if heartbeat fails
        logger.warn({
          operation: 'heartbeat_start_error',
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to start heartbeat service - continuing without it',
        });
      }
    } else {
      logger.info({
        operation: 'heartbeat_disabled',
        msg: 'Heartbeat service not configured (HEARTBEAT_CONFIG_FILE not set)',
      });
    }

    logger.info({
      operation: 'servers_ready',
      oauthPort: globalConfig.authServerPort,
      oauthProtocol: protocol,
      oauthDashboard: `${protocol}://localhost:${globalConfig.authServerPort}/`,
      oauthMcpEndpoint: `${protocol}://localhost:${globalConfig.authServerPort}/mcp`,
      mcpPort: globalConfig.mcpServerPort,
      mcpProtocol: 'http',
      mcpEndpoint: `http://localhost:${globalConfig.mcpServerPort}/mcp`,
      servicesCount: serviceRegistry.list().length,
      heartbeatEnabled: !!heartbeatService,
      msg: 'All servers ready. OAuth (HTTPS) on :3333, MCP (HTTP) on :3334',
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
  logger.info({ operation: 'shutdown', msg: 'Shutting down servers...' });

  // Stop MCP server
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

  // Stop MCP HTTP server
  if (mcpHttpServer) {
    try {
      // Track active connections to force close them on shutdown
      const connections = new Set<any>();
      mcpHttpServer.on('connection', (conn) => {
        connections.add(conn);
        conn.on('close', () => connections.delete(conn));
      });

      await new Promise<void>((resolve, reject) => {
        // Set a timeout to force exit if server doesn't close
        const shutdownTimeout = setTimeout(() => {
          logger.warn({
            operation: 'mcp_http_shutdown_timeout',
            msg: 'MCP HTTP server close timeout - forcing connection closure',
          });
          // Force close all connections
          connections.forEach((conn) => conn.destroy());
          resolve();
        }, 5000); // 5 second timeout

        mcpHttpServer!.close((error) => {
          clearTimeout(shutdownTimeout);
          if (error) {
            logger.error({
              operation: 'mcp_http_shutdown_error',
              error: error.message,
            });
            reject(error);
          } else {
            logger.info({
              operation: 'mcp_http_server_stopped',
              msg: 'MCP HTTP server stopped',
            });
            resolve();
          }
        });

        // Force close all active connections immediately for faster shutdown
        connections.forEach((conn) => conn.destroy());
      });
    } catch (error) {
      logger.error({
        operation: 'mcp_http_shutdown_error',
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

  // Stop heartbeat service
  if (heartbeatService) {
    try {
      await heartbeatService.stop();
      logger.info({
        operation: 'heartbeat_stopped',
        msg: 'Heartbeat service stopped',
      });
    } catch (error) {
      logger.error({
        operation: 'heartbeat_shutdown_error',
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

  logger.info({ operation: 'shutdown_complete', msg: 'All servers shutdown complete' });
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
