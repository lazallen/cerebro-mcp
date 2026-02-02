/**
 * Event Response Client Unit Tests
 *
 * Tests comment validation, response methods, and error handling
 */

import { EventResponseClient, validateComment } from '../event-response-client';
import { MicrosoftApiClient } from '../api-client';
import { ResourceLockedError } from '../resource-lock';
import type { EventResponseRequest } from '../../../types/calendar';

describe('EventResponseClient', () => {
  describe('validateComment', () => {
    it('should return undefined for undefined comment', () => {
      expect(validateComment(undefined)).toBeUndefined();
    });

    it('should return undefined for empty comment', () => {
      expect(validateComment('')).toBeUndefined();
    });

    it('should return comment unchanged when under 8KB limit', () => {
      const comment = 'This is a short comment';
      expect(validateComment(comment)).toBe(comment);
    });

    it('should return comment unchanged when exactly 8192 bytes', () => {
      // Create string of exactly 8192 single-byte characters
      const comment = 'a'.repeat(8192);
      const result = validateComment(comment);

      expect(result).toBe(comment);
      expect(Buffer.from(result!,  'utf8').length).toBe(8192);
    });

    it('should truncate comment when exceeding 8192 bytes', () => {
      // Create string of 8193 single-byte characters
      const comment = 'a'.repeat(8193);
      const result = validateComment(comment);

      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(comment.length);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should handle multi-byte UTF-8 characters correctly', () => {
      // Each Chinese character is 3 bytes in UTF-8
      // 2730 characters * 3 bytes = 8190 bytes (under limit)
      const comment = '你'.repeat(2730);
      const result = validateComment(comment);

      expect(result).toBe(comment);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should truncate multi-byte UTF-8 characters when over limit', () => {
      // Each Chinese character is 3 bytes in UTF-8
      // 2732 characters * 3 bytes = 8196 bytes (over limit by 4 bytes)
      const comment = '你'.repeat(2732);
      const result = validateComment(comment);

      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(comment.length);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should handle mixed ASCII and multi-byte characters', () => {
      // Mix of English (1 byte) and Chinese (3 bytes) characters
      const englishPart = 'a'.repeat(4096); // 4096 bytes
      const chinesePart = '你'.repeat(1365); // 1365 * 3 = 4095 bytes
      const comment = englishPart + chinesePart; // Total: 8191 bytes

      const result = validateComment(comment);

      expect(result).toBe(comment);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should truncate mixed content when over limit', () => {
      const englishPart = 'a'.repeat(4096);
      const chinesePart = '你'.repeat(1366); // 1366 * 3 = 4098 bytes
      const comment = englishPart + chinesePart; // Total: 8194 bytes (over by 2)

      const result = validateComment(comment);

      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(comment.length);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should handle emoji characters correctly', () => {
      // Emoji are typically 4 bytes in UTF-8
      // 2048 emoji * 4 bytes = 8192 bytes (exactly at limit)
      const comment = '😀'.repeat(2048);
      const result = validateComment(comment);

      expect(result).toBe(comment);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should truncate when emoji exceed limit', () => {
      // 2049 emoji * 4 bytes = 8196 bytes (over by 4)
      const comment = '😀'.repeat(2049);
      const result = validateComment(comment);

      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(comment.length);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should preserve as much content as possible when truncating', () => {
      const comment = 'a'.repeat(9000); // Well over limit
      const result = validateComment(comment);

      expect(result).toBeDefined();
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
      // Should be close to 8192 bytes
      expect(Buffer.from(result!, 'utf8').length).toBeGreaterThan(8000);
    });

    it('should handle newlines and special characters', () => {
      const comment = 'Line 1\nLine 2\rLine 3\tTabbed\0Null';
      const result = validateComment(comment);

      expect(result).toBe(comment);
      expect(Buffer.from(result!, 'utf8').length).toBeLessThanOrEqual(8192);
    });
  });

  describe('decline', () => {
    let client: EventResponseClient;
    let mockApiClient: jest.Mocked<MicrosoftApiClient>;

    beforeEach(() => {
      // Create mock API client
      mockApiClient = {
        request: jest.fn(),
      } as unknown as jest.Mocked<MicrosoftApiClient>;

      client = new EventResponseClient(mockApiClient);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully decline a meeting', async () => {
      mockApiClient.request.mockResolvedValue({
        data: {},
        status: 202,
        headers: {},
      });

      const request: EventResponseRequest = {
        eventId: 'event-123',
        response: 'declined',
        comment: 'Cannot attend',
        sendResponse: true,
      };

      const result = await client.decline(request);

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-123');
      expect(result.responseType).toBe('declined');
      expect(result.message).toContain('declined sent successfully');
      expect(result.timestamp).toBeDefined();

      // Verify API was called correctly
      expect(mockApiClient.request).toHaveBeenCalledWith('/me/events/event-123/decline', {
        method: 'POST',
        body: {
          comment: 'Cannot attend',
          sendResponse: true,
        },
      });
    });

    it('should decline without comment when comment is omitted', async () => {
      mockApiClient.request.mockResolvedValue({
        data: {},
        status: 202,
        headers: {},
      });

      const request: EventResponseRequest = {
        eventId: 'event-456',
        response: 'declined',
        sendResponse: false,
      };

      const result = await client.decline(request);

      expect(result.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledWith('/me/events/event-456/decline', {
        method: 'POST',
        body: {
          comment: undefined,
          sendResponse: false,
        },
      });
    });

    it('should truncate comment if over 8KB limit', async () => {
      mockApiClient.request.mockResolvedValue({
        data: {},
        status: 202,
        headers: {},
      });

      const longComment = 'a'.repeat(9000); // Over limit
      const request: EventResponseRequest = {
        eventId: 'event-789',
        response: 'declined',
        comment: longComment,
      };

      await client.decline(request);

      const call = mockApiClient.request.mock.calls[0];
      const requestBody = call[1].body as { comment?: string };
      expect(requestBody.comment).toBeDefined();
      expect(Buffer.from(requestBody.comment!, 'utf8').length).toBeLessThanOrEqual(8192);
    });

    it('should return failure for ResourceLockedError (concurrent request)', async () => {
      // First request will be in progress
      mockApiClient.request.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: {}, status: 202, headers: {} }), 100);
          })
      );

      const request: EventResponseRequest = {
        eventId: 'event-concurrent',
        response: 'declined',
      };

      // Start first request (don't await yet)
      const firstRequestPromise = client.decline(request);

      // Small delay to ensure lock is registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second concurrent request should fail with ResourceLockedError
      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.eventId).toBe('event-concurrent');
      expect(result.message).toContain('already being processed');
      expect(result.error?.code).toBe('AlreadyProcessing');
      expect(result.error?.status).toBe(409);
      expect(result.error?.retryable).toBe(false);

      // Wait for first request to complete
      const firstResult = await firstRequestPromise;
      expect(firstResult.success).toBe(true);
    });

    it('should handle 404 error (event not found)', async () => {
      mockApiClient.request.mockRejectedValue({
        status: 404,
        message: 'Event not found',
        context: { response: { error: { code: 'ResourceNotFound' } } },
      });

      const request: EventResponseRequest = {
        eventId: 'nonexistent-event',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.eventId).toBe('nonexistent-event');
      expect(result.message).toContain('not found');
      expect(result.error?.status).toBe(404);
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle 401 error (authentication failure)', async () => {
      mockApiClient.request.mockRejectedValue({
        status: 401,
        message: 'Unauthorized',
      });

      const request: EventResponseRequest = {
        eventId: 'event-123',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication token expired');
      expect(result.error?.status).toBe(401);
    });

    it('should handle 403 error (insufficient permissions)', async () => {
      mockApiClient.request.mockRejectedValue({
        status: 403,
        message: 'Forbidden',
      });

      const request: EventResponseRequest = {
        eventId: 'event-123',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Insufficient permissions');
      expect(result.error?.status).toBe(403);
    });

    it('should retry and eventually succeed for transient 500 error', async () => {
      // Fail twice with 500, then succeed
      mockApiClient.request
        .mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' })
        .mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' })
        .mockResolvedValue({ data: {}, status: 202, headers: {} });

      const request: EventResponseRequest = {
        eventId: 'event-retry',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledTimes(3);
    });

    it('should return failure after exhausting all retries', async () => {
      // Always fail with 500
      mockApiClient.request.mockRejectedValue({
        status: 500,
        message: 'Internal Server Error',
      });

      const request: EventResponseRequest = {
        eventId: 'event-fail',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Microsoft service error');
      expect(result.error?.status).toBe(500);
      // Initial attempt + 3 retries = 4 total calls
      expect(mockApiClient.request).toHaveBeenCalledTimes(4);
    });

    it('should handle 429 rate limit error with retry', async () => {
      // Fail with 429, then succeed
      mockApiClient.request
        .mockRejectedValueOnce({
          status: 429,
          message: 'Too Many Requests',
          context: { headers: { 'retry-after': '1' } },
        })
        .mockResolvedValue({ data: {}, status: 202, headers: {} });

      const request: EventResponseRequest = {
        eventId: 'event-rate-limit',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors (400)', async () => {
      mockApiClient.request.mockRejectedValue({
        status: 400,
        message: 'Bad Request',
      });

      const request: EventResponseRequest = {
        eventId: 'event-bad-request',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid request');
      // Should only be called once (no retries)
      expect(mockApiClient.request).toHaveBeenCalledTimes(1);
    });

    it('should default sendResponse to true when not specified', async () => {
      mockApiClient.request.mockResolvedValue({
        data: {},
        status: 202,
        headers: {},
      });

      const request: EventResponseRequest = {
        eventId: 'event-default',
        response: 'declined',
      };

      await client.decline(request);

      const call = mockApiClient.request.mock.calls[0];
      const requestBody = call[1].body as { sendResponse?: boolean };
      expect(requestBody.sendResponse).toBe(true);
    });

    it('should include timestamp in result', async () => {
      mockApiClient.request.mockResolvedValue({
        data: {},
        status: 202,
        headers: {},
      });

      const request: EventResponseRequest = {
        eventId: 'event-timestamp',
        response: 'declined',
      };

      const beforeTime = new Date().toISOString();
      const result = await client.decline(request);
      const afterTime = new Date().toISOString();

      expect(result.timestamp).toBeDefined();
      expect(result.timestamp >= beforeTime).toBe(true);
      expect(result.timestamp <= afterTime).toBe(true);
    });

    it('should delete event when organizer has not requested a response', async () => {
      // First call (decline) fails with "organizer hasn't requested a response"
      // Second call (delete) succeeds
      const error = new Error("Your request can't be completed. The meeting organizer hasn't requested a response.");
      Object.assign(error, { status: 400 });

      mockApiClient.request
        .mockRejectedValueOnce(error)
        .mockResolvedValue({ data: {}, status: 204, headers: {} });

      const request: EventResponseRequest = {
        eventId: 'event-no-response',
        response: 'declined',
        comment: 'Cannot attend',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-no-response');
      expect(result.responseType).toBe('declined');
      expect(result.message).toContain('Meeting removed from your calendar');
      expect(result.message).toContain('no response was sent');

      // Verify decline was attempted first
      expect(mockApiClient.request).toHaveBeenCalledWith('/me/events/event-no-response/decline', {
        method: 'POST',
        body: {
          comment: 'Cannot attend',
          sendResponse: true,
        },
      });

      // Verify event was deleted as fallback
      expect(mockApiClient.request).toHaveBeenCalledWith('/me/events/event-no-response', {
        method: 'DELETE',
      });

      expect(mockApiClient.request).toHaveBeenCalledTimes(2);
    });

    it('should return failure if both decline and delete fail', async () => {
      // First call (decline) fails with "organizer hasn't requested a response"
      // Second call (delete) also fails
      const declineError = new Error("Your request can't be completed. The meeting organizer hasn't requested a response.");
      Object.assign(declineError, { status: 400 });

      const deleteError = new Error('Event not found');
      Object.assign(deleteError, { status: 404 });

      mockApiClient.request
        .mockRejectedValueOnce(declineError)
        .mockRejectedValueOnce(deleteError);

      const request: EventResponseRequest = {
        eventId: 'event-no-response-delete-fail',
        response: 'declined',
      };

      const result = await client.decline(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not allow responses');
      expect(result.message).toContain('could not be removed');

      expect(mockApiClient.request).toHaveBeenCalledTimes(2);
    });
  });
});
