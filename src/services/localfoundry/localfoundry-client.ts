/**
 * LocalFoundry HTTP Client
 *
 * HTTP client for communicating with LocalFoundry Chat Completions API.
 * Follows OpenAI-compatible API format.
 */

import { logger } from '../../common/logger';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  LocalFoundryConfig,
} from './types';

export class LocalFoundryClient {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config: LocalFoundryConfig) {
    this.endpoint = config.endpoint;
    this.model = config.model;
    this.timeout = config.timeout;

    logger.info(
      {
        operation: 'localfoundry_client_init',
        endpoint: this.endpoint,
        model: this.model,
        timeout: this.timeout,
      },
      'LocalFoundry client initialized'
    );
  }

  /**
   * Send a chat completion request to LocalFoundry
   *
   * @param messages - Array of chat messages (system + user prompts)
   * @param options - Optional request parameters
   * @returns Generated text content from the assistant
   * @throws Error if request fails or times out
   */
  async chatCompletion(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      max_tokens?: number;
    }
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const request: ChatCompletionRequest = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens,
    };

    try {
      logger.debug(
        {
          operation: 'localfoundry_request',
          endpoint: this.endpoint,
          model: this.model,
          messageCount: messages.length,
        },
        'Sending chat completion request'
      );

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        const errorMessage = `LocalFoundry request failed: HTTP ${response.status} - ${errorText}`;

        logger.error(
          {
            operation: 'localfoundry_request_error',
            status: response.status,
            error: errorText,
          },
          errorMessage
        );

        throw new Error(errorMessage);
      }

      const data: ChatCompletionResponse = (await response.json()) as ChatCompletionResponse;

      if (!data.choices || data.choices.length === 0) {
        throw new Error('LocalFoundry returned empty choices array');
      }

      const choice = data.choices[0];
      if (!choice?.message?.content) {
        throw new Error('LocalFoundry returned invalid response structure');
      }

      const content = choice.message.content;

      logger.debug(
        {
          operation: 'localfoundry_response',
          responseLength: content.length,
          finishReason: choice.finish_reason,
          usage: data.usage,
        },
        'Received chat completion response'
      );

      return content;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        // Handle abort/timeout errors
        if (error.name === 'AbortError') {
          const timeoutError = new Error(
            `Request timed out after ${this.timeout}ms. Consider reducing text length or increasing LOCALFOUNDRY_TIMEOUT environment variable.`
          );

          logger.error(
            {
              operation: 'localfoundry_timeout',
              timeout: this.timeout,
            },
            'LocalFoundry request timed out'
          );

          throw timeoutError;
        }

        // Handle network errors (ECONNREFUSED, etc.)
        if (
          'code' in error &&
          typeof (error as NodeJS.ErrnoException).code === 'string' &&
          (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
        ) {
          const networkError = new Error(
            `LocalFoundry endpoint unreachable at ${this.endpoint}. Ensure LocalFoundry is running and the endpoint URL is correct.`
          );

          logger.error(
            {
              operation: 'localfoundry_connection_error',
              endpoint: this.endpoint,
              error: error.message,
            },
            'Failed to connect to LocalFoundry endpoint'
          );

          throw networkError;
        }

        // Handle fetch errors
        if (error.message.includes('fetch failed')) {
          const networkError = new Error(
            `LocalFoundry endpoint unreachable at ${this.endpoint}. Ensure LocalFoundry is running.`
          );

          logger.error(
            {
              operation: 'localfoundry_fetch_error',
              endpoint: this.endpoint,
              error: error.message,
            },
            'Failed to fetch from LocalFoundry endpoint'
          );

          throw networkError;
        }
      }

      // Re-throw other errors
      logger.error(
        {
          operation: 'localfoundry_unexpected_error',
          error: error instanceof Error ? error.message : String(error),
        },
        'Unexpected error during LocalFoundry request'
      );

      throw error;
    }
  }

  /**
   * Check if LocalFoundry endpoint is available and responding
   *
   * @returns true if endpoint is reachable, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      logger.debug(
        {
          operation: 'localfoundry_health_check',
          endpoint: this.endpoint,
        },
        'Checking LocalFoundry endpoint health'
      );

      // Simple health check with minimal request
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: 'ping',
        },
      ];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for health check

      const request: ChatCompletionRequest = {
        model: this.model,
        messages,
        max_tokens: 5,
      };

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const isHealthy = response.ok;

      logger.info(
        {
          operation: 'localfoundry_health_check_result',
          endpoint: this.endpoint,
          status: response.status,
          healthy: isHealthy,
        },
        isHealthy ? 'LocalFoundry endpoint is healthy' : 'LocalFoundry endpoint returned error'
      );

      return isHealthy;
    } catch (error) {
      logger.warn(
        {
          operation: 'localfoundry_health_check_failed',
          endpoint: this.endpoint,
          error: error instanceof Error ? error.message : String(error),
        },
        'LocalFoundry health check failed'
      );

      return false;
    }
  }
}
