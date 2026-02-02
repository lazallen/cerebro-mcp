/**
 * Calendar Event Response Types
 *
 * Type definitions for meeting invitation response functionality
 */

/**
 * Valid response types for calendar events
 * Maps to Microsoft Graph API endpoints:
 * - 'accepted' -> /events/{id}/accept
 * - 'declined' -> /events/{id}/decline
 * - 'tentativelyAccepted' -> /events/{id}/tentativelyAccept
 */
export type EventResponseType = 'accepted' | 'declined' | 'tentativelyAccepted';

/**
 * Input data for responding to a meeting invitation
 */
export interface EventResponseRequest {
  /**
   * Microsoft Graph API event ID
   * Format: Graph API GUID (e.g., "AAMkAGI...")
   */
  eventId: string;

  /**
   * Response type
   */
  response: EventResponseType;

  /**
   * Optional comment to organizer
   * Maximum length: 8,192 bytes (UTF-8)
   * Will be truncated if exceeds limit
   */
  comment?: string;

  /**
   * Whether to send response notification to organizer
   * Default: true
   */
  sendResponse?: boolean;
}

/**
 * Error details for failed response operations
 */
export interface EventResponseError {
  /**
   * Microsoft Graph API error code
   * Examples: "ResourceNotFound", "InvalidAuthenticationToken", "TooManyRequests"
   */
  code: string;

  /**
   * HTTP status code
   * Examples: 400, 401, 404, 429, 500
   */
  status: number;

  /**
   * Whether the error is retryable
   * Retryable: 429, 500, 503, network errors
   * Not retryable: 400, 401, 403, 404
   */
  retryable: boolean;

  /**
   * Additional error details from Microsoft Graph API
   * May include nested innererror object
   */
  details?: unknown;
}

/**
 * Output data from a meeting response operation
 */
export interface EventResponseResult {
  /**
   * Operation success status
   */
  success: boolean;

  /**
   * The event ID that was processed
   */
  eventId: string;

  /**
   * The response type that was sent
   */
  responseType: EventResponseType;

  /**
   * User-friendly message describing the outcome
   * Success: "Meeting response {type} sent successfully for event {id}"
   * Failure: Specific error message based on error type
   */
  message: string;

  /**
   * Error details (only present if success = false)
   */
  error?: EventResponseError;

  /**
   * Timestamp of the operation (ISO 8601)
   */
  timestamp: string;
}

/**
 * Configuration for retry logic with exponential backoff
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts
   * Default: 3 (per specification clarification)
   */
  maxAttempts: number;

  /**
   * Base delay for exponential backoff in milliseconds
   * Default: 1000ms (1 second)
   */
  baseDelay: number;

  /**
   * Maximum delay between retries in milliseconds
   * Default: 30000ms (30 seconds)
   */
  maxDelay: number;

  /**
   * Current attempt number (0-based)
   * Incremented after each retry
   */
  currentAttempt: number;
}

/**
 * Internal state for concurrency control
 */
export interface ResourceLockState {
  /**
   * Map of resource IDs to their active lock promises
   * Key: eventId
   * Value: Promise that resolves when operation completes
   */
  locks: Map<string, Promise<void>>;
}

/**
 * Microsoft Graph API response body for event responses
 */
export interface MicrosoftGraphResponseBody {
  /**
   * Optional comment to organizer
   */
  comment?: string;

  /**
   * Whether to send response to organizer
   * Default: true
   */
  sendResponse?: boolean;
}
