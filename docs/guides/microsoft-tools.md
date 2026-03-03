# Microsoft 365 Tools Reference

Cerebro exposes 16 Microsoft 365 MCP tools covering email, calendar, and meeting room management.

## Prerequisites

Microsoft OAuth must be completed via the dashboard at `https://localhost:3333/`. Required permissions:
- `Mail.ReadWrite` — email tools
- `Calendars.ReadWrite` — calendar tools
- `Place.Read.All` — room discovery tools

## Tool Index

- **Auth**: `microsoft.authenticate`, `microsoft.check-auth-status`
- **Email**: `microsoft.list-mail-folders`, `microsoft.list-emails`, `microsoft.read-email`, `microsoft.send-email`, `microsoft.move-email`
- **Calendar**: `microsoft.list-events`, `microsoft.get-event`, `microsoft.create-event`, `microsoft.update-event`, `microsoft.delete-event`, `microsoft.find-meeting-times`
- **Room Booking**: `microsoft.list-meeting-rooms`, `microsoft.check-room-availability`, `microsoft.book-meeting-room`, `microsoft.remove-meeting-room`

---

## Email Tools

### `list-mail-folders`

Lists all available mail folders in your mailbox.

**Parameters:** None

**Returns:**
```typescript
{
  folders: [
    { id: "...", name: "Inbox", totalItems: 42, unreadItems: 5 },
    { id: "...", name: "Personal", totalItems: 128, unreadItems: 0 },
  ],
  count: 15
}
```

Use this to discover the exact folder names and paths in your mailbox before using `list-emails` or `move-email`.

---

### `list-emails`

Lists recent emails from a specific folder.

**Parameters:**
- `folder` (optional, default: `"inbox"`): Folder to retrieve from
  - Standard folders: `inbox`, `spam`/`junk`, `sent`, `drafts`, `trash`/`deleted`
  - Custom folder names: Any folder in your mailbox (e.g., `"Archive"`, `"Projects"`)
  - Nested paths: Use `/` to access subfolders (e.g., `"Areas/Line Management/Personal"`)
  - Use `"all"` for cross-folder search
- `count` (optional, default: 10, max: 50): Number of emails to retrieve

**Examples:**
```typescript
// Default: 10 most recent inbox emails
{ count: 10 }

// Check spam folder
{ count: 15, folder: "spam" }

// Access custom folder
{ count: 10, folder: "Archive" }

// Access nested subfolder
{ count: 10, folder: "Areas/Line Management/Personal" }

// Search all folders
{ count: 50, folder: "all" }
```

**Standard folder mapping:**
- `inbox` → Inbox
- `spam`, `junk` → JunkEmail
- `sent` → SentItems
- `drafts` → Drafts
- `trash`, `deleted` → DeletedItems
- Custom names → resolved via folder hierarchy traversal

If a folder path doesn't exist, you'll get a helpful error showing available folders at each level.

---

### `move-email`

Moves an email to a different folder.

**Parameters:**
- `emailId` (required): Email message ID from `list-emails`
- `folderPath` (required): Target folder path (supports nested paths with `/`)
- `markAsRead` (optional, default: `true`): Mark as read after moving

**Examples:**
```typescript
// Move to Archive
{ emailId: "AAMkAGI2T...", folderPath: "Archive" }

// Move to nested folder
{ emailId: "AAMkAGI2T...", folderPath: "Projects/2026/Q1", markAsRead: true }

// Move without marking as read
{ emailId: "AAMkAGI2T...", folderPath: "sent", markAsRead: false }
```

**Returns:**
```typescript
{
  success: true,
  emailId: "AAMkAGI2T...",
  subject: "Meeting notes from Q1 review",
  fromFolder: "Inbox",
  toFolder: "Projects/2026/Q1",
  markedAsRead: true,
  wasIdempotent: false   // true if email was already in target folder
}
```

**Error codes:** `EMAIL_NOT_FOUND`, `FOLDER_NOT_FOUND`, `PERMISSION_DENIED`, `NETWORK_ERROR`, `INVALID_INPUT`

---

## Room Booking Tools

**Note:** Room discovery requires the `Place.Read.All` permission, which is automatically requested during OAuth. Some tenants require admin consent for this permission.

### `list-meeting-rooms`

Searches for meeting rooms by location, capacity, and amenities.

**Parameters:**
- `building` (optional): Filter by office location (e.g., `"Edinburgh"`, `"Glasgow"`, `"Barcelona"`, `"London"`)
- `minCapacity` (optional): Minimum room capacity — system applies a 20% buffer automatically
- `floorNumber` (optional): Filter by specific floor number
- `requiresVideo` (optional): Filter to rooms with video conferencing equipment
- `requiresAudio` (optional): Filter to rooms with audio equipment
- `wheelchairAccessible` (optional): Filter to accessible rooms

