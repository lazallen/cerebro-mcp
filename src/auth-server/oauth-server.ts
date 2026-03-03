/**
 * Unified OAuth Authentication Server
 *
 * Handles OAuth 2.0 authentication for multiple services (Microsoft, Slack, etc.)
 * Routes: /auth/:service/login, /auth/:service/callback
 * Supports both HTTP and HTTPS with automatic SSL certificate detection
 *
 * CRITICAL: Callback URLs are IMMUTABLE - OAuth apps already registered
 * - Microsoft: http://localhost:3333/auth/microsoft/callback
 * - Slack: http://localhost:3333/auth/slack/callback
 * - Port: 3333 (configurable via AUTH_SERVER_PORT but defaults to 3333)
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import * as querystring from 'querystring';
import { logger, globalConfig } from '../common';
import { ServiceConfig } from '../types/service';
import { BaseTokenStorage } from '../common/base-token-storage';
import { isTokenExpired } from '../types/token';
import type { MCPServer } from '../mcp-server';
import { SessionCredentialStorage } from '../services/slack-saved-items/session-credential-storage';
import { TriageRouter, CalendarResponder } from './triage-router';

/**
 * Service registration for auth server
 */
export interface AuthServiceRegistration {
  /** Service display name */
  name: string;

  /** Service configuration */
  config: ServiceConfig;

  /** Token storage instance */
  tokenStorage: BaseTokenStorage;
}

/**
 * Parsed service route from URL
 */
export interface ServiceRoute {
  /** Service name (e.g., 'microsoft', 'slack') */
  service: string;

  /** Action (e.g., 'login', 'callback') */
  action: string;
}

/**
 * Service authentication status for dashboard
 */
export interface ServiceStatus {
  /** Service name (e.g., 'microsoft', 'slack', 'local') */
  serviceName: string;

  /** Display name (e.g., 'Microsoft 365', 'Slack', 'LocalFoundry') */
  displayName: string;

  /** Login URL for this service (empty string for non-OAuth services) */
  loginUrl: string;

  /** Authentication state */
  state:
    | 'connected'
    | 'expired'
    | 'requires_auth'
    | 'error'
    | 'available'
    | 'unavailable'
    | 'not_configured';

  /** Status message */
  message: string;

  /** Token expiration timestamp (milliseconds since epoch) */
  expiresAt?: number;

  /** Granted OAuth scopes */
  scopes?: string[];

  /** Service endpoint URL (for non-OAuth services like LocalFoundry) */
  endpoint?: string;

  /** Model name (for LLM services like LocalFoundry) */
  model?: string;
}

/**
 * OAuth Authentication Server
 */
export class OAuthServer {
  private readonly port: number;
  private readonly services: Map<string, AuthServiceRegistration>;
  private server?: http.Server | https.Server;
  private readonly protocol: 'http' | 'https';
  private isRunning: boolean = false;
  private mcpServer?: MCPServer;
  private triageRouter?: TriageRouter;
  private readonly slackCredentialStorage: SessionCredentialStorage;

  constructor(port?: number) {
    this.port = port ?? globalConfig.authServerPort;
    this.services = new Map();
    this.slackCredentialStorage = new SessionCredentialStorage();

    // Detect SSL certificates for HTTPS
    this.protocol = this.detectSSLCertificates() ? 'https' : 'http';

    logger.info({
      operation: 'auth_server_init',
      port: this.port,
      protocol: this.protocol,
      msg: `Initializing OAuth server on ${this.protocol}://localhost:${this.port}`,
    });
  }

