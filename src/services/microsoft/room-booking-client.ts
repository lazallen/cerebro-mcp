/**
 * Room Booking Client
 *
 * Business logic for Microsoft Graph Places API integration and room booking.
 */

import { MicrosoftApiClient } from './api-client';
import {
  type MeetingRoom,
  type RoomAvailability,
  type RoomSearchCriteria,
  type RoomBookingRequest,
  type RoomConflict,
  parseAvailabilityView,
  isValidRoomEmail,
} from '../../types/room';
import { calculateRequiredCapacity } from '../../common/capacity-calculator';
import { logger } from '../../common';

export class RoomBookingClient {
  constructor(private readonly apiClient: MicrosoftApiClient) {}

  /**
   * Search for meeting rooms with filters (FR-001-004)
   * @param criteria Search criteria for filtering rooms
   * @returns List of matching meeting rooms
   */
  async searchRooms(criteria: RoomSearchCriteria): Promise<MeetingRoom[]> {
    logger.info({
      operation: 'search_rooms',
      criteria,
      msg: 'Searching for meeting rooms',
    });

    try {
      // Build OData filter string
      const filters: string[] = [];

      if (criteria.building) {
        filters.push(`building eq '${criteria.building}'`);
      }

      if (criteria.minCapacity !== undefined) {
        filters.push(`capacity ge ${criteria.minCapacity}`);
      }

      if (criteria.floorNumber !== undefined) {
        filters.push(`floorNumber eq ${criteria.floorNumber}`);
      }

      if (criteria.requiresVideo) {
        filters.push('videoDeviceName ne null');
      }

      if (criteria.requiresAudio) {
        filters.push('audioDeviceName ne null');
      }

      if (criteria.requiresDisplay) {
        filters.push('displayDeviceName ne null');
      }

      if (criteria.wheelchairAccessible) {
        filters.push('isWheelChairAccessible eq true');
      }

      // Fetch rooms from Graph API
      const rooms = await this.apiClient.listMeetingRooms(
        filters.length > 0 ? filters.join(' and ') : undefined
      );

      logger.info({
        operation: 'search_rooms',
        count: rooms.length,
        msg: 'Found meeting rooms',
      });

      return rooms;
    } catch (error) {
      // Handle permission errors (FR-007a, FR-007b)
      if (this.isPermissionError(error)) {
        const message =
          'Missing required permission: Place.Read.All. Please re-authenticate with proper permissions.';
        logger.error({
          operation: 'search_rooms',
          error: error instanceof Error ? error.message : String(error),
          msg: message,
        });
        throw new Error(message);
      }

      logger.error({
        operation: 'search_rooms',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to search meeting rooms',
      });
      throw error;
    }
  }

  /**
   * Check room availability for a time period (FR-005-007)
   * @param roomEmails Array of room email addresses
   * @param startTime Meeting start time
   * @param endTime Meeting end time
   * @returns Map of room availability by email
   */
  async checkRoomAvailability(
    roomEmails: string[],
    startTime: Date,
    endTime: Date
  ): Promise<Map<string, RoomAvailability>> {
    logger.info({
      operation: 'check_room_availability',
      roomCount: roomEmails.length,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      msg: 'Checking room availability',
    });

    try {
      // Call getSchedule API with batch of rooms (up to 20)
      const scheduleData = await this.apiClient.getSchedule(roomEmails, startTime, endTime);

      const availabilityMap = new Map<string, RoomAvailability>();

      for (const schedule of scheduleData.value) {
        const conflicts: RoomConflict[] = schedule.scheduleItems
          .filter((item: any) => item.status === 'busy' || item.status === 'tentative')
          .map((item: any) => ({
            subject: item.subject,
            start: {
              dateTime: item.start.dateTime,
              timeZone: item.start.timeZone,
            },
            end: {
              dateTime: item.end.dateTime,
              timeZone: item.end.timeZone,
            },
            status: item.status,
          }));

        const isAvailable = parseAvailabilityView(schedule.availabilityView);

        availabilityMap.set(schedule.scheduleId, {
          roomEmail: schedule.scheduleId,
          isAvailable,
          availabilityView: schedule.availabilityView,
          conflicts,
        });
      }

      logger.info({
        operation: 'check_room_availability',
        availableCount: Array.from(availabilityMap.values()).filter((a) => a.isAvailable).length,
        totalCount: availabilityMap.size,
        msg: 'Checked room availability',
      });

      return availabilityMap;
    } catch (error) {
      logger.error({
        operation: 'check_room_availability',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to check room availability',
      });
      throw error;
    }
  }

