# Microsoft Graph API Places - Room Discovery and Booking Research

**Research Date**: 2026-02-05
**Target Implementation**: TypeScript/Node.js
**Existing Codebase**: cerebro-mcp (Microsoft Graph API integration via MicrosoftService)

## Executive Summary

This document provides comprehensive research on Microsoft Graph API Places endpoints for meeting room discovery and booking. It covers API patterns, availability checking, booking methods, permission requirements, and error handling strategies suitable for TypeScript/Node.js implementation.

---

## 1. Places API Patterns

### 1.1 Endpoint Structure

#### Get All Rooms
```
GET /places/microsoft.graph.room
```

#### Get Rooms in Specific Room List
```
GET /places/{room-list-emailaddress}/microsoft.graph.roomlist/rooms
```

Example:
```
GET /places/bldg2@contoso.com/microsoft.graph.roomlist/rooms
```

### 1.2 Supported Place Types

- `microsoft.graph.building`
- `microsoft.graph.floor`
- `microsoft.graph.section`
- `microsoft.graph.desk`
- `microsoft.graph.room`
- `microsoft.graph.workspace`
- `microsoft.graph.roomlist`

### 1.3 Query Parameters

#### Universal Parameters (All Place Types)
- `$select` - Select specific properties
- `$top` - Customize page size (default: 100 for rooms/workspaces, 1,000 for others)
- `$skip` - Pagination support

#### Limited Parameters (Room, Workspace, RoomList Only)
- `$filter` - Filter results using OData syntax
- `$count=true` - Get total count

### 1.4 Room Resource Schema

Complete room properties available for filtering and display:

```typescript
interface Room {
  // Identifiers
  id: string;                          // Unique identifier (may change)
  placeId: string;                     // Alternative immutable identifier

  // Display Information
  displayName: string;                 // Room name
  label: string;                       // Descriptive label (e.g., room number)
  nickname: string;                    // Nickname (e.g., "conf room")
  emailAddress: string;                // Room email address
  phone: string;                       // Room phone number

  // Location Properties
  address: PhysicalAddress;            // Street address
  building: string;                    // Building name/number
  floorNumber: number;                 // Floor number
  floorLabel: string;                  // Floor label (e.g., "P")
  geoCoordinates: OutlookGeoCoordinates; // Lat/long/altitude
  parentId: string;                    // Parent floor or section ID

  // Capacity & Amenities
  capacity: number;                    // Room capacity
  audioDeviceName: string;             // Audio device name
  videoDeviceName: string;             // Video device name
  displayDeviceName: string;           // Display device name
  tags: string[];                      // Other features (view, furniture)

  // Booking & Accessibility
  bookingType: 'unknown' | 'standard' | 'reserved';
  isWheelChairAccessible: boolean;
  teamsEnabledState: 'unknown' | 'enabled' | 'disabled' | 'unknownFutureValue';
}
```

### 1.5 Filter Examples

#### Filter by Capacity
```typescript
// Rooms with capacity >= 10
const response = await apiClient.request('/places/microsoft.graph.room', {
  method: 'GET',
  params: {
    $filter: 'capacity ge 10',
    $select: 'id,displayName,emailAddress,capacity',
  },
});
```

#### Filter by Building
```typescript
// Rooms in Building 2
const response = await apiClient.request('/places/microsoft.graph.room', {
  method: 'GET',
  params: {
    $filter: "building eq 'Building 2'",
    $select: 'id,displayName,emailAddress,building,capacity',
  },
});
```

#### Filter by Multiple Criteria
```typescript
// Rooms with video, capacity >= 8, wheelchair accessible
const response = await apiClient.request('/places/microsoft.graph.room', {
  method: 'GET',
  params: {
    $filter: "videoDeviceName ne null and capacity ge 8 and isWheelChairAccessible eq true",
    $select: 'id,displayName,emailAddress,capacity,videoDeviceName,isWheelChairAccessible',
  },
});
```

