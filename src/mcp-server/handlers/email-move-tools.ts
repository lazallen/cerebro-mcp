/**
 * Email Move Operations Handlers
 * Feature: 014-move-email-folder
 *
 * Implements handlers for moving emails between folders via Microsoft Graph API
 */

import { logger } from '../../common';
import type { MicrosoftApiClient } from '../../services/microsoft/api-client';
import type {
  MoveEmailInput,
  MoveEmailsInput,
  MoveResult,
  MoveBatchResult,
  MoveError,
  MoveBatchError,
  // BatchMoveState, // Will be used in Phase 5 (US3)
} from '../../types/email';

/**
 * Move a single email to a target folder
 * T014-T018: Implement moveEmail handler with validation, Graph API call, error handling, and logging
 *
 * @param input - Move operation parameters
 * @param apiClient - Microsoft Graph API client
 * @param folderResolver - Function to resolve folder paths to IDs
 * @returns Success result or error
 */
export async function moveEmail(
  input: MoveEmailInput,
  apiClient: MicrosoftApiClient,
  folderResolver: (path: string) => Promise<string>
): Promise<MoveResult | MoveError> {
  const startTime = Date.now();

  logger.info({
    operation: 'move_email_start',
    emailId: input.emailId,
    folderPath: input.folderPath,
    markAsRead: input.markAsRead ?? true,
    msg: 'Starting single email move operation',
  });

  try {
    // T015: Input validation
    if (!input.emailId || typeof input.emailId !== 'string' || input.emailId.trim().length === 0) {
      const error: MoveError = {
        success: false,
        errorType: 'INVALID_INPUT',
        message: formatErrorMessage('INVALID_INPUT', undefined, undefined, undefined, 'emailId is required and cannot be empty'),
      };
      logger.warn({
        operation: 'move_email_validation_error',
        error: error.message,
        msg: 'Input validation failed',
      });
      return error;
    }

    if (!input.folderPath || typeof input.folderPath !== 'string' || input.folderPath.trim().length === 0) {
      const error: MoveError = {
        success: false,
        errorType: 'INVALID_INPUT',
        message: formatErrorMessage('INVALID_INPUT', input.emailId, undefined, undefined, 'folderPath is required and cannot be empty'),
        emailId: input.emailId,
      };
      logger.warn({
        operation: 'move_email_validation_error',
        emailId: input.emailId,
        error: error.message,
        msg: 'Input validation failed',
      });
      return error;
    }

    const markAsRead = input.markAsRead ?? true;

    // Fetch email metadata (includes idempotent check data)
    const emailMetadata = await fetchEmailMetadata(input.emailId, apiClient);

    // Resolve target folder
    let targetFolderId: string;
    let targetFolderName: string;
    try {
      targetFolderId = await folderResolver(input.folderPath);

      // Fetch target folder display name for result
      const folderResponse = await apiClient.request(`/me/mailFolders/${targetFolderId}`, {
        method: 'GET',
        params: {
          $select: 'displayName',
        },
      });
      const folder = folderResponse.data as { displayName?: string };
      targetFolderName = folder.displayName || input.folderPath;
    } catch (error) {
      // T017: Error handling with balanced detail messages
      logger.error({
        operation: 'move_email_folder_resolution_error',
        emailId: input.emailId,
        folderPath: input.folderPath,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to resolve target folder',
      });

      const moveError: MoveError = {
        success: false,
        errorType: 'FOLDER_NOT_FOUND',
        message: formatErrorMessage(
          'FOLDER_NOT_FOUND',
          input.emailId,
          emailMetadata.subject,
          input.folderPath,
          error instanceof Error ? error.message : undefined
        ),
        emailId: input.emailId,
        subject: emailMetadata.subject,
        folderPath: input.folderPath,
      };
      return moveError;
    }

    // T005: Check if move is idempotent (already in target folder)
    if (isIdempotentMove(emailMetadata.parentFolderId, targetFolderId)) {
      logger.info({
        operation: 'move_email_idempotent',
        emailId: input.emailId,
        subject: emailMetadata.subject,
        folder: targetFolderName,
        msg: 'Email already in target folder (idempotent move)',
      });

      // Still update read status if requested
      if (markAsRead && !emailMetadata.isRead) {
        await updateReadStatus(input.emailId, true, apiClient);
      }

      const result: MoveResult = {
        success: true,
        emailId: input.emailId,
        subject: emailMetadata.subject,
        fromFolder: emailMetadata.parentFolderName,
        toFolder: targetFolderName,
        markedAsRead: markAsRead,
        wasIdempotent: true,
      };

      logger.info({
        operation: 'move_email_success',
        emailId: input.emailId,
        duration: Date.now() - startTime,
        wasIdempotent: true,
        msg: 'Email move operation completed (idempotent)',
      });

      return result;
    }

    // T016: Implement Graph API move call
    logger.debug({
      operation: 'move_email_api_call',
      emailId: input.emailId,
      fromFolder: emailMetadata.parentFolderName,
      toFolder: targetFolderName,
      msg: 'Calling Microsoft Graph API to move email',
    });

    let newEmailId: string;
    try {
      const moveResponse = await apiClient.request(`/me/messages/${input.emailId}/move`, {
        method: 'POST',
        body: {
          destinationId: targetFolderId,
        },
      });

      // Extract the new email ID from the move response
      const movedEmail = moveResponse.data as { id?: string };
      newEmailId = movedEmail.id || input.emailId;

      logger.debug({
        operation: 'move_email_api_success',
        emailId: input.emailId,
        newEmailId,
        msg: 'Successfully moved email via Graph API',
      });
    } catch (error) {
      // T017: Error handling for move operation
      logger.error({
        operation: 'move_email_api_error',
        emailId: input.emailId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to move email via Graph API',
      });

      // Check for permission denied (403)
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        (error as { response?: { status?: number } }).response?.status === 403
      ) {
        const moveError: MoveError = {
          success: false,
          errorType: 'PERMISSION_DENIED',
          message: formatErrorMessage(
            'PERMISSION_DENIED',
            input.emailId,
            emailMetadata.subject,
            input.folderPath
          ),
          emailId: input.emailId,
          subject: emailMetadata.subject,
          folderPath: input.folderPath,
          graphErrorCode: 'ErrorAccessDenied',
        };
        return moveError;
      }

      // Check for network errors
      if (
        error &&
        typeof error === 'object' &&
        (('code' in error &&
          (error as { code?: string }).code === 'ECONNREFUSED') ||
        ('errno' in error && (error as { errno?: string }).errno === 'ETIMEDOUT'))
      ) {
        const moveError: MoveError = {
          success: false,
          errorType: 'NETWORK_ERROR',
          message: formatErrorMessage(
            'NETWORK_ERROR',
            input.emailId,
            emailMetadata.subject,
            undefined,
            error instanceof Error ? error.message : undefined
          ),
          emailId: input.emailId,
          subject: emailMetadata.subject,
        };
        return moveError;
      }

      // Generic Graph API error
      const moveError: MoveError = {
        success: false,
        errorType: 'GRAPH_API_ERROR',
        message: formatErrorMessage(
          'GRAPH_API_ERROR',
          input.emailId,
          emailMetadata.subject,
          input.folderPath,
          error instanceof Error ? error.message : undefined
        ),
        emailId: input.emailId,
        subject: emailMetadata.subject,
        folderPath: input.folderPath,
      };
      return moveError;
    }

    // T006: Update read status after successful move
    if (markAsRead) {
      try {
        await updateReadStatus(newEmailId, true, apiClient);
      } catch (error) {
        // Log warning but don't fail the operation since move succeeded
        logger.warn({
          operation: 'move_email_read_status_warning',
          emailId: input.emailId,
          newEmailId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Email moved successfully but failed to update read status',
        });
      }
    }

    // T018: Structured logging for successful operation
    const duration = Date.now() - startTime;
    logger.info({
      operation: 'move_email_success',
      emailId: input.emailId,
      newEmailId,
      subject: emailMetadata.subject,
      fromFolder: emailMetadata.parentFolderName,
      toFolder: targetFolderName,
      markedAsRead: markAsRead,
      duration,
      msg: 'Email move operation completed successfully',
    });

    const result: MoveResult = {
      success: true,
      emailId: newEmailId, // Return the new ID after move
      subject: emailMetadata.subject,
      fromFolder: emailMetadata.parentFolderName,
      toFolder: targetFolderName,
      markedAsRead: markAsRead,
      wasIdempotent: false,
    };

    return result;
  } catch (error) {
    // T017: Top-level error handling
    logger.error({
      operation: 'move_email_error',
      emailId: input.emailId,
      folderPath: input.folderPath,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
      msg: 'Email move operation failed',
    });

    // If it's already a MoveError, return it
    if (error && typeof error === 'object' && 'success' in error && error.success === false) {
      return error as MoveError;
    }

    // Generic error
    const moveError: MoveError = {
      success: false,
      errorType: 'GRAPH_API_ERROR',
      message: formatErrorMessage(
        'GRAPH_API_ERROR',
        input.emailId,
        undefined,
        input.folderPath,
        error instanceof Error ? error.message : String(error)
      ),
      emailId: input.emailId,
      folderPath: input.folderPath,
    };
    return moveError;
  }
}

