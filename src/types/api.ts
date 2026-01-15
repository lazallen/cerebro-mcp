/**
 * API client types for HTTP requests and responses
 *
 * Defines generic types for API responses, errors, and pagination.
 */

/**
 * Generic API response wrapper
 * @template T Type of the response data
 */
export interface APIResponse<T> {
  /** Response data payload */
  data: T;

  /** HTTP status code */
  status: number;

  /** Response headers */
  headers?: Record<string, string>;

  /** Pagination information (if applicable) */
  pagination?: PaginationInfo;
}

/**
 * Pagination information for paginated API responses
 */
export interface PaginationInfo {
  /** Link to next page (e.g., @odata.nextLink for Microsoft Graph) */
  nextLink?: string;

  /** Current page number (if available) */
  page?: number;

  /** Total number of items (if available) */
  total?: number;

  /** Items per page */
  pageSize?: number;
}

/**
 * API error with context
 * Extends native Error with additional API-specific information
 */
export class APIError extends Error {
  /** HTTP status code */
  public readonly status: number;

  /** Service name that generated the error */
  public readonly service: string;

  /** Operation that failed */
  public readonly operation: string;

  /** Additional error context */
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    service: string,
    operation: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.service = service;
    this.operation = operation;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      service: this.service,
      operation: this.operation,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * HTTP request configuration
 */
export interface RequestConfig {
  /** Request method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** Request headers */
  headers?: Record<string, string>;

  /** Request body (for POST/PUT/PATCH) */
  body?: unknown;

  /** Query parameters */
  params?: Record<string, string | number | boolean>;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** Whether to follow pagination automatically */
  followPagination?: boolean;
}

/**
 * Mock request handler for test mode
 * @template T Type of the mocked response data
 */
export type MockRequestHandler<T> = (config: RequestConfig) => Promise<APIResponse<T>>;
