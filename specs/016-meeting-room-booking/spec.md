# Feature Specification: Meeting Room Booking for Calendar Triage

**Feature Branch**: `016-meeting-room-booking`
**Created**: 2026-02-05
**Status**: Draft
**Input**: User description: "Add meeting room booking functionality to calendar-triage command via Microsoft Graph API"

## Clarifications

### Session 2026-02-05

- Q: When the system cannot auto-detect the office location from calendar events (FR-016), at what point should it prompt the user? → A: At the start of calendar triage session (proactive, before analyzing meetings)
- Q: When a user attempts to book a room that's already occupied (busy) for the requested time slot, what should the system do? → A: Block the booking and suggest alternative available rooms
- Q: How should the system distinguish between virtual-only meetings (no room needed) and meetings requiring rooms? → A: Check categories for explicit room need indicator (e.g., "Office", "In-Person", "Room Needed"); only offer room booking if category present. Default is to skip room booking unless explicitly categorized
- Q: When the system attempts to access Microsoft Graph API for room data but lacks the required Place.Read.All permission, how should it behave? → A: Gracefully degrade with clear error message and re-authentication instructions
- Q: How should the 20% capacity buffer be applied when calculating room requirements? → A: Round up (5 attendees → 6 capacity, 8 attendees → 10 capacity)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Room Booking During Calendar Triage (Priority: P1)

A user working from their office runs the calendar-triage command to review their daily schedule. The system detects they are in the office, identifies meetings without room bookings, finds available rooms, and books them automatically with user confirmation.

**Why this priority**: This is the core value proposition - eliminating the manual task of booking meeting rooms and ensuring all in-office meetings have appropriate spaces reserved.

**Independent Test**: Can be fully tested by creating a test calendar with an office location event and meetings without rooms, running calendar-triage, and verifying that room booking suggestions appear and can be executed.

**Acceptance Scenarios**:

1. **Given** user is working from Edinburgh office and has 3 meetings today without rooms, **When** user runs `/calendar-triage`, **Then** system detects office location, identifies 3 missing room issues, and offers to book available rooms
2. **Given** user has meeting with 4 attendees scheduled for 14:00-15:00, **When** system finds available rooms, **Then** system recommends room with capacity 6+ and appropriate amenities
3. **Given** user confirms room booking, **When** system books the room, **Then** room appears as resource attendee in calendar event and location field is updated
4. **Given** all recommended rooms are booked, **When** user confirms booking, **Then** calendar event is updated and confirmation message displays room details

---

### User Story 2 - Manual Room Lookup and Booking (Priority: P2)

A user needs to book a meeting room outside of the calendar-triage workflow. They want to search for available rooms by criteria (office, capacity, amenities) and book a specific room to an existing meeting.

**Why this priority**: Provides flexibility for ad-hoc room bookings and enables users to manage rooms without running full calendar triage.

**Independent Test**: Can be tested by directly invoking room listing and booking tools with specific parameters, verifying room search works and booking updates calendar events correctly.

**Acceptance Scenarios**:

1. **Given** user needs to book a room in Edinburgh with capacity for 8 people, **When** user searches for rooms, **Then** system returns list of Edinburgh rooms with 8+ capacity including availability status
2. **Given** user has selected a specific room, **When** user books it to an existing meeting, **Then** room is added as resource attendee and meeting location is updated
3. **Given** selected room is already booked for that time, **When** user attempts booking, **Then** system warns user of conflict and suggests alternative rooms

---

### User Story 3 - Room Removal and Rebooking (Priority: P3)

A user's plans change - their meeting becomes virtual-only or they need to work remotely. They want to remove room bookings from existing meetings to free up the space for others.

**Why this priority**: Enables efficient use of office resources by freeing up rooms that won't be used, but less critical than the primary booking flow.

**Independent Test**: Can be tested by creating meetings with room bookings, invoking the removal tool, and verifying rooms are removed from attendees and location fields are cleared.

**Acceptance Scenarios**:

1. **Given** user has 3 meetings with room bookings but is now working remotely, **When** user removes room bookings, **Then** rooms are removed from attendee lists and location fields are cleared
2. **Given** user wants to change from a small room to larger room, **When** user removes old room and books new room, **Then** old room is freed and new room is booked to the same meeting
3. **Given** meeting becomes virtual-only, **When** user removes room booking, **Then** room is removed but virtual meeting link remains intact

---

### Edge Cases

- What happens when no rooms are available for the requested time slot? System suggests alternative times or virtual meeting options
- How does system handle meetings outside office hours (before 08:00 or after 18:00)? System skips room booking for these meetings
- What if room capacity is too small for attendee count? System recommends larger rooms or suggests splitting the meeting
- How does system handle meetings without room-indicating categories? System skips room booking by default; rooms are only offered when meeting has explicit category (e.g., "Office", "In-Person", "Room Needed")
- What if user office location cannot be detected? System prompts user to specify office (Edinburgh/Glasgow/Barcelona/Remote)
- How does system handle recurring meetings? System processes each instance independently based on office location per day
- What if room auto-decline occurs due to conflict? System detects decline and suggests alternative rooms
- What happens with multi-office meetings (attendees in different locations)? System books room in user's office location only
- What if Microsoft Graph API permissions are insufficient (missing Place.Read.All)? System displays clear error message with re-authentication instructions and continues calendar triage without room booking features

