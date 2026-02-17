# Research: Meeting Room Booking via Microsoft Graph API

**Date**: 2026-02-05
**Feature**: 016-meeting-room-booking
**Spec**: [spec.md](./spec.md)

## Purpose

Document technical decisions and implementation patterns for adding meeting room booking functionality to Cerebro MCP via Microsoft Graph Places API.

## Key Technical Decisions

### Decision 1: Microsoft Graph Places API

**Chosen**: Use `/places/microsoft.graph.room` endpoint with OData filtering

**Rationale**:
- Native Microsoft Graph API support for room discovery
- Rich filtering capabilities (building, capacity, amenities, accessibility)
- Returns structured room metadata (email, capacity, equipment, location)
- Integrates seamlessly with existing MicrosoftService architecture
- No additional service dependencies required

**Alternatives Considered**:
- **Exchange Web Services (EWS)**: Rejected - deprecated in favor of Graph API, limited filtering
- **Custom room database**: Rejected - adds complexity, sync issues, stale data risk

### Decision 2: Room Availability Detection

**Chosen**: Use `/me/calendar/getSchedule` API with batch room email checking

**Rationale**:
- Single API call can check up to 20 rooms simultaneously
- Returns availability view string (0-4 status codes) for quick parsing
- Includes detailed schedule items with conflict information
- Uses existing Calendars.ReadWrite permission
- Supports configurable time slot intervals (5-1440 minutes)

**Alternatives Considered**:
- **Individual event queries per room**: Rejected - too many API calls, rate limiting risk
- **findMeetingTimes API**: Rejected - designed for finding mutual availability across people, not room status checking

###Decision 3: Room Booking Pattern

**Chosen**: Resource attendee pattern with GET-then-PATCH atomic operation

**Rationale**:
- Rooms are attendees with `type: "resource"` (Exchange Server standard)
- PATCH requires complete attendee list to avoid removing existing attendees
- Atomic pattern: GET current → verify availability → add room → PATCH event
- Exchange handles auto-accept/decline based on room's booking policy
- Updates both `attendees` array and `location` field for consistency

**Alternatives Considered**:
- **Direct PATCH without GET**: Rejected - risks removing existing attendees
- **POST new event**: Only for new meetings, not booking rooms for existing meetings
- **Separate room management API**: Rejected - no such API exists in Graph

### Decision 4: Category-Based Meeting Detection

**Chosen**: Explicit opt-in via event categories ("Office", "In-Person", "Room Needed")

