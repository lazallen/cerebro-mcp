# Data Model: Meeting Room Booking

**Feature**: 016-meeting-room-booking
**Date**: 2026-02-05

## Entity Definitions

### 1. MeetingRoom

Represents a physical conference room with booking capabilities.

**TypeScript Definition**:
```typescript
interface MeetingRoom {
  // Identifiers
  id: string;                          // Graph API room ID
  emailAddress: string;                // Room email (used for booking)

  // Display Information
  displayName: string;                 // Room name (e.g., "EDI-L2 Barajas")
  nickname?: string;                   // Short name (e.g., "Barajas")

  // Location Properties
  building: string;                    // Office location (Edinburgh, Glasgow, etc.)
  floorNumber?: number;                // Floor number
  floorLabel?: string;                 // Floor label (e.g., "L2", "Ground")

  // Capacity & Equipment
  capacity: number;                    // Maximum occupancy
  audioDeviceName?: string;            // Audio equipment name
  videoDeviceName?: string;            // Video equipment name (e.g., "Teams Rooms")
  displayDeviceName?: string;          // Display equipment name
  tags?: string[];                     // Amenity tags (e.g., ["whiteboard", "video-conference"])

  // Accessibility
  isWheelchairAccessible?: boolean;    // ADA compliance
  bookingType?: 'standard' | 'reserved' | 'unknown';  // Booking policy
}
```

**Entity Rules**:
- `emailAddress` is REQUIRED for booking operations (resource attendee identifier)
- `capacity` must be positive integer >= 1
- `building` must be one of: Edinburgh, Glasgow, Barcelona, London (FR-018)
- `tags` array may be empty or undefined (optional amenities)

**Validation**:
```typescript
function validateMeetingRoom(room: Partial<MeetingRoom>): room is MeetingRoom {
  return Boolean(
    room.id &&
    room.emailAddress &&
    room.displayName &&
    room.building &&
    typeof room.capacity === 'number' && room.capacity > 0
  );
}
```

### 2. RoomAvailability

Represents the availability status of a room for a specific time period.

**TypeScript Definition**:
```typescript
interface RoomAvailability {
  // Room Identification
  roomEmail: string;                   // Room email address
  roomName?: string;                   // Room display name (optional)

  // Availability Status
  isAvailable: boolean;                // true = free, false = busy/conflict
  availabilityView: string;            // Graph API view string ("0"=free, "2"=busy)

  // Conflict Details
  conflicts: RoomConflict[];           // List of conflicting bookings
}

interface RoomConflict {
  subject?: string;                    // Meeting subject (may be hidden)
  start: {
    dateTime: string;                  // ISO 8601 format
    timeZone: string;                  // IANA timezone
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  status: 'busy' | 'tentative' | 'oof' | 'workingElsewhere';
}
```

**Entity Rules**:
- `isAvailable` = true IFF availabilityView contains no "2" characters (FR-006)
- `availabilityView` string uses Graph API encoding: 0=free, 1=tentative, 2=busy, 3=oof, 4=workingElsewhere
- `conflicts` array empty when `isAvailable = true`

**Availability View Parsing**:
```typescript
function parseAvailabilityView(view: string): boolean {
  // "0000" = all free -> available
  // "0020" = has busy slot -> not available
  return !view.includes('2') && !view.includes('3');
}
```

### 3. RoomBookingRequest

Input data for booking a room to an event.

**TypeScript Definition**:
```typescript
interface RoomBookingRequest {
  // Target Event
  eventId: string;                     // Existing calendar event ID

  // Room Selection
  roomEmail: string;                   // Room to book
  roomName?: string;                   // Room display name (for location field)

  // Booking Options
  updateLocation?: boolean;            // Update event location field (default: true)
  verifyAvailability?: boolean;        // Check availability before booking (default: true)
}
```

