/**
 * Room Booking Tool Handlers
 *
 * MCP tool handlers for meeting room booking functionality.
 */

import { RoomBookingClient } from '../../services/microsoft/room-booking-client';
import type { RoomSearchCriteria } from '../../types/room';
import { logger } from '../../common';

/**
 * List meeting rooms handler (list-meeting-rooms tool)
 * Implements contract: specs/016-meeting-room-booking/contracts/list-meeting-rooms.json
 */
export async function listMeetingRooms(
  client: RoomBookingClient,
  args: {
    building?: string;
    minCapacity?: number;
    floorNumber?: number;
    requiresVideo?: boolean;
    requiresAudio?: boolean;
    wheelchairAccessible?: boolean;
    tags?: string[];
  }
): Promise<{ rooms: any[]; count: number }> {
  logger.info({
    operation: 'list_meeting_rooms_handler',
    args,
    msg: 'Processing list-meeting-rooms tool call',
  });

  try {
    const criteria: RoomSearchCriteria = {
      building: args.building,
      minCapacity: args.minCapacity,
      floorNumber: args.floorNumber,
      requiresVideo: args.requiresVideo,
      requiresAudio: args.requiresAudio,
      wheelchairAccessible: args.wheelchairAccessible,
      tags: args.tags,
    };

    const rooms = await client.searchRooms(criteria);

    return {
      rooms: rooms.map((room) => ({
        id: room.id,
        emailAddress: room.emailAddress,
        displayName: room.displayName,
        building: room.building,
        floorNumber: room.floorNumber,
        capacity: room.capacity,
        videoDeviceName: room.videoDeviceName,
        audioDeviceName: room.audioDeviceName,
        isWheelchairAccessible: room.isWheelchairAccessible,
        tags: room.tags,
      })),
      count: rooms.length,
    };
  } catch (error) {
    logger.error({
      operation: 'list_meeting_rooms_handler',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to list meeting rooms',
    });
    throw error;
  }
}

/**
 * Check room availability handler (check-room-availability tool)
 * Implements contract: specs/016-meeting-room-booking/contracts/check-room-availability.json
 */
export async function checkRoomAvailability(
  client: RoomBookingClient,
  args: {
    roomEmails: string[];
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
  }
): Promise<{ availability: any[] }> {
  logger.info({
    operation: 'check_room_availability_handler',
    roomCount: args.roomEmails.length,
    msg: 'Processing check-room-availability tool call',
  });

  try {
    // Validate room count (max 20 per Graph API limits)
    if (args.roomEmails.length > 20) {
      throw new Error(
        `Cannot check more than 20 rooms at once. Received: ${args.roomEmails.length}`
      );
    }

    const startTime = new Date(args.startDateTime);
    const endTime = new Date(args.endDateTime);

    // Validate time range
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new Error('Invalid date format. Use ISO 8601 format (e.g., 2026-02-05T14:00:00Z)');
    }

    if (endTime <= startTime) {
      throw new Error('End time must be after start time');
    }

    const availabilityMap = await client.checkRoomAvailability(args.roomEmails, startTime, endTime);

    const availability = Array.from(availabilityMap.values()).map((avail) => ({
      roomEmail: avail.roomEmail,
      roomName: avail.roomName,
      isAvailable: avail.isAvailable,
      availabilityView: avail.availabilityView,
      conflicts: avail.conflicts.map((conflict) => ({
        start: conflict.start.dateTime,
        end: conflict.end.dateTime,
        status: conflict.status,
      })),
    }));

    return { availability };
  } catch (error) {
    logger.error({
      operation: 'check_room_availability_handler',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to check room availability',
    });
    throw error;
  }
}

/**
 * Book meeting room handler (book-meeting-room tool)
 * Implements contract: specs/016-meeting-room-booking/contracts/book-meeting-room.json
 */
export async function bookMeetingRoom(
  client: RoomBookingClient,
  args: {
    eventId: string;
    roomEmail: string;
    roomName?: string;
    updateLocation?: boolean;
    verifyAvailability?: boolean;
  }
): Promise<{
  success: boolean;
  message: string;
  eventId: string;
  roomBooked: string;
}> {
  logger.info({
    operation: 'book_meeting_room_handler',
    eventId: args.eventId,
    roomEmail: args.roomEmail,
    msg: 'Processing book-meeting-room tool call',
  });

  try {
    const result = await client.bookRoom({
      eventId: args.eventId,
      roomEmail: args.roomEmail,
      roomName: args.roomName,
      updateLocation: args.updateLocation,
      verifyAvailability: args.verifyAvailability,
    });

    return {
      success: result.success,
      message: result.message,
      eventId: args.eventId,
      roomBooked: args.roomEmail,
    };
  } catch (error) {
    logger.error({
      operation: 'book_meeting_room_handler',
      eventId: args.eventId,
      roomEmail: args.roomEmail,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to book meeting room',
    });
    throw error;
  }
}

/**
 * Remove meeting room handler (remove-meeting-room tool)
 * Implements contract: specs/016-meeting-room-booking/contracts/remove-meeting-room.json
 */
export async function removeMeetingRoom(
  client: RoomBookingClient,
  args: {
    eventId: string;
    roomEmail: string;
    clearLocation?: boolean;
  }
): Promise<{
  success: boolean;
  message: string;
  eventId: string;
  roomRemoved: string;
}> {
  logger.info({
    operation: 'remove_meeting_room_handler',
    eventId: args.eventId,
    roomEmail: args.roomEmail,
    msg: 'Processing remove-meeting-room tool call',
  });

  try {
    const result = await client.removeRoom(
      args.eventId,
      args.roomEmail,
      args.clearLocation ?? true
    );

    return {
      success: result.success,
      message: result.message,
      eventId: args.eventId,
      roomRemoved: args.roomEmail,
    };
  } catch (error) {
    logger.error({
      operation: 'remove_meeting_room_handler',
      eventId: args.eventId,
      roomEmail: args.roomEmail,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to remove meeting room',
    });
    throw error;
  }
}