## Requirements *(mandatory)*

### Functional Requirements

#### Room Discovery and Availability

- **FR-001**: System MUST retrieve list of meeting rooms filtered by office location (building name)
- **FR-002**: System MUST retrieve list of meeting rooms filtered by minimum capacity
- **FR-003**: System MUST retrieve list of meeting rooms filtered by floor number when specified
- **FR-004**: System MUST retrieve list of meeting rooms filtered by amenities (video equipment, whiteboard) when specified
- **FR-005**: System MUST check room availability for specific time slots using calendar schedule data
- **FR-006**: System MUST return availability status indicating if room is free, busy, tentative, or out of office
- **FR-007**: System MUST handle multiple room availability checks in a single request
- **FR-007a**: System MUST gracefully handle Microsoft Graph API permission failures (e.g., missing Place.Read.All) with clear error message
- **FR-007b**: System MUST provide re-authentication instructions when Graph API permissions are insufficient

#### Room Booking and Management

- **FR-008**: System MUST add meeting room as resource attendee to existing calendar event
- **FR-009**: System MUST update calendar event location field with room name when booking room
- **FR-010**: System MUST preserve existing event attendees when adding room booking
- **FR-011**: System MUST remove meeting room from calendar event attendee list
- **FR-012**: System MUST clear or update location field when removing room booking
- **FR-013**: System MUST prevent duplicate room bookings to same event
- **FR-014a**: System MUST block room booking attempts when selected room is busy for the requested time slot
- **FR-014b**: System MUST automatically suggest alternative available rooms when a booking conflict is detected

#### Office Location Detection

- **FR-015**: System MUST detect when user is working from office by checking for "Working from [Office]" calendar events
- **FR-016**: System MUST detect office location from calendar event location fields
- **FR-017**: System MUST prompt user to specify office location at the start of calendar triage session when auto-detection fails
- **FR-018**: System MUST support office locations: Edinburgh, Glasgow, Barcelona, London, and Remote

#### Calendar Triage Integration

- **FR-019**: System MUST identify meetings without room bookings during calendar triage
- **FR-020**: System MUST only flag missing rooms for meetings with 2+ attendees
- **FR-021**: System MUST only flag missing rooms for meetings during office hours (08:00-18:00)
- **FR-022**: System MUST only offer room booking for meetings with explicit category indicators (e.g., "Office", "In-Person", "Room Needed")
- **FR-022a**: System MUST skip room booking by default for meetings without room-indicating categories
- **FR-023**: System MUST calculate required room capacity based on meeting attendee count
- **FR-024**: System MUST present room booking recommendations to user before executing
- **FR-025**: System MUST require user confirmation before booking any room

#### Room Selection Logic

- **FR-026**: System MUST prioritize smallest available room that accommodates attendee count
- **FR-027**: System MUST apply 20% capacity buffer rounded up (e.g., 5 attendees → 6 capacity minimum, 8 attendees → 10 capacity minimum)
- **FR-028**: System MUST prioritize rooms with video equipment for meetings with remote attendees
- **FR-029**: System MUST suggest alternative rooms when preferred room is unavailable
- **FR-030**: System MUST suggest alternative meeting times when no suitable rooms are available

### Key Entities

- **Meeting Room**: Physical conference room with attributes including email address, display name, building/office location, floor number, capacity, video equipment availability, and amenity tags
- **Calendar Event**: Scheduled meeting with attributes including start/end time, attendees (people and resources), location, virtual meeting link, organizer, and categories (used to indicate room booking requirements)
- **Room Availability**: Time-based availability status for a room including free/busy state, conflicting bookings, and working hours
- **Office Location**: Physical office building where user is working, determines which meeting rooms to search (Edinburgh, Glasgow, Barcelona, London)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete room booking for a single meeting in under 30 seconds from calendar triage detection to confirmation
- **SC-002**: System correctly identifies office location from calendar events in 95% of cases without user input
- **SC-003**: System successfully books available rooms on first attempt in 90% of cases
- **SC-004**: System recommends appropriately sized rooms (within 20% of attendee count) in 95% of bookings
- **SC-005**: Users report time savings of 5+ minutes per day on manual room booking tasks
- **SC-006**: Zero double-bookings occur due to system-initiated room reservations
- **SC-007**: Room booking workflow handles all edge cases (no rooms, capacity issues, conflicts) with clear user guidance
- **SC-008**: 90% of users successfully complete their first room booking without assistance or confusion