**Entity Rules**:
- `eventId` must be valid Graph API event identifier
- `roomEmail` must match MeetingRoom.emailAddress format
- If `verifyAvailability = true`, must check availability before PATCH (FR-014a)

### 4. RoomSearchCriteria

Filter criteria for discovering meeting rooms.

**TypeScript Definition**:
```typescript
interface RoomSearchCriteria {
  // Location Filters
  building?: string;                   // Office location (Edinburgh, Glasgow, etc.)
  floorNumber?: number;                // Specific floor

  // Capacity Filters
  minCapacity?: number;                // Minimum seats required

  // Amenity Filters
  requiresVideo?: boolean;             // Must have video equipment
  requiresAudio?: boolean;             // Must have audio equipment
  requiresDisplay?: boolean;           // Must have display equipment
  tags?: string[];                     // Required amenity tags

  // Accessibility Filters
  wheelchairAccessible?: boolean;      // ADA compliant rooms only

  // Availability Filter
  startTime?: Date;                    // Check availability from this time
  endTime?: Date;                      // Check availability until this time
}
```

**Entity Rules**:
- All fields optional (no filters = return all rooms)
- `minCapacity` must be positive if provided
- If `startTime` and `endTime` provided, automatically filter to available rooms only

**Capacity Calculation**:
```typescript
function calculateRequiredCapacity(attendeeCount: number): number {
  // Apply 20% buffer, round up (FR-027)
  return Math.ceil(attendeeCount * 1.2);
}
```

### 5. OfficeLocation

Enumeration of supported office locations.

**TypeScript Definition**:
```typescript
type OfficeLocation =
  | 'Edinburgh'
  | 'Glasgow'
  | 'Barcelona'
  | 'London'
  | 'Remote';

interface OfficeDetectionResult {
  location: OfficeLocation | null;     // Detected location or null
  confidence: 'high' | 'medium' | 'low'; // Detection confidence
  source: 'calendar-event' | 'location-field' | 'user-input'; // Detection method
}
```

**Entity Rules**:
- `Remote` location skips room booking entirely
- Detection sources prioritized: user-input > calendar-event > location-field
- High confidence = explicit "Working from [Office]" event title (FR-015)
- Medium confidence = location field matches office name (FR-016)
- Low confidence = partial string match, requires user confirmation (FR-017)

## Relationships

```
┌─────────────────┐
│ CalendarEvent   │
│ (Graph API)     │
└────────┬────────┘
         │
         │ has attendees
         ▼
┌─────────────────┐     ┌──────────────────┐
│ ResourceAttendee├─────┤ MeetingRoom      │
│ (type: resource)│     │ (Places API)     │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 │ checked via
                                 ▼
                        ┌──────────────────┐
                        │ RoomAvailability │
                        │ (getSchedule API)│
                        └──────────────────┘

┌─────────────────┐
│ OfficeLocation  │
│ (detected from  │
│  calendar)      │
└────────┬────────┘
         │
         │ filters
         ▼
┌─────────────────┐     ┌──────────────────┐
│RoomSearchCriteria├────▶│ MeetingRoom      │
└─────────────────┘     │ (filtered list)  │
                        └──────────────────┘
```

## State Transitions

### Room Booking Lifecycle

```
[Unbooked Event]
       │
       │ 1. Detect office location (FR-015, FR-016, FR-017)
       ▼
[Office Detected]
       │
       │ 2. Check event categories (FR-022)
       ▼
[Category Match: "Office" / "In-Person" / "Room Needed"]
       │
       │ 3. Calculate required capacity (FR-027)
       ▼
[Search Rooms]
       │
       │ 4. Filter by building + capacity + amenities (FR-001-004)
       ▼
[Candidate Rooms]
       │
       │ 5. Check availability (FR-005-007)
       ▼
[Available Rooms]
       │
       │ 6. User selects room (FR-024)
       ▼
[Booking Requested]
       │
       │ 7. Verify no conflicts (FR-014a)
       ├─── [Conflict] ──▶ [Suggest Alternatives] (FR-014b, FR-029)
       │
       │ 8. Add room as resource attendee (FR-008, FR-009)
       ▼
[Booked Event]
       │
       │ Room auto-accepts (Exchange Server)
       ▼
[Confirmed Booking]
```

