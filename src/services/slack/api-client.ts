/**
 * Slack API Client
 *
 * Handles API requests to Slack Web API
 */

import { BaseAPIClient } from '../../common/base-api-client';
import { SlackTokenStorage } from './token-storage';
import { APIResponse, RequestConfig } from '../../types/api';

export class SlackApiClient extends BaseAPIClient {
  private readonly tokenStorage: SlackTokenStorage;

  constructor(tokenStorage: SlackTokenStorage) {
    super('https://slack.com/api', 'slack', 30000);
    this.tokenStorage = tokenStorage;
  }

  protected async getAccessToken(): Promise<string> {
    return this.tokenStorage.getValidAccessToken();
  }

  /**
   * Override makeRequest to handle Slack's response format
   * Slack returns {ok: true/false, error?: string}
   */
  protected override async makeRequest(
    path: string,
    config: RequestConfig
  ): Promise<APIResponse<unknown>> {
    // All Slack requests are POST
    const requestConfig: RequestConfig = {
      ...config,
      method: 'POST',
    };

    const response = await super.makeRequest(path, requestConfig);

    // Check Slack-specific error format
    const data = response.data as { ok?: boolean; error?: string };
    if (data && typeof data.ok === 'boolean' && !data.ok) {
      throw new Error(`Slack API error: ${data.error ?? 'Unknown error'}`);
    }

    return response;
  }

  /**
   * Public wrapper for makeRequest to be used by SlackService
   */
  async request(path: string, config: RequestConfig): Promise<APIResponse<unknown>> {
    return this.makeRequest(path, config);
  }
}
