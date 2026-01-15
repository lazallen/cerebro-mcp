/**
 * Microsoft 365 Service
 *
 * Implements Microsoft 365 integration with Graph API
 */

import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common';
import { MicrosoftTokenStorage } from './token-storage';
import { MicrosoftApiClient } from './api-client';

export class MicrosoftService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string;
  private readonly tokenStorage: MicrosoftTokenStorage;
  private readonly apiClient: MicrosoftApiClient;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.name = config.name;
    this.tokenStorage = new MicrosoftTokenStorage(config);
    this.apiClient = new MicrosoftApiClient(this.tokenStorage);

    logger.info({
      operation: 'microsoft_service_created',
      service: this.name,
      msg: 'Microsoft 365 service instance created',
    });
  }

  async initialize(): Promise<void> {
    logger.info({
      operation: 'microsoft_service_init',
      service: this.name,
      msg: 'Initializing Microsoft 365 service',
    });

    // Load existing tokens if available
    await this.tokenStorage.loadTokens();

    logger.info({
      operation: 'microsoft_service_initialized',
      service: this.name,
      hasTokens: await this.isAuthenticated(),
      msg: 'Microsoft 365 service initialized',
    });
  }

  getTools(): Tool[] {
    return [
      {
        name: 'list-emails',
        description:
          'List recent emails from inbox. Returns subject, sender, date, and preview for each email.',
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of emails to retrieve (default: 10, max: 50)',
              default: 10,
            },
          },
        },
        handler: this.listEmails.bind(this),
      },
      {
        name: 'read-email',
        description:
          'Read full email content by ID. Returns complete email with body, headers, and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description: 'Email message ID from list-emails',
            },
          },
          required: ['emailId'],
        },
        handler: this.readEmail.bind(this),
      },
      {
        name: 'send-email',
        description: 'Send an email to one or more recipients.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email addresses of recipients',
            },
            subject: {
              type: 'string',
              description: 'Email subject line',
            },
            body: {
              type: 'string',
              description: 'Email body content (plain text or HTML)',
            },
            bodyType: {
              type: 'string',
              enum: ['text', 'html'],
              description: 'Body content type (default: text)',
              default: 'text',
            },
          },
          required: ['to', 'subject', 'body'],
        },
        handler: this.sendEmail.bind(this),
      },
    ];
  }

  async isAuthenticated(): Promise<boolean> {
    return this.tokenStorage.hasTokens();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    logger.info({
      operation: 'microsoft_service_shutdown',
      service: this.name,
      msg: 'Shutting down Microsoft 365 service',
    });
  }

  /**
   * List recent emails from inbox
   */
  private async listEmails(input: Record<string, unknown>): Promise<unknown> {
    const count = Math.min((input['count'] as number | undefined) ?? 10, 50);

    const response = await this.apiClient.request('/me/messages', {
      method: 'GET',
      params: {
        $top: count.toString(),
        $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead',
        $orderby: 'receivedDateTime desc',
      },
    });

    const data = response.data as { value?: unknown[] };
    return {
      emails: data.value ?? [],
      count: (data.value ?? []).length,
    };
  }

  /**
   * Read full email by ID
   */
  private async readEmail(input: Record<string, unknown>): Promise<unknown> {
    const emailId = input['emailId'] as string;

    const response = await this.apiClient.request(`/me/messages/${emailId}`, {
      method: 'GET',
      params: {
        $select: 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments',
      },
    });

    return response.data;
  }

  /**
   * Send an email
   */
  private async sendEmail(input: Record<string, unknown>): Promise<unknown> {
    const to = input['to'] as string[];
    const subject = input['subject'] as string;
    const body = input['body'] as string;
    const bodyType = (input['bodyType'] as string | undefined) ?? 'text';

    const message = {
      message: {
        subject,
        body: {
          contentType: bodyType === 'html' ? 'HTML' : 'Text',
          content: body,
        },
        toRecipients: to.map((email) => ({
          emailAddress: { address: email },
        })),
      },
    };

    await this.apiClient.request('/me/sendMail', {
      method: 'POST',
      body: message,
    });

    return {
      success: true,
      message: `Email sent to ${to.join(', ')}`,
    };
  }
}
