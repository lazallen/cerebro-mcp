# Quickstart: Meeting Room Booking

**Feature**: 016-meeting-room-booking
**Date**: 2026-02-05

## Overview

This guide shows how to use the meeting room booking tools to discover, check availability, book, and remove meeting rooms via Microsoft Graph API.

## Prerequisites

1. **Authentication**: Microsoft account authenticated with Cerebro MCP
2. **Permissions**: `Place.Read.All` and `Calendars.ReadWrite` permissions granted
3. **Office Location**: Working from a supported office (Edinburgh, Glasgow, Barcelona, London)
4. **Category Setup**: Calendar events categorized with "Office", "In-Person", or "Room Needed"

## Quick Start: Book a Room for Today's Meeting

### Step 1: Find Available Rooms

Search for rooms in your office with sufficient capacity:

```typescript
// Example: Find rooms in Edinburgh for 5 people (system applies 20% buffer → 6 capacity minimum)
const rooms = await mcp.call('microsoft_list-meeting-rooms', {
  building: 'Edinburgh',
  minCapacity: 6,
  requiresVideo: true,  // Optional: filter for video equipment
});

// Response:
{
  rooms: [
    {
      id: 'room-guid-1',
      emailAddress: 'edi-l2-barajas@skyscanner.net',
      displayName: 'EDI-L2 Barajas',
      capacity: 6,
      building: 'Edinburgh',
      floorNumber: 2,
      videoDeviceName: 'Teams Rooms',
      isWheelchairAccessible: false
    },
    {
      id: 'room-guid-2',
      emailAddress: 'edi-l2-north-coast-500@skyscanner.net',
      displayName: 'EDI-L2 North Coast 500',
      capacity: 8,
      building: 'Edinburgh',
      floorNumber: 2,
      videoDeviceName: 'Teams Rooms',
      isWheelchairAccessible: true
    }
  ],
  count: 2
}
```

### Step 2: Check Room Availability

Verify the room is free during your meeting time:

```typescript
const availability = await mcp.call('microsoft_check-room-availability', {
  roomEmails: [
    'edi-l2-barajas@skyscanner.net',
    'edi-l2-north-coast-500@skyscanner.net'
  ],
  startDateTime: '2026-02-05T14:00:00Z',
  endDateTime: '2026-02-05T15:00:00Z',
});

// Response:
{
  availability: [
    {
      roomEmail: 'edi-l2-barajas@skyscanner.net',
      roomName: 'EDI-L2 Barajas',
      isAvailable: true,
      availabilityView: '0000',  // All time slots free
      conflicts: []
    },
    {
      roomEmail: 'edi-l2-north-coast-500@skyscanner.net',
      roomName: 'EDI-L2 North Coast 500',
      isAvailable: false,
      availabilityView: '0220',  // Some time slots busy
      conflicts: [
        {
          start: '2026-02-05T14:30:00Z',
          end: '2026-02-05T15:30:00Z',
          status: 'busy'
        }
      ]
    }
  ]
}
```

### Step 3: Book the Available Room

Add the room to your existing calendar event:

```typescript
const result = await mcp.call('microsoft_book-meeting-room', {
  eventId: 'AAMkAGI2T...',  // Your calendar event ID
  roomEmail: 'edi-l2-barajas@skyscanner.net',
  roomName: 'EDI-L2 Barajas',  // Optional: used for location field
});

// Response:
{
  success: true,
  message: 'Room booked successfully: EDI-L2 Barajas',
  eventId: 'AAMkAGI2T...',
  roomBooked: 'edi-l2-barajas@skyscanner.net',
  eventWebLink: 'https://outlook.office.com/calendar/item/...'
}
```

Done! The room is now booked and will appear in your calendar event.

## Use Cases

### Use Case 1: Book Room for Existing Meeting

**Scenario**: You have a meeting today and need to book a room.

```bash
# 1. Get your meeting ID
eventId=$(claude call microsoft_list-events startDate=2026-02-05 | jq -r '.events[0].id')

# 2. Find available rooms
claude call microsoft_list-meeting-rooms building=Edinburgh minCapacity=8

# 3. Check availability
claude call microsoft_check-room-availability \
  roomEmails='["edi-l2-barajas@skyscanner.net"]' \
  startDateTime='2026-02-05T14:00:00Z' \
  endDateTime='2026-02-05T15:00:00Z'

# 4. Book the room
claude call microsoft_book-meeting-room \
  eventId=$eventId \
  roomEmail='edi-l2-barajas@skyscanner.net'
```