**Rationale**:
- User-controlled explicit indication of room requirement
- Avoids false positives (hybrid meetings with dial-in don't need rooms)
- Leverages existing Graph API `categories` property (no new fields)
- Default-skip behavior prevents unwanted room suggestions
- Aligns with clarification decision (spec.md lines 14-15)

**Alternatives Considered**:
- **Presence of virtual link = skip**: Rejected - hybrid meetings have links but need rooms
- **Attendee location analysis**: Rejected - unreliable, attendee location data often missing
- **Always suggest rooms**: Rejected - too noisy, annoys users with virtual-only meetings

### Decision 5: Capacity Buffer Calculation

**Chosen**: 20% buffer rounded up using `Math.ceil(attendeeCount * 1.2)`

**Rationale**:
- Provides comfort space for attendees (5 attendees → 6 capacity minimum)
- Accounts for unexpected additions (late joiners, equipment, presentation materials)
- Rounding up ensures sufficient space (8 attendees → 10 capacity, not 9.6)
- Simple formula, testable, matches clarification (spec.md line 16)
- Industry standard practice for meeting room planning

**Alternatives Considered**:
- **Fixed +2 seats**: Rejected - doesn't scale (10 people + 2 = 12, insufficient for large meetings)
- **Round down**: Rejected - creates cramped rooms, poor user experience
- **Exact match**: Rejected - no buffer for unexpected needs

### Decision 6: Permission Error Handling

**Chosen**: Graceful degradation with actionable error messages

**Rationale**:
- Detects 403 errors with `Authorization_RequestDenied` or `Forbidden` codes
- Returns specific error messages per endpoint (/places vs /getSchedule vs /events)
- Continues calendar-triage without room booking if Place.Read.All missing
- Provides re-authentication instructions with specific permission requirements
- Aligns with clarification decision (spec.md lines 15-16, FR-007a/b)

**Alternatives Considered**:
- **Silent failure**: Rejected - users don't know why feature doesn't work
- **Immediate re-auth prompt**: Rejected - blocks workflow, interrupts user
- **Generic error message**: Rejected - doesn't guide users to resolution

## Implementation Patterns

### Pattern 1: Room Search with Filtering

```typescript
// OData filter construction
const filters: string[] = [];
if (building) filters.push(`building eq '${building}'`);
if (minCapacity) filters.push(`capacity ge ${minCapacity}`);
if (requiresVideo) filters.push('videoDeviceName ne null');

// Combined filter
const filterString = filters.join(' and ');

// API request
const response = await apiClient.request('/places/microsoft.graph.room', {
  method: 'GET',
  params: {
    $filter: filterString,
    $select: 'id,displayName,emailAddress,capacity,building',
    $top: '100',
  },
});
```

### Pattern 2: Batch Availability Checking

```typescript
// Check multiple rooms in single request
const response = await apiClient.request('/me/calendar/getSchedule', {
  method: 'POST',
  body: {
    schedules: ['room1@domain.com', 'room2@domain.com', 'room3@domain.com'],
    startTime: { dateTime: start.toISOString(), timeZone: 'UTC' },
    endTime: { dateTime: end.toISOString(), timeZone: 'UTC' },
    availabilityViewInterval: 30,
  },
});

// Parse availability view: "0" = free, "2" = busy
const isFree = !schedule.availabilityView.includes('2');
```

### Pattern 3: Atomic Room Booking

```typescript
// 1. GET current event
const event = await apiClient.request(`/me/calendar/events/${eventId}`, {
  method: 'GET',
  params: { $select: 'attendees' },
});

// 2. Check if room already exists
const roomExists = event.attendees.some(a => a.emailAddress.address === roomEmail);
if (roomExists) throw new Error('Room already booked');

// 3. Add room to attendees (preserve existing)
const updatedAttendees = [
  ...event.attendees,
  { emailAddress: { address: roomEmail }, type: 'resource' },
];

// 4. PATCH with complete list
await apiClient.request(`/me/calendar/events/${eventId}`, {
  method: 'PATCH',
  body: { attendees: updatedAttendees },
});
```

### Pattern 4: Exponential Backoff with Retry-After

```typescript
// Honor Retry-After header for 429 errors
const retryAfter = error.response?.headers?.['retry-after'];
const delayMs = retryAfter
  ? parseInt(retryAfter) * 1000
  : baseDelayMs * Math.pow(2, attempt);

// Add jitter (±25%)
const jitter = delayMs * 0.25 * (Math.random() - 0.5);
await sleep(delayMs + jitter);
```

## Integration Points

### Existing Codebase Extensions

1. **MicrosoftService** (`src/services/microsoft/microsoft-service.ts`)
   - Add 4 new tool registrations in `getTools()` method
   - Follow existing pattern (similar to onenote-tools, email-move-tools)

2. **MicrosoftApiClient** (`src/services/microsoft/api-client.ts`)
   - Already supports generic `request()` method
   - No changes needed - reuse existing HTTP client

3. **New RoomBookingClient** (`src/services/microsoft/room-booking-client.ts`)
   - Encapsulates room booking business logic
   - Pattern: similar to `OneNoteClient`, `EventResponseClient`
   - Methods: `searchRooms()`, `checkAvailability()`, `bookRoom()`, `removeRoom()`

4. **OAuth Scopes** (environment configuration)
   - Add `Place.Read.All` to existing scope list
   - Update `.env.example` with new permission documentation

## Dependencies

### Required Permissions

- **Place.Read.All**: Room discovery via Places API
- **Calendars.ReadWrite**: Already granted (event creation/updates)

### No New NPM Dependencies

All functionality uses existing dependencies:
- `@modelcontextprotocol/sdk` - MCP tool definitions
- Existing `MicrosoftApiClient` - HTTP requests to Graph API
- Existing `pino` logger - Structured logging
- TypeScript strict mode - Type safety

## Performance Considerations

1. **Batch Room Availability**: Check up to 20 rooms per request (Graph API limit)
2. **Request Caching**: Room metadata rarely changes (cache for session duration)
3. **Concurrent Operations**: Search rooms + check availability can run in parallel
4. **Time Complexity**: O(1) for availability check (string parsing), O(n) for room filtering

## Security Considerations

1. **Permission Verification**: Detect missing Place.Read.All before API calls
2. **Error Message Sanitization**: No internal details exposed to users
3. **Input Validation**: Validate building names, capacity values, email addresses
4. **Token Handling**: Reuse existing MicrosoftTokenStorage (secure file-based storage)

## Testing Strategy

1. **Unit Tests**:
   - Capacity calculation (buffer rounding)
   - OData filter construction
   - Availability view parsing
   - Error handling (permission, rate limit, timeout)

2. **Integration Tests**:
   - Room search with real Graph API (test mode)
   - Availability checking for known rooms
   - Booking flow (create event → book room → verify)
   - Permission error handling

3. **Mocking**:
   - Use existing test mode pattern (`USE_TEST_MODE=true`)
   - Mock Graph API responses for deterministic tests

## References

- Microsoft Graph Places API: https://learn.microsoft.com/en-us/graph/api/place-list
- Room Resource Type: https://learn.microsoft.com/en-us/graph/api/resources/room
- getSchedule API: https://learn.microsoft.com/en-us/graph/api/calendar-getschedule
- Event Update: https://learn.microsoft.com/en-us/graph/api/event-update

## Next Steps

Proceed to Phase 1:
1. Generate data-model.md (Room, RoomAvailability entities)
2. Generate API contracts (4 tool schemas)
3. Generate quickstart.md (usage guide)
