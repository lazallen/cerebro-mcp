/**
 * Service Registry Implementation
 *
 * Manages registration and lifecycle of services.
 * Services are registered conditionally based on environment variables.
 */

import { BaseService, ServiceRegistry as IServiceRegistry } from '../types/service';
import { Tool } from '../types/tool';
import { logger } from '../common';

/**
 * Service registry implementation
 */
export class ServiceRegistry implements IServiceRegistry {
  public readonly services: Map<string, BaseService>;

  constructor() {
    this.services = new Map();
  }

  /**
   * Register a new service
   * @param service Service instance to register
   * @throws Error if service with same name already exists
   */
  async register(service: BaseService): Promise<void> {
    if (this.services.has(service.name)) {
      throw new Error(`Service '${service.name}' is already registered`);
    }

    logger.info({
      operation: 'service_register_start',
      service: service.name,
      msg: `Registering service: ${service.config.displayName}`,
    });

    try {
      // Initialize the service
      await service.initialize();

      // Store in registry
      this.services.set(service.name, service);

      logger.info({
        operation: 'service_registered',
        service: service.name,
        displayName: service.config.displayName,
        toolCount: service.getTools().length,
        msg: `Service registered successfully: ${service.config.displayName}`,
      });
    } catch (error) {
      logger.error({
        operation: 'service_register_error',
        service: service.name,
        error: error instanceof Error ? error.message : String(error),
        msg: `Failed to register service: ${service.name}`,
      });
      throw error;
    }
  }

  /**
   * Get a service by name
   * @param name Service name
   * @returns Service instance or undefined if not found
   */
  get(name: string): BaseService | undefined {
    return this.services.get(name);
  }

  /**
   * List all registered service names
   * @returns Array of service names
   */
  list(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get all tools from all services with namespace prefixing
   * @returns Array of tools with names like "service.toolname"
   */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];

    for (const [serviceName, service] of this.services.entries()) {
      try {
        const serviceTools = service.getTools();

        // Namespace each tool with service name
        for (const tool of serviceTools) {
          tools.push({
            ...tool,
            name: `${serviceName}.${tool.name}`,
          });
        }
      } catch (error) {
        logger.error({
          operation: 'get_tools_error',
          service: serviceName,
          error: error instanceof Error ? error.message : String(error),
          msg: `Error getting tools from service: ${serviceName}`,
        });
        // Continue with other services even if one fails
      }
    }

    return tools;
  }

  /**
   * Shutdown all services
   */
  async shutdownAll(): Promise<void> {
    logger.info({
      operation: 'shutdown_all_services',
      serviceCount: this.services.size,
      msg: 'Shutting down all services',
    });

    const shutdownPromises: Promise<void>[] = [];

    for (const [name, service] of this.services.entries()) {
      shutdownPromises.push(
        service.shutdown().catch((error) => {
          logger.error({
            operation: 'service_shutdown_error',
            service: name,
            error: error instanceof Error ? error.message : String(error),
            msg: `Error shutting down service: ${name}`,
          });
        })
      );
    }

    await Promise.all(shutdownPromises);

    logger.info({
      operation: 'all_services_shutdown',
      msg: 'All services shut down',
    });
  }
}
