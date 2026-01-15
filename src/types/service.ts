/**
 * Service configuration types
 *
 * Defines structures for service configuration and lifecycle management.
 */

import { Tool } from './tool';

/**
 * OAuth configuration for a service
 */
export interface OAuthConfig {
  /** OAuth client ID */
  clientId: string;

  /** OAuth client secret */
  clientSecret: string;

  /** OAuth redirect URI (callback URL) */
  redirectUri: string;

  /** OAuth scopes to request */
  scopes: string[];

  /** OAuth authorization endpoint */
  authEndpoint: string;

  /** OAuth token endpoint */
  tokenEndpoint: string;

  /** OAuth tenant ID (for Microsoft) */
  tenantId?: string;

  /** User scopes (for Slack) */
  userScopes?: string[];
}

/**
 * Service configuration
 */
export interface ServiceConfig {
  /** Service name (e.g., "microsoft", "slack") */
  name: string;

  /** Human-readable service display name */
  displayName: string;

  /** API base endpoint */
  apiEndpoint: string;

  /** OAuth configuration */
  oauth: OAuthConfig;

  /** Token storage path */
  tokenStorePath: string;

  /** Default request timeout in milliseconds */
  timeout?: number;

  /** Additional service-specific configuration */
  metadata?: Record<string, unknown>;
}

/**
 * Service lifecycle interface
 * All services must implement this interface
 */
export interface BaseService {
  /** Service configuration */
  readonly config: ServiceConfig;

  /** Service name */
  readonly name: string;

  /**
   * Initialize the service
   * Called when service is loaded
   */
  initialize(): Promise<void>;

  /**
   * Get all tools provided by this service
   * @returns Array of tool definitions
   */
  getTools(): Tool[];

  /**
   * Check if service is authenticated
   * @returns true if service has valid tokens
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Shutdown the service
   * Called when server is shutting down
   */
  shutdown(): Promise<void>;
}

/**
 * Service registry for managing multiple services
 */
export interface ServiceRegistry {
  /** Map of service name to service instance */
  services: Map<string, BaseService>;

  /**
   * Register a new service
   * @param service Service instance to register
   * @throws Error if service with same name already exists
   */
  register(service: BaseService): Promise<void>;

  /**
   * Get a service by name
   * @param name Service name
   * @returns Service instance or undefined if not found
   */
  get(name: string): BaseService | undefined;

  /**
   * List all registered service names
   * @returns Array of service names
   */
  list(): string[];

  /**
   * Get all tools from all services with namespace prefixing
   * @returns Array of tools with names like "service.toolname"
   */
  getAllTools(): Tool[];

  /**
   * Shutdown all services
   */
  shutdownAll(): Promise<void>;
}
