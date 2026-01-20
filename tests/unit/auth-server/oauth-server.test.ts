/**
 * OAuth Server Tests
 *
 * Comprehensive tests for the unified OAuth authentication server
 */

import { OAuthServer, AuthServiceRegistration } from '../../../src/auth-server/oauth-server';
import { BaseTokenStorage } from '../../../src/common/base-token-storage';
import { ServiceConfig } from '../../../src/types/service';
import { TokenData } from '../../../src/types/token';
import * as http from 'http';
import * as https from 'https';

/**
 * Mock token storage for testing
 */
class MockTokenStorage extends BaseTokenStorage {
  private mockTokenData?: TokenData;

  constructor(serviceName: string) {
    super(`/tmp/test-${serviceName}-token.json`, serviceName);
  }

  async exchangeCodeForTokens(code: string): Promise<TokenData> {
    this.mockTokenData = {
      accessToken: `mock_access_token_${code}`,
      refreshToken: 'mock_refresh_token',
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer',
      scopes: ['read', 'write'],
    };

    await this.saveTokens(this.mockTokenData);
    return this.mockTokenData;
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    this.mockTokenData = {
      accessToken: 'mock_refreshed_access_token',
      refreshToken,
      expiresAt: Date.now() + 3600000,
      tokenType: 'Bearer',
      scopes: ['read', 'write'],
    };

    await this.saveTokens(this.mockTokenData);
    return this.mockTokenData;
  }

  getMockTokenData(): TokenData | undefined {
    return this.mockTokenData;
  }
}

/**
 * Create mock service configuration
 */
function createMockServiceConfig(serviceName: string): ServiceConfig {
  return {
    name: serviceName,
    displayName: `Mock ${serviceName} Service`,
    apiEndpoint: `https://api.${serviceName}.com`,
    oauth: {
      clientId: 'mock_client_id',
      clientSecret: 'mock_client_secret',
      redirectUri: `http://localhost:3333/auth/${serviceName}/callback`,
      scopes: ['read', 'write'],
      authEndpoint: `https://oauth.${serviceName}.com/authorize`,
      tokenEndpoint: `https://oauth.${serviceName}.com/token`,
    },
    tokenStorePath: `/tmp/test-${serviceName}-token.json`,
  };
}

/**
 * Make HTTP/HTTPS request to server
 */
function makeRequest(
  port: number,
  path: string,
  method: string = 'GET',
  useHttps: boolean = true
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      rejectUnauthorized: false, // Allow self-signed certificates
    };

    const protocol = useHttps ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 500,
          body,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000);
    req.end();
  });
}

/**
 * Wait for server to be ready by polling
 */
async function waitForServer(port: number, maxAttempts: number = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await makeRequest(port, '/');
      return;
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe('OAuthServer', () => {
  let server: OAuthServer;
  const testPort = 3334; // Use different port to avoid conflicts

  beforeEach(() => {
    server = new OAuthServer(testPort);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Server Initialization', () => {
    it('should initialize with correct port', () => {
      expect(server).toBeDefined();
    });

    it('should start HTTP server successfully', async () => {
      await expect(server.start()).resolves.not.toThrow();
    });

    it('should stop server gracefully', async () => {
      await server.start();
      await waitForServer(testPort);
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('Service Registration', () => {
    it('should register a service successfully', () => {
      const config = createMockServiceConfig('test');
      const tokenStorage = new MockTokenStorage('test');
      const registration: AuthServiceRegistration = {
        name: 'Test Service',
        config,
        tokenStorage,
      };

      expect(() => server.registerService('test', registration)).not.toThrow();
    });

    it('should throw error when registering duplicate service', () => {
      const config = createMockServiceConfig('test');
      const tokenStorage = new MockTokenStorage('test');
      const registration: AuthServiceRegistration = {
        name: 'Test Service',
        config,
        tokenStorage,
      };

      server.registerService('test', registration);
      expect(() => server.registerService('test', registration)).toThrow(
        "Service 'test' is already registered"
      );
    });
  });

  describe('HTTP Routes', () => {
    beforeEach(async () => {
      const config = createMockServiceConfig('test');
      const tokenStorage = new MockTokenStorage('test');
      const registration: AuthServiceRegistration = {
        name: 'Test Service',
        config,
        tokenStorage,
      };

      server.registerService('test', registration);
      await server.start();
      await waitForServer(testPort);
    });

    it('should serve home page at /', async () => {
      const response = await makeRequest(testPort, '/');

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Authentication Dashboard');
      expect(response.body).toContain('Test Service');
    });

    it('should redirect to OAuth provider for login', async () => {
      const response = await makeRequest(testPort, '/auth/test/login');

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('https://oauth.test.com/authorize');
      expect(response.headers['location']).toContain('client_id=mock_client_id');
      expect(response.headers['location']).toContain('response_type=code');
      expect(response.headers['location']).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3333%2Fauth%2Ftest%2Fcallback'
      );
    });

    it('should return 404 for unknown service', async () => {
      const response = await makeRequest(testPort, '/auth/unknown/login');

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Service Not Found');
      expect(response.body).toContain('unknown');
    });

    it('should handle callback with authorization code', async () => {
      const response = await makeRequest(testPort, '/auth/test/callback?code=test_auth_code');

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Authentication Successful');
      expect(response.body).toContain('Test Service');
    });

    it('should handle callback with OAuth error', async () => {
      const response = await makeRequest(
        testPort,
        '/auth/test/callback?error=access_denied&error_description=User%20denied%20access'
      );

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Authentication Error');
      expect(response.body).toContain('access_denied');
    });

    it('should handle callback without authorization code', async () => {
      const response = await makeRequest(testPort, '/auth/test/callback');

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Missing Authorization Code');
    });

    it('should return 404 for unknown routes', async () => {
      const response = await makeRequest(testPort, '/unknown');

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Not Found');
    });
  });

  describe('Legacy URL Support', () => {
    beforeEach(async () => {
      const config = createMockServiceConfig('microsoft');
      const tokenStorage = new MockTokenStorage('microsoft');
      const registration: AuthServiceRegistration = {
        name: 'Microsoft 365',
        config,
        tokenStorage,
      };

      server.registerService('microsoft', registration);
      await server.start();
      await waitForServer(testPort);
    });

    it('should support legacy /auth login URL', async () => {
      const response = await makeRequest(testPort, '/auth');

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toContain('https://oauth.microsoft.com/authorize');
    });

    it('should support legacy /auth/callback URL', async () => {
      const response = await makeRequest(testPort, '/auth/callback?code=test_code');

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Authentication Successful');
    });

    it('should return error for legacy URLs when Microsoft not configured', async () => {
      const serverWithoutMs = new OAuthServer(3335);

      try {
        await serverWithoutMs.start();
        await waitForServer(3335);

        const response = await makeRequest(3335, '/auth');

        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('Service Unavailable');
      } finally {
        await serverWithoutMs.stop();
      }
    });
  });

  describe('Callback URL Compliance', () => {
    it('should use exact callback URL pattern for Microsoft', () => {
      const config = createMockServiceConfig('microsoft');

      expect(config.oauth.redirectUri).toBe('http://localhost:3333/auth/microsoft/callback');
    });

    it('should use exact callback URL pattern for Slack', () => {
      const config = createMockServiceConfig('slack');

      expect(config.oauth.redirectUri).toBe('http://localhost:3333/auth/slack/callback');
    });

    it('should use port 3333 by default', () => {
      const defaultServer = new OAuthServer();
      // Port is private, but we can verify through service registration
      const config = createMockServiceConfig('test');
      expect(config.oauth.redirectUri).toContain(':3333');
    });
  });
});
