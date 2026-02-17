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

  /**
   * List meeting rooms from Microsoft Graph Places API
   * @param filter OData filter string (optional)
   * @returns Array of meeting rooms
   */
  async listMeetingRooms(filter?: string): Promise<any[]> {
    const params: any = {
      $select:
        'id,emailAddress,displayName,building,capacity,floorNumber,audioDeviceName,videoDeviceName,isWheelChairAccessible',
      $top: '100',
    };

    if (filter) {
      params.$filter = filter;
    }

    const response = await this.makeRequest('/places/microsoft.graph.room', {
      method: 'GET',
      params,
    });

    const data = response.data as any;
    return data.value || [];
  }

  /**
   * Get schedule (availability) for rooms using getSchedule API
   * @param schedules Array of room email addresses
   * @param startTime Start time
   * @param endTime End time
   * @param intervalMinutes Time slot interval (default: 30)
   * @returns Schedule data with availability views
   */
  async getSchedule(
    schedules: string[],
    startTime: Date,
    endTime: Date,
    intervalMinutes: number = 30
  ): Promise<any> {
    const response = await this.makeRequest('/me/calendar/getSchedule', {
      method: 'POST',
      body: {
        schedules,
        startTime: {
          dateTime: startTime.toISOString(),
          timeZone: 'UTC',
        },
        endTime: {
          dateTime: endTime.toISOString(),
          timeZone: 'UTC',
        },
        availabilityViewInterval: intervalMinutes,
      },
    });

    return response.data;
  }
}
