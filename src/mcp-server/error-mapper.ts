/**
 * MCP Error Types and Mapper
 *
 * Maps application errors to JSON-RPC 2.0 error codes
 * and provides MCP-specific error classes.
 */

import { APIError } from '../types/api';

/**
 * JSON-RPC 2.0 error codes
 */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * MCP-specific error codes (application-defined range: -32000 to -32099)
 */
export const MCP_ERROR_CODES = {
  TOOL_NOT_FOUND: -32000,
  TOOL_VALIDATION_ERROR: -32001,
  TOOL_EXECUTION_ERROR: -32002,
  AUTHENTICATION_REQUIRED: -32003,
  TOOL_TIMEOUT: -32004,
  SERVICE_NOT_FOUND: -32005,
} as const;

/**
 * JSON-RPC error response format
 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: {
    service?: string;
    operation?: string;
    toolName?: string;
    correlationId?: string;
    details?: unknown;
  };
}

/**
 * Base MCP error class
 */
export class MCPError extends APIError {
  public readonly code: number;
  public readonly toolName?: string;
  public readonly correlationId?: string;

  constructor(
    message: string,
    code: number,
    service: string,
    operation: string,
    context?: {
      toolName?: string;
      correlationId?: string;
      details?: unknown;
    }
  ) {
    super(message, 0, service, operation, context);
    this.name = 'MCPError';
    this.code = code;
    this.toolName = context?.toolName;
    this.correlationId = context?.correlationId;
  }

  /**
   * Convert to JSON-RPC error format
   */
  toJSONRPC(): JSONRPCError {
    return {
      code: this.code,
      message: this.message,
      data: {
        service: this.service,
        operation: this.operation,
        toolName: this.toolName,
        correlationId: this.correlationId,
        details: this.context,
      },
    };
  }
}

/**
 * Tool not found error
 */
export class ToolNotFoundError extends MCPError {
  constructor(toolName: string, availableTools: string[], correlationId?: string) {
    super(
      `Tool '${toolName}' not found`,
      MCP_ERROR_CODES.TOOL_NOT_FOUND,
      'mcp-server',
      'tool_lookup',
      {
        toolName,
        correlationId,
        details: { availableTools },
      }
    );
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Tool validation error (invalid input)
 */
export class ToolValidationError extends MCPError {
  constructor(toolName: string, validationErrors: unknown, correlationId?: string) {
    super(
      `Tool '${toolName}' input validation failed`,
      MCP_ERROR_CODES.TOOL_VALIDATION_ERROR,
      'mcp-server',
      'input_validation',
      {
        toolName,
        correlationId,
        details: { validationErrors },
      }
    );
    this.name = 'ToolValidationError';
  }
}

/**
 * Tool execution error
 */
export class ToolExecutionError extends MCPError {
  constructor(toolName: string, originalError: Error | APIError, correlationId?: string) {
    const message =
      originalError instanceof APIError
        ? `${originalError.service}.${originalError.operation}: ${originalError.message}`
        : originalError.message;

    super(
      `Tool '${toolName}' execution failed: ${message}`,
      MCP_ERROR_CODES.TOOL_EXECUTION_ERROR,
      originalError instanceof APIError ? originalError.service : 'unknown',
      'tool_execution',
      {
        toolName,
        correlationId,
        details: {
          originalError: {
            name: originalError.name,
            message: originalError.message,
            ...(originalError instanceof APIError && {
              service: originalError.service,
              operation: originalError.operation,
              status: originalError.status,
            }),
          },
        },
      }
    );
    this.name = 'ToolExecutionError';
  }
}

/**
 * Authentication required error
 */
export class AuthenticationRequiredError extends MCPError {
  constructor(service: string, authUrl: string, correlationId?: string) {
    super(
      `Authentication required for service '${service}'. Please authenticate at: ${authUrl}`,
      MCP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      service,
      'authentication_check',
      {
        correlationId,
        details: { authUrl },
      }
    );
    this.name = 'AuthenticationRequiredError';
  }
}

/**
 * Tool timeout error
 */
export class ToolTimeoutError extends MCPError {
  constructor(toolName: string, timeoutMs: number, correlationId?: string) {
    super(
      `Tool '${toolName}' execution timed out after ${timeoutMs}ms`,
      MCP_ERROR_CODES.TOOL_TIMEOUT,
      'mcp-server',
      'tool_execution',
      {
        toolName,
        correlationId,
        details: { timeoutMs },
      }
    );
    this.name = 'ToolTimeoutError';
  }
}

/**
 * Service not found error
 */
export class ServiceNotFoundError extends MCPError {
  constructor(serviceName: string, availableServices: string[], correlationId?: string) {
    super(
      `Service '${serviceName}' not found or not registered`,
      MCP_ERROR_CODES.SERVICE_NOT_FOUND,
      'mcp-server',
      'service_lookup',
      {
        correlationId,
        details: { serviceName, availableServices },
      }
    );
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * Map any error to JSON-RPC error format
 */
export function mapErrorToJSONRPC(error: unknown, correlationId?: string): JSONRPCError {
  // MCP errors already have JSON-RPC format
  if (error instanceof MCPError) {
    return error.toJSONRPC();
  }

  // API errors
  if (error instanceof APIError) {
    return {
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
      data: {
        service: error.service,
        operation: error.operation,
        correlationId,
        details: {
          status: error.status,
          context: error.context,
        },
      },
    };
  }

  // Generic errors
  if (error instanceof Error) {
    return {
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
      data: {
        correlationId,
        details: {
          name: error.name,
          stack: error.stack,
        },
      },
    };
  }

  // Unknown errors
  return {
    code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
    message: 'An unknown error occurred',
    data: {
      correlationId,
      details: { error: String(error) },
    },
  };
}