  /**
   * Detect if SSL certificates are available
   * @returns true if certificates exist and can be used
   */
  private detectSSLCertificates(): boolean {
    // Check if SSL is explicitly disabled via environment variable
    if (process.env['DISABLE_SSL'] === 'true' || process.env['USE_HTTP'] === 'true') {
      logger.info({
        operation: 'ssl_detection',
        msg: 'SSL disabled via environment variable - will use HTTP',
      });
      return false;
    }

    try {
      const certPath = path.join(process.cwd(), 'localhost+2.pem');
      const keyPath = path.join(process.cwd(), 'localhost+2-key.pem');

      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        logger.info({
          operation: 'ssl_detection',
          certPath,
          keyPath,
          msg: 'SSL certificates found - will use HTTPS',
        });
        return true;
      }

      logger.info({
        operation: 'ssl_detection',
        msg: 'SSL certificates not found - will use HTTP. To enable HTTPS: run "mkcert localhost 127.0.0.1 ::1"',
      });
      return false;
    } catch (error) {
      logger.warn({
        operation: 'ssl_detection',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Error detecting SSL certificates - falling back to HTTP',
      });
      return false;
    }
  }

  /**
   * Register a service with the auth server
   * @param serviceName Service name (must match OAuth callback URL)
   * @param registration Service registration
   */
  registerService(serviceName: string, registration: AuthServiceRegistration): void {
    if (this.services.has(serviceName)) {
      throw new Error(`Service '${serviceName}' is already registered`);
    }

    this.services.set(serviceName, registration);

    logger.info({
      operation: 'service_registered',
      service: serviceName,
      displayName: registration.name,
      redirectUri: registration.config.oauth.redirectUri,
      msg: `Registered service: ${registration.name}`,
    });
  }

  /**
   * Register MCP server for handling MCP protocol routes
   * @param mcpServer MCP server instance
   */
  registerMCPServer(mcpServer: MCPServer): void {
    this.mcpServer = mcpServer;
    logger.info({
      operation: 'mcp_server_registered',
      msg: 'MCP server registered with OAuth server for unified HTTP routing',
    });
  }

  /**
   * Register the Triage Review UI router.
   * @param systemDir Path to the system directory (e.g., './system')
   * @param contextDir Path to the context directory (e.g., './context')
   * @param calendarResponder Optional service for responding to meeting invites
   */
  registerTriageRouter(
    systemDir: string,
    contextDir: string,
    calendarResponder?: CalendarResponder
  ): void {
    this.triageRouter = new TriageRouter(systemDir, contextDir, calendarResponder);
    logger.info({
      operation: 'triage_router_registered',
      systemDir,
      contextDir,
      msg: 'Triage Review UI registered at /triage',
    });
  }

  /**
   * Parse service route from URL pathname
   * @param pathname URL pathname
   * @returns Parsed route or null if invalid
   */
  private parseServiceRoute(pathname: string): ServiceRoute | null {
    const match = pathname.match(/^\/auth\/([^/]+)\/([^/]+)$/);
    if (match) {
      return {
        service: match[1] ?? '',
        action: match[2] ?? '',
      };
    }
    return null;
  }

  /**
   * Start the OAuth server
   * @returns Promise that resolves when server is listening
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (this.protocol === 'https') {
          this.startHTTPSServer(resolve, reject);
        } else {
          this.startHTTPServer(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Start HTTP server
   */
  private startHTTPServer(resolve: () => void, reject: (error: Error) => void): void {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.on('error', (error) => {
      logger.error({
        operation: 'server_error',
        error: error.message,
        msg: 'HTTP server error',
      });
      reject(error);
    });

    this.server.listen(this.port, () => {
      this.isRunning = true;
      this.logServerStarted();
      resolve();
    });
  }

  /**
   * Start HTTPS server
   */
  private startHTTPSServer(resolve: () => void, reject: (error: Error) => void): void {
    try {
      const certPath = path.join(process.cwd(), 'localhost+2.pem');
      const keyPath = path.join(process.cwd(), 'localhost+2-key.pem');

      const options: https.ServerOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };

      this.server = https.createServer(options, (req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        logger.error({
          operation: 'server_error',
          error: error.message,
          msg: 'HTTPS server error',
        });
        reject(error);
      });

      this.server.listen(this.port, () => {
        this.isRunning = true;
        this.logServerStarted();
        resolve();
      });
    } catch (error) {
      logger.error({
        operation: 'https_startup_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to start HTTPS server',
      });
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Log server started message
   */
  private logServerStarted(): void {
    logger.info({
      operation: 'auth_server_started',
      protocol: this.protocol,
      port: this.port,
      servicesCount: this.services.size,
      msg: `OAuth server listening on ${this.protocol}://localhost:${this.port}`,
    });

    // Log service endpoints
    this.services.forEach((registration, serviceName) => {
      logger.info({
        operation: 'service_endpoint',
        service: serviceName,
        loginUrl: `${this.protocol}://localhost:${this.port}/auth/${serviceName}/login`,
        callbackUrl: `${this.protocol}://localhost:${this.port}/auth/${serviceName}/callback`,
        tokenPath: registration.config.tokenStorePath,
      });
    });

    if (this.services.size === 0) {
      logger.warn({
        operation: 'no_services',
        msg: 'No services registered - configure service credentials in environment variables',
      });
    }
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url ?? '/', true);
    const pathname = parsedUrl.pathname ?? '/';
    const query = parsedUrl.query;

    logger.debug({
      operation: 'request_received',
      method: req.method,
      pathname,
      msg: `${req.method ?? 'GET'} ${pathname}`,
    });

    try {
      // Handle Triage Review UI routes
      if (pathname === '/triage' || pathname.startsWith('/triage/')) {
        if (this.triageRouter) {
          await this.triageRouter.handleRequest(req, res, pathname);
        } else {
          this.renderError(res, 'Triage UI Not Available', 'Triage router not registered');
        }
        return;
      }

      // Handle MCP routes first
      if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
        if (!this.mcpServer) {
          this.renderError(res, 'MCP Not Available', 'MCP server not registered');
          return;
        }
        await this.mcpServer.handleRequest(req, res);
        return;
      }

      // Handle legacy routes for backward compatibility
      if (pathname === '/auth/callback') {
        await this.handleLegacyCallback(query, res);
        return;
      }

      if (pathname === '/auth') {
        this.handleLegacyLogin(query, res);
        return;
      }

      // Slack Saved Items credential management
      if (pathname === '/auth/slack-saved-items/credentials') {
        await this.handleSlackSavedItemsCredentials(req, res);
        return;
      }

      // Parse service route
      const route = this.parseServiceRoute(pathname);

      if (route) {
        const registration = this.services.get(route.service);

        if (!registration) {
          this.renderServiceNotFound(res, route.service);
          return;
        }

        // Handle actions
        if (route.action === 'login') {
          this.handleLogin(registration, query, res);
        } else if (route.action === 'callback') {
          await this.handleCallback(registration, query, res);
        } else {
          this.render404(res);
        }
      } else if (pathname === '/') {
        await this.renderHomePage(res);
      } else {
        this.render404(res);
      }
    } catch (error) {
      logger.error({
        operation: 'request_handler_error',
        pathname,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Error handling request',
      });

      this.renderError(
        res,
        'Internal Server Error',
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    }
  }

  /**
   * Handle legacy callback URL (backward compatibility)
   * Routes to Microsoft service
   */
  private async handleLegacyCallback(
    query: querystring.ParsedUrlQuery,
    res: http.ServerResponse
  ): Promise<void> {
    logger.warn({
      operation: 'legacy_callback',
      msg: 'Legacy callback URL /auth/callback accessed - please update to /auth/microsoft/callback',
    });

    const microsoftService = this.services.get('microsoft');
    if (microsoftService) {
      await this.handleCallback(microsoftService, query, res);
    } else {
      this.renderError(
        res,
        'Service Unavailable',
        'Legacy callback requires Microsoft service to be configured. Please update to /auth/microsoft/callback'
      );
    }
  }

  /**
   * Handle legacy login URL (backward compatibility)
   * Routes to Microsoft service
   */
  private handleLegacyLogin(query: querystring.ParsedUrlQuery, res: http.ServerResponse): void {
    logger.warn({
      operation: 'legacy_login',
      msg: 'Legacy login URL /auth accessed - please update to /auth/microsoft/login',
    });

    const microsoftService = this.services.get('microsoft');
    if (microsoftService) {
      this.handleLogin(microsoftService, query, res);
    } else {
      this.renderError(
        res,
        'Service Unavailable',
        'Legacy login requires Microsoft service to be configured'
      );
    }
  }

  /**
   * Handle login initiation
   */
  private handleLogin(
    registration: AuthServiceRegistration,
    query: querystring.ParsedUrlQuery,
    res: http.ServerResponse
  ): void {
    logger.info({
      operation: 'oauth_login',
      service: registration.config.name,
      msg: `OAuth login initiated for ${registration.name}`,
    });

    // Verify credentials are set
    if (!registration.config.oauth.clientId || !registration.config.oauth.clientSecret) {
      this.renderError(
        res,
        'Configuration Error',
        `${registration.name} credentials not configured. Please set environment variables.`
      );
      return;
    }

    // Build authorization URL
    const authUrl = this.buildAuthUrl(registration, query);

    logger.info({
      operation: 'oauth_redirect',
      service: registration.config.name,
      authUrl,
      msg: `Redirecting to OAuth provider: ${authUrl}`,
    });

    // Redirect to OAuth provider
    res.writeHead(302, { Location: authUrl });
    res.end();
  }

  /**
   * Build OAuth authorization URL
   */
  private buildAuthUrl(
    registration: AuthServiceRegistration,
    query: querystring.ParsedUrlQuery
  ): string {
    const { oauth } = registration.config;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const clientIdFromQuery = (query as Record<string, string | string[] | undefined>)['client_id'];
    const clientId = typeof clientIdFromQuery === 'string' ? clientIdFromQuery : oauth.clientId;

    const authParams: Record<string, string> = {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: oauth.redirectUri,
      state: Date.now().toString(),
    };

    // Handle scope parameters
    if (oauth.userScopes) {
      // User-level scopes (e.g., Slack user_scope)
      // Use service-specific delimiter (default to comma for backward compatibility)
      const delimiter = oauth.scopeDelimiter ?? ',';
      authParams['user_scope'] = oauth.userScopes.join(delimiter);
    }

    if (oauth.scopes) {
      // Bot/app-level scopes (e.g., Microsoft scope, Slack scope)
      // Use service-specific delimiter (default to space for backward compatibility)
      const delimiter = oauth.scopeDelimiter ?? ' ';
      authParams['scope'] = oauth.scopes.join(delimiter);
    }

    // Add Microsoft-specific parameters
    if (oauth.tenantId) {
      authParams['response_mode'] = 'query';
    }

    return `${oauth.authEndpoint}?${querystring.stringify(authParams)}`;
  }

  /**
   * Handle OAuth callback
   */
  private async handleCallback(
    registration: AuthServiceRegistration,
    query: querystring.ParsedUrlQuery,
    res: http.ServerResponse
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const codeParam = (query as Record<string, string | string[] | undefined>)['code'];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const errorParam = (query as Record<string, string | string[] | undefined>)['error'];
    const hasCode = codeParam !== undefined;
    const hasError = errorParam !== undefined;

    logger.info({
      operation: 'oauth_callback',
      service: registration.config.name,
      hasCode,
      hasError,
      msg: `OAuth callback received for ${registration.name}`,
    });

    // Check for OAuth errors
    if (hasError) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const errorDescParam = (query as Record<string, string | string[] | undefined>)[
        'error_description'
      ];
      const errorDesc =
        typeof errorDescParam === 'string' ? errorDescParam : 'No description provided';
      logger.error({
        operation: 'oauth_error',
        service: registration.config.name,
        error: errorParam,
        errorDescription: errorDesc,
      });

      this.renderError(
        res,
        'Authentication Error',
        `OAuth error: ${String(errorParam)}<br/>Description: ${errorDesc}`
      );
      return;
    }

    // Check for authorization code
    const code = typeof codeParam === 'string' ? codeParam : undefined;
    if (!code) {
      logger.error({
        operation: 'missing_code',
        service: registration.config.name,
      });

      this.renderError(
        res,
        'Missing Authorization Code',
        'No authorization code provided in callback. Please try again.'
      );
      return;
    }

    // Exchange code for tokens
    try {
      logger.info({
        operation: 'token_exchange_start',
        service: registration.config.name,
        msg: `Exchanging authorization code for tokens...`,
      });

      await registration.tokenStorage.exchangeCodeForTokens(code);

      logger.info({
        operation: 'token_exchange_success',
        service: registration.config.name,
        msg: `Token exchange successful`,
      });

      this.renderSuccess(
        res,
        'Authentication Successful!',
        `You have successfully authenticated with ${registration.name}.<br/>
         The access token has been saved securely.<br/>
         Token stored at: <code>${registration.config.tokenStorePath}</code>`
      );
    } catch (error) {
      logger.error({
        operation: 'token_exchange_error',
        service: registration.config.name,
        error: error instanceof Error ? error.message : String(error),
      });

      this.renderError(
        res,
        'Token Exchange Error',
        `Failed to exchange authorization code for tokens.<br/>
         Error: ${error instanceof Error ? error.message : 'Unknown error'}<br/>
         Please try again.`
      );
    }
  }

  /**
   * Check authentication status for a service
   * @param serviceName Service name
   * @param registration Service registration
   * @returns Service status object
   */
  private async checkServiceAuthStatus(
    serviceName: string,
    registration: AuthServiceRegistration
  ): Promise<ServiceStatus> {
    const status: ServiceStatus = {
      serviceName,
      displayName: registration.name,
      loginUrl: `${this.protocol}://localhost:${this.port}/auth/${serviceName}/login`,
      state: 'requires_auth',
      message: 'Not authenticated',
    };

    try {
      // Check if token file exists
      const hasTokens = await registration.tokenStorage.hasTokens();

      if (!hasTokens) {
        return status;
      }

      // Load token data
      const tokenData = registration.tokenStorage.getCurrentTokenData();

      if (!tokenData) {
        return status;
      }

      // Check if token is expired
      if (isTokenExpired(tokenData, 5 * 60 * 1000)) {
        status.state = 'expired';
        status.message = 'Token expired - re-authentication required';
        status.expiresAt = tokenData.expiresAt;
      } else {
        status.state = 'connected';
        status.message = 'Connected';
        status.expiresAt = tokenData.expiresAt;
        status.scopes = tokenData.scopes;
      }

      return status;
    } catch (error) {
      status.state = 'error';
      status.message = error instanceof Error ? error.message : 'Unknown error';
      return status;
    }
  }

  /**
   * Get authentication status for all registered services
   * @returns Array of service statuses
   */
  private async getServiceStatuses(): Promise<ServiceStatus[]> {
    const statuses: ServiceStatus[] = [];

    // Get OAuth service statuses
    for (const [serviceName, registration] of this.services.entries()) {
      const status = await this.checkServiceAuthStatus(serviceName, registration);
      statuses.push(status);
    }

    // Get LocalFoundry status from MCP server's service registry
    if (this.mcpServer) {
      const localFoundryStatus = await this.checkLocalFoundryStatus();
      if (localFoundryStatus) {
        statuses.push(localFoundryStatus);
      }
    }

    return statuses;
  }

  /**
   * Check LocalFoundry service status
   * @returns LocalFoundry service status or null if not configured
   */
  private async checkLocalFoundryStatus(): Promise<ServiceStatus | null> {
    try {
      // Access the service registry through the MCP server
      const services = (this.mcpServer as any)?.serviceRegistry?.list() || [];
      const localService = services.find((s: any) => s.name === 'local');

      if (!localService) {
        // LocalFoundry not configured
        return {
          serviceName: 'local',
          displayName: 'LocalFoundry',
          loginUrl: '',
          state: 'not_configured',
          message: 'LocalFoundry not configured. Set LOCALFOUNDRY_ENDPOINT environment variable.',
        };
      }

      // Check if LocalFoundry endpoint is available
      const isAvailable = await localService.isAuthenticated();
      const config = localService.config;

      if (isAvailable) {
        return {
          serviceName: 'local',
          displayName: 'LocalFoundry',
          loginUrl: '',
          state: 'available',
          message: 'LocalFoundry endpoint is available and responding',
          endpoint: config.apiEndpoint,
          model: localService.localFoundryConfig?.model || 'phi-4',
        };
      } else {
        return {
          serviceName: 'local',
          displayName: 'LocalFoundry',
          loginUrl: '',
          state: 'unavailable',
          message: `LocalFoundry endpoint at ${config.apiEndpoint} is not reachable. Ensure LocalFoundry is running.`,
          endpoint: config.apiEndpoint,
          model: localService.localFoundryConfig?.model || 'phi-4',
        };
      }
    } catch (error) {
      logger.warn(
        {
          operation: 'localfoundry_status_check',
          error: error instanceof Error ? error.message : String(error),
        },
        'Error checking LocalFoundry status'
      );

      return {
        serviceName: 'local',
        displayName: 'LocalFoundry',
        loginUrl: '',
        state: 'error',
        message: `Error checking status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Render a service card with status and authentication button
   * @param status Service status object
   * @returns HTML string for service card
   */
  private renderServiceCard(status: ServiceStatus): string {
    const statusConfig = {
      connected: {
        badge: '✓ Connected',
        color: '#3fb950',
        bgColor: 'rgba(63,185,80,0.15)',
      },
      available: {
        badge: '✓ Available',
        color: '#3fb950',
        bgColor: 'rgba(63,185,80,0.15)',
      },
      expired: {
        badge: '! Expired',
        color: '#d29922',
        bgColor: 'rgba(210,153,34,0.15)',
      },
      requires_auth: {
        badge: '○ Not Authenticated',
        color: '#8b949e',
        bgColor: 'rgba(139,148,158,0.15)',
      },
      unavailable: {
        badge: '○ Unavailable',
        color: '#d29922',
        bgColor: 'rgba(210,153,34,0.15)',
      },
      not_configured: {
        badge: '○ Not Configured',
        color: '#8b949e',
        bgColor: 'rgba(139,148,158,0.15)',
      },
      error: {
        badge: '✗ Error',
        color: '#f85149',
        bgColor: 'rgba(248,81,73,0.15)',
      },
    };

    const config = statusConfig[status.state];

    let details = `<p><strong>Status:</strong> ${status.message}</p>`;

    if (status.expiresAt) {
      const expiryDate = new Date(status.expiresAt);
      details += `<p><strong>Expires:</strong> ${expiryDate.toLocaleString()}</p>`;
    }

    if (status.scopes && status.scopes.length > 0) {
      details += `<p><strong>Scopes:</strong> ${status.scopes.join(', ')}</p>`;
    }

    // Add endpoint and model for non-OAuth services (like LocalFoundry)
    if (status.endpoint) {
      details += `<p><strong>Endpoint:</strong> ${status.endpoint}</p>`;
    }

    if (status.model) {
      details += `<p><strong>Model:</strong> ${status.model}</p>`;
    }

    // Show auth button only for OAuth services (those with a loginUrl)
    const authButton = status.loginUrl
      ? `
        <div class="service-actions">
          <a href="${status.loginUrl}" class="btn btn-primary">
            ${status.state === 'connected' ? 'Re-authenticate' : 'Authenticate'}
          </a>
        </div>
      `
      : '';

    return `
      <div class="service-card" style="border-color: ${config.color};">
        <div class="service-header">
          <h2>${status.displayName}</h2>
          <span class="status-badge" style="background-color: ${config.bgColor}; color: ${config.color};">
            ${config.badge}
          </span>
        </div>
        <div class="service-details">
          ${details}
        </div>
        ${authButton}
      </div>
    `;
  }

  /**
   * Render home page with authentication dashboard
   */
  private async renderHomePage(res: http.ServerResponse): Promise<void> {
    const serviceStatuses = await this.getServiceStatuses();
    const slackSavedItemsCard = await this.renderSlackSavedItemsCard();

    const serviceCards =
      serviceStatuses.length > 0
        ? serviceStatuses.map((status) => this.renderServiceCard(status)).join('\n')
        : '<p class="no-services"><em>No services configured. Please set service credentials in environment variables.</em></p>';

    const html = this.renderHtml(
      'Cerebro MCP - Authentication Dashboard',
      'Authentication Dashboard',
      `
        <div class="dashboard-intro">
          <p>Manage OAuth authentication for all configured services.</p>
          <p><strong>Server:</strong> <code>${this.protocol}://localhost:${this.port}</code></p>
        </div>
        <div class="service-grid">
          ${serviceCards}
          ${slackSavedItemsCard}
        </div>
      `,
      'info'
    );

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Render service not found error
   */
  private renderServiceNotFound(res: http.ServerResponse, serviceName: string): void {
    const availableServices = Array.from(this.services.keys()).join(', ') || 'none';

    this.renderError(
      res,
      'Service Not Found',
      `The service "<strong>${serviceName}</strong>" is not available.<br/>
       Available services: ${availableServices}`
    );
  }

  /**
   * Render 404 error
   */
  private render404(res: http.ServerResponse): void {
    this.renderError(res, 'Not Found', 'The requested page was not found.');
  }

  /**
   * Render success page
   */
  private renderSuccess(res: http.ServerResponse, title: string, message: string): void {
    const html = this.renderHtml(title, title, `<div class="message-box"><p>${message}</p></div>`, 'success');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Render error page
   */
  private renderError(res: http.ServerResponse, title: string, message: string): void {
    const html = this.renderHtml(title, title, `<div class="message-box"><p>${message}</p></div>`, 'error');
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Render HTML page
   */
  private renderHtml(
    title: string,
    heading: string,
    content: string,
    type: 'success' | 'error' | 'info' = 'info'
  ): string {
    const accentColor = { success: '#3fb950', error: '#f85149', info: '#58a6ff' }[type];

    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="3"  r="2.5" fill="#58a6ff"/>
        <circle cx="3"  cy="17" r="2.5" fill="#58a6ff"/>
        <circle cx="19" cy="17" r="2.5" fill="#58a6ff"/>
        <circle cx="11" cy="11" r="2"   fill="#58a6ff" fill-opacity="0.45"/>
        <line x1="11" y1="5.5" x2="11"    y2="9"    stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="9.3"  y1="12.3" x2="5.2"  y2="15"  stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="12.7" y1="12.3" x2="16.8" y2="15"  stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="3"  y1="14.5" x2="11" y2="5.5"  stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
        <line x1="11" y1="5.5"  x2="19" y2="14.5" stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
        <line x1="3"  y1="17"   x2="19" y2="17"   stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
      </svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
    }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: #21262d;
      border: 1px solid #30363d;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.88em;
    }
    strong { color: #e6edf3; }

    /* ── Nav ── */
    #main-nav {
      height: 48px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: #e6edf3;
    }
    .nav-brand:hover { text-decoration: none; }
    .nav-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: #e6edf3; }
    .nav-links { display: flex; list-style: none; gap: 4px; margin-left: auto; }
    .nav-link {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #8b949e;
      text-decoration: none;
      transition: background 0.15s, color 0.15s;
    }
    .nav-link:hover { background: #21262d; color: #e6edf3; text-decoration: none; }
    .nav-link.active { background: #21262d; color: #e6edf3; }

    /* ── Page layout ── */
    #page-content {
      flex: 1;
      overflow-y: auto;
      padding: 28px 24px;
      max-width: 1040px;
      width: 100%;
      margin: 0 auto;
    }
    .page-heading {
      font-size: 18px;
      font-weight: 600;
      color: ${accentColor};
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #30363d;
    }
    .page-close-hint { margin-top: 20px; color: #8b949e; font-size: 12px; }

    /* ── Service cards ── */
    .dashboard-intro { margin-bottom: 20px; color: #8b949e; }
    .dashboard-intro p { margin: 4px 0; }
    .service-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }
    .service-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      transition: border-color 0.15s;
    }
    .service-card:hover { border-color: rgba(88,166,255,0.3); }
    .service-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      gap: 12px;
    }
    .service-header h2 { margin: 0; font-size: 15px; font-weight: 600; color: #e6edf3; }
    .status-badge {
      padding: 3px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .service-details { margin: 10px 0; color: #8b949e; font-size: 13px; }
    .service-details p { margin: 5px 0; line-height: 1.5; }
    .service-actions { margin-top: 14px; display: flex; gap: 8px; }
    .btn {
      display: inline-block;
      padding: 7px 16px;
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      transition: opacity 0.15s;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .btn:hover { opacity: 0.85; text-decoration: none; }
    .btn-primary { background: #58a6ff; color: #0d1117; }
    .no-services { text-align: center; padding: 40px; color: #8b949e; }

    /* ── Simple message box (success / error pages) ── */
    .message-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-left: 3px solid ${accentColor};
      padding: 16px;
      border-radius: 6px;
      margin-bottom: 16px;
    }

    @media (max-width: 768px) {
      #page-content { padding: 16px; }
      .service-grid { grid-template-columns: 1fr; }
      .service-header { flex-direction: column; align-items: flex-start; }
      .status-badge { align-self: flex-start; }
    }
  </style>
</head>
<body>
  <nav id="main-nav">
    <a class="nav-brand" href="/">
      ${logoSvg}
      <span class="nav-title">Cerebro</span>
    </a>
    <ul class="nav-links">
      <li><a href="/"       class="nav-link active">Auth</a></li>
      <li><a href="/triage" class="nav-link">Triage</a></li>
    </ul>
  </nav>
  <div id="page-content">
    <h1 class="page-heading">${heading}</h1>
    ${content}
    <p class="page-close-hint"><em>You can close this window and return to Claude.</em></p>
  </div>
</body>
</html>`;
  }

  // ─── Slack Saved Items Credential Management ────────────────────────────────

  /**
   * Handle GET and POST requests for /auth/slack-saved-items/credentials
   */
  private async handleSlackSavedItemsCredentials(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method === 'POST') {
      await this.handleSlackSavedItemsCredentialsPost(req, res);
    } else {
      await this.renderSlackSavedItemsCredentialsPage(res);
    }
  }

  /**
   * POST /auth/slack-saved-items/credentials — save new xoxc + xoxd credentials
   */
  private async handleSlackSavedItemsCredentialsPost(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // Read request body
      const body = await new Promise<string>((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });

      const params = new URLSearchParams(body);
      const xoxcToken = params.get('xoxcToken')?.trim() ?? '';
      const xoxdCookie = params.get('xoxdCookie')?.trim() ?? '';

      if (!xoxcToken || !xoxdCookie) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Both xoxcToken and xoxdCookie are required.' }));
        return;
      }

      const credentials = await this.slackCredentialStorage.save(xoxcToken, xoxdCookie);
      const estimatedExpiresAt = new Date(credentials.savedAt + 12 * 60 * 60 * 1000).toISOString();

      logger.info({
        operation: 'slack_credentials_dashboard_save',
        savedAt: new Date(credentials.savedAt).toISOString(),
        msg: 'Slack session credentials saved via dashboard',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Credentials saved successfully.',
        estimatedExpiresAt,
      }));
    } catch (error) {
      logger.error({
        operation: 'slack_credentials_dashboard_save_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to save Slack session credentials',
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to save credentials. Check server logs.' }));
    }
  }

  /**
   * GET /auth/slack-saved-items/credentials — render credential management page
   */
  private async renderSlackSavedItemsCredentialsPage(res: http.ServerResponse): Promise<void> {
    await this.slackCredentialStorage.load();
    const creds = this.slackCredentialStorage.getCurrent();

    let statusHtml: string;
    if (!creds) {
      statusHtml = `
        <div class="cred-status not-configured">
          <span class="cred-badge">○ Not Configured</span>
          <p>No credentials saved yet. Follow the steps below to set up access.</p>
        </div>`;
    } else if (this.slackCredentialStorage.isExpired()) {
      const savedAt = new Date(creds.savedAt).toLocaleString();
      statusHtml = `
        <div class="cred-status expired">
          <span class="cred-badge">✗ Expired</span>
          <p>Credentials saved at <strong>${savedAt}</strong> have expired. Please refresh them below.</p>
        </div>`;
    } else if (this.slackCredentialStorage.isExpiringSoon()) {
      const expiresAt = new Date(this.slackCredentialStorage.getEstimatedExpiresAt()!).toLocaleString();
      statusHtml = `
        <div class="cred-status expiring-soon">
          <span class="cred-badge">⚠ Expiring Soon</span>
          <p>Credentials expire at approximately <strong>${expiresAt}</strong>. Refresh them soon to avoid interruption.</p>
        </div>`;
    } else {
      const savedAt = new Date(creds.savedAt).toLocaleString();
      const expiresAt = new Date(this.slackCredentialStorage.getEstimatedExpiresAt()!).toLocaleString();
      statusHtml = `
        <div class="cred-status configured">
          <span class="cred-badge">✓ Configured</span>
          <p>Credentials saved at <strong>${savedAt}</strong>, estimated expiry: <strong>${expiresAt}</strong>.</p>
          ${creds.workspaceUrl ? `<p>Workspace: <code>${creds.workspaceUrl}</code></p>` : ''}
        </div>`;
    }

    const html = this.renderHtml(
      'Slack Saved Items — Credentials',
      'Slack Saved Items: Session Credentials',
      `
      <style>
        .cred-status { padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; border: 1px solid; }
        .cred-status.not-configured { background: rgba(139,148,158,0.1); border-color: rgba(139,148,158,0.3); color: #8b949e; }
        .cred-status.expired        { background: rgba(248,81,73,0.1);   border-color: rgba(248,81,73,0.3);   color: #f85149; }
        .cred-status.expiring-soon  { background: rgba(210,153,34,0.1);  border-color: rgba(210,153,34,0.3);  color: #d29922; }
        .cred-status.configured     { background: rgba(63,185,80,0.1);   border-color: rgba(63,185,80,0.3);   color: #3fb950; }
        .cred-status p { color: #e6edf3; margin-top: 6px; }
        .cred-badge { font-weight: 700; font-size: 0.95em; letter-spacing: 0.02em; }
        h3 { font-size: 14px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin: 20px 0 10px; }
        .cred-form label { display: block; margin-top: 14px; font-weight: 600; font-size: 13px; color: #e6edf3; }
        .cred-form input[type=text] {
          width: 100%; padding: 8px 12px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.85em;
          margin-top: 6px; border: 1px solid #30363d; border-radius: 6px;
          background: #21262d; color: #e6edf3; outline: none;
        }
        .cred-form input[type=text]:focus { border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88,166,255,0.2); }
        .cred-form button {
          margin-top: 16px; padding: 8px 20px; background: #58a6ff; color: #0d1117;
          border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit;
        }
        .cred-form button:hover { opacity: 0.85; }
        #save-result { margin-top: 12px; padding: 10px 14px; border-radius: 6px; display: none; font-size: 13px; border: 1px solid; }
        .steps ol { padding-left: 20px; color: #8b949e; }
        .steps p { color: #8b949e; margin-bottom: 10px; }
        .steps li { margin-bottom: 8px; color: #8b949e; }
        .steps li strong { color: #e6edf3; }
        .back-link { margin-top: 24px; display: inline-block; font-size: 13px; }
      </style>
      ${statusHtml}
      <h3>Extraction Instructions</h3>
      <div class="steps">
        <p>Credentials expire roughly every 12 hours. You need two values from your browser's active Slack session.</p>
        <ol>
          <li>Open Slack in <strong>Chrome or Edge</strong> and make sure you are logged in.</li>
          <li>Press <strong>F12</strong> to open DevTools.</li>
          <li><strong>Get your xoxc token:</strong><br>
            → Application tab → Storage → Local Storage → <code>https://{yourworkspace}.slack.com</code><br>
            → Find key <code>localConfig_v2</code> → search the value for <code>"token"</code><br>
            → Copy the value starting with <code>xoxc-</code></li>
          <li><strong>Get your xoxd cookie:</strong><br>
            → Application tab → Storage → Cookies → <code>https://{yourworkspace}.slack.com</code><br>
            → Find the cookie named <code>d</code><br>
            → Copy its value (starts with <code>xoxd-</code>)</li>
        </ol>
      </div>
      <h3>Enter Credentials</h3>
      <form class="cred-form" id="cred-form">
        <label for="xoxcToken">xoxc Token</label>
        <input type="text" id="xoxcToken" name="xoxcToken" placeholder="xoxc-..." autocomplete="off" spellcheck="false">
        <label for="xoxdCookie">xoxd Cookie</label>
        <input type="text" id="xoxdCookie" name="xoxdCookie" placeholder="xoxd-..." autocomplete="off" spellcheck="false">
        <button type="submit">Save Credentials</button>
      </form>
      <div id="save-result"></div>
      <a class="back-link" href="/">← Back to Dashboard</a>
      <script>
        document.getElementById('cred-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const result = document.getElementById('save-result');
          const xoxcToken = document.getElementById('xoxcToken').value.trim();
          const xoxdCookie = document.getElementById('xoxdCookie').value.trim();
          try {
            const resp = await fetch('/auth/slack-saved-items/credentials', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ xoxcToken, xoxdCookie }).toString()
            });
            const data = await resp.json();
            result.style.display = 'block';
            if (data.success) {
              result.style.background = 'rgba(63,185,80,0.1)';
              result.style.borderColor = 'rgba(63,185,80,0.3)';
              result.style.color = '#3fb950';
              result.textContent = 'Credentials saved. Estimated expiry: ' + data.estimatedExpiresAt;
              document.getElementById('xoxcToken').value = '';
              document.getElementById('xoxdCookie').value = '';
            } else {
              result.style.background = 'rgba(248,81,73,0.1)';
              result.style.borderColor = 'rgba(248,81,73,0.3)';
              result.style.color = '#f85149';
              result.textContent = 'Error: ' + (data.error || 'Unknown error');
            }
          } catch(err) {
            result.style.display = 'block';
            result.style.background = 'rgba(248,81,73,0.1)';
            result.style.borderColor = 'rgba(248,81,73,0.3)';
            result.style.color = '#f85149';
            result.textContent = 'Network error saving credentials.';
          }
        });
      </script>
      `,
      'info'
    );

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Render a Slack Saved Items status card for the dashboard home page
   */
  private async renderSlackSavedItemsCard(): Promise<string> {
    await this.slackCredentialStorage.load();
    const creds = this.slackCredentialStorage.getCurrent();

    let badge: string;
    let badgeColor: string;
    let badgeBg: string;
    let statusMsg: string;

    if (!creds) {
      badge = '○ Not Configured';
      badgeColor = '#8b949e';
      badgeBg = 'rgba(139,148,158,0.15)';
      statusMsg = 'No credentials stored. Set up via the credentials page.';
    } else if (this.slackCredentialStorage.isExpired()) {
      badge = '✗ Expired';
      badgeColor = '#f85149';
      badgeBg = 'rgba(248,81,73,0.15)';
      statusMsg = `Credentials expired (saved at ${new Date(creds.savedAt).toLocaleString()}).`;
    } else if (this.slackCredentialStorage.isExpiringSoon()) {
      badge = '⚠ Expiring Soon';
      badgeColor = '#d29922';
      badgeBg = 'rgba(210,153,34,0.15)';
      const exp = this.slackCredentialStorage.getEstimatedExpiresAt();
      statusMsg = `Credentials expire ~${new Date(exp!).toLocaleString()}. Refresh soon.`;
    } else {
      badge = '✓ Configured';
      badgeColor = '#3fb950';
      badgeBg = 'rgba(63,185,80,0.15)';
      const exp = this.slackCredentialStorage.getEstimatedExpiresAt();
      statusMsg = `Active. Estimated expiry: ${new Date(exp!).toLocaleString()}.`;
    }

    return `
      <div class="service-card" style="border-color: ${badgeColor};">
        <div class="service-header">
          <h2>Slack Saved Items</h2>
          <span class="status-badge" style="background-color: ${badgeBg}; color: ${badgeColor};">
            ${badge}
          </span>
        </div>
        <div class="service-details">
          <p><strong>Status:</strong> ${statusMsg}</p>
          <p><em>Session credentials (xoxc/xoxd) — expires every ~12h</em></p>
        </div>
        <div class="service-actions">
          <a href="/auth/slack-saved-items/credentials" class="btn btn-primary">Manage Credentials</a>
        </div>
      </div>
    `;
  }

  /**
   * Stop the OAuth server
   * @returns Promise that resolves when server is stopped
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server || !this.isRunning) {
        logger.info({
          operation: 'auth_server_shutdown',
          msg: 'Shutting down OAuth server',
        });
        logger.error({
          operation: 'shutdown_error',
          error: 'Server is not running.',
        });
        resolve();
        return;
      }

      logger.info({
        operation: 'auth_server_shutdown',
        msg: 'Shutting down OAuth server',
      });

      this.server.close((error) => {
        if (error) {
          logger.error({
            operation: 'shutdown_error',
            error: error.message,
          });
          reject(error);
        } else {
          this.isRunning = false;
          logger.info({
            operation: 'auth_server_stopped',
            msg: 'OAuth server stopped',
          });
          resolve();
        }
      });
    });
  }
}