#### Filter by Tags (Amenities)
```typescript
// Note: tags is a collection - use lambda operators if supported
const response = await apiClient.request('/places/microsoft.graph.room', {
  method: 'GET',
  params: {
    $filter: "tags/any(t: t eq 'whiteboard')",
    $select: 'id,displayName,emailAddress,tags',
  },
});
```

### 1.6 Response Structure

```typescript
interface PlacesResponse {
  '@odata.context': string;
  value: Room[];
  '@odata.nextLink'?: string; // Pagination link
}
```

### 1.7 TypeScript Implementation Example

```typescript
async function searchRooms(options: {
  building?: string;
  minCapacity?: number;
  requiresVideo?: boolean;
  requiresAudio?: boolean;
  wheelchairAccessible?: boolean;
  teamsEnabled?: boolean;
}): Promise<Room[]> {
  const filters: string[] = [];

  if (options.building) {
    filters.push(`building eq '${options.building}'`);
  }

  if (options.minCapacity) {
    filters.push(`capacity ge ${options.minCapacity}`);
  }

  if (options.requiresVideo) {
    filters.push('videoDeviceName ne null');
  }

  if (options.requiresAudio) {
    filters.push('audioDeviceName ne null');
  }

  if (options.wheelchairAccessible) {
    filters.push('isWheelChairAccessible eq true');
  }

  if (options.teamsEnabled) {
    filters.push("teamsEnabledState eq 'enabled'");
  }

  const filterString = filters.length > 0 ? filters.join(' and ') : undefined;

  const response = await apiClient.request('/places/microsoft.graph.room', {
    method: 'GET',
    params: {
      $filter: filterString,
      $select: 'id,displayName,emailAddress,capacity,building,audioDeviceName,videoDeviceName,isWheelChairAccessible,teamsEnabledState',
      $top: '100',
    },
  });

  const data = response.data as PlacesResponse;
  return data.value;
}
```

---

## 2. Room Availability Checking

### 2.1 getSchedule Endpoint

```
POST /me/calendar/getSchedule
POST /users/{id|userPrincipalName}/calendar/getSchedule
```

### 2.2 Request Format

```typescript
interface GetScheduleRequest {
  schedules: string[];              // Room email addresses
  startTime: {
    dateTime: string;               // ISO 8601 format
    timeZone: string;               // IANA timezone
  };
  endTime: {
    dateTime: string;
    timeZone: string;
  };
  availabilityViewInterval?: number; // Minutes (default: 30, min: 5, max: 1440)
}
```

### 2.3 Availability View Interpretation

The `availabilityView` string uses single digits for each time slot:

| Value | Status | Meaning |
|-------|--------|---------|
| 0 | free / workingElsewhere | Available |
| 1 | tentative | Tentatively booked |
| 2 | busy | Occupied |
| 3 | oof | Out of office |
| 4 | workingElsewhere | Working elsewhere |

**Example**: `"000220130"` with 60-minute intervals means:
- Hours 0-2: Free
- Hour 3: Busy
- Hour 4: Busy (continues)
- Hour 5: Free
- Hour 6: Tentative
- Hour 7-8: Free, Out of office

### 2.4 Batch Availability Check

```typescript
async function checkRoomAvailability(
  roomEmails: string[],
  startTime: Date,
  endTime: Date,
  intervalMinutes: number = 30
): Promise<Map<string, RoomAvailability>> {
  const response = await apiClient.request('/me/calendar/getSchedule', {
    method: 'POST',
    body: {
      schedules: roomEmails,
      startTime: {
        dateTime: startTime.toISOString(),
        timeZone: 'UTC',
      },
      endTime: {
        dateTime: endTime.toISOString(),
        timeZone: 'UTC',
      },
      availabilityViewInterval: intervalMinutes,
    },
  });

  const data = response.data as {
    value: Array<{
      scheduleId: string;
      availabilityView: string;
      scheduleItems: Array<{
        status: string;
        subject: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
      }>;
    }>;
  };

  const availabilityMap = new Map<string, RoomAvailability>();

  for (const schedule of data.value) {
    availabilityMap.set(schedule.scheduleId, {
      roomEmail: schedule.scheduleId,
      availabilityView: schedule.availabilityView,
      busySlots: schedule.scheduleItems.filter(item => item.status === 'busy'),
      isFree: !schedule.availabilityView.includes('2'), // No '2' means no busy slots
    });
  }

  return availabilityMap;
}

interface RoomAvailability {
  roomEmail: string;
  availabilityView: string;
  busySlots: Array<{
    status: string;
    subject: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  }>;
  isFree: boolean;
}
```