/**
 * Move multiple emails to a target folder atomically
 * Implementation will be added in Phase 5 (User Story 3)
 *
 * @param _input - Batch move operation parameters
 * @param _apiClient - Microsoft Graph API client
 * @param _folderResolver - Function to resolve folder paths to IDs
 * @returns Success result or error
 */
export async function moveEmailsBatch(
  _input: MoveEmailsInput,
  _apiClient: MicrosoftApiClient,
  _folderResolver: (path: string) => Promise<string>
): Promise<MoveBatchResult | MoveBatchError> {
  // Implementation will be added in US3 phase
  throw new Error('Not implemented - will be added in Phase 5 (User Story 3)');
}

// ============================================================================
// Helper Functions (Phase 2: Foundational)
// ============================================================================

/**
 * Email metadata retrieved for move operations
 */
interface EmailMetadata {
  id: string;
  subject: string;
  parentFolderId: string;
  parentFolderName: string;
  isRead: boolean;
}

/**
 * Fetch email metadata needed for move operation
 * T004: Implement email metadata fetch helper
 *
 * @param emailId - Email message ID
 * @param apiClient - Microsoft Graph API client
 * @returns Email metadata
 * @throws MoveError if email not found
 */
async function fetchEmailMetadata(
  emailId: string,
  apiClient: MicrosoftApiClient
): Promise<EmailMetadata> {
  try {
    logger.debug({
      operation: 'fetch_email_metadata',
      emailId,
      msg: 'Fetching email metadata for move operation',
    });

    // Fetch email details including current folder
    const response = await apiClient.request(`/me/messages/${emailId}`, {
      method: 'GET',
      params: {
        $select: 'id,subject,parentFolderId,isRead',
      },
    });

    const email = response.data as {
      id?: string;
      subject?: string;
      parentFolderId?: string;
      isRead?: boolean;
    };

    if (!email.id || !email.parentFolderId) {
      throw new Error('Invalid email response from Graph API');
    }

    // Fetch parent folder name for better error messages
    const folderResponse = await apiClient.request(
      `/me/mailFolders/${email.parentFolderId}`,
      {
        method: 'GET',
        params: {
          $select: 'displayName',
        },
      }
    );

    const folder = folderResponse.data as { displayName?: string };
    const parentFolderName = folder.displayName || email.parentFolderId;

    // Truncate subject to 100 characters
    const subject = email.subject
      ? email.subject.length > 100
        ? `${email.subject.substring(0, 97)}...`
        : email.subject
      : '[No subject]';

    logger.debug({
      operation: 'fetch_email_metadata_success',
      emailId,
      subject,
      parentFolder: parentFolderName,
      msg: 'Successfully fetched email metadata',
    });

    return {
      id: email.id,
      subject,
      parentFolderId: email.parentFolderId,
      parentFolderName,
      isRead: email.isRead ?? false,
    };
  } catch (error) {
    logger.error({
      operation: 'fetch_email_metadata_error',
      emailId,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to fetch email metadata',
    });

    // Check if it's a 404 (email not found)
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 404
    ) {
      throw {
        success: false,
        errorType: 'EMAIL_NOT_FOUND',
        message: `Failed to move email [${emailId}]: Email not found or has been deleted.`,
        emailId,
      } as MoveError;
    }

    throw error;
  }
}

