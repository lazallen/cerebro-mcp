/**
 * Retry Handler Unit Tests
 *
 * Tests exponential backoff, max attempts, and retryable error detection
 */

import {
  RetryHandler,
  calculateBackoffDelay,
  isRetryableError,
  extractRetryAfterDelay,
} from '../retry-handler';

describe('RetryHandler', () => {
  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      // Attempt 0: 1000 * 2^0 = 1000ms
      expect(calculateBackoffDelay(0)).toBe(1000);

      // Attempt 1: 1000 * 2^1 = 2000ms
      expect(calculateBackoffDelay(1)).toBe(2000);

      // Attempt 2: 1000 * 2^2 = 4000ms
      expect(calculateBackoffDelay(2)).toBe(4000);

      // Attempt 3: 1000 * 2^3 = 8000ms
      expect(calculateBackoffDelay(3)).toBe(8000);

      // Attempt 4: 1000 * 2^4 = 16000ms
      expect(calculateBackoffDelay(4)).toBe(16000);
    });

    it('should cap delay at maxDelay', () => {
      // Attempt 5: 1000 * 2^5 = 32000ms, but capped at 30000ms
      expect(calculateBackoffDelay(5)).toBe(30000);

      // Attempt 10: Should still be capped
      expect(calculateBackoffDelay(10)).toBe(30000);
    });

    it('should support custom config', () => {
      const config = {
        baseDelay: 500,
        maxDelay: 5000,
        maxAttempts: 3,
      };

      // Attempt 0: 500 * 2^0 = 500ms
      expect(calculateBackoffDelay(0, config)).toBe(500);

      // Attempt 3: 500 * 2^3 = 4000ms
      expect(calculateBackoffDelay(3, config)).toBe(4000);

      // Attempt 4: 500 * 2^4 = 8000ms, capped at 5000ms
      expect(calculateBackoffDelay(4, config)).toBe(5000);
    });
  });

  describe('isRetryableError', () => {
    it('should mark 429 as retryable (rate limiting)', () => {
      const error = { status: 429, message: 'Too Many Requests' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark 500 as retryable (server error)', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark 503 as retryable (service unavailable)', () => {
      const error = { status: 503, message: 'Service Unavailable' };
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark 400 as not retryable (bad request)', () => {
      const error = { status: 400, message: 'Bad Request' };
      expect(isRetryableError(error)).toBe(false);
    });

    it('should mark 401 as not retryable (unauthorized)', () => {
      const error = { status: 401, message: 'Unauthorized' };
      expect(isRetryableError(error)).toBe(false);
    });

    it('should mark 403 as not retryable (forbidden)', () => {
      const error = { status: 403, message: 'Forbidden' };
      expect(isRetryableError(error)).toBe(false);
    });

    it('should mark 404 as not retryable (not found)', () => {
      const error = { status: 404, message: 'Not Found' };
      expect(isRetryableError(error)).toBe(false);
    });

    it('should mark 409 as not retryable (conflict)', () => {
      const error = { status: 409, message: 'Conflict' };
      expect(isRetryableError(error)).toBe(false);
    });

    it('should mark network errors as retryable', () => {
      const errors = [
        Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('Not found'), { code: 'ENOTFOUND' }),
        Object.assign(new Error('Network unreachable'), { code: 'ENETUNREACH' }),
        Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }),
      ];

      errors.forEach((error) => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should mark unknown errors as not retryable', () => {
      expect(isRetryableError(new Error('Unknown error'))).toBe(false);
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError({})).toBe(false);
    });
  });

  describe('RetryHandler.executeWithRetry', () => {
    it('should succeed on first attempt without retry', async () => {
      const handler = new RetryHandler();
      const operation = jest.fn().mockResolvedValue('success');

      const result = await handler.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable errors and eventually succeed', async () => {
      const handler = new RetryHandler({ maxAttempts: 3, baseDelay: 10, maxDelay: 100 });
      const operation = jest
        .fn()
        .mockRejectedValueOnce({ status: 500, message: 'Server Error' })
        .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
        .mockResolvedValue('success');

      const result = await handler.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should stop retrying after maxAttempts', async () => {
      const handler = new RetryHandler({ maxAttempts: 2, baseDelay: 10, maxDelay: 100 });
      const operation = jest.fn().mockRejectedValue({ status: 500, message: 'Server Error' });

      await expect(handler.executeWithRetry(operation)).rejects.toEqual({
        status: 500,
        message: 'Server Error',
      });

      // Initial attempt + 2 retries = 3 total calls
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const handler = new RetryHandler();
      const operation = jest.fn().mockRejectedValue({ status: 404, message: 'Not Found' });

      await expect(handler.executeWithRetry(operation)).rejects.toEqual({
        status: 404,
        message: 'Not Found',
      });

      // Should fail immediately without retry
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should reset attempt counter after successful operation', async () => {
      const handler = new RetryHandler({ maxAttempts: 3, baseDelay: 10, maxDelay: 100 });

      // First operation with retries
      const operation1 = jest
        .fn()
        .mockRejectedValueOnce({ status: 500 })
        .mockResolvedValue('success1');

      await handler.executeWithRetry(operation1);
      expect(handler.getConfig().currentAttempt).toBe(1);

      // Reset and second operation should start fresh
      handler.reset();
      const operation2 = jest.fn().mockResolvedValue('success2');

      await handler.executeWithRetry(operation2);
      expect(handler.getConfig().currentAttempt).toBe(0);
      expect(operation2).toHaveBeenCalledTimes(1);
    });

    it('should enforce max 3 attempts per spec', async () => {
      const handler = new RetryHandler(); // Default config has maxAttempts: 3
      const operation = jest.fn().mockRejectedValue({ status: 500 });

      await expect(handler.executeWithRetry(operation)).rejects.toBeDefined();

      // Initial attempt + 3 retries = 4 total calls
      expect(operation).toHaveBeenCalledTimes(4);
    });
  });

  describe('RetryHandler.getConfig', () => {
    it('should return current retry configuration', () => {
      const handler = new RetryHandler();
      const config = handler.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(30000);
      expect(config.currentAttempt).toBe(0);
    });

    it('should reflect custom configuration', () => {
      const customConfig = {
        maxAttempts: 5,
        baseDelay: 500,
        maxDelay: 10000,
      };

      const handler = new RetryHandler(customConfig);
      const config = handler.getConfig();

      expect(config.maxAttempts).toBe(5);
      expect(config.baseDelay).toBe(500);
      expect(config.maxDelay).toBe(10000);
    });
  });

  describe('extractRetryAfterDelay', () => {
    it('should extract Retry-After header value in seconds', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'retry-after': '5',
          },
        },
      };

      const delay = extractRetryAfterDelay(error);
      expect(delay).toBe(5000); // 5 seconds = 5000ms
    });

    it('should handle Retry-After with capital letters', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'Retry-After': '10',
          },
        },
      };

      const delay = extractRetryAfterDelay(error);
      expect(delay).toBe(10000);
    });

    it('should handle case-insensitive header lookup', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'RETRY-AFTER': '3',
          },
        },
      };

      const delay = extractRetryAfterDelay(error);
      expect(delay).toBe(3000);
    });

    it('should return undefined if no Retry-After header', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'content-type': 'application/json',
          },
        },
      };

      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it('should return undefined if header value is invalid', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'retry-after': 'invalid',
          },
        },
      };

      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it('should return undefined if header value is negative', () => {
      const error = {
        status: 429,
        context: {
          headers: {
            'retry-after': '-5',
          },
        },
      };

      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it('should return undefined for errors without context', () => {
      const error = { status: 500, message: 'Server Error' };
      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it('should return undefined for non-object errors', () => {
      expect(extractRetryAfterDelay('string error')).toBeUndefined();
      expect(extractRetryAfterDelay(null)).toBeUndefined();
      expect(extractRetryAfterDelay(undefined)).toBeUndefined();
    });
  });

  describe('RetryHandler with Retry-After header', () => {
    it('should use Retry-After delay instead of exponential backoff', async () => {
      const handler = new RetryHandler({ maxAttempts: 2, baseDelay: 10, maxDelay: 100 });
      const startTime = Date.now();

      const operation = jest
        .fn()
        .mockRejectedValueOnce({
          status: 429,
          context: {
            headers: {
              'retry-after': '0', // 0 seconds for fast test
            },
          },
        })
        .mockResolvedValue('success');

      const result = await handler.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);

      // Should have used Retry-After (0ms) instead of baseDelay (10ms)
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(50); // Allow some overhead
    });
  });
});