**Example:**
```typescript
// Find Edinburgh rooms for 6+ people with video
{
  building: "Edinburgh",
  minCapacity: 6,
  requiresVideo: true
}
```

---

### `check-room-availability`

Checks availability for one or more rooms during a time period.

**Parameters:**
- `roomEmails` (required): Array of room email addresses (from `list-meeting-rooms`)
- `startDateTime` (required): Meeting start time (ISO 8601)
- `endDateTime` (required): Meeting end time (ISO 8601)
- `timeZone` (optional, default: `"UTC"`): IANA timezone

**Example:**
```typescript
{
  roomEmails: ["edi-l2-barajas@company.com"],
  startDateTime: "2026-02-05T14:00:00Z",
  endDateTime: "2026-02-05T15:00:00Z"
}
```

---

### `book-meeting-room`

Adds a room to an existing calendar event.

**Parameters:**
- `eventId` (required): Calendar event ID (from `list-events`)
- `roomEmail` (required): Room email address to book
- `roomName` (optional): Room display name for the location field
- `updateLocation` (optional, default: `true`): Update event location field
- `verifyAvailability` (optional, default: `true`): Check availability before booking

**Example:**
```typescript
{
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l2-barajas@company.com",
  roomName: "EDI-L2 Barajas"
}
```

---

### `remove-meeting-room`

Removes a room booking from an event.

**Parameters:**
- `eventId` (required): Calendar event ID
- `roomEmail` (required): Room email address to remove
- `clearLocation` (optional, default: `true`): Clear the event location field

---

## Room Booking Workflows

### Manual workflow

```typescript
// 1. Search for suitable rooms
const rooms = await listMeetingRooms({
  building: "Edinburgh",
  floorNumber: 2,
  minCapacity: 10,
  requiresVideo: true
});

// 2. Check availability for top candidates
const availability = await checkRoomAvailability({
  roomEmails: rooms.slice(0, 5).map(r => r.emailAddress),
  startDateTime: "2026-02-05T14:00:00Z",
  endDateTime: "2026-02-05T15:00:00Z"
});

// 3. Book the first available room
const availableRoom = availability.find(a => a.isAvailable);
await bookMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: availableRoom.roomEmail,
  roomName: "EDI-L2 Barajas"
});
```

### Rebook workflow

```typescript
// Remove old room
await removeMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l2-old-room@company.com"
});

// Book new room
await bookMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l3-new-room@company.com",
  roomName: "EDI-L3 New Room"
});
```

### Automated room selection

The room booking system supports intelligent automation for calendar triage workflows:

**Office location detection** — Automatically detects user's office from calendar events:
- Searches for "Working from [Office]" calendar entries
- Checks event location fields for office names (Edinburgh, Glasgow, Barcelona, London)
- Falls back to user prompt on failure

**Category-based opt-in** — Only offers room booking for meetings with explicit indicators:
- Opt-in categories: `"Office"`, `"In-Person"`, `"Room Needed"`
- Skips room booking for virtual meetings

**Smart room selection:**
- **Capacity buffer**: 20% buffer rounded up (5 attendees → 6 capacity minimum)
- **Smallest fit**: Prefers smallest available room that fits the attendee count
- **Video priority**: Prefers video-equipped rooms when remote attendees are present
- **Availability check**: Verifies room is free, suggests alternatives on conflict

**Example:**
```typescript
// 1. Detect office from today's calendar
const events = await listEvents({ startDate: "2026-02-05", endDate: "2026-02-05" });
const office = detectOfficeLocation(events); // "Edinburgh"

// 2. Find meetings needing rooms (categories: ["Office"])
const meeting = events.find(e => needsRoomBooking(e.categories));

// 3. Search with capacity buffer (5 attendees → minCapacity 6)
const rooms = await listMeetingRooms({
  building: office,
  minCapacity: Math.ceil(meeting.attendees.length * 1.2),
  requiresVideo: meeting.onlineMeeting ? true : false
});

// 4. Check availability and book best room
const availability = await checkRoomAvailability({
  roomEmails: rooms.map(r => r.emailAddress),
  startDateTime: meeting.start.dateTime,
  endDateTime: meeting.end.dateTime
});

const bestRoom = selectBestRoom(
  rooms.filter(r => availability[r.emailAddress].isAvailable),
  meeting.attendees.length
);
await bookMeetingRoom({ eventId: meeting.id, roomEmail: bestRoom.emailAddress });
```

---

## Related Docs

- [docs/research/microsoft-graph-places-api.md](../research/microsoft-graph-places-api.md) — Graph API research for room booking
- [docs/research/meeting-response-api.md](../research/meeting-response-api.md) — Graph API research for event responses
