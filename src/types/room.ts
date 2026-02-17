/**
 * Meeting Room Booking Types
 *
 * Types for Microsoft Graph Places API integration and room booking functionality.
 */

/**
 * Office location enumeration
 * Supported office locations for room booking
 */
export type OfficeLocation = 'Edinburgh' | 'Glasgow' | 'Barcelona' | 'London' | 'Remote';

/**
 * Meeting room resource from Microsoft Graph Places API
 * Represents a physical conference room with booking capabilities
 */
export interface MeetingRoom {
  // Identifiers
  id: string; // Graph API room ID
  emailAddress: string; // Room email (used for booking)

  // Display Information
  displayName: string; // Room name (e.g., "EDI-L2 Barajas")
  nickname?: string; // Short name (e.g., "Barajas")

  // Location Properties
  building: string; // Office location (Edinburgh, Glasgow, etc.)
  floorNumber?: number; // Floor number
  floorLabel?: string; // Floor label (e.g., "L2", "Ground")

  // Capacity & Equipment
  capacity: number; // Maximum occupancy
  audioDeviceName?: string; // Audio equipment name
  videoDeviceName?: string; // Video equipment name (e.g., "Teams Rooms")
  displayDeviceName?: string; // Display equipment name
  tags?: string[]; // Amenity tags (e.g., ["whiteboard", "video-conference"])

  // Accessibility
  isWheelchairAccessible?: boolean; // ADA compliance
  bookingType?: 'standard' | 'reserved' | 'unknown'; // Booking policy
}

/**
 * Room conflict details from getSchedule API
 */
export interface RoomConflict {
  subject?: string; // Meeting subject (may be hidden)
  start: {
    dateTime: string; // ISO 8601 format
    timeZone: string; // IANA timezone
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  status: 'busy' | 'tentative' | 'oof' | 'workingElsewhere';
}

/**
 * Room availability status for a specific time period
 * Returned by checkRoomAvailability method
 */
export interface RoomAvailability {
  // Room Identification
  roomEmail: string; // Room email address
  roomName?: string; // Room display name (optional)

  // Availability Status
  isAvailable: boolean; // true = free, false = busy/conflict
  availabilityView: string; // Graph API view string ("0"=free, "2"=busy)

  // Conflict Details
  conflicts: RoomConflict[]; // List of conflicting bookings
}

/**
 * Room booking request parameters
 * Input for bookRoom method
 */
export interface RoomBookingRequest {
  // Target Event
  eventId: string; // Existing calendar event ID

  // Room Selection
  roomEmail: string; // Room to book
  roomName?: string; // Room display name (for location field)

  // Booking Options
  updateLocation?: boolean; // Update event location field (default: true)
  verifyAvailability?: boolean; // Check availability before booking (default: true)
}

/**
 * Room search criteria for filtering meeting rooms
 * Input for searchRooms method
 */
export interface RoomSearchCriteria {
  // Location Filters
  building?: string; // Office location (Edinburgh, Glasgow, etc.)
  floorNumber?: number; // Specific floor

  // Capacity Filters
  minCapacity?: number; // Minimum seats required

  // Amenity Filters
  requiresVideo?: boolean; // Must have video equipment
  requiresAudio?: boolean; // Must have audio equipment
  requiresDisplay?: boolean; // Must have display equipment
  tags?: string[]; // Required amenity tags

  // Accessibility Filters
  wheelchairAccessible?: boolean; // ADA compliant rooms only

  // Availability Filter
  startTime?: Date; // Check availability from this time
  endTime?: Date; // Check availability until this time
}

/**
 * Office detection result
 * Returned by office location detection logic
 */
export interface OfficeDetectionResult {
  location: OfficeLocation | null; // Detected location or null
  confidence: 'high' | 'medium' | 'low'; // Detection confidence
  source: 'calendar-event' | 'location-field' | 'user-input'; // Detection method
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate room email address format
 * @param email Room email address
 * @returns true if valid email format
 */
export function isValidRoomEmail(email: string): boolean {
  // Format: <name>@<domain>
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate room capacity range
 * @param capacity Room capacity value
 * @returns true if capacity is valid integer between 1 and 1000
 */
export function isValidCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 1000;
}

/**
 * Validate time range for room booking
 * @param start Start date
 * @param end End date
 * @returns true if end is after start and duration is <= 24 hours
 */
export function isValidTimeRange(start: Date, end: Date): boolean {
  return end > start && end.getTime() - start.getTime() <= 24 * 60 * 60 * 1000; // Max 24 hours
}

/**
 * Validate building/office name
 * @param building Building name
 * @returns true if building is a supported office location
 */
export function isValidBuilding(building: string): boolean {
  const validBuildings: OfficeLocation[] = ['Edinburgh', 'Glasgow', 'Barcelona', 'London'];
  return validBuildings.includes(building as OfficeLocation);
}

/**
 * Validate MeetingRoom object
 * @param room Partial meeting room object
 * @returns true if room has all required fields
 */
export function validateMeetingRoom(room: Partial<MeetingRoom>): room is MeetingRoom {
  return Boolean(
    room.id &&
      room.emailAddress &&
      room.displayName &&
      room.building &&
      typeof room.capacity === 'number' &&
      room.capacity > 0
  );
}

/**
 * Parse availability view string from Graph API
 * @param view Availability view string (0=free, 2=busy)
 * @returns true if room is available (no busy or out-of-office slots)
 */
export function parseAvailabilityView(view: string): boolean {
  // "0000" = all free -> available
  // "0020" = has busy slot -> not available
  // "3" = out of office -> not available
  return !view.includes('2') && !view.includes('3');
}
