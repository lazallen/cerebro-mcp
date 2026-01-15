/**
 * Microsoft Graph API Client
 *
 * Handles API requests to Microsoft Graph
 */

import { BaseAPIClient } from '../../common/base-api-client';
import { MicrosoftTokenStorage } from './token-storage';
import { APIResponse, RequestConfig } from '../../types/api';

export class MicrosoftApiClient extends BaseAPIClient {
  private readonly tokenStorage: MicrosoftTokenStorage;

  constructor(tokenStorage: MicrosoftTokenStorage) {
    super('https://graph.microsoft.com/v1.0', 'microsoft', 30000);
    this.tokenStorage = tokenStorage;
  }

  protected async getAccessToken(): Promise<string> {
    return this.tokenStorage.getValidAccessToken();
  }

  /**
   * Public wrapper for makeRequest to be used by MicrosoftService
   */
  async request(path: string, config: RequestConfig): Promise<APIResponse<unknown>> {
    return this.makeRequest(path, config);
  }
}