### Availability States

```
Room for Time Slot:
  ├─ [Free]              → isAvailable = true
  ├─ [Busy]              → isAvailable = false, show conflicts
  ├─ [Tentative]         → isAvailable = false, may be cancelable
  ├─ [Out of Office]     → isAvailable = false (room closed)
  └─ [Working Elsewhere] → isAvailable = false (room repurposed)
```

## Data Validation Rules

### Input Validation

**Room Email Address**:
```typescript
function isValidRoomEmail(email: string): boolean {
  // Format: <name>@<domain>
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

**Capacity Range**:
```typescript
function isValidCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 1000;
}
```

**Time Range**:
```typescript
function isValidTimeRange(start: Date, end: Date): boolean {
  return end > start && (end.getTime() - start.getTime()) <= 24 * 60 * 60 * 1000; // Max 24 hours
}
```

**Building Name**:
```typescript
const validBuildings: OfficeLocation[] = ['Edinburgh', 'Glasgow', 'Barcelona', 'London'];

function isValidBuilding(building: string): boolean {
  return validBuildings.includes(building as OfficeLocation);
}
```

## Error States

| Error Code | Condition | User Message |
|------------|-----------|--------------|
| `PERMISSION_DENIED` | Missing Place.Read.All | "Missing required permission: Place.Read.All. Please re-authenticate." |
| `ROOM_NOT_FOUND` | Invalid room email | "Room not found. Please verify the room email address." |
| `ROOM_BUSY` | Availability check failed | "Room is not available during the meeting time." |
| `DUPLICATE_BOOKING` | Room already in attendees | "Room is already booked for this meeting." |
| `INVALID_CAPACITY` | Capacity < 1 or > 1000 | "Room capacity must be between 1 and 1000." |
| `EVENT_NOT_FOUND` | Invalid event ID | "Calendar event not found. Please verify the event ID." |
| `TIME_RANGE_INVALID` | End before start | "End time must be after start time." |

## GraphQL Schema (Optional Extension)

If exposing via GraphQL in future:

```graphql
type MeetingRoom {
  id: ID!
  emailAddress: String!
  displayName: String!
  building: String!
  capacity: Int!
  floorNumber: Int
  hasVideo: Boolean
  hasAudio: Boolean
  isWheelchairAccessible: Boolean
  availability(startTime: DateTime!, endTime: DateTime!): RoomAvailability!
}

type RoomAvailability {
  isAvailable: Boolean!
  conflicts: [RoomConflict!]!
}

type RoomConflict {
  start: DateTime!
  end: DateTime!
  status: String!
}

type Query {
  searchRooms(criteria: RoomSearchInput!): [MeetingRoom!]!
  checkAvailability(roomEmails: [String!]!, startTime: DateTime!, endTime: DateTime!): [RoomAvailability!]!
}

type Mutation {
  bookRoom(eventId: ID!, roomEmail: String!): BookingResult!
  removeRoom(eventId: ID!, roomEmail: String!): BookingResult!
}
```

## Summary

**Total Entities**: 5 (MeetingRoom, RoomAvailability, RoomBookingRequest, RoomSearchCriteria, OfficeLocation)
**Total Relationships**: 3 (Event ↔ Room, Room ↔ Availability, Office ↔ Search)
**State Transitions**: 2 flows (Booking Lifecycle, Availability States)
**Validation Rules**: 4 (Email, Capacity, TimeRange, Building)
**Error States**: 7 distinct error codes

All entities are immutable value objects except RoomAvailability (changes over time). No persistent storage required - all data sourced from Microsoft Graph API in real-time.
