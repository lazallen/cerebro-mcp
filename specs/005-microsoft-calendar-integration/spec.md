# Feature 005: Microsoft Calendar Integration

**Status**: Approved
**Priority**: P1 (High)
**Estimated Effort**: Medium
**Target Release**: v0.2.0

---

## Overview

Extends the Microsoft 365 service (Feature 004) with calendar management capabilities using Microsoft Graph API. Provides tools for viewing, creating, updating, deleting calendar events, and finding optimal meeting times based on attendee availability.

---

## Business Context

### Problem Statement
The Microsoft 365 service currently only supports email operations. Users need calendar integration to:
- View upcoming meetings and events
- Create calendar events programmatically
- Update or cancel existing events
- Query events within date ranges
- Manage attendees and meeting details
- Find optimal meeting times across multiple attendees' calendars

### Success Criteria
1. Users can list calendar events within date ranges
2. Users can view detailed event information including attendees
3. Users can create new calendar events with attendees
4. Users can update existing calendar events
5. Users can delete/cancel calendar events
6. Users can find optimal meeting times based on attendee availability
7. All operations work with the same OAuth flow as email tools
8. Calendar operations comply with Skyscanner production standards

---

## Technical Design

### Architecture

```
MicrosoftService (existing)
├── Email Tools (existing)
│   ├── list-emails
│   ├── read-email
│   └── send-email
└── Calendar Tools (NEW)
    ├── list-events
    ├── get-event
    ├── create-event
    ├── update-event
    ├── delete-event
    └── find-meeting-times
```

### API Endpoints

Microsoft Graph API endpoints to be used:
- `GET /me/calendar/events` - List calendar events
- `GET /me/calendar/events/{id}` - Get specific event
- `POST /me/calendar/events` - Create calendar event
- `PATCH /me/calendar/events/{id}` - Update calendar event
- `DELETE /me/calendar/events/{id}` - Delete calendar event
- `POST /me/findMeetingTimes` - Find optimal meeting times

### OAuth Scopes

Add to existing Microsoft 365 OAuth scopes in service-registration.ts:
- `Calendars.Read` - Read user calendars
- `Calendars.ReadWrite` - Create/update/delete calendar events

Updated scope array:
```typescript
scopes: [
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'User.Read',
  'Calendars.Read',      // NEW
  'Calendars.ReadWrite', // NEW
]
```

---

## Functional Requirements

### FR-019: List Calendar Events
- **Priority**: P1
- **Description**: List calendar events within a date range
- **Input Parameters**:
  - `startDate` (optional): ISO 8601 date string (default: today)
  - `endDate` (optional): ISO 8601 date string (default: 7 days from start)
  - `count` (optional): Max number of events (default: 50, max: 100)
- **Output**: Array of events with:
  - Event ID
  - Subject/title
  - Start time (with timezone)
  - End time (with timezone)
  - Location
  - Organizer
  - Attendee count
  - Online meeting URL (if Teams/online meeting)
- **Acceptance**:
  - Returns events ordered by start time ascending
  - Respects date range filters
  - Caps result count at maximum
  - Handles all-day events correctly

### FR-020: Get Event Details
- **Priority**: P1
- **Description**: Retrieve complete details for a specific calendar event
- **Input Parameters**:
  - `eventId` (required): Calendar event ID from list-events
- **Output**: Full event details including:
  - All fields from FR-019
  - Body/description (HTML and text)
  - Full attendee list with response status
  - Recurrence pattern (if recurring)
  - Reminder settings
  - Categories/tags
  - Sensitivity/privacy level
- **Acceptance**:
  - Returns complete event object
  - Throws error if event not found
  - Works with both single and recurring events