### 2.5 Find Available Rooms

```typescript
async function findAvailableRooms(
  searchOptions: RoomSearchOptions,
  startTime: Date,
  endTime: Date
): Promise<Room[]> {
  // Step 1: Search for rooms matching criteria
  const candidateRooms = await searchRooms(searchOptions);

  // Step 2: Check availability for all candidate rooms
  const roomEmails = candidateRooms.map(room => room.emailAddress);
  const availabilityMap = await checkRoomAvailability(roomEmails, startTime, endTime);

  // Step 3: Filter to only available rooms
  const availableRooms = candidateRooms.filter(room => {
    const availability = availabilityMap.get(room.emailAddress);
    return availability?.isFree === true;
  });

  return availableRooms;
}
```

---

## 3. Room Booking Methods

### 3.1 Resource Attendee Pattern

**Key Concept**: Rooms are added as attendees with `type: "resource"`. Exchange Server automatically accepts/rejects based on room availability.

### 3.2 Creating Event with Room

```typescript
async function createMeetingWithRoom(
  subject: string,
  startDateTime: string,
  endDateTime: string,
  roomEmail: string,
  attendeeEmails: string[]
): Promise<string> {
  const event = {
    subject,
    start: {
      dateTime: startDateTime,
      timeZone: 'UTC',
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'UTC',
    },
    location: {
      displayName: roomEmail, // Optional: display name of room
      locationEmailAddress: roomEmail,
    },
    attendees: [
      // Room as resource attendee
      {
        emailAddress: {
          address: roomEmail,
        },
        type: 'resource',
      },
      // Human attendees
      ...attendeeEmails.map(email => ({
        emailAddress: {
          address: email,
        },
        type: 'required',
      })),
    ],
  };

  const response = await apiClient.request('/me/calendar/events', {
    method: 'POST',
    body: event,
  });

  const data = response.data as { id: string };
  return data.id;
}
```

### 3.3 PATCH vs POST Patterns

#### POST - Create New Event
- Use for creating new meetings
- Returns event ID immediately
- Room auto-acceptance happens asynchronously

#### PATCH - Update Existing Event

**CRITICAL**: When updating attendees, include ALL attendees (existing + new) to avoid removal.

```typescript
async function addRoomToExistingEvent(
  eventId: string,
  roomEmail: string
): Promise<void> {
  // Step 1: Get current event to retrieve existing attendees
  const eventResponse = await apiClient.request(`/me/calendar/events/${eventId}`, {
    method: 'GET',
    params: {
      $select: 'attendees,location,subject,start,end',
    },
  });

  const event = eventResponse.data as {
    attendees: Array<{
      emailAddress: { address: string; name?: string };
      type: string;
    }>;
    location?: { displayName?: string };
  };

  // Step 2: Check if room already exists
  const roomExists = event.attendees.some(
    a => a.emailAddress.address === roomEmail
  );

  if (roomExists) {
    throw new Error('Room is already booked for this meeting');
  }

  // Step 3: Add room to attendees list (preserve existing)
  const updatedAttendees = [
    ...event.attendees,
    {
      emailAddress: {
        address: roomEmail,
      },
      type: 'resource',
    },
  ];

  // Step 4: PATCH with complete attendees list
  await apiClient.request(`/me/calendar/events/${eventId}`, {
    method: 'PATCH',
    body: {
      attendees: updatedAttendees,
      location: {
        displayName: roomEmail,
        locationEmailAddress: roomEmail,
      },
    },
  });
}
```

### 3.4 Atomic Room Booking Pattern

