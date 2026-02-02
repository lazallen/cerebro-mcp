/**
 * Retry Handler with Exponential Backoff
 *
 * Implements retry logic for transient failures with exponential backoff strategy
 * Per specification: max 3 attempts, base delay 1000ms, max delay 30000ms
 */

import { logger } from '../../common';
import type { RetryConfig } from '../../types/calendar';

/**
 * Default retry configuration per specification clarifications
 */
const DEFAULT_RETRY_CONFIG: Omit<RetryConfig, 'currentAttempt'> = {
  maxAttempts: 3, // Per spec clarification
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
};

/**
 * Determines if an error should be retried
 * Retryable: 429 (always), 500, 503, network errors
 * Not retryable: 400, 401, 403, 404, 409 (client errors)
 */
export function isRetryableError(error: unknown): boolean {
  // Handle APIError or error-like objects with status property
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;

    // Always retry rate limiting
    if (status === 429) return true;

    // Retry server errors
    if (status === 500 || status === 503) return true;

    // Don't retry client errors
    if (status >= 400 && status < 500) return false;
  }

  // Handle network errors (ECONNREFUSED, ETIMEDOUT, etc.)
  if (error instanceof Error) {
    const errorCode = (error as Error & { code?: string }).code;
    if (errorCode) {
      const networkErrors = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ENETUNREACH',
        'ECONNRESET',
      ];
      return networkErrors.includes(errorCode);
    }
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Extracts Retry-After header value from error
 * Returns delay in milliseconds if header is present
 *
 * @param error - Error object that may contain headers
 * @returns Delay in milliseconds, or undefined if not found
 */
export function extractRetryAfterDelay(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    // Check for headers in error context
    const errorWithContext = error as { context?: { headers?: Record<string, string> } };
    if (errorWithContext.context?.headers) {
      const headers = errorWithContext.context.headers;

      // Check for retry-after header (case-insensitive)
      const retryAfter =
        headers['retry-after'] ||
        headers['Retry-After'] ||
        Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];

      if (retryAfter) {
        // Parse as integer (seconds)
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds) && seconds > 0) {
          logger.debug({
            operation: 'retry_after_header_found',
            retryAfterSeconds: seconds,
            msg: `Using Retry-After header value: ${seconds} seconds`,
          });
          return seconds * 1000; // Convert to milliseconds
        }
      }
    }
  }
  return undefined;
}

/**
 * Calculates exponential backoff delay
 * Formula: delay = min(baseDelay * 2^attempt, maxDelay)
 *
 * @param attempt - Current attempt number (0-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Omit<RetryConfig, 'currentAttempt'> = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.baseDelay * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * Sleeps for specified milliseconds
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry Handler Class
 *
 * Manages retry state and execution with exponential backoff
 */
export class RetryHandler {
  private currentAttempt = 0;
  private readonly config: Omit<RetryConfig, 'currentAttempt'>;

  constructor(config?: Partial<Omit<RetryConfig, 'currentAttempt'>>) {
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };
  }

  /**
   * Executes operation with retry logic
   *
   * @param operation - Async operation to execute
   * @returns Operation result
   * @throws Last error if all retries exhausted
   */
  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    this.currentAttempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await operation();
        if (this.currentAttempt > 0) {
          logger.info({
            operation: 'retry_success',
            attempt: this.currentAttempt + 1,
            msg: `Operation succeeded after ${this.currentAttempt} ${
              this.currentAttempt === 1 ? 'retry' : 'retries'
            }`,
          });
        }
        return result;
      } catch (error) {
        // Check if we should retry
        if (!isRetryableError(error)) {
          logger.debug({
            operation: 'retry_not_retryable',
            error: error instanceof Error ? error.message : String(error),
            msg: 'Error is not retryable, failing immediately',
          });
          throw error;
        }

        // Check if we've exhausted retries
        if (this.currentAttempt >= this.config.maxAttempts) {
          logger.error({
            operation: 'retry_exhausted',
            maxAttempts: this.config.maxAttempts,
            error: error instanceof Error ? error.message : String(error),
            msg: `All ${this.config.maxAttempts} retry attempts exhausted`,
          });
          throw error;
        }

        // Calculate delay: use Retry-After header if present, otherwise exponential backoff
        const retryAfterDelay = extractRetryAfterDelay(error);
        const delay = retryAfterDelay ?? calculateBackoffDelay(this.currentAttempt, this.config);
        this.currentAttempt++;

        logger.info({
          operation: 'retry_attempt',
          attempt: this.currentAttempt,
          maxAttempts: this.config.maxAttempts,
          delayMs: delay,
          delaySource: retryAfterDelay ? 'retry-after-header' : 'exponential-backoff',
          error: error instanceof Error ? error.message : String(error),
          msg: `Retrying operation (attempt ${this.currentAttempt}/${this.config.maxAttempts}) after ${delay}ms`,
        });

        await sleep(delay);
      }
    }
  }

  /**
   * Resets retry counter
   * Useful for reusing the same handler for multiple operations
   */
  reset(): void {
    this.currentAttempt = 0;
  }

  /**
   * Gets current retry configuration
   */
  getConfig(): RetryConfig {
    return {
      ...this.config,
      currentAttempt: this.currentAttempt,
    };
  }
}