### FR-021: Create Calendar Event
- **Priority**: P1
- **Description**: Create a new calendar event with optional attendees
- **Input Parameters**:
  - `subject` (required): Event title/subject
  - `startDateTime` (required): ISO 8601 datetime string
  - `endDateTime` (required): ISO 8601 datetime string
  - `startTimeZone` (optional): IANA timezone (default: UTC)
  - `endTimeZone` (optional): IANA timezone (default: UTC)
  - `body` (optional): Event description/body
  - `bodyType` (optional): 'text' or 'html' (default: 'text')
  - `location` (optional): Physical location string
  - `attendees` (optional): Array of email addresses
  - `isOnlineMeeting` (optional): Boolean to create Teams meeting (default: false)
  - `isAllDay` (optional): Boolean for all-day events (default: false)
- **Output**:
  - Created event ID
  - Event web link
  - Online meeting join URL (if isOnlineMeeting=true)
  - Success confirmation
- **Acceptance**:
  - Creates event in user's default calendar
  - Sends meeting invites to attendees if specified
  - Creates Teams meeting link if requested
  - Validates datetime formats
  - Handles timezone conversions

### FR-022: Update Calendar Event
- **Priority**: P1
- **Description**: Update an existing calendar event
- **Input Parameters**:
  - `eventId` (required): Event ID to update
  - All fields from FR-021 (optional, only updates provided fields)
  - `sendUpdate` (optional): 'all', 'none', or 'tentative' (default: 'all')
- **Output**:
  - Updated event ID
  - Success confirmation
  - List of notified attendees
- **Acceptance**:
  - Only modifies specified fields (partial update)
  - Sends update notifications based on sendUpdate parameter
  - Throws error if event not found
  - Validates user has permission to update

### FR-023: Delete Calendar Event
- **Priority**: P1
- **Description**: Delete/cancel a calendar event
- **Input Parameters**:
  - `eventId` (required): Event ID to delete
  - `sendCancellation` (optional): Boolean to notify attendees (default: true)
- **Output**:
  - Success confirmation
  - List of notified attendees (if sendCancellation=true)
- **Acceptance**:
  - Removes event from calendar
  - Sends cancellation notices if requested
  - Throws error if event not found
  - Validates user has permission to delete

### FR-024: OAuth Scope Update
- **Priority**: P1
- **Description**: Update Microsoft OAuth registration to include calendar scopes
- **Acceptance**:
  - Calendars.Read and Calendars.ReadWrite added to scope array
  - Users see new permissions when authenticating
  - Existing tokens continue to work (users re-auth to get calendar access)
  - Service initialization checks for calendar scopes

### FR-025: Find Meeting Times
- **Priority**: P1
- **Description**: Find optimal meeting times based on attendee availability using Microsoft Graph findMeetingTimes API
- **Input Parameters**:
  - `attendees` (required): Array of email addresses for required attendees
  - `optionalAttendees` (optional): Array of email addresses for optional attendees
  - `meetingDuration` (required): Meeting duration in minutes
  - `maxCandidates` (optional): Max number of suggestions (default: 5, max: 10)
  - `timeConstraintStart` (optional): Start of search window in ISO 8601 (default: now)
  - `timeConstraintEnd` (optional): End of search window in ISO 8601 (default: 5 days from start)
  - `minimumAttendeePercentage` (optional): Minimum percentage of attendees required (0-100, default: 100)
- **Output**:
  - Success status
  - Number of suggestions found
  - Array of time slot suggestions with:
    - Confidence score (0-100)
    - Suggestion reason
    - Time slot (start, end, timezone)
    - Organizer availability
    - Per-attendee availability status
  - Empty suggestions reason (if no slots found)
  - Search parameters used
- **Acceptance**:
  - Analyzes calendars of all attendees
  - Returns slots where required attendees are available
  - Respects optional attendee status
  - Caps suggestions at maximum
  - Provides confidence scores and reasoning
  - Works within specified time windows
  - Handles timezone conversions

---

## User Stories

### User Story 1: View Upcoming Meetings (P1)
**As a** user
**I want to** view my upcoming calendar events
**So that** I can see my schedule for the next week