```typescript
async function bookRoomAtomic(
  eventId: string,
  roomEmail: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Step 1: Verify room is available
    const eventDetails = await apiClient.request(`/me/calendar/events/${eventId}`, {
      method: 'GET',
      params: { $select: 'start,end' },
    });

    const event = eventDetails.data as {
      start: { dateTime: string };
      end: { dateTime: string };
    };

    const availability = await checkRoomAvailability(
      [roomEmail],
      new Date(event.start.dateTime),
      new Date(event.end.dateTime)
    );

    if (!availability.get(roomEmail)?.isFree) {
      return {
        success: false,
        message: 'Room is not available during the meeting time',
      };
    }

    // Step 2: Add room to event
    await addRoomToExistingEvent(eventId, roomEmail);

    return {
      success: true,
      message: 'Room booked successfully',
    };
  } catch (error) {
    throw new Error(`Failed to book room: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

---

## 4. Permission Requirements

### 4.1 Required Permissions

#### For Room Discovery (Places API)
- **Place.Read.All** (Delegated or Application)
  - Allows reading all place resources (rooms, buildings, etc.)
  - Required for `/places/microsoft.graph.room` endpoints
  - Admin consent: May be required depending on tenant configuration

#### For Availability Checking (getSchedule)
- **Calendars.ReadBasic** (Least privileged)
  - Sufficient for checking free/busy status
  - Does not expose meeting details
- **Calendars.Read** (Higher privileged)
  - Includes meeting subject and details
- **Calendars.ReadWrite** (Highest privileged)
  - Full calendar access

#### For Room Booking (Event Creation/Updates)
- **Calendars.ReadWrite** (Required)
  - Allows creating and updating events
  - Includes adding resource attendees

### 4.2 Recommended Permission Set

```json
{
  "scopes": [
    "Place.Read.All",
    "Calendars.ReadWrite",
    "User.Read"
  ]
}
```

### 4.3 Permission Error Detection

```typescript
function isPermissionError(error: any): boolean {
  if (error.response?.status === 403) {
    const errorCode = error.response?.data?.error?.code;
    return errorCode === 'Authorization_RequestDenied' ||
           errorCode === 'Forbidden';
  }
  return false;
}

function getPermissionErrorMessage(endpoint: string): string {
  if (endpoint.includes('/places/')) {
    return 'Missing required permission: Place.Read.All. Please contact your administrator to grant this permission.';
  }
  if (endpoint.includes('/getSchedule')) {
    return 'Missing required permission: Calendars.Read or Calendars.ReadBasic. Please re-authenticate with proper permissions.';
  }
  if (endpoint.includes('/calendar/events')) {
    return 'Missing required permission: Calendars.ReadWrite. Please re-authenticate with proper permissions.';
  }
  return 'Insufficient permissions. Please contact your administrator.';
}
```

---

## 5. Error Handling Patterns

### 5.1 Common Error Codes

#### Authentication & Authorization (401/403)
```typescript
401 Unauthorized - Missing or invalid token
403 Forbidden - Insufficient permissions or license
  error=insufficient_claims - Conditional access policies
```

#### Rate Limiting (429/509)
```typescript
429 Too Many Requests - Throttled, honor Retry-After header
509 Bandwidth Limit Exceeded - App exceeded bandwidth cap
```

#### Server Issues (503/504)
```typescript
503 Service Unavailable - Retry with exponential backoff
504 Gateway Timeout - Retry with exponential backoff
```

#### Request Errors (400/409/412)
```typescript
400 Bad Request - Malformed request
409 Conflict - Resource conflict (use exponential backoff)
412 Precondition Failed - if-match header mismatch
```

### 5.2 Retry Strategy Implementation

```typescript
interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.['retry-after'];

      // Don't retry on non-retriable errors
      if (status === 400 || status === 401 || status === 403) {
        throw error;
      }

      // Don't retry if max attempts reached
      if (attempt === options.maxRetries) {
        throw error;
      }

      // Calculate delay
      let delayMs: number;
      if (retryAfter) {
        // Honor Retry-After header (in seconds)
        delayMs = parseInt(retryAfter) * 1000;
      } else {
        // Exponential backoff: 1s, 2s, 4s, 8s, etc.
        delayMs = Math.min(
          options.baseDelayMs * Math.pow(2, attempt),
          options.maxDelayMs
        );
      }

      // Add jitter (±25%)
      const jitter = delayMs * 0.25 * (Math.random() - 0.5);
      delayMs += jitter;

      logger.warn({
        attempt: attempt + 1,
        maxRetries: options.maxRetries,
        delayMs,
        status,
        operation: 'retry_operation',
      }, 'Retrying after error');

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
```

