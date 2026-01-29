/**
 * Health Check Handler
 *
 * Provides health check endpoints for monitoring and debugging MCP server connectivity.
 * Supports both simple ping and detailed status checks.
 */

import * as http from 'http';
import { logger } from '../common';
import type { ServiceRegistry } from '../common/service-registry';

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services?: {
    name: string;
    authenticated: boolean;
    toolCount: number;
  }[];
  version?: string;
  serverName?: string;
}

export class HealthCheckHandler {
  private readonly serviceRegistry: ServiceRegistry;
  private readonly startTime: number;
  private readonly serverName: string;
  private readonly serverVersion: string;

  constructor(
    serviceRegistry: ServiceRegistry,
    serverName: string,
    serverVersion: string
  ) {
    this.serviceRegistry = serviceRegistry;
    this.startTime = Date.now();
    this.serverName = serverName;
    this.serverVersion = serverVersion;
  }

  /**
   * Handle health check request
   */
  async handleHealthCheck(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const urlPath = req.url || '/';

    try {
      // Simple ping endpoint
      if (urlPath === '/health' || urlPath === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
          })
        );
        return;
      }

      // Detailed status endpoint
      if (urlPath === '/health/status') {
        const response = await this.getDetailedStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));
        return;
      }

      // Not a health check endpoint
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (error) {
      logger.error({
        operation: 'health_check_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Health check failed',
      });

      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  /**
   * Get detailed server status
   */
  private async getDetailedStatus(): Promise<HealthCheckResponse> {
    const services = await Promise.all(
      this.serviceRegistry.list().map(async (serviceName) => {
        const service = this.serviceRegistry.get(serviceName);
        if (!service) {
          return {
            name: serviceName,
            authenticated: false,
            toolCount: 0,
          };
        }

        try {
          const authenticated = await service.isAuthenticated();
          const tools = service.getTools();
          return {
            name: serviceName,
            authenticated,
            toolCount: tools.length,
          };
        } catch (error) {
          logger.warn({
            operation: 'health_check_service_error',
            service: serviceName,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            name: serviceName,
            authenticated: false,
            toolCount: 0,
          };
        }
      })
    );

    // Determine overall health
    const authenticatedCount = services.filter((s) => s.authenticated).length;
    const status =
      authenticatedCount === 0
        ? 'degraded' // No services authenticated but server is running
        : authenticatedCount === services.length
          ? 'healthy' // All services authenticated
          : 'degraded'; // Some services authenticated

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      services,
      version: this.serverVersion,
      serverName: this.serverName,
    };
  }

  /**
   * Check if request is a health check
   */
  static isHealthCheckRequest(url: string): boolean {
    return (
      url === '/health' ||
      url === '/ping' ||
      url === '/health/status' ||
      url.startsWith('/health/')
    );
  }
}