### Use Case 2: Change Room (Remove Old, Book New)

**Scenario**: You need a larger room for more attendees.

```bash
# 1. Remove current room
claude call microsoft_remove-meeting-room \
  eventId='AAMkAGI2T...' \
  roomEmail='edi-l2-barajas@skyscanner.net'

# 2. Find larger room
claude call microsoft_list-meeting-rooms \
  building=Edinburgh \
  minCapacity=12

# 3. Book new room
claude call microsoft_book-meeting-room \
  eventId='AAMkAGI2T...' \
  roomEmail='edi-l3-loch-lomond@skyscanner.net'
```

### Use Case 3: Meeting Became Virtual - Remove Room

**Scenario**: Meeting changed to virtual-only, free up the room.

```bash
# Remove room and clear location field
claude call microsoft_remove-meeting-room \
  eventId='AAMkAGI2T...' \
  roomEmail='edi-l2-barajas@skyscanner.net' \
  clearLocation=true
```

### Use Case 4: Find Room with Specific Amenities

**Scenario**: Need a wheelchair accessible room with video equipment on a specific floor.

```bash
# Search with multiple filters
claude call microsoft_list-meeting-rooms \
  building=Edinburgh \
  floorNumber=2 \
  minCapacity=8 \
  requiresVideo=true \
  wheelchairAccessible=true
```

## Calendar Triage Integration

### Automatic Room Booking During Triage

When you run `/calendar-triage`, the system automatically:

1. **Detects office location** from calendar events (e.g., "Working from Edinburgh")
2. **Identifies meetings needing rooms** (those categorized as "Office", "In-Person", or "Room Needed")
3. **Calculates required capacity** with 20% buffer (5 attendees → 6 capacity minimum)
4. **Finds available rooms** matching your office and capacity
5. **Presents recommendations** with capacity, amenities, availability
6. **Books room on confirmation** after you approve the suggestion

**Example Triage Output**:

```
Calendar Triage for Wednesday, February 5, 2026

Detecting office location...
→ Found "Working from Edinburgh" event
→ Office location: Edinburgh

Analyzing calendar...
Found 1 issue:

Issue 1: Missing Meeting Room
→ Meeting: "Team Sync" (14:00-15:00)
→ Attendees: 4 people (requires 5+ capacity room with buffer)
→ Category: "Office" (room booking enabled)
→ Suggested action: Book room in Edinburgh office

Resolving Issue 1...

Searching for available rooms in Edinburgh...
→ Found 3 rooms with capacity 5+

Checking availability for 14:00-15:00...
→ EDI-L2 Barajas (6 people, video-enabled) - Available ✓
→ EDI-L2 North Coast 500 (8 people, video-enabled) - Available ✓
→ EDI-L3 Loch Lomond (12 people) - Busy ✗

Recommended room: EDI-L2 Barajas (capacity: 6, Teams Rooms)

Book this room for "Team Sync"? (y/n): y

Booking room...
✅ Room booked: EDI-L2 Barajas
✅ Calendar updated with room location
```

### Setting Up Calendar Categories

To enable automatic room booking, add categories to your calendar events:

**Outlook Desktop**:
1. Open calendar event
2. Click "Categorize" → "All Categories"
3. Add category: "Office" or "In-Person" or "Room Needed"
4. Save event

**Outlook Web**:
1. Open calendar event
2. Click "..." menu → "Categorize"
3. Select or create category: "Office", "In-Person", or "Room Needed"
4. Save event

**Programmatically**:
```typescript
await mcp.call('microsoft_update-event', {
  eventId: 'AAMkAGI2T...',
  categories: ['Office']  // Enables room booking for this event
});
```

## Error Handling

### Permission Errors

**Error**: "Missing required permission: Place.Read.All"

**Solution**:
```bash
# Re-authenticate with updated permissions
claude call microsoft_authenticate

# Follow the browser link to grant Place.Read.All permission
# Then check authentication status
claude call microsoft_check-auth-status
```

### Room Conflicts

**Error**: "Room is not available during the meeting time"

**Solution 1 - Find Alternative**:
```bash
# Find other available rooms
claude call microsoft_list-meeting-rooms building=Edinburgh minCapacity=8

# Check their availability
claude call microsoft_check-room-availability \
  roomEmails='["room2@domain.com", "room3@domain.com"]' \
  startDateTime='2026-02-05T14:00:00Z' \
  endDateTime='2026-02-05T15:00:00Z'
```