### 5.3 Complete Error Handler

```typescript
class GraphApiErrorHandler {
  static handle(error: any, operation: string): never {
    const status = error.response?.status;
    const errorCode = error.response?.data?.error?.code;
    const errorMessage = error.response?.data?.error?.message;

    logger.error({
      operation,
      status,
      errorCode,
      errorMessage,
    }, 'Graph API error');

    // Permission errors
    if (status === 403 && isPermissionError(error)) {
      throw new Error(getPermissionErrorMessage(operation));
    }

    // Rate limiting
    if (status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'] || '60';
      throw new Error(
        `Request throttled. Please retry after ${retryAfter} seconds.`
      );
    }

    // Service unavailable
    if (status === 503) {
      throw new Error(
        'Microsoft Graph service temporarily unavailable. Please try again in a few moments.'
      );
    }

    // Bad request
    if (status === 400) {
      throw new Error(
        `Invalid request: ${errorMessage || 'Please check your input parameters'}`
      );
    }

    // Calendar size limit (getSchedule specific)
    if (errorCode === '5006') {
      throw new Error(
        'Calendar has more than 1000 entries. Cannot retrieve schedule.'
      );
    }

    // Generic error
    throw new Error(
      `Microsoft Graph API error: ${errorMessage || 'Unknown error'}`
    );
  }
}
```

### 5.4 Usage Example

```typescript
async function searchRoomsWithErrorHandling(
  options: RoomSearchOptions
): Promise<Room[]> {
  try {
    return await retryWithExponentialBackoff(async () => {
      const response = await apiClient.request('/places/microsoft.graph.room', {
        method: 'GET',
        params: buildFilterParams(options),
      });

      const data = response.data as PlacesResponse;
      return data.value;
    });
  } catch (error) {
    GraphApiErrorHandler.handle(error, 'search_rooms');
  }
}
```

---

## 6. Integration with Existing Codebase

### 6.1 Current Architecture

The cerebro-mcp codebase has:
- **MicrosoftService** class (`/home/stuartdavidson/code/cerebro-mcp/src/services/microsoft/microsoft-service.ts`)
- **MicrosoftApiClient** for Graph API requests
- **MicrosoftTokenStorage** for OAuth token management
- Existing calendar tools: list-events, get-event, create-event, update-event, find-meeting-times

### 6.2 Recommended Implementation Approach

#### Step 1: Add Room Discovery Tool
```typescript
{
  name: 'search-rooms',
  description: 'Search for meeting rooms by building, capacity, and amenities',
  inputSchema: {
    type: 'object',
    properties: {
      building: { type: 'string', description: 'Building name or number' },
      minCapacity: { type: 'number', description: 'Minimum room capacity' },
      requiresVideo: { type: 'boolean', description: 'Requires video conferencing' },
      requiresAudio: { type: 'boolean', description: 'Requires audio equipment' },
      wheelchairAccessible: { type: 'boolean', description: 'Wheelchair accessible' },
      teamsEnabled: { type: 'boolean', description: 'Microsoft Teams enabled' },
    },
  },
  handler: this.searchRooms.bind(this),
}
```

#### Step 2: Add Room Availability Tool
```typescript
{
  name: 'check-room-availability',
  description: 'Check availability for one or more rooms during a time period',
  inputSchema: {
    type: 'object',
    properties: {
      roomEmails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Room email addresses to check',
      },
      startDateTime: { type: 'string', description: 'Start time (ISO 8601)' },
      endDateTime: { type: 'string', description: 'End time (ISO 8601)' },
      intervalMinutes: {
        type: 'number',
        description: 'Time slot interval in minutes (default: 30)',
        default: 30,
      },
    },
    required: ['roomEmails', 'startDateTime', 'endDateTime'],
  },
  handler: this.checkRoomAvailability.bind(this),
}
```

