/**
 * Base API Client
 *
 * Abstract base class for making HTTP/HTTPS API requests with Bearer token authentication.
 * Supports pagination, error handling, configurable timeouts, and mock mode for testing.
 *
 * @template T Type of API response data
 */

import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as querystring from 'querystring';
import {
  APIResponse,
  APIError,
  RequestConfig,
  PaginationInfo,
  MockRequestHandler,
} from '../types/api';

export abstract class BaseAPIClient<T = unknown> {
  protected readonly apiEndpoint: string;
  protected readonly serviceName: string;
  protected readonly timeout: number;
  protected readonly useTestMode: boolean;
  protected mockHandler?: MockRequestHandler<T>;

  /**
   * Create a new API client
   * @param apiEndpoint Base API endpoint URL
   * @param serviceName Service name for error context
   * @param timeout Request timeout in milliseconds (default 30000)
   * @param useTestMode Whether to use mock mode (default from USE_TEST_MODE env)
   */
  constructor(
    apiEndpoint: string,
    serviceName: string,
    timeout: number = 30000,
    useTestMode?: boolean
  ) {
    this.apiEndpoint = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint;
    this.serviceName = serviceName;
    this.timeout = timeout;
    this.useTestMode = useTestMode ?? process.env['USE_TEST_MODE'] === 'true';
  }

  /**
   * Set mock request handler for test mode
   * @param handler Mock handler function
   */
  setMockHandler(handler: MockRequestHandler<T>): void {
    this.mockHandler = handler;
  }

  /**
   * Get access token for authentication
   * Must be implemented by subclasses
   * @returns Promise resolving to access token
   */
  protected abstract getAccessToken(): Promise<string>;

  /**
   * Make a single API request
   * @param path API path (relative to apiEndpoint)
   * @param config Request configuration
   * @returns Promise resolving to API response
   */
  protected async makeRequest(path: string, config: RequestConfig): Promise<APIResponse<T>> {
    // Use mock handler in test mode
    if (this.useTestMode && this.mockHandler) {
      return this.mockHandler(config);
    }

    const accessToken = await this.getAccessToken();
    const fullUrl = `${this.apiEndpoint}${path}`;

    // Build query string
    let requestUrl = fullUrl;
    if (config.params) {
      const query = querystring.stringify(config.params as Record<string, string>);
      requestUrl = `${fullUrl}?${query}`;
    }

    const parsedUrl = url.parse(requestUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Build headers
    const headers: http.OutgoingHttpHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    };

    // Build request body
    let body: string | undefined;
    if (config.body) {
      body = JSON.stringify(config.body);
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        method: config.method,
        headers,
        timeout: config.timeout ?? this.timeout,
      };

      const req = httpModule.request(requestUrl, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const statusCode = res.statusCode ?? 500;
            const responseHeaders: Record<string, string> = {};
            Object.entries(res.headers).forEach(([key, value]) => {
              if (value) {
                responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
              }
            });

            // Parse response body
            let parsedData: T;
            try {
              parsedData = data ? (JSON.parse(data) as T) : ({} as T);
            } catch (parseError) {
              throw new APIError(
                `Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
                statusCode,
                this.serviceName,
                `${config.method} ${path}`,
                { rawData: data }
              );
            }

            // Handle error status codes
            if (statusCode >= 400) {
              const errorMessage = this.extractErrorMessage(parsedData, statusCode);
              throw new APIError(
                errorMessage,
                statusCode,
                this.serviceName,
                `${config.method} ${path}`,
                { response: parsedData }
              );
            }

            // Extract pagination info
            const pagination = this.extractPaginationInfo(parsedData, responseHeaders);

            resolve({
              data: parsedData,
              status: statusCode,
              headers: responseHeaders,
              pagination,
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(
          new APIError(
            `Request failed: ${error.message}`,
            0,
            this.serviceName,
            `${config.method} ${path}`,
            { originalError: error }
          )
        );
      });

      req.on('timeout', () => {
        req.destroy();
        reject(
          new APIError(
            `Request timeout after ${config.timeout ?? this.timeout}ms`,
            0,
            this.serviceName,
            `${config.method} ${path}`
          )
        );
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Make a paginated API request, automatically following pagination links
   * @param path API path (relative to apiEndpoint)
   * @param config Request configuration
   * @returns Promise resolving to array of all pages
   */
  protected async makePaginatedRequest(
    path: string,
    config: RequestConfig
  ): Promise<APIResponse<T>[]> {
    const responses: APIResponse<T>[] = [];
    let currentPath: string | undefined = path;
    let currentConfig = { ...config };

    while (currentPath) {
      const response = await this.makeRequest(currentPath, currentConfig);
      responses.push(response);

      // Check if there's a next page
      if (config.followPagination !== false && response.pagination?.nextLink) {
        // Extract path from nextLink
        const nextUrl = url.parse(response.pagination.nextLink);
        currentPath = nextUrl.path ?? undefined;
        // Clear params for next request (they're in the nextLink)
        currentConfig = { ...config, params: undefined };
      } else {
        currentPath = undefined;
      }
    }

    return responses;
  }

  /**
   * Extract error message from API response
   * Can be overridden by subclasses for service-specific error formats
   * @param response Parsed response data
   * @param statusCode HTTP status code
   * @returns Error message string
   */
  protected extractErrorMessage(response: unknown, statusCode: number): string {
    if (typeof response === 'object' && response !== null) {
      // Try common error message fields
      const errorObj = response as Record<string, unknown>;
      if (typeof errorObj['error'] === 'string') {
        return errorObj['error'];
      }
      if (typeof errorObj['message'] === 'string') {
        return errorObj['message'];
      }
      if (typeof errorObj['error'] === 'object' && errorObj['error'] !== null) {
        const nestedError = errorObj['error'] as Record<string, unknown>;
        if (typeof nestedError['message'] === 'string') {
          return nestedError['message'];
        }
      }
    }

    return `HTTP ${statusCode} error`;
  }

  /**
   * Extract pagination information from response
   * Can be overridden by subclasses for service-specific pagination formats
   * @param response Parsed response data
   * @param headers Response headers
   * @returns Pagination info or undefined
   */
  protected extractPaginationInfo(
    response: unknown,
    _headers: Record<string, string>
  ): PaginationInfo | undefined {
    if (typeof response === 'object' && response !== null) {
      const responseObj = response as Record<string, unknown>;

      // Microsoft Graph pagination (@odata.nextLink)
      if (typeof responseObj['@odata.nextLink'] === 'string') {
        return {
          nextLink: responseObj['@odata.nextLink'],
        };
      }

      // Generic pagination
      if (typeof responseObj['nextLink'] === 'string') {
        return {
          nextLink: responseObj['nextLink'],
        };
      }
    }

    return undefined;
  }
}
