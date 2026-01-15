/**
 * Structured Logger
 *
 * Configures and exports pino logger instance with appropriate settings
 * for structured JSON logging with correlation IDs and context.
 */

import pino from 'pino';
import { randomUUID } from 'crypto';

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log context
 */
export interface LogContext {
  /** Correlation ID for request tracing */
  correlationId?: string;

  /** Service name */
  service?: string;

  /** Operation being performed */
  operation?: string;

  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Get log level from environment or default to 'info'
 */
function getLogLevel(): LogLevel {
  const level = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(level)) {
    return level as LogLevel;
  }
  return 'info';
}

/**
 * Determine if we should use pretty printing
 * Pretty print in development (when LOG_PRETTY=true or NODE_ENV=development)
 */
function shouldPrettyPrint(): boolean {
  if (process.env['LOG_PRETTY'] === 'true') {
    return true;
  }
  if (process.env['NODE_ENV'] === 'development' && process.env['LOG_PRETTY'] !== 'false') {
    return true;
  }
  return false;
}

/**
 * Create pino logger with configuration
 */
const createLogger = (): pino.Logger => {
  const prettyPrint = shouldPrettyPrint();

  const pinoConfig: pino.LoggerOptions = {
    level: getLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: {
      // Application base fields
      app: 'cerebro-mcp-ts',
      pid: process.pid,
    },
  };

  if (prettyPrint) {
    return pino({
      ...pinoConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(pinoConfig);
};

/**
 * Global logger instance
 */
export const logger = createLogger();

/**
 * Create a child logger with context
 * @param context Log context to add
 * @returns Child logger with context
 */
export function createChildLogger(context: LogContext): pino.Logger {
  return logger.child(context);
}

/**
 * Generate a new correlation ID
 * @returns UUID v4 correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Log an API request
 * @param method HTTP method
 * @param url Request URL
 * @param correlationId Correlation ID
 * @param service Service name
 */
export function logApiRequest(
  method: string,
  url: string,
  correlationId: string,
  service: string
): void {
  logger.info({
    correlationId,
    service,
    operation: 'api_request',
    method,
    url,
    msg: `${method} ${url}`,
  });
}

/**
 * Log an API response
 * @param method HTTP method
 * @param url Request URL
 * @param status HTTP status code
 * @param durationMs Request duration in milliseconds
 * @param correlationId Correlation ID
 * @param service Service name
 */
export function logApiResponse(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  correlationId: string,
  service: string
): void {
  logger.info({
    correlationId,
    service,
    operation: 'api_response',
    method,
    url,
    status,
    durationMs,
    msg: `${method} ${url} - ${status} (${durationMs}ms)`,
  });
}

/**
 * Log an error with full context
 * @param error Error object
 * @param context Additional context
 */
export function logError(error: Error, context?: LogContext): void {
  logger.error({
    ...context,
    operation: context?.operation ?? 'error',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    msg: error.message,
  });
}

/**
 * Log tool execution
 * @param toolName Tool name
 * @param correlationId Correlation ID
 * @param durationMs Execution duration in milliseconds
 * @param success Whether execution succeeded
 */
export function logToolExecution(
  toolName: string,
  correlationId: string,
  durationMs: number,
  success: boolean
): void {
  const level = success ? 'info' : 'error';
  logger[level]({
    correlationId,
    operation: 'tool_execution',
    toolName,
    durationMs,
    success,
    msg: `Tool ${toolName} ${success ? 'completed' : 'failed'} (${durationMs}ms)`,
  });
}