#### Step 3: Add Room Booking Tool
```typescript
{
  name: 'book-room',
  description: 'Add a room to an existing calendar event or create new meeting with room',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'Existing event ID (optional - if not provided, creates new event)',
      },
      roomEmail: { type: 'string', description: 'Room email address' },
      subject: { type: 'string', description: 'Meeting subject (required for new events)' },
      startDateTime: { type: 'string', description: 'Start time (required for new events)' },
      endDateTime: { type: 'string', description: 'End time (required for new events)' },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Attendee email addresses',
      },
    },
    required: ['roomEmail'],
  },
  handler: this.bookRoom.bind(this),
}
```

#### Step 4: Add Combined Find & Book Tool
```typescript
{
  name: 'find-and-book-room',
  description: 'Find available room matching criteria and book it for a meeting',
  inputSchema: {
    type: 'object',
    properties: {
      startDateTime: { type: 'string', description: 'Meeting start time (ISO 8601)' },
      endDateTime: { type: 'string', description: 'Meeting end time (ISO 8601)' },
      minCapacity: { type: 'number', description: 'Minimum room capacity' },
      building: { type: 'string', description: 'Preferred building' },
      requiresVideo: { type: 'boolean', description: 'Requires video conferencing' },
      subject: { type: 'string', description: 'Meeting subject' },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Attendee email addresses',
      },
    },
    required: ['startDateTime', 'endDateTime', 'subject'],
  },
  handler: this.findAndBookRoom.bind(this),
}
```

### 6.3 Permission Update

Update OAuth scopes in service configuration:
```typescript
const scopes = [
  'User.Read',
  'Mail.ReadWrite',
  'Calendars.ReadWrite',
  'Place.Read.All',  // ADD THIS
  'Notes.ReadWrite',
];
```

---

## 7. Best Practices Summary

### 7.1 Room Discovery
1. Use `$filter` to narrow results before checking availability
2. Select only needed properties with `$select` to reduce payload
3. Handle pagination with `@odata.nextLink` for large room lists
4. Cache room metadata (doesn't change frequently)

### 7.2 Availability Checking
1. Batch multiple rooms in single getSchedule request (limit ~20)
2. Use appropriate interval (30-60 minutes for most cases)
3. Parse `availabilityView` for quick free/busy overview
4. Use `scheduleItems` for detailed conflict information

### 7.3 Room Booking
1. Always check availability before booking
2. Use resource attendee type for automatic room management
3. Include room in both `attendees` and `location` fields
4. When updating events, always GET current attendees first
5. Handle async room acceptance (may take seconds)

### 7.4 Error Handling
1. Implement exponential backoff for 429/503/504 errors
2. Honor `Retry-After` header when present
3. Provide user-friendly permission error messages
4. Never display raw API error messages to users
5. Log detailed errors for debugging

### 7.5 Performance
1. Use concurrent requests where possible (room search + availability check)
2. Implement request caching for static data (room lists)
3. Limit getSchedule batches to prevent timeout (5006 error)
4. Consider implementing request queuing for high-volume scenarios

---

## 8. References

- Microsoft Graph Places API: https://learn.microsoft.com/en-us/graph/api/place-list
- Room Resource Type: https://learn.microsoft.com/en-us/graph/api/resources/room
- getSchedule API: https://learn.microsoft.com/en-us/graph/api/calendar-getschedule
- Event Resource: https://learn.microsoft.com/en-us/graph/api/user-post-events
- Event Update: https://learn.microsoft.com/en-us/graph/api/event-update
- Graph API Errors: https://learn.microsoft.com/en-us/graph/errors
- OData Query Parameters: https://learn.microsoft.com/en-us/graph/query-parameters

---

**Document Status**: Complete
**Implementation Ready**: Yes
**Reviewed By**: AI Research Assistant
**Next Steps**: Implementation of room discovery and booking tools in MicrosoftService class