/**
 * Check if email is already in the target folder (idempotent check)
 * T005: Implement idempotent check helper
 *
 * @param currentFolderId - Email's current folder ID
 * @param targetFolderId - Target folder ID
 * @returns True if email is already in target folder
 */
function isIdempotentMove(
  currentFolderId: string,
  targetFolderId: string
): boolean {
  return currentFolderId === targetFolderId;
}

/**
 * Update email read status
 * T006: Implement read status update helper
 *
 * @param emailId - Email message ID
 * @param markAsRead - Whether to mark as read
 * @param apiClient - Microsoft Graph API client
 */
async function updateReadStatus(
  emailId: string,
  markAsRead: boolean,
  apiClient: MicrosoftApiClient
): Promise<void> {
  try {
    logger.debug({
      operation: 'update_read_status',
      emailId,
      markAsRead,
      msg: 'Updating email read status',
    });

    await apiClient.request(`/me/messages/${emailId}`, {
      method: 'PATCH',
      body: {
        isRead: markAsRead,
      },
    });

    logger.debug({
      operation: 'update_read_status_success',
      emailId,
      markAsRead,
      msg: 'Successfully updated email read status',
    });
  } catch (error) {
    logger.error({
      operation: 'update_read_status_error',
      emailId,
      markAsRead,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to update email read status',
    });
    throw error;
  }
}

