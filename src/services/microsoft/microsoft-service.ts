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
      // Authentication Tools
      {
        name: 'authenticate',
        description:
          'Initiate Microsoft OAuth authentication. Returns authorization URL to complete in browser.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.authenticate.bind(this),
      },
      {
        name: 'check-auth-status',
        description:
          'Check Microsoft authentication status. Returns user information if authenticated.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.checkAuthStatus.bind(this),
      },

      // Email Tools
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

      // Calendar Tools
      {
        name: 'list-events',
        description:
          'List calendar events within a date range. Returns event details including time, location, and attendees.',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in ISO 8601 format (default: today)',
            },
            endDate: {
              type: 'string',
              description: 'End date in ISO 8601 format (default: 7 days from start)',
            },
            count: {
              type: 'number',
              description: 'Max number of events to retrieve (default: 50, max: 100)',
              default: 50,
            },
          },
        },
        handler: this.listEvents.bind(this),
      },
      {
        name: 'get-event',
        description:
          'Get complete details for a specific calendar event by ID. Returns full event information including attendees and recurrence.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'Calendar event ID from list-events',
            },
          },
          required: ['eventId'],
        },
        handler: this.getEvent.bind(this),
      },
      {
        name: 'create-event',
        description: 'Create a new calendar event with optional attendees and online meeting.',
        inputSchema: {
          type: 'object',
          properties: {
            subject: {
              type: 'string',
              description: 'Event title/subject',
            },
            startDateTime: {
              type: 'string',
              description: 'Start date/time in ISO 8601 format',
            },
            endDateTime: {
              type: 'string',
              description: 'End date/time in ISO 8601 format',
            },
            startTimeZone: {
              type: 'string',
              description: 'IANA timezone for start time (default: UTC)',
              default: 'UTC',
            },
            endTimeZone: {
              type: 'string',
              description: 'IANA timezone for end time (default: UTC)',
              default: 'UTC',
            },
            body: {
              type: 'string',
              description: 'Event description/body content',
            },
            bodyType: {
              type: 'string',
              enum: ['text', 'html'],
              description: 'Body content type (default: text)',
              default: 'text',
            },
            location: {
              type: 'string',
              description: 'Physical location of the event',
            },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email addresses of attendees',
            },
            isOnlineMeeting: {
              type: 'boolean',
              description: 'Create Teams online meeting (default: false)',
              default: false,
            },
            isAllDay: {
              type: 'boolean',
              description: 'All-day event flag (default: false)',
              default: false,
            },
          },
          required: ['subject', 'startDateTime', 'endDateTime'],
        },
        handler: this.createEvent.bind(this),
      },
      {
        name: 'update-event',
        description: 'Update an existing calendar event. Only specified fields will be modified.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'Event ID to update',
            },
            subject: {
              type: 'string',
              description: 'Event title/subject',
            },
            startDateTime: {
              type: 'string',
              description: 'Start date/time in ISO 8601 format',
            },
            endDateTime: {
              type: 'string',
              description: 'End date/time in ISO 8601 format',
            },
            startTimeZone: {
              type: 'string',
              description: 'IANA timezone for start time',
            },
            endTimeZone: {
              type: 'string',
              description: 'IANA timezone for end time',
            },
            body: {
              type: 'string',
              description: 'Event description/body content',
            },
            bodyType: {
              type: 'string',
              enum: ['text', 'html'],
              description: 'Body content type',
            },
            location: {
              type: 'string',
              description: 'Physical location of the event',
            },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email addresses of attendees',
            },
            isOnlineMeeting: {
              type: 'boolean',
              description: 'Create/remove Teams online meeting',
            },
            sendUpdate: {
              type: 'string',
              enum: ['all', 'none', 'tentative'],
              description: 'Who to notify of updates (default: all)',
              default: 'all',
            },
          },
          required: ['eventId'],
        },
        handler: this.updateEvent.bind(this),
      },
      {
        name: 'delete-event',
        description: 'Delete/cancel a calendar event.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'Event ID to delete',
            },
            sendCancellation: {
              type: 'boolean',
              description: 'Send cancellation notice to attendees (default: true)',
              default: true,
            },
          },
          required: ['eventId'],
        },
        handler: this.deleteEvent.bind(this),
      },
      {
        name: 'find-meeting-times',
        description:
          'Find optimal meeting times based on attendee availability. Uses Microsoft Graph findMeetingTimes API to suggest time slots.',
        inputSchema: {
          type: 'object',
          properties: {
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email addresses of required attendees',
            },
            optionalAttendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email addresses of optional attendees',
            },
            meetingDuration: {
              type: 'number',
              description: 'Meeting duration in minutes (default: 60)',
              default: 60,
            },
            maxCandidates: {
              type: 'number',
              description: 'Maximum number of time slot suggestions (default: 5, max: 10)',
              default: 5,
            },
            timeConstraintStart: {
              type: 'string',
              description: 'Start of time window in ISO 8601 format (default: now)',
            },
            timeConstraintEnd: {
              type: 'string',
              description: 'End of time window in ISO 8601 format (default: 5 days from start)',
            },
            minimumAttendeePercentage: {
              type: 'number',
              description:
                'Minimum percentage of attendees required (0-100, default: 100 for all required)',
              default: 100,
            },
          },
          required: ['attendees', 'meetingDuration'],
        },
        handler: this.findMeetingTimes.bind(this),
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

  /**
   * List calendar events within a date range
   */
  private async listEvents(input: Record<string, unknown>): Promise<unknown> {
    const count = Math.min((input['count'] as number | undefined) ?? 50, 100);

    // Calculate date range
    const startDate = input['startDate'] ? new Date(input['startDate'] as string) : new Date();
    const endDate = input['endDate']
      ? new Date(input['endDate'] as string)
      : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from start

    const response = await this.apiClient.request('/me/calendar/events', {
      method: 'GET',
      params: {
        $top: count.toString(),
        $select: 'id,subject,start,end,location,organizer,attendees,onlineMeeting,isAllDay,webLink',
        $filter: `start/dateTime ge '${startDate.toISOString()}' and start/dateTime lt '${endDate.toISOString()}'`,
        $orderby: 'start/dateTime asc',
      },
    });

    const data = response.data as { value?: unknown[] };
    return {
      events: data.value ?? [],
      count: (data.value ?? []).length,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  }

  /**
   * Get event details by ID
   */
  private async getEvent(input: Record<string, unknown>): Promise<unknown> {
    const eventId = input['eventId'] as string;

    const response = await this.apiClient.request(`/me/calendar/events/${eventId}`, {
      method: 'GET',
      params: {
        $select:
          'id,subject,start,end,location,organizer,attendees,body,recurrence,reminders,categories,sensitivity,onlineMeeting,isAllDay,webLink',
      },
    });

    return response.data;
  }

  /**
   * Create a new calendar event
   */
  private async createEvent(input: Record<string, unknown>): Promise<unknown> {
    const subject = input['subject'] as string;
    const startDateTime = input['startDateTime'] as string;
    const endDateTime = input['endDateTime'] as string;
    const startTimeZone = (input['startTimeZone'] as string | undefined) ?? 'UTC';
    const endTimeZone = (input['endTimeZone'] as string | undefined) ?? 'UTC';
    const body = input['body'] as string | undefined;
    const bodyType = (input['bodyType'] as string | undefined) ?? 'text';
    const location = input['location'] as string | undefined;
    const attendees = input['attendees'] as string[] | undefined;
    const isOnlineMeeting = (input['isOnlineMeeting'] as boolean | undefined) ?? false;
    const isAllDay = (input['isAllDay'] as boolean | undefined) ?? false;

    const event: Record<string, unknown> = {
      subject,
      start: {
        dateTime: startDateTime,
        timeZone: startTimeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: endTimeZone,
      },
      isAllDay,
      isOnlineMeeting,
    };

    if (body) {
      event['body'] = {
        contentType: bodyType === 'html' ? 'HTML' : 'Text',
        content: body,
      };
    }

    if (location) {
      event['location'] = {
        displayName: location,
      };
    }

    if (attendees && attendees.length > 0) {
      event['attendees'] = attendees.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      }));
    }

    const response = await this.apiClient.request('/me/calendar/events', {
      method: 'POST',
      body: event,
    });

    const data = response.data as {
      id?: string;
      webLink?: string;
      onlineMeeting?: { joinUrl?: string };
    };

    return {
      success: true,
      eventId: data.id,
      webLink: data.webLink,
      onlineMeetingUrl: data.onlineMeeting?.joinUrl,
      message: 'Event created successfully',
    };
  }

  /**
   * Update an existing calendar event
   */
  private async updateEvent(input: Record<string, unknown>): Promise<unknown> {
    const eventId = input['eventId'] as string;
    const sendUpdate = (input['sendUpdate'] as string | undefined) ?? 'all';

    const updateData: Record<string, unknown> = {};

    if (input['subject'] !== undefined) {
      updateData['subject'] = input['subject'];
    }

    if (input['startDateTime'] !== undefined) {
      updateData['start'] = {
        dateTime: input['startDateTime'],
        timeZone: input['startTimeZone'] ?? 'UTC',
      };
    }

    if (input['endDateTime'] !== undefined) {
      updateData['end'] = {
        dateTime: input['endDateTime'],
        timeZone: input['endTimeZone'] ?? 'UTC',
      };
    }

    if (input['body'] !== undefined) {
      const bodyType = (input['bodyType'] as string | undefined) ?? 'text';
      updateData['body'] = {
        contentType: bodyType === 'html' ? 'HTML' : 'Text',
        content: input['body'],
      };
    }

    if (input['location'] !== undefined) {
      updateData['location'] = {
        displayName: input['location'],
      };
    }

    if (input['attendees'] !== undefined) {
      const attendees = input['attendees'] as string[];
      updateData['attendees'] = attendees.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      }));
    }

    if (input['isOnlineMeeting'] !== undefined) {
      updateData['isOnlineMeeting'] = input['isOnlineMeeting'];
    }

    await this.apiClient.request(`/me/calendar/events/${eventId}`, {
      method: 'PATCH',
      body: updateData,
      headers: {
        Prefer: `outlook.timezone="UTC"`,
      },
    });

    // Get attendee list for response
    const eventResponse = await this.apiClient.request(`/me/calendar/events/${eventId}`, {
      method: 'GET',
      params: {
        $select: 'attendees',
      },
    });

    const eventData = eventResponse.data as {
      attendees?: Array<{ emailAddress?: { address?: string } }>;
    };
    const notifiedAttendees =
      sendUpdate !== 'none'
        ? (eventData.attendees ?? [])
            .map((a) => a.emailAddress?.address)
            .filter((email): email is string => !!email)
        : [];

    return {
      success: true,
      eventId,
      notifiedAttendees,
      message: 'Event updated successfully',
    };
  }

  /**
   * Delete a calendar event
   */
  private async deleteEvent(input: Record<string, unknown>): Promise<unknown> {
    const eventId = input['eventId'] as string;
    const sendCancellation = (input['sendCancellation'] as boolean | undefined) ?? true;

    // Get attendee list before deletion
    let notifiedAttendees: string[] = [];
    if (sendCancellation) {
      const eventResponse = await this.apiClient.request(`/me/calendar/events/${eventId}`, {
        method: 'GET',
        params: {
          $select: 'attendees',
        },
      });

      const eventData = eventResponse.data as {
        attendees?: Array<{ emailAddress?: { address?: string } }>;
      };
      notifiedAttendees = (eventData.attendees ?? [])
        .map((a) => a.emailAddress?.address)
        .filter((email): email is string => !!email);
    }

    await this.apiClient.request(`/me/calendar/events/${eventId}`, {
      method: 'DELETE',
    });

    return {
      success: true,
      eventId,
      notifiedAttendees: sendCancellation ? notifiedAttendees : [],
      message: 'Event deleted successfully',
    };
  }

  /**
   * Find optimal meeting times based on attendee availability
   */
  private async findMeetingTimes(input: Record<string, unknown>): Promise<unknown> {
    const attendees = input['attendees'] as string[];
    const optionalAttendees = (input['optionalAttendees'] as string[] | undefined) ?? [];
    const meetingDuration = (input['meetingDuration'] as number) ?? 60;
    const maxCandidates = Math.min((input['maxCandidates'] as number | undefined) ?? 5, 10);
    const minimumAttendeePercentage =
      (input['minimumAttendeePercentage'] as number | undefined) ?? 100;

    // Calculate time constraint
    const now = new Date();
    const timeConstraintStart = input['timeConstraintStart']
      ? new Date(input['timeConstraintStart'] as string)
      : now;
    const timeConstraintEnd = input['timeConstraintEnd']
      ? new Date(input['timeConstraintEnd'] as string)
      : new Date(timeConstraintStart.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days

    const requestBody = {
      attendees: [
        ...attendees.map((email) => ({
          emailAddress: { address: email },
          type: 'Required',
        })),
        ...optionalAttendees.map((email) => ({
          emailAddress: { address: email },
          type: 'Optional',
        })),
      ],
      timeConstraint: {
        timeslots: [
          {
            start: {
              dateTime: timeConstraintStart.toISOString(),
              timeZone: 'UTC',
            },
            end: {
              dateTime: timeConstraintEnd.toISOString(),
              timeZone: 'UTC',
            },
          },
        ],
      },
      meetingDuration: `PT${meetingDuration}M`, // ISO 8601 duration format
      maxCandidates,
      isOrganizerOptional: false,
      returnSuggestionReasons: true,
      minimumAttendeePercentage,
    };

    const response = await this.apiClient.request('/me/findMeetingTimes', {
      method: 'POST',
      body: requestBody,
    });

    const data = response.data as {
      meetingTimeSuggestions?: Array<{
        confidence?: number;
        organizerAvailability?: string;
        suggestionReason?: string;
        meetingTimeSlot?: {
          start?: { dateTime?: string; timeZone?: string };
          end?: { dateTime?: string; timeZone?: string };
        };
        attendeeAvailability?: Array<{
          attendee?: { emailAddress?: { address?: string } };
          availability?: string;
        }>;
      }>;
      emptySuggestionsReason?: string;
    };

    const suggestions = data.meetingTimeSuggestions ?? [];

    return {
      success: true,
      suggestionsCount: suggestions.length,
      suggestions: suggestions.map((suggestion) => ({
        confidence: suggestion.confidence,
        reason: suggestion.suggestionReason,
        timeSlot: {
          start: suggestion.meetingTimeSlot?.start?.dateTime,
          end: suggestion.meetingTimeSlot?.end?.dateTime,
          timeZone: suggestion.meetingTimeSlot?.start?.timeZone ?? 'UTC',
        },
        organizerAvailability: suggestion.organizerAvailability,
        attendeeAvailability: (suggestion.attendeeAvailability ?? []).map((a) => ({
          email: a.attendee?.emailAddress?.address,
          availability: a.availability,
        })),
      })),
      emptySuggestionsReason: data.emptySuggestionsReason,
      searchParameters: {
        attendees,
        optionalAttendees,
        meetingDuration,
        timeWindow: {
          start: timeConstraintStart.toISOString(),
          end: timeConstraintEnd.toISOString(),
        },
      },
    };
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(): string {
    const scopes = this.config.oauth.scopes?.join(' ') ?? '';
    const params = new URLSearchParams({
      client_id: this.config.oauth.clientId,
      response_type: 'code',
      redirect_uri: this.config.oauth.redirectUri,
      scope: scopes,
      response_mode: 'query',
      state: Date.now().toString(),
    });

    return `${this.config.oauth.authEndpoint}?${params.toString()}`;
  }

  /**
   * Initiate OAuth authentication
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async authenticate(_input: Record<string, unknown>): Promise<unknown> {
    const authUrl = this.getAuthorizationUrl();
    return {
      success: true,
      authUrl,
      message: 'Please visit the URL to complete authentication. The OAuth server must be running at https://localhost:3333',
    };
  }

  /**
   * Check authentication status
   */
  private async checkAuthStatus(_input: Record<string, unknown>): Promise<unknown> {
    const hasTokens = await this.tokenStorage.hasTokens();
    if (!hasTokens) {
      return {
        authenticated: false,
        message: 'Not authenticated. Please run authenticate tool.',
      };
    }

    // Validate token with Microsoft Graph
    try {
      const response = await this.apiClient.request('/me', {
        method: 'GET',
      });

      const data = response.data as {
        displayName?: string;
        userPrincipalName?: string;
        id?: string;
      };

      return {
        authenticated: true,
        user: {
          displayName: data.displayName,
          email: data.userPrincipalName,
          id: data.id,
        },
      };
    } catch (error) {
      return {
        authenticated: false,
        message: 'Authentication token is invalid or expired. Please re-authenticate.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