**Solution 2 - Change Meeting Time**:
```bash
# Update meeting time to avoid conflict
claude call microsoft_update-event \
  eventId='AAMkAGI2T...' \
  startDateTime='2026-02-05T15:00:00Z' \
  endDateTime='2026-02-05T16:00:00Z'

# Try booking again
claude call microsoft_book-meeting-room \
  eventId='AAMkAGI2T...' \
  roomEmail='edi-l2-barajas@skyscanner.net'
```

### Duplicate Booking

**Error**: "Room is already booked for this meeting"

**Solution**: Room is already in the event's attendees. No action needed, or remove and re-book if you want to change rooms.

## Best Practices

### 1. Always Check Availability First

```typescript
// ✓ Good: Check before booking
const availability = await checkAvailability(roomEmail, start, end);
if (availability.isAvailable) {
  await bookRoom(eventId, roomEmail);
}

// ✗ Bad: Blind booking (may fail with conflict error)
await bookRoom(eventId, roomEmail);  // Risky!
```

### 2. Apply Capacity Buffer

```typescript
// ✓ Good: Let the system apply 20% buffer
await listRooms({ minCapacity: attendeeCount });  // System rounds up

// ✗ Bad: Manual capacity calculation (inconsistent)
await listRooms({ minCapacity: attendeeCount + 2 });  // Arbitrary buffer
```

### 3. Use Category-Based Detection

```typescript
// ✓ Good: Explicit categorization
await updateEvent({ categories: ['Office'] });  // Clear intent

// ✗ Bad: Assuming all meetings need rooms
// System only suggests rooms for categorized meetings (opt-in)
```

### 4. Batch Availability Checks

```typescript
// ✓ Good: Check multiple rooms in one request (up to 20)
await checkAvailability({
  roomEmails: ['room1@domain.com', 'room2@domain.com', 'room3@domain.com'],
  start, end
});

// ✗ Bad: Individual checks (3 API calls, slower)
await checkAvailability({ roomEmails: ['room1@domain.com'], start, end });
await checkAvailability({ roomEmails: ['room2@domain.com'], start, end });
await checkAvailability({ roomEmails: ['room3@domain.com'], start, end });
```

### 5. Handle Errors Gracefully

```typescript
try {
  await bookRoom(eventId, roomEmail);
} catch (error) {
  if (error.message.includes('ROOM_BUSY')) {
    // Find alternative room
    const alternatives = await findAvailableRooms(criteria, start, end);
    console.log('Room busy. Alternatives:', alternatives);
  } else if (error.message.includes('PERMISSION_DENIED')) {
    // Guide user to re-authenticate
    console.log('Please re-authenticate with Place.Read.All permission');
  } else {
    // Log unexpected errors
    console.error('Booking failed:', error);
  }
}
```

## Troubleshooting

### Issue: No Rooms Returned

**Check**:
1. Building name matches exactly (case-sensitive): "Edinburgh" not "edinburgh"
2. Office has meeting rooms registered in Microsoft Graph
3. Place.Read.All permission granted

**Debug**:
```bash
# List all rooms without filters
claude call microsoft_list-meeting-rooms

# Check permission status
claude call microsoft_check-auth-status
```

### Issue: Room Booking Fails with "EVENT_NOT_FOUND"

**Check**:
1. Event ID is correct (copied from list-events)
2. Event exists in your calendar
3. You have permission to modify the event (organizer or delegate)

**Debug**:
```bash
# Verify event exists
claude call microsoft_get-event eventId='AAMkAGI2T...'
```

### Issue: Calendar Triage Doesn't Suggest Rooms

**Check**:
1. Office location detected (look for "Working from [Office]" event)
2. Meeting has required category ("Office", "In-Person", or "Room Needed")
3. Meeting has 2+ attendees (FR-020)
4. Meeting is during office hours 08:00-18:00 (FR-021)

**Debug**:
```bash
# Check meeting categories
claude call microsoft_list-events | jq '.events[] | {subject, categories}'

# Manually add category
claude call microsoft_update-event \
  eventId='AAMkAGI2T...' \
  categories='["Office"]'
```

## API Reference

See contract files for complete API documentation:
- [list-meeting-rooms.json](./contracts/list-meeting-rooms.json)
- [check-room-availability.json](./contracts/check-room-availability.json)
- [book-meeting-room.json](./contracts/book-meeting-room.json)
- [remove-meeting-room.json](./contracts/remove-meeting-room.json)

## Next Steps

- **Implementation**: Proceed to `/speckit.tasks` to generate implementation tasks
- **Testing**: Write unit tests for room search, availability checking, booking logic
- **Documentation**: Update main README with room booking examples
