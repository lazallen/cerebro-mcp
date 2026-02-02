/**
 * Event Response Client
 *
 * Handles meeting invitation responses (accept/decline/tentative)
 * with retry logic, rate limiting, concurrency control, and logging
 */

import { logger } from '../../common';
import type {
  EventResponseRequest,
  EventResponseResult,
  EventResponseType,
  MicrosoftGraphResponseBody,
} from '../../types/calendar';
import { MicrosoftApiClient } from './api-client';
import { RetryHandler } from './retry-handler';
import { ResourceLock, ResourceLockedError } from './resource-lock';

/**
 * Maximum comment length in bytes (UTF-8)
 * Per Microsoft Graph API limit: 8KB = 8192 bytes
 */
const MAX_COMMENT_BYTES = 8192;

/**
 * Validates and truncates comment to 8KB UTF-8 byte limit
 *
 * @param comment - Optional comment string
 * @returns Validated comment (truncated if needed) or undefined
 */
export function validateComment(comment?: string): string | undefined {
  if (!comment) {
    return undefined;
  }

  const buffer = Buffer.from(comment, 'utf8');

  // Check if within limit
  if (buffer.length <= MAX_COMMENT_BYTES) {
    return comment;
  }

  // Truncate to fit within limit
  let truncated = comment;
  while (Buffer.from(truncated, 'utf8').length > MAX_COMMENT_BYTES) {
    truncated = truncated.slice(0, -1);
  }

  logger.warn({
    operation: 'comment_truncated',
    originalLength: buffer.length,
    truncatedLength: Buffer.from(truncated, 'utf8').length,
    maxBytes: MAX_COMMENT_BYTES,
    msg: `Comment exceeded ${MAX_COMMENT_BYTES} byte limit and was truncated`,
  });

  return truncated;
}

/**
 * Event Response Client Class
 *
 * Manages meeting invitation responses with full error handling,
 * retry logic, rate limiting, and concurrency control
 */
export class EventResponseClient {
  private readonly apiClient: MicrosoftApiClient;
  private readonly retryHandler: RetryHandler;
  private readonly resourceLock: ResourceLock;

  constructor(apiClient: MicrosoftApiClient) {
    this.apiClient = apiClient;
    this.retryHandler = new RetryHandler();
    this.resourceLock = new ResourceLock();
  }

  /**
   * Declines a meeting invitation
   *
   * @param request - Event response request
   * @returns Response result
   */
  async decline(request: EventResponseRequest): Promise<EventResponseResult> {
    return this.respondToEvent(request, 'declined');
  }

  /**
   * Accepts a meeting invitation
   *
   * @param request - Event response request
   * @returns Response result
   */
  async accept(request: EventResponseRequest): Promise<EventResponseResult> {
    return this.respondToEvent(request, 'accepted');
  }

  /**
   * Tentatively accepts a meeting invitation
   *
   * @param request - Event response request
   * @returns Response result
   */
  async tentativelyAccept(request: EventResponseRequest): Promise<EventResponseResult> {
    return this.respondToEvent(request, 'tentativelyAccepted');
  }

  /**
   * Core method to respond to an event
   * Handles validation, retry logic, concurrency control, and logging
   *
   * @param request - Event response request
   * @param responseType - Type of response
   * @returns Response result
   */
  private async respondToEvent(
    request: EventResponseRequest,
    responseType: EventResponseType
  ): Promise<EventResponseResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // Validate and truncate comment if needed
      const validatedComment = validateComment(request.comment);

