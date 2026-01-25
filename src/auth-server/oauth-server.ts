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

  constructor(port?: number) {
    this.port = port ?? globalConfig.authServerPort;
    this.services = new Map();

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
        color: '#5cb85c',
        bgColor: '#d4edda',
      },
      available: {
        badge: '✓ Available',
        color: '#5cb85c',
        bgColor: '#d4edda',
      },
      expired: {
        badge: '! Expired',
        color: '#f0ad4e',
        bgColor: '#fff3cd',
      },
      requires_auth: {
        badge: '○ Not Authenticated',
        color: '#6c757d',
        bgColor: '#e9ecef',
      },
      unavailable: {
        badge: '○ Unavailable',
        color: '#f0ad4e',
        bgColor: '#fff3cd',
      },
      not_configured: {
        badge: '○ Not Configured',
        color: '#6c757d',
        bgColor: '#e9ecef',
      },
      error: {
        badge: '✗ Error',
        color: '#d9534f',
        bgColor: '#f8d7da',
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
    const html = this.renderHtml(title, title, `<p>${message}</p>`, 'success');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Render error page
   */
  private renderError(res: http.ServerResponse, title: string, message: string): void {
    const html = this.renderHtml(title, title, `<p>${message}</p>`, 'error');
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
    const colors = {
      success: { heading: '#5cb85c', bg: '#d4edda', border: '#c3e6cb' },
      error: { heading: '#d9534f', bg: '#f8d7da', border: '#f5c6cb' },
      info: { heading: '#0078d4', bg: '#e7f6fd', border: '#b3e0ff' },
    };

    const color = colors[type];

    return `
      <html>
        <head>
          <title>${title}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5f5f5;
            }
            h1 {
              color: ${color.heading};
              margin-bottom: 10px;
            }
            .content-box {
              background-color: ${color.bg};
              border: 1px solid ${color.border};
              padding: 15px;
              border-radius: 4px;
              margin: 15px 0;
            }
            code {
              background: #f4f4f4;
              padding: 2px 6px;
              border-radius: 4px;
              font-family: monospace;
            }

            /* Dashboard styles */
            .dashboard-intro {
              margin-bottom: 30px;
            }
            .service-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
              gap: 20px;
              margin-top: 20px;
            }
            .service-card {
              background: white;
              border: 2px solid #ddd;
              border-radius: 8px;
              padding: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              transition: box-shadow 0.2s;
            }
            .service-card:hover {
              box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            }
            .service-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 15px;
              gap: 15px;
            }
            .service-header h2 {
              margin: 0;
              font-size: 1.4em;
              color: #333;
            }
            .status-badge {
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 0.9em;
              font-weight: bold;
              white-space: nowrap;
            }
            .service-details {
              margin: 15px 0;
              color: #666;
            }
            .service-details p {
              margin: 8px 0;
              line-height: 1.5;
            }
            .service-actions {
              margin-top: 15px;
              display: flex;
              gap: 10px;
            }
            .btn {
              display: inline-block;
              padding: 10px 20px;
              text-decoration: none;
              border-radius: 4px;
              font-weight: bold;
              transition: all 0.2s;
              text-align: center;
            }
            .btn-primary {
              background-color: #0078d4;
              color: white;
            }
            .btn-primary:hover {
              background-color: #005a9e;
            }
            .no-services {
              text-align: center;
              padding: 40px;
              color: #666;
              font-size: 1.1em;
            }

            /* Responsive design */
            @media (max-width: 768px) {
              body {
                padding: 10px;
              }
              .service-grid {
                grid-template-columns: 1fr;
              }
              .service-header {
                flex-direction: column;
                align-items: flex-start;
              }
              .status-badge {
                align-self: flex-start;
              }
            }
          </style>
        </head>
        <body>
          <h1>${heading}</h1>
          <div class="content-box">
            ${content}
          </div>
          <p><em>You can close this window and return to Claude.</em></p>
        </body>
      </html>
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