  /**
   * Book a room to an existing event (FR-008-010, FR-013, FR-014a)
   * @param request Room booking request
   * @returns Success result with booked room details
   */
  async bookRoom(request: RoomBookingRequest): Promise<{ success: boolean; message: string }> {
    logger.info({
      operation: 'book_room',
      eventId: request.eventId,
      roomEmail: request.roomEmail,
      msg: 'Booking room to event',
    });

    try {
      // Validate room email
      if (!isValidRoomEmail(request.roomEmail)) {
        throw new Error(`Invalid room email format: ${request.roomEmail}`);
      }

      // Get current event to retrieve attendees (FR-010)
      const event = await this.apiClient.request(`/me/calendar/events/${request.eventId}`, {
        method: 'GET',
        params: {
          $select: 'attendees,start,end,location',
        },
      });

      const eventData = event.data as any;

      // Check if room already booked (FR-013)
      const roomExists = eventData.attendees?.some(
        (a: any) => a.emailAddress.address === request.roomEmail
      );

      if (roomExists) {
        const message = 'Room is already booked for this meeting.';
        logger.warn({
          operation: 'book_room',
          eventId: request.eventId,
          roomEmail: request.roomEmail,
          msg: message,
        });
        throw new Error(message);
      }

      // Verify availability if requested (FR-014a)
      if (request.verifyAvailability !== false) {
        const startTime = new Date(eventData.start.dateTime);
        const endTime = new Date(eventData.end.dateTime);

        const availability = await this.checkRoomAvailability(
          [request.roomEmail],
          startTime,
          endTime
        );

        const roomAvailability = availability.get(request.roomEmail);
        if (roomAvailability && !roomAvailability.isAvailable) {
          const message = 'Room is not available during the meeting time.';
          logger.warn({
            operation: 'book_room',
            eventId: request.eventId,
            roomEmail: request.roomEmail,
            conflicts: roomAvailability.conflicts.length,
            msg: message,
          });
          throw new Error(message);
        }
      }

      // Add room as resource attendee (FR-008)
      const updatedAttendees = [
        ...(eventData.attendees || []),
        {
          emailAddress: {
            address: request.roomEmail,
            name: request.roomName,
          },
          type: 'resource',
        },
      ];

      // Build PATCH body
      const patchBody: any = {
        attendees: updatedAttendees,
      };

      // Update location field if requested (FR-009)
      if (request.updateLocation !== false) {
        patchBody.location = {
          displayName: request.roomName || request.roomEmail,
          locationEmailAddress: request.roomEmail,
        };
      }

      // PATCH event with room booking
      await this.apiClient.request(`/me/calendar/events/${request.eventId}`, {
        method: 'PATCH',
        body: patchBody,
      });

      const message = `Room booked successfully: ${request.roomName || request.roomEmail}`;
      logger.info({
        operation: 'book_room',
        eventId: request.eventId,
        roomEmail: request.roomEmail,
        msg: message,
      });

      return { success: true, message };
    } catch (error) {
      logger.error({
        operation: 'book_room',
        eventId: request.eventId,
        roomEmail: request.roomEmail,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to book room',
      });
      throw error;
    }
  }

  /**
   * Remove room booking from an event
   * @param eventId Event ID
   * @param roomEmail Room email to remove
   * @param clearLocation Whether to clear location field
   * @returns Success result
   */
  async removeRoom(
    eventId: string,
    roomEmail: string,
    clearLocation: boolean = true
  ): Promise<{ success: boolean; message: string }> {
    logger.info({
      operation: 'remove_room',
      eventId,
      roomEmail,
      msg: 'Removing room from event',
    });

    try {
      // Get current event
      const event = await this.apiClient.request(`/me/calendar/events/${eventId}`, {
        method: 'GET',
        params: {
          $select: 'attendees,location',
        },
      });

      const eventData = event.data as any;

      // Check if room exists
      const roomIndex = eventData.attendees?.findIndex(
        (a: any) => a.emailAddress.address === roomEmail
      );

      if (roomIndex === -1 || roomIndex === undefined) {
        throw new Error('Room is not booked for this meeting.');
      }

      // Remove room from attendees
      const updatedAttendees = eventData.attendees.filter(
        (a: any) => a.emailAddress.address !== roomEmail
      );

      // Build PATCH body
      const patchBody: any = {
        attendees: updatedAttendees,
      };

      // Clear location if requested
      if (clearLocation) {
        patchBody.location = {
          displayName: '',
          locationEmailAddress: '',
        };
      }

      // PATCH event
      await this.apiClient.request(`/me/calendar/events/${eventId}`, {
        method: 'PATCH',
        body: patchBody,
      });

      const message = `Room removed successfully: ${roomEmail}`;
      logger.info({
        operation: 'remove_room',
        eventId,
        roomEmail,
        msg: message,
      });

      return { success: true, message };
    } catch (error) {
      logger.error({
        operation: 'remove_room',
        eventId,
        roomEmail,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to remove room',
      });
      throw error;
    }
  }

