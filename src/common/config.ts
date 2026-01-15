/**
 * Global Configuration
 *
 * Loads and validates global application configuration from environment variables.
 */

import * as dotenv from 'dotenv';
import { logger } from './logger';

// Load environment variables from .env file
dotenv.config();

/**
 * Global application configuration
 */
export interface GlobalConfig {
  /** Server name */
  serverName: string;

  /** Server version */
  serverVersion: string;

  /** Auth server port */
  authServerPort: number;

  /** Whether to use test/mock mode */
  useTestMode: boolean;

  /** Log level */
  logLevel: string;

  /** Node environment */
  nodeEnv: string;
}

/**
 * Validate required environment variables
 * @param requiredVars Array of required environment variable names
 * @throws Error if any required variables are missing
 */
export function validateRequiredEnvVars(requiredVars: string[]): void {
  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error({ operation: 'config_validation', missingVars: missing }, errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Get integer from environment variable with default
 * @param varName Environment variable name
 * @param defaultValue Default value if not set
 * @returns Parsed integer value
 */
function getEnvInt(varName: string, defaultValue: number): number {
  const value = process.env[varName];
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    logger.warn(
      { operation: 'config_parsing', varName, value, defaultValue },
      `Invalid integer for ${varName}, using default ${defaultValue}`
    );
    return defaultValue;
  }

  return parsed;
}

/**
 * Get boolean from environment variable with default
 * @param varName Environment variable name
 * @param defaultValue Default value if not set
 * @returns Boolean value
 */
function getEnvBool(varName: string, defaultValue: boolean): boolean {
  const value = process.env[varName];
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Load global configuration
 * @returns Global configuration object
 */
export function loadGlobalConfig(): GlobalConfig {
  const config: GlobalConfig = {
    serverName: process.env['SERVER_NAME'] ?? 'cerebro-mcp-ts',
    serverVersion: process.env['SERVER_VERSION'] ?? '0.1.0',
    authServerPort: getEnvInt('AUTH_SERVER_PORT', 3333),
    useTestMode: getEnvBool('USE_TEST_MODE', false),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
  };

  logger.info(
    {
      operation: 'config_loaded',
      config: {
        serverName: config.serverName,
        serverVersion: config.serverVersion,
        authServerPort: config.authServerPort,
        useTestMode: config.useTestMode,
        logLevel: config.logLevel,
        nodeEnv: config.nodeEnv,
      },
    },
    'Configuration loaded'
  );

  return config;
}

/**
 * Global configuration instance
 */
export const globalConfig = loadGlobalConfig();
