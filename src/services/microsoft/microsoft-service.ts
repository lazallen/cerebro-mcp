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
import { OneNoteClient } from './onenote-client';
import { EventResponseClient } from './event-response-client';
import { createSectionWithPages as createSectionHandler, updatePage as updatePageHandler, getInkText as getInkTextHandler } from '../../mcp-server/handlers/onenote-tools';
import { moveEmail as moveEmailHandler } from '../../mcp-server/handlers/email-move-tools';
import type { SectionInput, PageUpdateInput } from '../../types/onenote';
import type { InkToTextInput } from '../../types/inkml';
import type { MoveEmailInput } from '../../types/email';
import type { EventResponseRequest } from '../../types/calendar';

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

    // Set up mock handler for test mode
    if (process.env['USE_TEST_MODE'] === 'true') {
      this.apiClient.setMockHandler(async (config) => {
        // Mock folder list endpoint
        if (config.params && typeof config.params['$select'] === 'string' && (config.params['$select'] as string).includes('displayName')) {
          return {
            data: {
              value: [
                { id: 'inbox-guid', displayName: 'Inbox' },
                { id: 'archive-guid', displayName: 'Archive' },
                { id: 'junkemail-guid', displayName: 'Junk Email' },
              ],
            },
            status: 200,
            headers: {},
          };
        }

        // Default mock response for other endpoints
        return {
          data: { value: [] },
          status: 200,
          headers: {},
        };
      });
    }

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
          'List recent emails from a specific folder. Returns subject, sender, date, and preview for each email.',
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of emails to retrieve (default: 10, max: 50)',
              default: 10,
            },
            folder: {
              type: 'string',
              description:
                'Folder to retrieve emails from (default: inbox). Common folders: inbox, spam, junk, sent, drafts, trash, deleted. Use "all" for cross-folder search. Custom folder names are also supported.',
              default: 'inbox',
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
      {
        name: 'list-mail-folders',
        description:
          'List all available mail folders in the mailbox. Returns folder names and IDs. Useful for finding the exact folder name to use with list-emails.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: this.listMailFolders.bind(this),
      },
      {
        name: 'move-email',
        description:
          'Move an email to a different folder in Outlook. Supports nested folder paths (e.g., \'Projects/2026/Q1\'). Marks emails as read by default after moving. Operation is idempotent - moving an email to its current folder succeeds without error.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description:
                'Email message ID from list-emails tool. Format: Microsoft Graph API message GUID.',
            },
            folderPath: {
              type: 'string',
              description:
                'Target folder path. Supports nested paths with forward slash delimiter (e.g., \'Archive\', \'Projects/2026/Q1\', \'Work/Clients/ClientA\'). Common folders: inbox, sent, drafts, spam, junk, trash, deleted. Case-sensitive for custom folders.',
            },
            markAsRead: {
              type: 'boolean',
              description:
                'Mark email as read after moving. Default: true. Set to false to preserve original read/unread status.',
              default: true,
            },
          },
          required: ['emailId', 'folderPath'],
        },
        handler: this.moveEmailMethod.bind(this),
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
      {
        name: 'respond-to-event',
        description:
          'Respond to a meeting invitation (accept, decline, or tentatively accept). Includes retry logic for transient failures, rate limiting with Retry-After header support, and concurrency control.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'Event ID from list-events or get-event',
            },
            response: {
              type: 'string',
              enum: ['accepted', 'declined', 'tentativelyAccepted'],
              description: 'Type of response to send',
            },
            comment: {
              type: 'string',
              description: 'Optional comment to include with response (max 8KB UTF-8)',
            },
            sendResponse: {
              type: 'boolean',
              description: 'Whether to send a response to the organizer (default: true)',
              default: true,
            },
          },
          required: ['eventId', 'response'],
        },
        handler: this.respondToEvent.bind(this),
      },

      // OneNote Tools
      {
        name: 'onenote-create-section',
        description:
          'Create or reuse a OneNote section and populate with meeting pages. Skips duplicate pages if section already exists.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionName: {
              type: 'string',
              description:
                'Section display name (format: YYYY-MM-DD descriptor, e.g., "2026-01-29 Meetings")',
            },
            meetings: {
              type: 'array',
              description: 'Array of meetings to create pages for',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Meeting name or subject (1-50 characters)',
                  },
                  date: {
                    type: 'string',
                    description: 'Meeting date in YYYY-MM-DD format',
                  },
                  time: {
                    type: 'string',
                    description: 'Optional meeting start time in ISO 8601 format for ordering',
                  },
                  preBriefNotes: {
                    type: 'string',
                    description: 'Preparation notes in markdown format',
                  },
                },
                required: ['title', 'date'],
              },
              minItems: 1,
            },
          },
          required: ['sectionName', 'meetings'],
        },
        handler: this.createSectionWithPages.bind(this),
      },
      {
        name: 'onenote-update-page',
        description:
          'Update the content of an existing OneNote page identified by section name and meeting title.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionName: {
              type: 'string',
              description: 'Section display name containing the page',
            },
            meetingTitle: {
              type: 'string',
              description: 'Meeting title (page title) to update',
            },
            content: {
              type: 'string',
              description: 'New page content in markdown format',
            },
          },
          required: ['sectionName', 'meetingTitle', 'content'],
        },
        handler: this.updatePageContent.bind(this),
      },
      {
        name: 'onenote-get-ink-text',
        description:
          'Convert handwritten ink strokes on a OneNote page to text using Windows Ink API and LocalFoundry cleanup. Provides 95-100% accuracy with per-word confidence scores.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionName: {
              type: 'string',
              description: 'Section display name containing the page',
            },
            meetingTitle: {
              type: 'string',
              description: 'Meeting title (page title) to process',
            },
            confidenceThreshold: {
              type: 'number',
              description: 'Confidence threshold for flagging low-confidence words (0-1 scale)',
              default: 0.7,
              minimum: 0,
              maximum: 1,
            },
          },
          required: ['sectionName', 'meetingTitle'],
        },
        handler: this.getInkText.bind(this),
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
   * Map user-friendly folder names to Microsoft Graph well-known folder names
   * @param folder - User-provided folder name
   * @returns Microsoft Graph well-known folder name, null for 'all', or undefined for custom folders
   */
  private mapToWellKnownFolder(folder: string): string | null | undefined {
    const folderMap: Record<string, string> = {
      inbox: 'inbox',
      spam: 'junkemail',
      junk: 'junkemail',
      sent: 'sentitems',
      drafts: 'drafts',
      trash: 'deleteditems',
      deleted: 'deleteditems',
    };

    const normalized = folder.toLowerCase().trim();

    // Special case: 'all' means search all folders (original behavior)
    if (normalized === 'all') {
      return null;
    }

    // Return well-known name if it's a standard folder, undefined otherwise
    return folderMap[normalized];
  }

  /**
   * Resolve custom folder name or path to folder ID by searching mailFolders
   * Supports both single folder names and paths (e.g., "Areas/Line Management/Personal")
   * @param folderInput - Folder name or path with "/" separators
   * @returns Folder ID (GUID) if found and unique
   * @throws Error if folder not found, path is invalid, or multiple folders match (for single names)
   */
  private async resolveFolderName(folderInput: string): Promise<string> {
    // Check if input contains a path (has "/" separator)
    const pathSegments = folderInput
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (pathSegments.length === 0) {
      throw new Error('Folder name cannot be empty');
    }

    if (pathSegments.length === 1) {
      // Single folder name - search at root level (original behavior)
      return this.resolveFolderNameAtRoot(pathSegments[0]!);
    }

    // Multi-segment path - traverse hierarchy
    return this.resolveFolderPath(pathSegments);
  }

  /**
   * Resolve a single folder name at root level
   * @param folderName - Folder name to find at root level
   * @returns Folder ID if found and unique
   * @throws Error if not found or multiple matches
   */
  private async resolveFolderNameAtRoot(folderName: string): Promise<string> {
    const response = await this.apiClient.request('/me/mailFolders', {
      method: 'GET',
      params: {
        $select: 'id,displayName',
        $top: '1000',
      },
    });

    const data = response.data as {
      value?: Array<{ id?: string; displayName?: string }>;
    };
    const folders = data.value ?? [];

    // Case-insensitive search for matching folders
    const matches = folders.filter(
      (f) => f.displayName?.toLowerCase() === folderName.toLowerCase()
    );

    if (matches.length === 0) {
      const availableFolders = folders
        .map((f) => f.displayName)
        .filter((n) => n)
        .join(', ');
      throw new Error(
        `Folder '${folderName}' not found at root level. Available folders: ${availableFolders || 'none'}. Use list-mail-folders to see all folders.`
      );
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple folders found with name '${folderName}' at root level. Please use a more specific path (e.g., "ParentFolder/${folderName}").`
      );
    }

    const folderId = matches[0]?.id;
    if (!folderId) {
      throw new Error(`Folder '${folderName}' found but has no ID.`);
    }

    return folderId;
  }

  /**
   * Resolve a folder path by traversing the hierarchy
   * @param pathSegments - Array of folder names representing the path
   * @returns Folder ID of the final folder in the path
   * @throws Error if any segment is not found
   */
  private async resolveFolderPath(pathSegments: string[]): Promise<string> {
    // Start with root folders
    let currentFolders = (
      (
        await this.apiClient.request('/me/mailFolders', {
          method: 'GET',
          params: { $select: 'id,displayName', $top: '1000' },
        })
      ).data as { value?: Array<{ id?: string; displayName?: string }> }
    ).value ?? [];

    let currentId: string | null = null;

    // Traverse each path segment
    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i]!;
      const match = currentFolders.find(
        (f) => f.displayName?.toLowerCase() === segment.toLowerCase()
      );

      if (!match) {
        const traversedPath = pathSegments.slice(0, i).join('/');
        const availableFolders = currentFolders
          .map((f) => f.displayName)
          .filter((n) => n)
          .join(', ');
        const locationMsg = traversedPath ? `under '${traversedPath}'` : 'at root level';
        throw new Error(
          `Folder '${segment}' not found ${locationMsg}. Available folders: ${availableFolders || 'none'}.`
        );
      }

      currentId = match.id ?? null;

      // Get child folders for next iteration (unless this is the last segment)
      if (i < pathSegments.length - 1) {
        if (!currentId) {
          throw new Error(`Folder '${segment}' has no ID.`);
        }

        const childResponse = await this.apiClient.request(
          `/me/mailFolders/${currentId}/childFolders`,
          {
            method: 'GET',
            params: {
              $select: 'id,displayName',
              $top: '1000',
            },
          }
        );

        const childData = childResponse.data as {
          value?: Array<{ id?: string; displayName?: string }>;
        };
        currentFolders = childData.value ?? [];

        if (currentFolders.length === 0) {
          const traversedPath = pathSegments.slice(0, i + 1).join('/');
          throw new Error(
            `Path invalid: Folder '${segment}' (${traversedPath}) has no child folders.`
          );
        }
      }
    }

    if (!currentId) {
      throw new Error(
        `Folder path '${pathSegments.join('/')}' could not be resolved to a valid folder ID.`
      );
    }

    return currentId;
  }

  /**
   * Get unread emails (public method for heartbeat email triage)
   * Uses the same logic as listEmails but filters for unread only
   */
  public async getUnreadEmails(options?: { top?: number; folder?: string }): Promise<unknown[]> {
    const result = await this.listEmails({
      count: options?.top ?? 50,
      folder: options?.folder ?? 'inbox',
      unreadOnly: true, // Internal flag to filter unread
    });
    return ((result as any).emails ?? []) as unknown[];
  }

  /**
   * Move an email to a target folder (public method for heartbeat email triage)
   * @param emailId - Email message ID from Microsoft Graph
   * @param folderPath - Target folder path (e.g., "Cerebro/Triaged")
   * @param markAsRead - Whether to mark email as read (default: false)
   * @returns Move operation result
   */
  public async moveEmail(
    emailId: string,
    folderPath: string,
    markAsRead: boolean = false
  ): Promise<unknown> {
    return this.moveEmailMethod({
      emailId,
      folderPath,
      markAsRead,
    });
  }

  /**
   * List recent emails from specified folder
   * @param input - Tool input with optional count and folder parameters
   * @returns Object containing emails array and count
   */
  private async listEmails(input: Record<string, unknown>): Promise<unknown> {
    const count = Math.min((input['count'] as number | undefined) ?? 10, 50);
    const folder = (input['folder'] as string | undefined) ?? 'inbox';
    const unreadOnly = input['unreadOnly'] as boolean | undefined;

    // Check if it's a well-known folder or special value
    const wellKnownName = this.mapToWellKnownFolder(folder);

    let endpoint: string;

    if (wellKnownName === null) {
      // Special case: 'all' means search all folders
      endpoint = '/me/messages';
    } else if (wellKnownName !== undefined) {
      // Standard well-known folder (inbox, spam, etc.)
      endpoint = `/me/mailFolders/${wellKnownName}/messages`;
    } else {
      // Custom folder - need to resolve name to ID
      const folderId = await this.resolveFolderName(folder);
      endpoint = `/me/mailFolders/${folderId}/messages`;
    }

    const params: Record<string, string> = {
      $top: count.toString(),
      $select: 'id,subject,from,receivedDateTime,bodyPreview,body,isRead',
      $orderby: 'receivedDateTime desc',
    };

    // Add unread filter if requested
    if (unreadOnly) {
      params.$filter = 'isRead eq false';
    }

    const response = await this.apiClient.request(endpoint, {
      method: 'GET',
      params,
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

    if (!emailId) {
      throw new Error('emailId parameter is required');
    }

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

    if (!to || to.length === 0) {
      throw new Error('to parameter is required and must contain at least one recipient');
    }
    if (!subject) {
      throw new Error('subject parameter is required');
    }
    if (!body) {
      throw new Error('body parameter is required');
    }

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
   * List all available mail folders in the mailbox
   * @returns Object containing folders array with id and displayName for each folder
   */
  private async listMailFolders(_input: Record<string, unknown>): Promise<unknown> {
    const response = await this.apiClient.request('/me/mailFolders', {
      method: 'GET',
      params: {
        $select: 'id,displayName,totalItemCount,unreadItemCount',
        $top: '1000',
      },
    });

    const data = response.data as {
      value?: Array<{
        id?: string;
        displayName?: string;
        totalItemCount?: number;
        unreadItemCount?: number;
      }>;
    };

    const folders = (data.value ?? []).map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      totalItems: folder.totalItemCount ?? 0,
      unreadItems: folder.unreadItemCount ?? 0,
    }));

    return {
      folders,
      count: folders.length,
    };
  }

  /**
   * Move an email to a target folder
   * T020: Add move-email service method binding
   */
  private async moveEmailMethod(input: Record<string, unknown>): Promise<unknown> {
    // Validate and extract input
    const moveInput: MoveEmailInput = {
      emailId: input['emailId'] as string,
      folderPath: input['folderPath'] as string,
      markAsRead: input['markAsRead'] as boolean | undefined,
    };

    // Create folder resolver that uses this service's methods
    const folderResolver = async (path: string): Promise<string> => {
      const wellKnownName = this.mapToWellKnownFolder(path);

      if (wellKnownName === null) {
        // Special case 'all' is not valid for move operations
        throw new Error('Cannot move email to "all" folders - specify a single folder path');
      } else if (wellKnownName !== undefined) {
        // Standard well-known folder (inbox, sent, etc.)
        // Fetch the actual folder ID
        const response = await this.apiClient.request(
          `/me/mailFolders/${wellKnownName}`,
          {
            method: 'GET',
            params: {
              $select: 'id',
            },
          }
        );
        const folder = response.data as { id?: string };
        if (!folder.id) {
          throw new Error(`Failed to resolve well-known folder: ${wellKnownName}`);
        }
        return folder.id;
      } else {
        // Custom folder - resolve using existing method
        return this.resolveFolderName(path);
      }
    };

    // Call the handler
    const result = await moveEmailHandler(moveInput, this.apiClient, folderResolver);

    return result;
  }

  /**
   * List calendar events within a date range
   * Note: Uses calendarView to expand recurring events into individual instances
   */
  private async listEvents(input: Record<string, unknown>): Promise<unknown> {
    const count = Math.min((input['count'] as number | undefined) ?? 50, 100);

    // Calculate date range - preserve timezone from input or use local time
    const startDate = input['startDate'] ? new Date(input['startDate'] as string) : new Date();
    const endDate = input['endDate']
      ? new Date(input['endDate'] as string)
      : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from start

    // Get timezone offset to format dates correctly for calendarView
    // calendarView requires dates in ISO format, which will be interpreted as UTC
    // So we format with the local timezone offset preserved
    const formatDateForCalendarView = (date: Date): string => {
      // Get timezone offset in minutes and convert to ISO string format
      const tzOffset = -date.getTimezoneOffset();
      const offsetSign = tzOffset >= 0 ? '+' : '-';
      const offsetHours = Math.floor(Math.abs(tzOffset) / 60)
        .toString()
        .padStart(2, '0');
      const offsetMinutes = (Math.abs(tzOffset) % 60).toString().padStart(2, '0');

      // Create ISO string with timezone offset
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');

      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
    };

    const startDateTime = formatDateForCalendarView(startDate);
    const endDateTime = formatDateForCalendarView(endDate);

    // Use calendarView to get expanded instances of recurring events
    const allEvents: unknown[] = [];
    let nextLink: string | undefined = undefined;
    let requestCount = 0;

    do {
      const response = nextLink
        ? await this.apiClient.request(nextLink.replace('https://graph.microsoft.com/v1.0', ''), {
            method: 'GET',
          })
        : await this.apiClient.request('/me/calendarView', {
            method: 'GET',
            params: {
              startDateTime,
              endDateTime,
              $top: count.toString(),
              $select:
                'id,subject,start,end,location,organizer,attendees,onlineMeeting,isAllDay,webLink',
              $orderby: 'start/dateTime asc',
            },
          });

      const data = response.data as { value?: unknown[]; '@odata.nextLink'?: string };
      if (data.value) {
        allEvents.push(...data.value);
      }

      nextLink = data['@odata.nextLink'];
      requestCount++;

      // Stop if we've reached the requested count or made too many requests
      if (allEvents.length >= count || requestCount >= 10) {
        break;
      }
    } while (nextLink);

    return {
      events: allEvents.slice(0, count),
      count: allEvents.slice(0, count).length,
      totalRetrieved: allEvents.length,
      hasMore: nextLink !== undefined,
      startDate: startDateTime,
      endDate: endDateTime,
    };
  }

  /**
   * Get event details by ID
   */
  private async getEvent(input: Record<string, unknown>): Promise<unknown> {
    const eventId = input['eventId'] as string;

    if (!eventId) {
      throw new Error('eventId parameter is required');
    }

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

    if (!subject) {
      throw new Error('subject parameter is required');
    }
    if (!startDateTime) {
      throw new Error('startDateTime parameter is required');
    }
    if (!endDateTime) {
      throw new Error('endDateTime parameter is required');
    }

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

    if (!eventId) {
      throw new Error('eventId parameter is required');
    }

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

    if (!eventId) {
      throw new Error('eventId parameter is required');
    }

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
    const meetingDuration = input['meetingDuration'] as number | undefined;
    const maxCandidates = Math.min((input['maxCandidates'] as number | undefined) ?? 5, 10);
    const minimumAttendeePercentage =
      (input['minimumAttendeePercentage'] as number | undefined) ?? 100;

    if (!attendees || attendees.length === 0) {
      throw new Error('attendees parameter is required and must contain at least one attendee');
    }
    if (meetingDuration === undefined) {
      throw new Error('meetingDuration parameter is required');
    }

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
   * Respond to a meeting invitation
   */
  private async respondToEvent(input: Record<string, unknown>): Promise<unknown> {
    const eventId = input['eventId'] as string;
    const response = input['response'] as EventResponseRequest['response'];
    const comment = input['comment'] as string | undefined;
    const sendResponse = (input['sendResponse'] as boolean | undefined) ?? true;

    if (!eventId) {
      throw new Error('eventId parameter is required');
    }
    if (!response) {
      throw new Error('response parameter is required');
    }
    if (!['accepted', 'declined', 'tentativelyAccepted'].includes(response)) {
      throw new Error(
        'response must be one of: accepted, declined, tentativelyAccepted'
      );
    }

    const eventResponseClient = new EventResponseClient(this.apiClient);

    const request: EventResponseRequest = {
      eventId,
      response,
      comment,
      sendResponse,
    };

    // Call the appropriate method based on response type
    switch (response) {
      case 'declined':
        return eventResponseClient.decline(request);
      case 'accepted':
        return eventResponseClient.accept(request);
      case 'tentativelyAccepted':
        return eventResponseClient.tentativelyAccept(request);
      default:
        throw new Error(`Invalid response type: ${response}`);
    }
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
      message:
        'Please visit the URL to complete authentication. The OAuth server must be running at https://localhost:3333',
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

  /**
   * Create or reuse a OneNote section and populate with meeting pages
   */
  private async createSectionWithPages(input: Record<string, unknown>): Promise<unknown> {
    try {
      // Extract and validate input
      const sectionName = input['sectionName'] as string;
      const meetings = input['meetings'] as Array<{
        title: string;
        date: string;
        time?: string;
        preBriefNotes?: string;
      }>;

      if (!sectionName) {
        throw new Error('sectionName is required');
      }

      if (!meetings || !Array.isArray(meetings) || meetings.length === 0) {
        throw new Error('meetings array is required and must contain at least one meeting');
      }

      // Get valid access token (handles refresh automatically)
      const accessToken = await this.tokenStorage.getValidAccessToken();

      const oneNoteClient = new OneNoteClient(accessToken);

      const sectionInput: SectionInput = {
        name: sectionName,
        meetings,
      };

      return await createSectionHandler(oneNoteClient, sectionInput);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        operation: 'create_section_with_pages',
      }, 'Failed to create section with pages');
      throw error;
    }
  }

  /**
   * Update the content of an existing OneNote page
   */
  private async updatePageContent(input: Record<string, unknown>): Promise<unknown> {
    try {
      // Extract and validate input
      const sectionName = input['sectionName'] as string;
      const meetingTitle = input['meetingTitle'] as string;
      const content = input['content'] as string;

      if (!sectionName) {
        throw new Error('sectionName is required');
      }

      if (!meetingTitle) {
        throw new Error('meetingTitle is required');
      }

      if (!content) {
        throw new Error('content is required');
      }

      // Get valid access token (handles refresh automatically)
      const accessToken = await this.tokenStorage.getValidAccessToken();

      const oneNoteClient = new OneNoteClient(accessToken);

      const pageUpdateInput: PageUpdateInput = {
        sectionName,
        meetingTitle,
        content,
      };

      return await updatePageHandler(oneNoteClient, pageUpdateInput);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        operation: 'update_page_content',
      }, 'Failed to update page content');
      throw error;
    }
  }

  /**
   * Convert handwritten ink to text using OCR
   */
  private async getInkText(input: Record<string, unknown>): Promise<unknown> {
    try {
      // Extract and validate input
      const sectionName = input['sectionName'] as string;
      const meetingTitle = input['meetingTitle'] as string;
      const confidenceThreshold = (input['confidenceThreshold'] as number) || 0.7;

      if (!sectionName) {
        throw new Error('sectionName is required');
      }

      if (!meetingTitle) {
        throw new Error('meetingTitle is required');
      }

      // Get valid access token (handles refresh automatically)
      const accessToken = await this.tokenStorage.getValidAccessToken();

      const oneNoteClient = new OneNoteClient(accessToken);

      const inkToTextInput: InkToTextInput = {
        sectionName,
        meetingTitle,
        confidenceThreshold,
      };

      return await getInkTextHandler(oneNoteClient, inkToTextInput);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        operation: 'get_ink_text',
      }, 'Failed to convert ink to text');
      throw error;
    }
  }
}
