#!/usr/bin/env node
/**
 * Unified Authentication Server
 *
 * Handles OAuth 2.0 authentication for multiple services (Microsoft, Slack, etc.)
 * Routes: /auth/:service/login, /auth/:service/callback
 * Supports both HTTP (for Microsoft) and HTTPS (for Slack with mkcert)
 */

const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Service configurations - dynamically loaded based on available services
const services = {};

// Initialize Microsoft service if credentials are available
try {
  const microsoftConfig = require('../services/microsoft/config');
  if (microsoftConfig && microsoftConfig.AUTH_CONFIG) {
    services.microsoft = {
      name: 'Microsoft 365',
      config: microsoftConfig.AUTH_CONFIG,
      TokenStorage: require('../services/microsoft/auth/token-storage')
    };
    console.log('✓ Microsoft 365 service loaded');
  }
} catch (error) {
  console.log('ℹ Microsoft 365 service not available:', error.message);
}

// Load Slack service if available
try {
  const slackConfig = require('../services/slack/config');
  if (slackConfig && slackConfig.AUTH_CONFIG) {
    services.slack = {
      name: 'Slack',
      config: slackConfig.AUTH_CONFIG,
      TokenStorage: require('../services/slack/auth/token-storage')
    };
    console.log('✓ Slack service loaded');
  }
} catch (error) {
  console.log('ℹ Slack service not available:', error.message);
}

console.log('Starting Unified Authentication Server');
console.log(`Loaded ${Object.keys(services).length} service(s): ${Object.keys(services).join(', ')}`);

/**
 * Parse service from URL path
 * @param {string} pathname - URL pathname
 * @returns {object|null} - {service: string, action: string} or null
 */
function parseServiceRoute(pathname) {
  const match = pathname.match(/^\/auth\/([^\/]+)\/([^\/]+)$/);
  if (match) {
    return {
      service: match[1],
      action: match[2]
    };
  }
  return null;
}

/**
 * Get service configuration
 * @param {string} serviceName - Service name (e.g., 'microsoft', 'slack')
 * @returns {object|null} - Service config or null
 */
function getService(serviceName) {
  return services[serviceName] || null;
}

/**
 * Render HTML response
 * @param {string} title - Page title
 * @param {string} heading - Main heading
 * @param {string} content - HTML content
 * @param {string} type - 'success' | 'error' | 'info'
 * @returns {string} - Complete HTML
 */
function renderHtml(title, heading, content, type = 'info') {
  const colors = {
    success: { heading: '#5cb85c', bg: '#d4edda', border: '#c3e6cb' },
    error: { heading: '#d9534f', bg: '#f8d7da', border: '#f5c6cb' },
    info: { heading: '#0078d4', bg: '#e7f6fd', border: '#b3e0ff' }
  };
  const color = colors[type];

  return `
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; }
          h1 { color: ${color.heading}; }
          .content-box { background-color: ${color.bg}; border: 1px solid ${color.border}; padding: 15px; border-radius: 4px; margin: 15px 0; }
          code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
          ul { margin: 10px 0; }
          li { margin: 5px 0; }
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
 * Handle authentication callback
 * @param {object} service - Service configuration
 * @param {object} query - Query parameters
 * @param {object} res - HTTP response
 */
async function handleCallback(service, query, res) {
  // Check for OAuth errors
  if (query.error) {
    console.error(`${service.name} authentication error: ${query.error}`);
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(renderHtml(
      'Authentication Error',
      'Authentication Error',
      `
        <p><strong>Error:</strong> ${query.error}</p>
        <p><strong>Description:</strong> ${query.error_description || 'No description provided'}</p>
        <p>Please try again.</p>
      `,
      'error'
    ));
    return;
  }

  // Check for authorization code
  if (!query.code) {
    console.error('No authorization code provided');
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(renderHtml(
      'Missing Authorization Code',
      'Missing Authorization Code',
      '<p>No authorization code was provided in the callback. Please try again.</p>',
      'error'
    ));
    return;
  }

  // Exchange code for tokens
  try {
    console.log(`${service.name}: Authorization code received, exchanging for tokens...`);
    const tokenStorage = new service.TokenStorage(service.config);
    await tokenStorage.exchangeCodeForTokens(query.code);

    console.log(`${service.name}: Token exchange successful`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderHtml(
      'Authentication Successful',
      'Authentication Successful!',
      `
        <p>You have successfully authenticated with ${service.name}.</p>
        <p>The access token has been saved securely.</p>
        <p>Token stored at: <code>${service.config.tokenStorePath}</code></p>
      `,
      'success'
    ));
  } catch (error) {
    console.error(`${service.name}: Token exchange error:`, error.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(renderHtml(
      'Token Exchange Error',
      'Token Exchange Error',
      `
        <p><strong>Error:</strong> ${error.message}</p>
        <p>Please close this window and try again.</p>
      `,
      'error'
    ));
  }
}

/**
 * Handle login initiation
 * @param {object} service - Service configuration
 * @param {object} query - Query parameters
 * @param {object} res - HTTP response
 */
function handleLogin(service, query, res) {
  console.log(`${service.name}: Auth request received, redirecting to OAuth provider...`);

  // Verify credentials are set
  if (!service.config.clientId || !service.config.clientSecret) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(renderHtml(
      'Configuration Error',
      'Configuration Error',
      `
        <p>${service.name} credentials are not set. Please configure the required environment variables.</p>
        <p>Check your <code>.env</code> file or Claude Desktop configuration.</p>
      `,
      'error'
    ));
    return;
  }

  // Build authorization URL (service-specific)
  const authUrl = buildAuthUrl(service, query);

  console.log(`${service.name}: Redirecting to: ${authUrl}`);
  res.writeHead(302, { 'Location': authUrl });
  res.end();
}

/**
 * Build OAuth authorization URL for a service
 * @param {object} service - Service configuration
 * @param {object} query - Query parameters
 * @returns {string} - Authorization URL
 */
function buildAuthUrl(service, query) {
  const querystring = require('querystring');
  const clientId = query.client_id || service.config.clientId;

  // Service-agnostic OAuth URL building
  if (service.config.authEndpoint) {
    // Generic OAuth 2.0 flow (works for Slack and future services)
    const authParams = {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: service.config.redirectUri
    };

    // Slack uses 'user_scope' for user tokens, others use 'scope'
    if (service.config.userScopes) {
      authParams.user_scope = service.config.userScopes.join(',');
    } else if (service.config.scopes) {
      authParams.scope = service.config.scopes.join(' ');
    }

    // Add state for CSRF protection
    authParams.state = Date.now().toString();

    return `${service.config.authEndpoint}?${querystring.stringify(authParams)}`;
  } else {
    // Legacy Microsoft OAuth (for backward compatibility)
    const authParams = {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: service.config.redirectUri,
      scope: service.config.scopes.join(' '),
      response_mode: 'query',
      state: Date.now().toString()
    };

    const tenantId = service.config.tenantId || 'common';
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${querystring.stringify(authParams)}`;
  }
}

