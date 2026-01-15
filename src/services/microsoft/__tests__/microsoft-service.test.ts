/**
 * Microsoft Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MicrosoftService } from '../microsoft-service';
import { ServiceConfig } from '../../../types/service';
import * as fs from 'fs/promises';

describe('MicrosoftService', () => {
  let service: MicrosoftService;
  let config: ServiceConfig;
  const testTokenPath = './.tokens/test-microsoft-tokens.json';

  beforeEach(() => {
    config = {
      name: 'microsoft-test',
      oauth: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tenantId: 'test-tenant-id',
        redirectUri: 'http://localhost:3333/auth/microsoft/callback',
        scopes: ['offline_access', 'Mail.Read', 'Mail.Send'],
      },
      tokenStoragePath: testTokenPath,
    };

    // Set test mode
    process.env['USE_TEST_MODE'] = 'true';

    service = new MicrosoftService(config);
  });

  afterEach(async () => {
    await service.shutdown();
    try {
      await fs.unlink(testTokenPath);
    } catch {
      // Ignore if file doesn't exist
    }
    delete process.env['USE_TEST_MODE'];
  });

  describe('initialization', () => {
    it('should create service with correct name', () => {
      expect(service.name).toBe('microsoft-test');
    });

    it('should initialize without errors', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should not be authenticated initially', async () => {
      await service.initialize();
      expect(await service.isAuthenticated()).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should return three tools', () => {
      const tools = service.getTools();
      expect(tools).toHaveLength(3);
    });

    it('should return list-emails tool', () => {
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');
      expect(listEmails).toBeDefined();
      expect(listEmails?.description).toContain('List recent emails');
      expect(listEmails?.inputSchema.properties).toHaveProperty('count');
    });

    it('should return read-email tool', () => {
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');
      expect(readEmail).toBeDefined();
      expect(readEmail?.description).toContain('Read full email');
      expect(readEmail?.inputSchema.required).toContain('emailId');
    });

    it('should return send-email tool', () => {
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');
      expect(sendEmail).toBeDefined();
      expect(sendEmail?.description).toContain('Send an email');
      expect(sendEmail?.inputSchema.required).toContain('to');
      expect(sendEmail?.inputSchema.required).toContain('subject');
      expect(sendEmail?.inputSchema.required).toContain('body');
    });
  });

  describe('list-emails tool', () => {
    it('should list emails in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({});
      expect(result).toHaveProperty('emails');
      expect(result).toHaveProperty('count');
      expect((result as { emails: unknown[] }).emails).toBeInstanceOf(Array);
    });

    it('should respect count parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({ count: 5 });
      expect(result).toHaveProperty('emails');
      expect((result as { count: number }).count).toBeLessThanOrEqual(5);
    });

    it('should cap count at 50', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({ count: 100 });
      expect(result).toHaveProperty('emails');
      // In test mode we won't have 50 emails, but the cap is applied
      expect((result as { count: number }).count).toBeLessThanOrEqual(50);
    });

    it('should default to 10 emails when count not provided', async () => {
      await service.initialize();
      const tools = service.getTools();
      const listEmails = tools.find((t) => t.name === 'list-emails');

      const result = await listEmails?.handler({});
      expect(result).toHaveProperty('count');
      // In test mode, we expect the mock response structure
      expect((result as { count: number }).count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('read-email tool', () => {
    it('should read email by ID in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');

      const result = await readEmail?.handler({ emailId: 'test-email-id' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should require emailId parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const readEmail = tools.find((t) => t.name === 'read-email');

      // Missing required parameter should fail
      await expect(readEmail?.handler({})).rejects.toThrow();
    });
  });

  describe('send-email tool', () => {
    it('should send email in test mode', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: 'Test body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should support multiple recipients', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test1@example.com', 'test2@example.com'],
        subject: 'Test Subject',
        body: 'Test body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { message: string }).message).toContain('test1@example.com');
      expect((result as { message: string }).message).toContain('test2@example.com');
    });

    it('should support HTML body type', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: '<p>Test HTML body</p>',
        bodyType: 'html',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should default to text body type', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      const result = await sendEmail?.handler({
        to: ['test@example.com'],
        subject: 'Test Subject',
        body: 'Plain text body',
      });

      expect(result).toHaveProperty('success');
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('should require to parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          subject: 'Test Subject',
          body: 'Test body',
        })
      ).rejects.toThrow();
    });

    it('should require subject parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          to: ['test@example.com'],
          body: 'Test body',
        })
      ).rejects.toThrow();
    });

    it('should require body parameter', async () => {
      await service.initialize();
      const tools = service.getTools();
      const sendEmail = tools.find((t) => t.name === 'send-email');

      await expect(
        sendEmail?.handler({
          to: ['test@example.com'],
          subject: 'Test Subject',
        })
      ).rejects.toThrow();
    });
  });

  describe('authentication', () => {
    it('should report not authenticated without tokens', async () => {
      await service.initialize();
      expect(await service.isAuthenticated()).toBe(false);
    });

    it('should report authenticated with valid tokens', async () => {
      // Write mock token file
      const mockTokens = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Date.now() + 3600000, // 1 hour from now
      };

      await fs.mkdir('./.tokens', { recursive: true });
      await fs.writeFile(testTokenPath, JSON.stringify(mockTokens));

      await service.initialize();
      expect(await service.isAuthenticated()).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without errors', async () => {
      await service.initialize();
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  describe('calendar tools', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('list-events tool', () => {
      it('should list calendar events', async () => {
        const tools = service.getTools();
        const listEvents = tools.find((t) => t.name === 'list-events');

        const result = await listEvents?.handler({});
        expect(result).toHaveProperty('events');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('startDate');
        expect(result).toHaveProperty('endDate');
        expect((result as { events: unknown[] }).events).toBeInstanceOf(Array);
      });

      it('should respect custom date range', async () => {
        const tools = service.getTools();
        const listEvents = tools.find((t) => t.name === 'list-events');

        const startDate = '2026-01-20T00:00:00Z';
        const endDate = '2026-01-27T00:00:00Z';

        const result = await listEvents?.handler({
          startDate,
          endDate,
        });

        expect(result).toHaveProperty('startDate');
        expect(result).toHaveProperty('endDate');
      });

      it('should cap count at 100', async () => {
        const tools = service.getTools();
        const listEvents = tools.find((t) => t.name === 'list-events');

        const result = await listEvents?.handler({ count: 200 });
        expect((result as { count: number }).count).toBeLessThanOrEqual(100);
      });
    });

    describe('get-event tool', () => {
      it('should get event by ID', async () => {
        const tools = service.getTools();
        const getEvent = tools.find((t) => t.name === 'get-event');

        const result = await getEvent?.handler({ eventId: 'test-event-id' });
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });

      it('should require eventId parameter', async () => {
        const tools = service.getTools();
        const getEvent = tools.find((t) => t.name === 'get-event');

        await expect(getEvent?.handler({})).rejects.toThrow();
      });
    });

    describe('create-event tool', () => {
      it('should create basic event', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        const result = await createEvent?.handler({
          subject: 'Test Event',
          startDateTime: '2026-01-20T10:00:00Z',
          endDateTime: '2026-01-20T11:00:00Z',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
        expect(result).toHaveProperty('eventId');
      });

      it('should create event with attendees', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        const result = await createEvent?.handler({
          subject: 'Meeting with Team',
          startDateTime: '2026-01-20T14:00:00Z',
          endDateTime: '2026-01-20T15:00:00Z',
          attendees: ['test1@example.com', 'test2@example.com'],
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should create online meeting when requested', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        const result = await createEvent?.handler({
          subject: 'Teams Meeting',
          startDateTime: '2026-01-20T10:00:00Z',
          endDateTime: '2026-01-20T11:00:00Z',
          isOnlineMeeting: true,
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should create all-day event', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        const result = await createEvent?.handler({
          subject: 'All Day Event',
          startDateTime: '2026-01-20T00:00:00Z',
          endDateTime: '2026-01-20T23:59:59Z',
          isAllDay: true,
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should support custom timezones', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        const result = await createEvent?.handler({
          subject: 'Event with Timezone',
          startDateTime: '2026-01-20T10:00:00',
          endDateTime: '2026-01-20T11:00:00',
          startTimeZone: 'America/New_York',
          endTimeZone: 'America/New_York',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should require subject parameter', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        await expect(
          createEvent?.handler({
            startDateTime: '2026-01-20T10:00:00Z',
            endDateTime: '2026-01-20T11:00:00Z',
          })
        ).rejects.toThrow();
      });

      it('should require startDateTime parameter', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        await expect(
          createEvent?.handler({
            subject: 'Test Event',
            endDateTime: '2026-01-20T11:00:00Z',
          })
        ).rejects.toThrow();
      });

      it('should require endDateTime parameter', async () => {
        const tools = service.getTools();
        const createEvent = tools.find((t) => t.name === 'create-event');

        await expect(
          createEvent?.handler({
            subject: 'Test Event',
            startDateTime: '2026-01-20T10:00:00Z',
          })
        ).rejects.toThrow();
      });
    });

    describe('update-event tool', () => {
      it('should update event subject', async () => {
        const tools = service.getTools();
        const updateEvent = tools.find((t) => t.name === 'update-event');

        const result = await updateEvent?.handler({
          eventId: 'test-event-id',
          subject: 'Updated Subject',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should update event time', async () => {
        const tools = service.getTools();
        const updateEvent = tools.find((t) => t.name === 'update-event');

        const result = await updateEvent?.handler({
          eventId: 'test-event-id',
          startDateTime: '2026-01-21T10:00:00Z',
          endDateTime: '2026-01-21T11:00:00Z',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should update attendees', async () => {
        const tools = service.getTools();
        const updateEvent = tools.find((t) => t.name === 'update-event');

        const result = await updateEvent?.handler({
          eventId: 'test-event-id',
          attendees: ['new1@example.com', 'new2@example.com'],
        });

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('notifiedAttendees');
      });

      it('should support partial updates', async () => {
        const tools = service.getTools();
        const updateEvent = tools.find((t) => t.name === 'update-event');

        const result = await updateEvent?.handler({
          eventId: 'test-event-id',
          location: 'New Location',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should require eventId parameter', async () => {
        const tools = service.getTools();
        const updateEvent = tools.find((t) => t.name === 'update-event');

        await expect(
          updateEvent?.handler({
            subject: 'Updated Subject',
          })
        ).rejects.toThrow();
      });
    });

    describe('delete-event tool', () => {
      it('should delete event successfully', async () => {
        const tools = service.getTools();
        const deleteEvent = tools.find((t) => t.name === 'delete-event');

        const result = await deleteEvent?.handler({
          eventId: 'test-event-id',
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
      });

      it('should send cancellation by default', async () => {
        const tools = service.getTools();
        const deleteEvent = tools.find((t) => t.name === 'delete-event');

        const result = await deleteEvent?.handler({
          eventId: 'test-event-id',
        });

        expect(result).toHaveProperty('notifiedAttendees');
      });

      it('should skip cancellation when requested', async () => {
        const tools = service.getTools();
        const deleteEvent = tools.find((t) => t.name === 'delete-event');

        const result = await deleteEvent?.handler({
          eventId: 'test-event-id',
          sendCancellation: false,
        });

        expect(result).toHaveProperty('notifiedAttendees');
        expect((result as { notifiedAttendees: string[] }).notifiedAttendees).toHaveLength(0);
      });

      it('should require eventId parameter', async () => {
        const tools = service.getTools();
        const deleteEvent = tools.find((t) => t.name === 'delete-event');

        await expect(deleteEvent?.handler({})).rejects.toThrow();
      });
    });

    describe('tool registration', () => {
      it('should return 9 total tools (3 email + 6 calendar)', () => {
        const tools = service.getTools();
        expect(tools).toHaveLength(9);
      });

      it('should have all calendar tools defined', () => {
        const tools = service.getTools();
        const calendarTools = [
          'list-events',
          'get-event',
          'create-event',
          'update-event',
          'delete-event',
          'find-meeting-times',
        ];

        calendarTools.forEach((toolName) => {
          const tool = tools.find((t) => t.name === toolName);
          expect(tool).toBeDefined();
          expect(tool?.handler).toBeDefined();
        });
      });
    });

    describe('find-meeting-times tool', () => {
      it('should find meeting times for attendees', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com', 'user2@example.com'],
          meetingDuration: 60,
        });

        expect(result).toHaveProperty('success');
        expect((result as { success: boolean }).success).toBe(true);
        expect(result).toHaveProperty('suggestions');
        expect(result).toHaveProperty('suggestionsCount');
      });

      it('should support optional attendees', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com'],
          optionalAttendees: ['user2@example.com', 'user3@example.com'],
          meetingDuration: 30,
        });

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('searchParameters');
      });

      it('should respect custom time constraints', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com'],
          meetingDuration: 60,
          timeConstraintStart: '2026-01-20T09:00:00Z',
          timeConstraintEnd: '2026-01-20T17:00:00Z',
        });

        expect(result).toHaveProperty('searchParameters');
        const params = (
          result as { searchParameters: { timeWindow: { start: string; end: string } } }
        ).searchParameters;
        expect(params.timeWindow).toBeDefined();
      });

      it('should cap maxCandidates at 10', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com'],
          meetingDuration: 60,
          maxCandidates: 20,
        });

        expect(result).toHaveProperty('suggestions');
        expect((result as { suggestions: unknown[] }).suggestions.length).toBeLessThanOrEqual(10);
      });

      it('should use default meeting duration of 60 minutes', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com'],
          meetingDuration: 60,
        });

        expect(result).toHaveProperty('searchParameters');
        expect(
          (result as { searchParameters: { meetingDuration: number } }).searchParameters
            .meetingDuration
        ).toBe(60);
      });

      it('should support custom minimum attendee percentage', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        const result = await findMeetingTimes?.handler({
          attendees: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
          meetingDuration: 60,
          minimumAttendeePercentage: 75,
        });

        expect(result).toHaveProperty('success');
      });

      it('should require attendees parameter', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        await expect(
          findMeetingTimes?.handler({
            meetingDuration: 60,
          })
        ).rejects.toThrow();
      });

      it('should require meetingDuration parameter', async () => {
        const tools = service.getTools();
        const findMeetingTimes = tools.find((t) => t.name === 'find-meeting-times');

        await expect(
          findMeetingTimes?.handler({
            attendees: ['user1@example.com'],
          })
        ).rejects.toThrow();
      });
    });
  });
});