      // Acquire lock to prevent concurrent requests
      return await this.resourceLock.acquireLock(request.eventId, async () => {
        // Execute with retry logic
        await this.retryHandler.executeWithRetry(async () => {
          // Make API call
          await this.callGraphApi(request.eventId, responseType, {
            comment: validatedComment,
            sendResponse: request.sendResponse ?? true,
          });
        });

        // Log success
        const duration = Date.now() - startTime;
        logger.info({
          operation: 'event_response_success',
          service: 'microsoft',
          eventId: request.eventId,
          responseType,
          outcome: 'success',
          timestamp,
          durationMs: duration,
          msg: `Meeting response ${responseType} sent successfully for event ${request.eventId}`,
        });

        return {
          success: true,
          eventId: request.eventId,
          responseType,
          message: `Meeting response ${responseType} sent successfully for event ${request.eventId}`,
          timestamp,
        };
      });
    } catch (error) {
      // Handle resource lock error
      if (error instanceof ResourceLockedError) {
        logger.warn({
          operation: 'event_response_locked',
          service: 'microsoft',
          eventId: request.eventId,
          responseType,
          outcome: 'failure',
          timestamp,
          msg: `Event ${request.eventId} is already being processed`,
        });

        return {
          success: false,
          eventId: request.eventId,
          responseType,
          message: `Event ${request.eventId} is already being processed. Please wait for the current operation to complete.`,
          error: {
            code: 'AlreadyProcessing',
            status: 409,
            retryable: false,
          },
          timestamp,
        };
      }

      // Handle special case: organizer hasn't requested a response
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStatus = this.getErrorStatus(error);
      const errorCode = this.getErrorCode(error);

      if (
        errorStatus === 400 &&
        errorMessage.toLowerCase().includes("organizer hasn't requested a response")
      ) {
        // Meeting doesn't accept responses - delete it from calendar instead
        try {
          logger.info({
            operation: 'event_response_fallback_delete',
            service: 'microsoft',
            eventId: request.eventId,
            responseType,
            msg: `Meeting does not accept responses. Deleting event ${request.eventId} from calendar instead.`,
          });

          // Delete the event from calendar
          await this.apiClient.request(`/me/events/${request.eventId}`, {
            method: 'DELETE',
          });

          const duration = Date.now() - startTime;
          logger.info({
            operation: 'event_response_delete_success',
            service: 'microsoft',
            eventId: request.eventId,
            responseType,
            outcome: 'success',
            timestamp,
            durationMs: duration,
            msg: `Event ${request.eventId} removed from calendar (meeting does not accept responses)`,
          });

          return {
            success: true,
            eventId: request.eventId,
            responseType,
            message: `Meeting removed from your calendar. The organizer has not requested responses to this invitation, so no response was sent.`,
            timestamp,
          };
        } catch (deleteError) {
          // If delete also fails, return the original error
          logger.error({
            operation: 'event_response_delete_error',
            service: 'microsoft',
            eventId: request.eventId,
            responseType,
            deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError),
            msg: `Failed to delete event ${request.eventId} after response was rejected`,
          });

          return {
            success: false,
            eventId: request.eventId,
            responseType,
            message: `This meeting does not allow responses and could not be removed from your calendar. ${
              deleteError instanceof Error ? deleteError.message : 'Unknown error occurred.'
            }`,
            error: {
              code: errorCode,
              status: errorStatus,
              retryable: false,
              details: error,
            },
            timestamp,
          };
        }
      }

      // Handle other errors
      logger.error({
        operation: 'event_response_error',
        service: 'microsoft',
        eventId: request.eventId,
        responseType,
        outcome: 'failure',
        timestamp,
        errorCode,
        errorStatus,
        errorMessage,
        msg: `Meeting response ${responseType} failed for event ${request.eventId}`,
      });

      return {
        success: false,
        eventId: request.eventId,
        responseType,
        message: this.getUserFriendlyErrorMessage(error, request.eventId),
        error: {
          code: errorCode,
          status: errorStatus,
          retryable: false, // Already retried by RetryHandler
          details: error,
        },
        timestamp,
      };
    }
  }

  /**
   * Calls Microsoft Graph API for event response
   *
   * @param eventId - Event ID
   * @param responseType - Response type
   * @param body - Request body
   */
  private async callGraphApi(
    eventId: string,
    responseType: EventResponseType,
    body: MicrosoftGraphResponseBody
  ): Promise<void> {
    // Map response type to API endpoint
    const endpointMap: Record<EventResponseType, string> = {
      accepted: 'accept',
      declined: 'decline',
      tentativelyAccepted: 'tentativelyAccept',
    };

    const endpoint = endpointMap[responseType];
    const path = `/me/events/${eventId}/${endpoint}`;

    // Make API call (202 Accepted expected)
    await this.apiClient.request(path, {
      method: 'POST',
      body,
    });
  }

  /**
   * Extracts HTTP status code from error
   */
  private getErrorStatus(error: unknown): number {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      return (error as { status: number }).status;
    }
    return 500;
  }

  /**
   * Extracts error code from error object
   * Handles nested Microsoft Graph API innererror structure
   */
  private getErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
        return (error as { code: string }).code;
      }
      // Check for Microsoft Graph error structure
      if ('error' in error && typeof (error as { error: unknown }).error === 'object') {
        const graphError = (error as { error: { code?: string } }).error;
        if (graphError && 'code' in graphError && typeof graphError.code === 'string') {
          return graphError.code;
        }
      }
    }
    return 'UnknownError';
  }

  /**
   * Generates user-friendly error message based on error type
   */
  private getUserFriendlyErrorMessage(error: unknown, eventId: string): string {
    const status = this.getErrorStatus(error);
    const code = this.getErrorCode(error);
    const errorMessage = error instanceof Error ? error.message : '';

    // Check for specific error message about response not requested
    if (
      status === 400 &&
      errorMessage.toLowerCase().includes("organizer hasn't requested a response")
    ) {
      return 'This meeting does not allow responses. The organizer has not requested attendees to respond to this invitation.';
    }

    // Error code mappings per contracts
    if (code === 'ResourceNotFound' || code === 'ErrorItemNotFound' || status === 404) {
      return `Event ${eventId} not found. It may have been deleted or you may not have access.`;
    }

    if (status === 401) {
      return 'Authentication token expired. Please re-authenticate using the microsoft.authenticate tool.';
    }

    if (status === 403) {
      return 'Insufficient permissions. Calendars.ReadWrite permission is required.';
    }

    if (status === 400) {
      return 'Invalid request. Check that the event allows time proposals if proposedNewTime is provided.';
    }

    if (status === 429) {
      return 'Rate limit exceeded. System will automatically retry after waiting.';
    }

    if (status >= 500) {
      return 'Microsoft service error. System will automatically retry.';
    }

    // Default message
    return error instanceof Error ? error.message : 'An unexpected error occurred.';
  }
}