**Acceptance Criteria**:
- User can list events with default 7-day window
- Events show key details (time, subject, location, attendees)
- Events are ordered chronologically
- Online meeting links are included

### User Story 2: Create Meeting with Attendees (P1)
**As a** user
**I want to** create calendar events with multiple attendees
**So that** I can schedule meetings programmatically

**Acceptance Criteria**:
- User can specify event subject, time, and attendees
- Meeting invites are sent to all attendees
- Can optionally create Teams online meeting
- Event appears in user's calendar immediately

### User Story 3: Update Meeting Details (P1)
**As a** user
**I want to** modify existing calendar events
**So that** I can change meeting times or details

**Acceptance Criteria**:
- User can update any event field
- Attendees receive update notifications
- Can control whether to notify attendees
- Partial updates supported (only change specific fields)

### User Story 4: Cancel Meeting (P1)
**As a** user
**I want to** delete calendar events
**So that** I can cancel meetings

**Acceptance Criteria**:
- User can delete events by ID
- Attendees receive cancellation notices
- Can optionally skip notifications
- Event removed from all calendars

### User Story 5: Query Events by Date Range (P2)
**As a** user
**I want to** query events within custom date ranges
**So that** I can find events in specific time periods

**Acceptance Criteria**:
- User can specify start and end dates
- Results limited to specified range
- Works with past, present, and future dates

### User Story 6: Find Optimal Meeting Times (P1)
**As a** user
**I want to** find meeting times when all required attendees are available
**So that** I can schedule meetings efficiently without checking calendars manually

**Acceptance Criteria**:
- User provides list of required attendees and meeting duration
- System analyzes attendee calendars for availability
- Returns ranked suggestions with confidence scores
- Shows per-attendee availability for each slot
- Supports optional attendees who don't block suggestions
- Allows custom time windows for search
- Provides reasons when no suitable times found

---

## Implementation Plan

### Phase 1: Add Calendar Tools to MicrosoftService
1. Update `src/services/microsoft/microsoft-service.ts`:
   - Add 6 new tool definitions in getTools()
   - Implement private handler methods for each tool
2. Update OAuth scopes in `src/mcp-server/service-registration.ts`
3. Add calendar-specific types if needed

### Phase 2: Implement Tool Handlers
1. `listEvents()`: GET /me/calendar/events with query params
2. `getEvent()`: GET /me/calendar/events/{id}
3. `createEvent()`: POST /me/calendar/events
4. `updateEvent()`: PATCH /me/calendar/events/{id}
5. `deleteEvent()`: DELETE /me/calendar/events/{id}
6. `findMeetingTimes()`: POST /me/findMeetingTimes

### Phase 3: Testing
1. Add unit tests to `src/services/microsoft/__tests__/microsoft-service.test.ts`
2. Test all 6 calendar tools in test mode
3. Test date parsing and timezone handling
4. Test attendee management
5. Test meeting time suggestions with various configurations
6. Test error scenarios (not found, permission denied)

### Phase 4: Documentation
1. Update README.md with calendar tool examples
2. Document OAuth scope requirements
3. Add calendar tool reference to MCP client documentation

---

## Test Plan

### Unit Tests (Target: 100% coverage of new code)

**Calendar Tool Registration**:
- ✓ getTools() returns 9 tools total (3 email + 6 calendar)
- ✓ Each calendar tool has correct name and schema
- ✓ Required parameters are marked as required

**List Events Tool**:
- ✓ Lists events with default date range (today + 7 days)
- ✓ Respects custom startDate and endDate
- ✓ Caps results at maximum count
- ✓ Returns events ordered by start time
- ✓ Handles empty calendar

**Get Event Tool**:
- ✓ Retrieves event by ID
- ✓ Returns full event details
- ✓ Throws error if event not found
- ✓ Handles recurring events

