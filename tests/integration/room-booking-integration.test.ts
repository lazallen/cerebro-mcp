/**
 * Integration tests for room booking flow
 *
 * Tests the complete flow: list rooms → check availability → book room
 */

import { RoomBookingClient } from '../../src/services/microsoft/room-booking-client';
import { MicrosoftApiClient } from '../../src/services/microsoft/api-client';
import type { RoomSearchCriteria, RoomBookingRequest } from '../../src/types/room';

describe('Room Booking Integration', () => {
  let client: RoomBookingClient;
  let mockApiClient: jest.Mocked<MicrosoftApiClient>;

  beforeEach(() => {
    mockApiClient = {
      listMeetingRooms: jest.fn(),
      getSchedule: jest.fn(),
      request: jest.fn(),
    } as any;
    client = new RoomBookingClient(mockApiClient);
  });

  describe('list → check → book flow', () => {
    it('should complete full booking flow successfully', async () => {
      // Step 1: List rooms in Edinburgh with capacity for 10 people
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'edi-l2-barajas@company.com',
          displayName: 'Barajas',
          building: 'Edinburgh',
          capacity: 12,
          videoDeviceName: 'Teams Rooms',
        },
        {
          id: 'room2',
          emailAddress: 'edi-l2-athens@company.com',
          displayName: 'Athens',
          building: 'Edinburgh',
          capacity: 8,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const searchCriteria: RoomSearchCriteria = {
        building: 'Edinburgh',
        minCapacity: 10,
      };

      const rooms = await client.searchRooms(searchCriteria);

      expect(rooms).toHaveLength(2);
      expect(rooms[0].displayName).toBe('Barajas');

      // Step 2: Check availability for both rooms
      const startTime = new Date('2026-02-05T14:00:00Z');
      const endTime = new Date('2026-02-05T15:00:00Z');

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'edi-l2-barajas@company.com',
            availabilityView: '0000', // available
            scheduleItems: [],
          },
          {
            scheduleId: 'edi-l2-athens@company.com',
            availabilityView: '0220', // busy
            scheduleItems: [
              {
                subject: 'Existing Meeting',
                start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const availability = await client.checkRoomAvailability(
        rooms.map((r) => r.emailAddress),
        startTime,
        endTime
      );

      expect(availability.size).toBe(2);
      expect(availability.get('edi-l2-barajas@company.com')?.isAvailable).toBe(true);
      expect(availability.get('edi-l2-athens@company.com')?.isAvailable).toBe(false);

      // Step 3: Book the available room
      const eventId = 'event123';
      const mockEvent = {
        id: eventId,
        subject: 'Team Standup',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: '' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      // Re-check availability before booking
      mockApiClient.getSchedule.mockResolvedValue({
        value: [
          {
            scheduleId: 'edi-l2-barajas@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      });
      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const bookingRequest: RoomBookingRequest = {
        eventId,
        roomEmail: 'edi-l2-barajas@company.com',
        roomName: 'Barajas',
      };

      const result = await client.bookRoom(bookingRequest);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            attendees: expect.arrayContaining([
              expect.objectContaining({
                emailAddress: {
                  address: 'edi-l2-barajas@company.com',
                  name: 'Barajas',
                },
                type: 'resource',
              }),
            ]),
          }),
        })
      );
    });

    it('should handle no available rooms scenario', async () => {
      // Step 1: List rooms
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 10,
        },
        {
          id: 'room2',
          emailAddress: 'room2@company.com',
          displayName: 'Room 2',
          building: 'Edinburgh',
          capacity: 12,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const searchCriteria: RoomSearchCriteria = {
        building: 'Edinburgh',
        minCapacity: 10,
      };

      const rooms = await client.searchRooms(searchCriteria);
      expect(rooms).toHaveLength(2);

      // Step 2: Check availability - all busy
      const startTime = new Date('2026-02-05T14:00:00Z');
      const endTime = new Date('2026-02-05T15:00:00Z');

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '2222', // busy
            scheduleItems: [
              {
                subject: 'Meeting 1',
                start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
          {
            scheduleId: 'room2@company.com',
            availabilityView: '2222', // busy
            scheduleItems: [
              {
                subject: 'Meeting 2',
                start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const availability = await client.checkRoomAvailability(
        rooms.map((r) => r.emailAddress),
        startTime,
        endTime
      );

      // Verify all rooms are unavailable
      const availableRooms = Array.from(availability.values()).filter(
        (a) => a.isAvailable
      );
      expect(availableRooms).toHaveLength(0);

      // Step 3: Attempt to book should fail
      const eventId = 'event123';
      const mockEvent = {
        id: eventId,
        subject: 'Team Standup',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: '' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      mockApiClient.getSchedule.mockResolvedValue({
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '2222',
            scheduleItems: [
              {
                subject: 'Meeting 1',
                start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      });

      const bookingRequest: RoomBookingRequest = {
        eventId,
        roomEmail: 'room1@company.com',
        roomName: 'Room 1',
      };

      await expect(client.bookRoom(bookingRequest)).rejects.toThrow('not available');
    });

    it('should filter rooms by video equipment and book first available', async () => {
      // Step 1: List rooms with video equipment
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1 (Video)',
          building: 'Edinburgh',
          capacity: 10,
          videoDeviceName: 'Teams Rooms',
        },
        {
          id: 'room2',
          emailAddress: 'room2@company.com',
          displayName: 'Room 2 (Video)',
          building: 'Edinburgh',
          capacity: 8,
          videoDeviceName: 'Zoom Rooms',
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const searchCriteria: RoomSearchCriteria = {
        building: 'Edinburgh',
        requiresVideo: true,
      };

      const rooms = await client.searchRooms(searchCriteria);

      expect(rooms).toHaveLength(2);
      expect(rooms.every((r) => r.videoDeviceName)).toBe(true);

      // Step 2: Check availability
      const startTime = new Date('2026-02-05T14:00:00Z');
      const endTime = new Date('2026-02-05T15:00:00Z');

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
          {
            scheduleId: 'room2@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const availability = await client.checkRoomAvailability(
        rooms.map((r) => r.emailAddress),
        startTime,
        endTime
      );

      const availableRooms = rooms.filter((r) =>
        availability.get(r.emailAddress)?.isAvailable
      );
      expect(availableRooms).toHaveLength(2);

      // Step 3: Book first available room
      const eventId = 'event123';
      const mockEvent = {
        id: eventId,
        subject: 'Video Call',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: '' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      mockApiClient.getSchedule.mockResolvedValue({
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      });
      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const bookingRequest: RoomBookingRequest = {
        eventId,
        roomEmail: availableRooms[0].emailAddress,
        roomName: availableRooms[0].displayName,
      };

      const result = await client.bookRoom(bookingRequest);

      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully during search', async () => {
      mockApiClient.listMeetingRooms.mockRejectedValue(
        new Error('Network error')
      );

      const searchCriteria: RoomSearchCriteria = {
        building: 'Edinburgh',
      };

      await expect(client.searchRooms(searchCriteria)).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle API errors gracefully during availability check', async () => {
      mockApiClient.getSchedule.mockRejectedValue(new Error('Network error'));

      const startTime = new Date('2026-02-05T14:00:00Z');
      const endTime = new Date('2026-02-05T15:00:00Z');

      await expect(
        client.checkRoomAvailability(['room1@company.com'], startTime, endTime)
      ).rejects.toThrow('Network error');
    });

    it('should handle API errors gracefully during booking', async () => {
      mockApiClient.request.mockRejectedValue(new Error('Network error'));

      const bookingRequest: RoomBookingRequest = {
        eventId: 'event123',
        roomEmail: 'room1@company.com',
        roomName: 'Room 1',
      };

      await expect(client.bookRoom(bookingRequest)).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('remove and rebook flow', () => {
    it('should remove room and rebook different room successfully', async () => {
      const eventId = 'event123';
      const oldRoomEmail = 'old-room@company.com';
      const newRoomEmail = 'new-room@company.com';

      // Step 1: Remove old room
      const eventWithOldRoom = {
        id: eventId,
        subject: 'Team Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [
          {
            emailAddress: { address: oldRoomEmail, name: 'Old Room' },
            type: 'resource',
          },
          {
            emailAddress: { address: 'user@company.com', name: 'User' },
            type: 'required',
          },
        ],
        location: { displayName: 'Old Room' },
      };

      mockApiClient.request
        .mockResolvedValueOnce({ data: eventWithOldRoom }) // GET event
        .mockResolvedValueOnce({ data: eventWithOldRoom }); // PATCH event

      const removeResult = await client.removeRoom(eventId, oldRoomEmail, true);

      expect(removeResult.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            attendees: [
              {
                emailAddress: { address: 'user@company.com', name: 'User' },
                type: 'required',
              },
            ],
            location: {
              displayName: '',
              locationEmailAddress: '',
            },
          }),
        })
      );

      // Step 2: Book new room
      const eventWithoutRoom = {
        id: eventId,
        subject: 'Team Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [
          {
            emailAddress: { address: 'user@company.com', name: 'User' },
            type: 'required',
          },
        ],
        location: { displayName: '' },
      };

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: newRoomEmail,
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };

      mockApiClient.request.mockResolvedValueOnce({ data: eventWithoutRoom }); // GET event
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);
      mockApiClient.request.mockResolvedValueOnce({ data: eventWithoutRoom }); // PATCH event

      const bookingRequest: RoomBookingRequest = {
        eventId,
        roomEmail: newRoomEmail,
        roomName: 'New Room',
      };

      const bookResult = await client.bookRoom(bookingRequest);

      expect(bookResult.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            attendees: expect.arrayContaining([
              expect.objectContaining({
                emailAddress: { address: newRoomEmail, name: 'New Room' },
                type: 'resource',
              }),
            ]),
          }),
        })
      );
    });

    it('should preserve virtual meeting link when removing room', async () => {
      const eventId = 'event123';
      const roomEmail = 'room@company.com';

      const eventWithRoomAndTeamsLink = {
        id: eventId,
        subject: 'Virtual Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [
          {
            emailAddress: { address: roomEmail, name: 'Room' },
            type: 'resource',
          },
        ],
        location: { displayName: 'Room' },
        onlineMeeting: {
          joinUrl: 'https://teams.microsoft.com/l/meetup-join/...',
        },
      };

      mockApiClient.request
        .mockResolvedValueOnce({ data: eventWithRoomAndTeamsLink }) // GET event
        .mockResolvedValueOnce({ data: eventWithRoomAndTeamsLink }); // PATCH event

      const result = await client.removeRoom(eventId, roomEmail, true);

      expect(result.success).toBe(true);
      // Verify we don't touch onlineMeeting field
      const patchCall = (mockApiClient.request as jest.Mock).mock.calls.find(
        (call) => call[1]?.method === 'PATCH'
      );
      expect(patchCall[1].body).not.toHaveProperty('onlineMeeting');
    });

    it('should handle error when removing non-existent room', async () => {
      const eventId = 'event123';
      const roomEmail = 'nonexistent@company.com';

      const eventWithoutRoom = {
        id: eventId,
        subject: 'Meeting',
        attendees: [
          {
            emailAddress: { address: 'user@company.com', name: 'User' },
            type: 'required',
          },
        ],
        location: { displayName: 'Some Location' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: eventWithoutRoom }); // GET event

      await expect(client.removeRoom(eventId, roomEmail, true)).rejects.toThrow(
        'not booked'
      );
    });
  });
});