/**
 * Render home page
 * @param {object} res - HTTP response
 */
function renderHomePage(res) {
  const serviceList = Object.entries(services)
    .map(([key, svc]) => `<li><strong>${svc.name}</strong> (${key})</li>`)
    .join('');

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderHtml(
    'Unified Authentication Server',
    'Unified Authentication Server',
    `
      <p>This server handles OAuth 2.0 authentication for multiple services.</p>
      <p><strong>Loaded Services:</strong></p>
      <ul>${serviceList || '<li><em>No services configured</em></li>'}</ul>
      <p>Don't navigate here directly. Use the <code>microsoft.authenticate</code> or <code>slack.authenticate</code> tool in Claude to start authentication.</p>
      <p><strong>Server running at:</strong> <code>http://localhost:3333</code></p>
    `,
    'info'
  ));
}

// Create HTTP/HTTPS server based on certificate availability
const PORT = 3333;
let server;
let protocol = 'http';

// Try to load SSL certificates for HTTPS
try {
  const certPath = path.join(process.cwd(), 'localhost+2.pem');
  const keyPath = path.join(process.cwd(), 'localhost+2-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };

    server = https.createServer(options, async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      const query = parsedUrl.query;

      console.log(`Request received: ${pathname}`);

      // LEGACY SUPPORT: Handle /auth/callback as Microsoft callback for backward compatibility
      // TODO: Remove this after migration period (redirects to /auth/microsoft/callback)
      if (pathname === '/auth/callback') {
        console.log('⚠️  Legacy callback URL detected: /auth/callback');
        console.log('   This route is deprecated. Please update to: /auth/microsoft/callback');

        const microsoftService = getService('microsoft');
        if (microsoftService) {
          console.log('   Forwarding to Microsoft service handler...');
          await handleCallback(microsoftService, query, res);
          return;
        } else {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end(renderHtml(
            'Service Unavailable',
            'Microsoft Service Not Available',
            `
              <p>The legacy callback endpoint requires Microsoft service to be configured.</p>
              <p>Please update your redirect URI to: <code>http://localhost:3333/auth/microsoft/callback</code></p>
            `,
            'error'
          ));
          return;
        }
      }

      // LEGACY SUPPORT: Handle /auth as Microsoft login for backward compatibility
      // TODO: Remove this after migration period (redirects to /auth/microsoft/login)
      if (pathname === '/auth') {
        console.log('⚠️  Legacy login URL detected: /auth');
        console.log('   This route is deprecated. Please update to: /auth/microsoft/login');

        const microsoftService = getService('microsoft');
        if (microsoftService) {
          console.log('   Forwarding to Microsoft service handler...');
          handleLogin(microsoftService, query, res);
          return;
        } else {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end(renderHtml(
            'Service Unavailable',
            'Microsoft Service Not Available',
            '<p>The legacy login endpoint requires Microsoft service to be configured.</p>',
            'error'
          ));
          return;
        }
      }

      // Parse service route
      const route = parseServiceRoute(pathname);

      if (route) {
        const service = getService(route.service);

        if (!service) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(renderHtml(
            'Service Not Found',
            'Service Not Found',
            `
              <p>The service "<strong>${route.service}</strong>" is not available.</p>
              <p>Available services: ${Object.keys(services).join(', ') || 'none'}</p>
            `,
            'error'
          ));
          return;
        }

        // Handle actions
        if (route.action === 'callback') {
          await handleCallback(service, query, res);
        } else if (route.action === 'login') {
          handleLogin(service, query, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      } else if (pathname === '/') {
        // Home page
        renderHomePage(res);
      } else {
        // Not found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    protocol = 'https';
    console.log('✓ SSL certificates found - using HTTPS');
  } else {
    throw new Error('Certificate files not found');
  }
} catch (error) {
  console.log('ℹ SSL certificates not found - using HTTP');
  console.log('  To enable HTTPS for Slack: run "mkcert localhost 127.0.0.1 ::1"');

  server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    console.log(`Request received: ${pathname}`);

    // LEGACY SUPPORT: Handle /auth/callback as Microsoft callback for backward compatibility
    // TODO: Remove this after migration period (redirects to /auth/microsoft/callback)
    if (pathname === '/auth/callback') {
      console.log('⚠️  Legacy callback URL detected: /auth/callback');
      console.log('   This route is deprecated. Please update to: /auth/microsoft/callback');

      const microsoftService = getService('microsoft');
      if (microsoftService) {
        console.log('   Forwarding to Microsoft service handler...');
        await handleCallback(microsoftService, query, res);
        return;
      } else {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end(renderHtml(
          'Service Unavailable',
          'Microsoft Service Not Available',
          `
            <p>The legacy callback endpoint requires Microsoft service to be configured.</p>
            <p>Please update your redirect URI to: <code>http://localhost:3333/auth/microsoft/callback</code></p>
          `,
          'error'
        ));
        return;
      }
    }

    // LEGACY SUPPORT: Handle /auth as Microsoft login for backward compatibility
    // TODO: Remove this after migration period (redirects to /auth/microsoft/login)
    if (pathname === '/auth') {
      console.log('⚠️  Legacy login URL detected: /auth');
      console.log('   This route is deprecated. Please update to: /auth/microsoft/login');

      const microsoftService = getService('microsoft');
      if (microsoftService) {
        console.log('   Forwarding to Microsoft service handler...');
        handleLogin(microsoftService, query, res);
        return;
      } else {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end(renderHtml(
          'Service Unavailable',
          'Microsoft Service Not Available',
          '<p>The legacy login endpoint requires Microsoft service to be configured.</p>',
          'error'
        ));
        return;
      }
    }

    // Parse service route
    const route = parseServiceRoute(pathname);

    if (route) {
      const service = getService(route.service);

      if (!service) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(renderHtml(
          'Service Not Found',
          'Service Not Found',
          `
            <p>The service "<strong>${route.service}</strong>" is not available.</p>
            <p>Available services: ${Object.keys(services).join(', ') || 'none'}</p>
          `,
          'error'
        ));
        return;
      }

      // Handle actions
      if (route.action === 'callback') {
        await handleCallback(service, query, res);
      } else if (route.action === 'login') {
        handleLogin(service, query, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } else if (pathname === '/') {
      // Home page
      renderHomePage(res);
    } else {
      // Not found
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`\n✓ Authentication server running at ${protocol}://localhost:${PORT}`);
  console.log(`\nService endpoints:`);

  Object.entries(services).forEach(([key, svc]) => {
    console.log(`  - ${svc.name}: ${protocol}://localhost:${PORT}/auth/${key}/login`);
    console.log(`    Callback: ${protocol}://localhost:${PORT}/auth/${key}/callback`);
    console.log(`    Token storage: ${svc.config.tokenStorePath}`);
  });

  if (Object.keys(services).length === 0) {
    console.log('\n⚠️  WARNING: No services are configured.');
    console.log('   Please configure service credentials in your environment variables.');
  }

  console.log('\nPress Ctrl+C to stop the server\n');
});

// Handle termination
process.on('SIGINT', () => {
  console.log('\nAuthentication server shutting down');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nAuthentication server shutting down');
  server.close(() => {
    process.exit(0);
  });
});