  /**
   * Detect office location from calendar events (FR-015, FR-016, FR-017)
   * @param events Array of calendar events
   * @returns Detected office location or null
   */
  detectOfficeLocation(events: any[]): string | null {
    logger.info({
      operation: 'detect_office_location',
      eventCount: events.length,
      msg: 'Detecting office location from calendar events',
    });

    // Check for "Working from [Office]" events (FR-015)
    for (const event of events) {
      if (event.subject) {
        const match = event.subject.match(/Working from (Edinburgh|Glasgow|Barcelona|London)/i);
        if (match) {
          const office = match[1];
          logger.info({
            operation: 'detect_office_location',
            office,
            source: 'subject',
            msg: 'Detected office from event subject',
          });
          return office;
        }
      }

      // Check location field (FR-016)
      if (event.location?.displayName) {
        const location = event.location.displayName.toLowerCase();
        if (location.includes('edinburgh')) return 'Edinburgh';
        if (location.includes('glasgow')) return 'Glasgow';
        if (location.includes('barcelona')) return 'Barcelona';
        if (location.includes('london')) return 'London';
      }
    }

    logger.warn({
      operation: 'detect_office_location',
      msg: 'Could not detect office location from events',
    });
    return null;
  }

  /**
   * Check if meeting needs room booking based on categories (FR-022, FR-022a)
   * @param categories Event categories
   * @returns true if meeting needs room booking
   */
  needsRoomBooking(categories: string[] | undefined): boolean {
    if (!categories || categories.length === 0) {
      return false; // Skip by default (FR-022a)
    }

    // Check for explicit room-indicating categories (FR-022)
    const roomCategories = ['Office', 'In-Person', 'Room Needed'];
    const hasRoomCategory = categories.some((cat) => roomCategories.includes(cat));

    logger.info({
      operation: 'check_room_needed',
      categories,
      hasRoomCategory,
      msg: 'Checked if meeting needs room booking',
    });

    return hasRoomCategory;
  }

  /**
   * Select best room from available options (FR-026, FR-027, FR-028)
   * @param rooms Available rooms
   * @param attendeeCount Number of attendees
   * @param requiresVideo Whether video equipment is required
   * @returns Selected room or null
   */
  selectBestRoom(
    rooms: MeetingRoom[],
    attendeeCount: number,
    requiresVideo: boolean = false
  ): MeetingRoom | null {
    logger.info({
      operation: 'select_best_room',
      roomCount: rooms.length,
      attendeeCount,
      requiresVideo,
      msg: 'Selecting best room from available options',
    });

    if (rooms.length === 0) {
      return null;
    }

    // Calculate required capacity with 20% buffer (FR-027)
    const requiredCapacity = calculateRequiredCapacity(attendeeCount);

    // Filter rooms by capacity
    let suitableRooms = rooms.filter((r) => r.capacity >= requiredCapacity);

    if (suitableRooms.length === 0) {
      logger.warn({
        operation: 'select_best_room',
        requiredCapacity,
        msg: 'No rooms meet capacity requirements',
      });
      return null;
    }

    // Prioritize rooms with video equipment if required (FR-028)
    if (requiresVideo) {
      const videoRooms = suitableRooms.filter((r) => r.videoDeviceName);
      if (videoRooms.length > 0) {
        suitableRooms = videoRooms;
        logger.info({
          operation: 'select_best_room',
          videoRoomCount: videoRooms.length,
          msg: 'Filtered to rooms with video equipment',
        });
      }
    }

    // Prioritize smallest room that fits (FR-026)
    suitableRooms.sort((a, b) => a.capacity - b.capacity);

    const selectedRoom = suitableRooms[0];
    if (!selectedRoom) {
      return null;
    }

    logger.info({
      operation: 'select_best_room',
      selectedRoom: selectedRoom.displayName,
      capacity: selectedRoom.capacity,
      requiredCapacity,
      hasVideo: !!selectedRoom.videoDeviceName,
      msg: 'Selected best room',
    });

    return selectedRoom;
  }

  /**
   * Check if error is a permission error (FR-007a)
   */
  private isPermissionError(error: any): boolean {
    if (error.response?.status === 403) {
      const errorCode = error.response?.data?.error?.code;
      return (
        errorCode === 'Authorization_RequestDenied' ||
        errorCode === 'Forbidden' ||
        errorCode === 'InsufficientPermissions'
      );
    }
    return false;
  }
}