/**
 * Format error message with balanced detail
 * T007: Implement error formatting helper
 *
 * @param errorType - Error type category
 * @param emailId - Email ID (if applicable)
 * @param subject - Email subject (if available)
 * @param folderPath - Folder path (if applicable)
 * @param detail - Additional error detail
 * @returns Formatted error message
 */
function formatErrorMessage(
  errorType: string,
  emailId?: string,
  subject?: string,
  folderPath?: string,
  detail?: string
): string {
  let message = '';

  switch (errorType) {
    case 'EMAIL_NOT_FOUND':
      message = `Failed to move email [${emailId}]`;
      if (subject) {
        message += ` "${subject}"`;
      }
      message += ': Email not found or has been deleted.';
      break;

    case 'FOLDER_NOT_FOUND':
      message = `Failed to move email`;
      if (emailId) {
        message += ` [${emailId}]`;
      }
      if (subject) {
        message += ` "${subject}"`;
      }
      if (folderPath) {
        message += ` to folder "${folderPath}"`;
      }
      message += '. Reason: Folder does not exist.';
      if (detail) {
        message += ` ${detail}`;
      }
      break;

    case 'PERMISSION_DENIED':
      message = `Failed to move email`;
      if (emailId) {
        message += ` [${emailId}]`;
      }
      if (subject) {
        message += ` "${subject}"`;
      }
      if (folderPath) {
        message += ` to folder "${folderPath}"`;
      }
      message += '. Reason: Insufficient permissions.';
      break;

    case 'INVALID_INPUT':
      message = `Invalid input: ${detail || 'Invalid parameters'}`;
      break;

    case 'NETWORK_ERROR':
      message = `Network error while moving email`;
      if (emailId) {
        message += ` [${emailId}]`;
      }
      if (detail) {
        message += `: ${detail}`;
      }
      break;

    default:
      message = `Failed to move email`;
      if (emailId) {
        message += ` [${emailId}]`;
      }
      if (detail) {
        message += `: ${detail}`;
      }
      break;
  }

  return message;
}