**Create Event Tool**:
- ✓ Creates basic event (subject, start, end)
- ✓ Creates event with attendees
- ✓ Creates online meeting when requested
- ✓ Creates all-day event
- ✓ Handles timezone conversion
- ✓ Validates datetime formats
- ✓ Requires mandatory fields

**Update Event Tool**:
- ✓ Updates event subject
- ✓ Updates event time
- ✓ Updates attendee list
- ✓ Partial updates (only specified fields)
- ✓ Controls notification sending
- ✓ Throws error if event not found

**Delete Event Tool**:
- ✓ Deletes event successfully
- ✓ Sends cancellation by default
- ✓ Skips cancellation when requested
- ✓ Throws error if event not found

**Find Meeting Times Tool**:
- ✓ Finds meeting times for required attendees
- ✓ Supports optional attendees
- ✓ Respects custom time constraints
- ✓ Caps maxCandidates at 10
- ✓ Uses default meeting duration of 60 minutes
- ✓ Supports custom minimum attendee percentage
- ✓ Requires attendees parameter
- ✓ Requires meetingDuration parameter

### Integration Tests (Manual)

**OAuth Flow**:
- [ ] Re-authenticate to get calendar scopes
- [ ] Verify Calendars.Read and Calendars.ReadWrite appear in consent screen
- [ ] Existing tokens work but lack calendar access
- [ ] New tokens include calendar permissions

**Real Calendar Operations**:
- [ ] List actual calendar events
- [ ] Create test event
- [ ] View created event details
- [ ] Update event time and attendees
- [ ] Delete test event
- [ ] Verify notifications sent to attendees
- [ ] Find meeting times for multiple attendees
- [ ] Verify confidence scores and availability details

**Error Handling**:
- [ ] Invalid event ID returns proper error
- [ ] Invalid datetime format rejected
- [ ] Unauthorized access handled gracefully
- [ ] No available meeting times handled gracefully

---

## Security Considerations

### Data Privacy
- Calendar data is sensitive personal information
- Only request minimum necessary scopes
- Never log event details or attendee information
- Respect user's calendar privacy settings

### Access Control
- Users can only access their own calendar
- Service cannot access other users' calendars without delegation
- Proper error handling for permission denied scenarios

### OAuth Scope Justification
- `Calendars.Read`: Required for list-events, get-event, and find-meeting-times
- `Calendars.ReadWrite`: Required for create/update/delete operations
- Scopes follow principle of least privilege

---

## Dependencies

### Internal Dependencies
- Feature 004 (Microsoft 365 Service) - **COMPLETED**
- Feature 003 (MCP Protocol Handler) - **COMPLETED**
- Feature 002 (OAuth Server) - **COMPLETED**

### External Dependencies
- Microsoft Graph API v1.0
- Valid Microsoft 365 account with Exchange Online
- Calendar permissions granted during OAuth

---

## Success Metrics

### Development Metrics
- [x] All 6 calendar tools implemented
- [x] Unit test coverage ≥ 80% for new code
- [x] Zero ESLint/TypeScript errors
- [x] Build passes successfully

### Functional Metrics
- [x] All user stories acceptance criteria met
- [x] All functional requirements implemented
- [ ] Manual integration tests pass
- [x] OAuth scope update deployed

---

## Future Enhancements (Out of Scope)

- Recurring event pattern creation
- Calendar sharing and delegation
- Multiple calendar support
- Event attachments
- Free/busy time queries
- Room/resource booking
- Calendar permissions management
- Event categories and color coding
- Reminder customization
- Meeting room finder integration

---

## References

- [Microsoft Graph Calendar API Documentation](https://learn.microsoft.com/en-us/graph/api/resources/calendar)
- [Microsoft Graph Event Resource](https://learn.microsoft.com/en-us/graph/api/resources/event)
- [OAuth Scopes for Calendar](https://learn.microsoft.com/en-us/graph/permissions-reference#calendars-permissions)
- Feature 004 Specification: Microsoft 365 Email Integration
