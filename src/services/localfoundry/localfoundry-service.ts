/**
 * LocalFoundry Service
 *
 * Provides local LLM text processing capabilities through LocalFoundry integration:
 * - Text summarization
 * - Question answering (clarification)
 * - Structured data extraction
 *
 * No authentication required - localhost endpoint only.
 */

import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common/logger';
import { LocalFoundryClient } from './localfoundry-client';
import { LocalFoundryTokenStorage } from './localfoundry-token-storage';
import { LocalFoundryConfig, SummarizeInput, ClarifyInput, ExtractInput } from './types';

export class LocalFoundryService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string;
  private readonly tokenStorage: LocalFoundryTokenStorage;
  private readonly client: LocalFoundryClient;
  private readonly localFoundryConfig: LocalFoundryConfig;

  constructor(config: ServiceConfig, localFoundryConfig: LocalFoundryConfig) {
    this.config = config;
    this.name = config.name;
    this.localFoundryConfig = localFoundryConfig;
    this.tokenStorage = new LocalFoundryTokenStorage(config.tokenStorePath);
    this.client = new LocalFoundryClient(localFoundryConfig);

    logger.info(
      {
        operation: 'localfoundry_service_construct',
        service: this.name,
        endpoint: localFoundryConfig.endpoint,
        model: localFoundryConfig.model,
      },
      'LocalFoundry service constructed'
    );
  }

  async initialize(): Promise<void> {
    await this.tokenStorage.loadTokens();

    logger.info(
      {
        operation: 'localfoundry_service_init',
        service: this.name,
        endpoint: this.localFoundryConfig.endpoint,
        model: this.localFoundryConfig.model,
      },
      'LocalFoundry service initialized'
    );
  }

  /**
   * Get all tools provided by LocalFoundry service
   */
  getTools(): Tool[] {
    return [
      // Summarize tool
      {
        name: 'summarize',
        description:
          'Summarize long text content concisely. Accepts text (required) and optional maxLength parameter (default: 300 words). Returns a concise summary highlighting key points.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content to summarize (document, code file, or any text)',
            },
            maxLength: {
              type: 'number',
              description: 'Maximum summary length in words (default: 300)',
              default: 300,
            },
          },
          required: ['text'],
        },
        handler: this.summarize.bind(this),
      },

      // Clarify tool
      {
        name: 'clarify',
        description:
          'Answer specific questions about provided text content. Accepts text (required) and question (required). Returns a targeted answer based on the text.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Context text to answer questions about',
            },
            question: {
              type: 'string',
              description: 'Specific question to answer based on the text',
            },
          },
          required: ['text', 'question'],
        },
        handler: this.clarify.bind(this),
      },

      // Extract tool
      {
        name: 'extract',
        description:
          'Extract structured data from unstructured text as JSON. Accepts text (required) and schema description (required). Returns valid JSON matching the requested schema.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to extract structured data from',
            },
            schema: {
              type: 'string',
              description: 'Description of desired JSON structure',
            },
          },
          required: ['text', 'schema'],
        },
        handler: this.extract.bind(this),
      },
    ];
  }

  /**
   * Check if service is available (no authentication needed for local endpoint)
   * Returns true if LocalFoundry endpoint is reachable and responding.
   * @returns true if endpoint is healthy, false otherwise
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const isHealthy = await this.client.healthCheck();
      if (!isHealthy) {
        logger.warn(
          {
            operation: 'localfoundry_health_check_failed',
            endpoint: this.localFoundryConfig.endpoint,
          },
          'LocalFoundry health check failed - endpoint may be unreachable'
        );
      }
      return isHealthy;
    } catch (error) {
      logger.warn(
        {
          operation: 'localfoundry_auth_check',
          error: error instanceof Error ? error.message : String(error),
        },
        'LocalFoundry health check error - endpoint may be unreachable'
      );
      return false;
    }
  }

  /**
   * Cleanup resources on service shutdown
   */
  async shutdown(): Promise<void> {
    logger.info(
      {
        operation: 'localfoundry_service_shutdown',
        service: this.name,
      },
      'LocalFoundry service shutting down'
    );
    // No cleanup needed for LocalFoundry (stateless HTTP client)
    await Promise.resolve(); // Satisfy linter requirement for await
  }

  /**
   * Summarize tool handler
   */
  private async summarize(input: unknown): Promise<{ summary: string }> {
    const { text, maxLength = 300 } = this.validateSummarizeInput(input);

    logger.info(
      {
        operation: 'localfoundry_summarize',
        textLength: text.length,
        maxLength,
      },
      'Processing summarize request'
    );

    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are a text summarization assistant. Provide concise summaries highlighting key points. Keep summaries under the requested length.',
        },
        {
          role: 'user' as const,
          content: `Summarize the following text in no more than ${maxLength} words:\n\n${text}`,
        },
      ];

      const summary = await this.client.chatCompletion(messages);

      logger.info(
        {
          operation: 'localfoundry_summarize_success',
          textLength: text.length,
          summaryLength: summary.length,
        },
        'Summarize request completed successfully'
      );

      return { summary };
    } catch (error) {
      logger.error(
        {
          operation: 'localfoundry_summarize_error',
          error: error instanceof Error ? error.message : String(error),
        },
        'Summarize request failed'
      );
      throw error;
    }
  }

  /**
   * Clarify tool handler
   */
  private async clarify(input: unknown): Promise<{ answer: string }> {
    const { text, question } = this.validateClarifyInput(input);

    logger.info(
      {
        operation: 'localfoundry_clarify',
        textLength: text.length,
        questionLength: question.length,
      },
      'Processing clarify request'
    );

    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are a Q&A assistant. Answer questions based only on the provided text. If the answer is not in the text, say so clearly.',
        },
        {
          role: 'user' as const,
          content: `Text:\n${text}\n\nQuestion: ${question}`,
        },
      ];

      const answer = await this.client.chatCompletion(messages);

      logger.info(
        {
          operation: 'localfoundry_clarify_success',
          textLength: text.length,
          answerLength: answer.length,
        },
        'Clarify request completed successfully'
      );

      return { answer };
    } catch (error) {
      logger.error(
        {
          operation: 'localfoundry_clarify_error',
          error: error instanceof Error ? error.message : String(error),
        },
        'Clarify request failed'
      );
      throw error;
    }
  }

  /**
   * Extract tool handler
   */
  private async extract(input: unknown): Promise<{ extracted: Record<string, unknown> }> {
    const { text, schema } = this.validateExtractInput(input);

    logger.info(
      {
        operation: 'localfoundry_extract',
        textLength: text.length,
        schemaLength: schema.length,
      },
      'Processing extract request'
    );

    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are a data extraction assistant. Extract information matching the requested schema and return ONLY valid JSON. No explanations, just JSON.',
        },
        {
          role: 'user' as const,
          content: `Extract data matching this schema:\n${schema}\n\nFrom this text:\n${text}\n\nReturn only valid JSON.`,
        },
      ];

      const response = await this.client.chatCompletion(messages);

      // Parse and validate JSON response
      let extracted: Record<string, unknown>;
      try {
        extracted = JSON.parse(response) as Record<string, unknown>;
      } catch (parseError) {
        logger.error(
          {
            operation: 'localfoundry_extract_json_parse_error',
            response: response.substring(0, 200),
            error: parseError instanceof Error ? parseError.message : String(parseError),
          },
          'Failed to parse LocalFoundry response as JSON'
        );

        throw new Error(
          `LocalFoundry returned invalid JSON response. Response: ${response.substring(0, 200)}...`
        );
      }

      logger.info(
        {
          operation: 'localfoundry_extract_success',
          textLength: text.length,
          extractedKeys: Object.keys(extracted),
        },
        'Extract request completed successfully'
      );

      return { extracted };
    } catch (error) {
      logger.error(
        {
          operation: 'localfoundry_extract_error',
          error: error instanceof Error ? error.message : String(error),
        },
        'Extract request failed'
      );
      throw error;
    }
  }

  /**
   * Validate and parse summarize input
   */
  private validateSummarizeInput(input: unknown): SummarizeInput {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Invalid input: expected object with text field');
    }

    const inputObj = input as Record<string, unknown>;
    const { text, maxLength } = inputObj;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    if (text.length > 50000) {
      throw new Error(
        `Invalid input: text length (${text.length}) exceeds maximum allowed length of 50000 characters`
      );
    }

    if (maxLength !== undefined && (typeof maxLength !== 'number' || maxLength <= 0)) {
      throw new Error('Invalid input: maxLength must be a positive number');
    }

    const parsedMaxLength =
      maxLength !== undefined && typeof maxLength === 'number' ? maxLength : undefined;

    return { text, maxLength: parsedMaxLength };
  }

  /**
   * Validate and parse clarify input
   */
  private validateClarifyInput(input: unknown): ClarifyInput {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Invalid input: expected object with text and question fields');
    }

    const inputObj = input as Record<string, unknown>;
    const { text, question } = inputObj;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    if (typeof question !== 'string' || question.trim().length === 0) {
      throw new Error('Invalid input: question must be a non-empty string');
    }

    if (text.length > 50000) {
      throw new Error(
        `Invalid input: text length (${text.length}) exceeds maximum allowed length of 50000 characters`
      );
    }

    if (question.length > 500) {
      throw new Error(
        `Invalid input: question length (${question.length}) exceeds maximum allowed length of 500 characters`
      );
    }

    return { text, question };
  }

  /**
   * Validate and parse extract input
   */
  private validateExtractInput(input: unknown): ExtractInput {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Invalid input: expected object with text and schema fields');
    }

    const inputObj = input as Record<string, unknown>;
    const { text, schema } = inputObj;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    if (typeof schema !== 'string' || schema.trim().length === 0) {
      throw new Error('Invalid input: schema must be a non-empty string');
    }

    if (text.length > 50000) {
      throw new Error(
        `Invalid input: text length (${text.length}) exceeds maximum allowed length of 50000 characters`
      );
    }

    if (schema.length > 2000) {
      throw new Error(
        `Invalid input: schema length (${schema.length}) exceeds maximum allowed length of 2000 characters`
      );
    }

    return { text, schema };
  }
}
