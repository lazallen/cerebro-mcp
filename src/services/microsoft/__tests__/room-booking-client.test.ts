/**
 * Tests for RoomBookingClient
 */

import { RoomBookingClient } from '../room-booking-client';
import { MicrosoftApiClient } from '../api-client';
import type { RoomSearchCriteria, RoomBookingRequest } from '../../../types/room';

describe('RoomBookingClient', () => {
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

  describe('searchRooms', () => {
    it('should search rooms with no filters', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 10,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = {};
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(undefined);
    });

    it('should filter by building', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 10,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { building: 'Edinburgh' };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        "building eq 'Edinburgh'"
      );
    });

    it('should filter by minimum capacity', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 12,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { minCapacity: 10 };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        'capacity ge 10'
      );
    });

    it('should filter by video device', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 10,
          videoDeviceName: 'Teams Rooms',
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { requiresVideo: true };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        'videoDeviceName ne null'
      );
    });

    it('should combine multiple filters with "and"', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 12,
          videoDeviceName: 'Teams Rooms',
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = {
        building: 'Edinburgh',
        minCapacity: 10,
        requiresVideo: true,
      };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        "building eq 'Edinburgh' and capacity ge 10 and videoDeviceName ne null"
      );
    });

    it('should filter by floor number', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room 1',
          building: 'Edinburgh',
          capacity: 10,
          floorNumber: 2,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { floorNumber: 2 };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith('floorNumber eq 2');
    });

    it('should filter by wheelchair accessibility', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Accessible Room',
          building: 'Edinburgh',
          capacity: 10,
          isWheelchairAccessible: true,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { wheelchairAccessible: true };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        'isWheelChairAccessible eq true'
      );
    });

    it('should filter by audio equipment', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Room with Audio',
          building: 'Edinburgh',
          capacity: 10,
          audioDeviceName: 'Conference Phone',
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = { requiresAudio: true };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        'audioDeviceName ne null'
      );
    });

    it('should combine floor, accessibility, and amenity filters', async () => {
      const mockRooms = [
        {
          id: 'room1',
          emailAddress: 'room1@company.com',
          displayName: 'Fully Equipped Accessible Room',
          building: 'Edinburgh',
          capacity: 10,
          floorNumber: 1,
          videoDeviceName: 'Teams Rooms',
          isWheelchairAccessible: true,
        },
      ];
      mockApiClient.listMeetingRooms.mockResolvedValue(mockRooms);

      const criteria: RoomSearchCriteria = {
        floorNumber: 1,
        requiresVideo: true,
        wheelchairAccessible: true,
      };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual(mockRooms);
      expect(mockApiClient.listMeetingRooms).toHaveBeenCalledWith(
        'floorNumber eq 1 and videoDeviceName ne null and isWheelChairAccessible eq true'
      );
    });

    it('should return empty array when no rooms found', async () => {
      mockApiClient.listMeetingRooms.mockResolvedValue([]);

      const criteria: RoomSearchCriteria = { building: 'NonExistent' };
      const result = await client.searchRooms(criteria);

      expect(result).toEqual([]);
    });
  });

  describe('checkRoomAvailability', () => {
    const startTime = new Date('2026-02-05T14:00:00Z');
    const endTime = new Date('2026-02-05T15:00:00Z');

    it('should check availability for single room (all free)', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      expect(result.size).toBe(1);
      const availability = result.get('room1@company.com');
      expect(availability).toEqual({
        roomEmail: 'room1@company.com',
        isAvailable: true,
        availabilityView: '0000',
        conflicts: [],
      });
    });

    it('should detect busy slots (2 in availability view)', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0020',
            scheduleItems: [
              {
                subject: 'Existing Meeting',
                start: { dateTime: '2026-02-05T14:30:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.isAvailable).toBe(false);
      expect(availability?.conflicts).toHaveLength(1);
      expect(availability?.conflicts[0].subject).toBe('Existing Meeting');
    });

    it('should treat tentative slots (1) as available', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0110',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.isAvailable).toBe(true);
    });

    it('should detect out-of-office slots (3) as unavailable', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0003',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.isAvailable).toBe(false);
    });

    it('should treat working-elsewhere slots (4) as available', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0444',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.isAvailable).toBe(true);
    });

    it('should check availability for multiple rooms', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0000',
            scheduleItems: [],
          },
          {
            scheduleId: 'room2@company.com',
            availabilityView: '0020',
            scheduleItems: [],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com', 'room2@company.com'],
        startTime,
        endTime
      );

      expect(result.size).toBe(2);
      expect(result.get('room1@company.com')?.isAvailable).toBe(true);
      expect(result.get('room2@company.com')?.isAvailable).toBe(false);
    });

    it('should extract conflict details from schedule items', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0022',
            scheduleItems: [
              {
                subject: 'Meeting A',
                start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T14:30:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
              {
                subject: 'Meeting B',
                start: { dateTime: '2026-02-05T14:30:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.conflicts).toHaveLength(2);
      expect(availability?.conflicts[0].subject).toBe('Meeting A');
      expect(availability?.conflicts[1].subject).toBe('Meeting B');
    });

    it('should handle batch checking of up to 20 rooms', async () => {
      const roomEmails = Array.from({ length: 20 }, (_, i) => `room${i + 1}@company.com`);
      const mockScheduleResponse = {
        value: roomEmails.map((email) => ({
          scheduleId: email,
          availabilityView: '0000',
          scheduleItems: [],
        })),
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        roomEmails,
        startTime,
        endTime
      );

      expect(result.size).toBe(20);
      expect(mockApiClient.getSchedule).toHaveBeenCalledWith(
        roomEmails,
        startTime,
        endTime
      );
    });

    it('should extract conflict subjects from schedule items', async () => {
      const mockScheduleResponse = {
        value: [
          {
            scheduleId: 'room1@company.com',
            availabilityView: '0002',
            scheduleItems: [
              {
                subject: 'Important Meeting',
                start: { dateTime: '2026-02-05T14:30:00Z', timeZone: 'UTC' },
                end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
                status: 'busy',
              },
            ],
          },
        ],
      };
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const result = await client.checkRoomAvailability(
        ['room1@company.com'],
        startTime,
        endTime
      );

      const availability = result.get('room1@company.com');
      expect(availability?.conflicts[0].subject).toBe('Important Meeting');
      expect(availability?.conflicts[0].status).toBe('busy');
    });
  });

  describe('bookRoom', () => {
    const eventId = 'event123';
    const roomEmail = 'room1@company.com';

    it('should book room successfully', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: '' },
      };

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: roomEmail,
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };

      mockApiClient.request
        .mockResolvedValueOnce({ data: mockEvent }) // GET event
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);
      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const request: RoomBookingRequest = {
        eventId,
        roomEmail,
        roomName: 'Room 1',
      };

      const result = await client.bookRoom(request);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            attendees: expect.arrayContaining([
              expect.objectContaining({
                emailAddress: { address: roomEmail, name: 'Room 1' },
                type: 'resource',
              }),
            ]),
          }),
        })
      );
    });

    it('should prevent duplicate room booking', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [
          {
            emailAddress: { address: roomEmail },
            type: 'resource',
          },
        ],
        location: { displayName: 'Room 1' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event

      const request: RoomBookingRequest = {
        eventId,
        roomEmail,
        roomName: 'Room 1',
      };

      await expect(client.bookRoom(request)).rejects.toThrow('already booked');
    });

    it('should block booking when room is unavailable', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: '' },
      };

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: roomEmail,
            availabilityView: '0020', // busy
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

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);

      const request: RoomBookingRequest = {
        eventId,
        roomEmail,
        roomName: 'Room 1',
      };

      await expect(client.bookRoom(request)).rejects.toThrow('not available');
    });

    it('should update location when updateLocation is true (default)', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: 'Old Location' },
      };

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: roomEmail,
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);
      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const request: RoomBookingRequest = {
        eventId,
        roomEmail,
        roomName: 'Room 1',
        updateLocation: true,
      };

      await client.bookRoom(request);

      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            location: {
              displayName: 'Room 1',
              locationEmailAddress: roomEmail,
            },
          }),
        })
      );
    });

    it('should not update location when updateLocation is false', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        start: { dateTime: '2026-02-05T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-02-05T15:00:00Z', timeZone: 'UTC' },
        attendees: [],
        location: { displayName: 'Old Location' },
      };

      const mockScheduleResponse = {
        value: [
          {
            scheduleId: roomEmail,
            availabilityView: '0000',
            scheduleItems: [],
          },
        ],
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event
      mockApiClient.getSchedule.mockResolvedValue(mockScheduleResponse);
      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const request: RoomBookingRequest = {
        eventId,
        roomEmail,
        roomName: 'Room 1',
        updateLocation: false,
      };

      await client.bookRoom(request);

      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.not.objectContaining({
            location: expect.anything(),
          }),
        })
      );
    });
  });

  describe('detectOfficeLocation', () => {
    it('should detect office from "Working from" event subject', () => {
      const events = [
        {
          subject: 'Working from Edinburgh',
          location: { displayName: '' },
        },
      ];

      const result = client.detectOfficeLocation(events);
      expect(result).toBe('Edinburgh');
    });

    it('should detect office from location field', () => {
      const events = [
        {
          subject: 'Team Meeting',
          location: { displayName: 'Edinburgh Office, Level 2' },
        },
      ];

      const result = client.detectOfficeLocation(events);
      expect(result).toBe('Edinburgh');
    });

    it('should check multiple events and return first match', () => {
      const events = [
        {
          subject: 'Random Meeting',
          location: { displayName: 'Virtual' },
        },
        {
          subject: 'Working from Glasgow',
          location: { displayName: '' },
        },
      ];

      const result = client.detectOfficeLocation(events);
      expect(result).toBe('Glasgow');
    });

    it('should return null when no office detected', () => {
      const events = [
        {
          subject: 'Virtual Meeting',
          location: { displayName: 'Zoom' },
        },
      ];

      const result = client.detectOfficeLocation(events);
      expect(result).toBeNull();
    });

    it('should handle empty events array', () => {
      const result = client.detectOfficeLocation([]);
      expect(result).toBeNull();
    });
  });

  describe('needsRoomBooking', () => {
    it('should return true for "Office" category', () => {
      const result = client.needsRoomBooking(['Office']);
      expect(result).toBe(true);
    });

    it('should return true for "In-Person" category', () => {
      const result = client.needsRoomBooking(['In-Person']);
      expect(result).toBe(true);
    });

    it('should return true for "Room Needed" category', () => {
      const result = client.needsRoomBooking(['Room Needed']);
      expect(result).toBe(true);
    });

    it('should return true when room category mixed with others', () => {
      const result = client.needsRoomBooking(['Important', 'Office', 'Project']);
      expect(result).toBe(true);
    });

    it('should return false for categories without room indicators', () => {
      const result = client.needsRoomBooking(['Important', 'Project']);
      expect(result).toBe(false);
    });

    it('should return false for undefined categories', () => {
      const result = client.needsRoomBooking(undefined);
      expect(result).toBe(false);
    });

    it('should return false for empty categories array', () => {
      const result = client.needsRoomBooking([]);
      expect(result).toBe(false);
    });
  });

  describe('selectBestRoom', () => {
    const rooms = [
      {
        id: 'room1',
        emailAddress: 'small@company.com',
        displayName: 'Small Room',
        building: 'Edinburgh',
        capacity: 4,
      },
      {
        id: 'room2',
        emailAddress: 'medium@company.com',
        displayName: 'Medium Room',
        building: 'Edinburgh',
        capacity: 8,
      },
      {
        id: 'room3',
        emailAddress: 'large@company.com',
        displayName: 'Large Room',
        building: 'Edinburgh',
        capacity: 20,
        videoDeviceName: 'Teams Rooms',
      },
      {
        id: 'room4',
        emailAddress: 'medium-video@company.com',
        displayName: 'Medium Room with Video',
        building: 'Edinburgh',
        capacity: 10,
        videoDeviceName: 'Zoom Rooms',
      },
    ];

    it('should select smallest room that meets capacity requirements', () => {
      // 5 attendees → 6 capacity minimum (20% buffer)
      const result = client.selectBestRoom(rooms, 5, false);

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Medium Room'); // capacity 8
    });

    it('should apply 20% capacity buffer correctly', () => {
      // 3 attendees → 4 capacity minimum (3 * 1.2 = 3.6, rounded up to 4)
      const result = client.selectBestRoom(rooms, 3, false);

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Small Room'); // capacity 4
    });

    it('should prioritize video rooms when requiresVideo is true', () => {
      // 5 attendees → 6 capacity minimum
      const result = client.selectBestRoom(rooms, 5, true);

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Medium Room with Video'); // smallest with video
      expect(result?.videoDeviceName).toBeDefined();
    });

    it('should return null when no rooms meet capacity', () => {
      const result = client.selectBestRoom(rooms, 100, false);
      expect(result).toBeNull();
    });

    it('should return null for empty rooms array', () => {
      const result = client.selectBestRoom([], 5, false);
      expect(result).toBeNull();
    });

    it('should fall back to non-video room if no video rooms meet capacity', () => {
      // Request video but only large room has video, medium room should be selected
      const result = client.selectBestRoom(rooms, 8, true);

      // 8 attendees → 10 capacity minimum
      // Medium room (8) too small, Medium with Video (10) fits
      expect(result?.displayName).toBe('Medium Room with Video');
    });

    it('should select room with exact capacity match', () => {
      // 8 attendees → 10 capacity minimum
      const result = client.selectBestRoom(rooms, 8, false);

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Medium Room with Video'); // capacity 10
    });
  });

  describe('removeRoom', () => {
    const eventId = 'event123';
    const roomEmail = 'room1@company.com';

    it('should remove room successfully', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        attendees: [
          {
            emailAddress: { address: roomEmail, name: 'Room 1' },
            type: 'resource',
          },
          {
            emailAddress: { address: 'user@company.com', name: 'User' },
            type: 'required',
          },
        ],
        location: { displayName: 'Room 1' },
      };

      mockApiClient.request
        .mockResolvedValueOnce({ data: mockEvent }) // GET event
        .mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const result = await client.removeRoom(eventId, roomEmail, false);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
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
          }),
        })
      );
    });

    it('should clear location when clearLocation is true', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        attendees: [
          {
            emailAddress: { address: roomEmail, name: 'Room 1' },
            type: 'resource',
          },
        ],
        location: { displayName: 'Room 1' },
      };

      mockApiClient.request
        .mockResolvedValueOnce({ data: mockEvent }) // GET event
        .mockResolvedValueOnce({ data: mockEvent }); // PATCH event

      const result = await client.removeRoom(eventId, roomEmail, true);

      expect(result.success).toBe(true);
      expect(mockApiClient.request).toHaveBeenCalledWith(
        `/me/calendar/events/${eventId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            location: {
              displayName: '',
              locationEmailAddress: '',
            },
          }),
        })
      );
    });

    it('should return error when room not found in attendees', async () => {
      const mockEvent = {
        id: eventId,
        subject: 'Test Meeting',
        attendees: [
          {
            emailAddress: { address: 'user@company.com', name: 'User' },
            type: 'required',
          },
        ],
        location: { displayName: 'Room 1' },
      };

      mockApiClient.request.mockResolvedValueOnce({ data: mockEvent }); // GET event

      await expect(client.removeRoom(eventId, roomEmail, false)).rejects.toThrow(
        'not booked'
      );
    });
  });
});
