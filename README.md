# Cerebro MCP TypeScript

TypeScript MCP server providing Claude with access to Microsoft 365, Slack, LocalFoundry LLM, and extensible service integrations via a unified HTTP server.

## Features

- **Dual-Port Architecture** - OAuth (HTTPS :3333) + MCP (HTTP :3334) for security and compatibility
- **Multi-Service** - Microsoft 365 (email, calendar), Slack (channels, messages, reminders), and LocalFoundry (local LLM text processing)
- **Type-Safe** - TypeScript strict mode, no `any` types
- **OAuth 2.0** - Automatic token refresh and web-based authentication dashboard
- **Streamable HTTP** - Modern MCP transport compatible with Claude Code
- **Local AI** - LocalFoundry integration for text summarization, clarification, and extraction
- **Production-Ready** - Structured logging, comprehensive tests, follows Skyscanner standards

## Quick Start

```bash
# Install
npm install

# Generate SSL certificates (required for OAuth)
mkcert -install
mkcert localhost 127.0.0.1 ::1

# Configure
cp .env.example .env
# Edit .env with your Microsoft/Slack credentials

# Run
npm start
```

Server starts on dual ports:
- **Port 3333 (HTTPS)**: OAuth Dashboard at `https://localhost:3333/` - Authenticate services
- **Port 3334 (HTTP)**: MCP Endpoint at `http://localhost:3334/mcp` - Claude Code connection

## Claude Code Setup

**Important:** Claude Code CLI uses `claude mcp add` commands (not JSON config files).

### Quick Setup

```bash
# 1. Start the server
npm start

# 2. Add Cerebro to Claude Code (using HTTP endpoint)
claude mcp add --transport http cerebro http://localhost:3334/mcp

# 3. Verify connection
claude mcp list
# Should show: cerebro: http://localhost:3334/mcp (HTTP) - ✓ Connected
```

### Dual-Port Architecture

Cerebro runs two HTTP servers for optimal security and compatibility:

- **Port 3333 (HTTPS)**: OAuth authentication dashboard - secure, requires SSL
- **Port 3334 (HTTP)**: MCP protocol endpoint - no SSL issues with Claude Code

This design allows OAuth to remain secure with HTTPS while providing HTTP access for MCP clients that have SSL certificate trust issues.

### Full Setup Workflow

1. **Start server**: `npm start`
2. **Add MCP server**: `claude mcp add --transport http cerebro http://localhost:3334/mcp`
3. **Verify connection**: `claude mcp list` - should show ✓ Connected
4. **Authenticate services**: Visit `https://localhost:3333/` and click "Authenticate"
5. **Use tools**: All authenticated services are now available in Claude Code

### Configuration Options

You can customize ports via environment variables in `.env`:

```bash
AUTH_SERVER_PORT=3333      # OAuth + Dashboard (HTTPS)
MCP_SERVER_PORT=3334       # MCP endpoint (HTTP)
```

📚 **Detailed setup guide**: [docs/guides/claude-code-setup.md](docs/guides/claude-code-setup.md)

## Connection Management & Troubleshooting

### Quick Server Management

Use the included startup script for easy server management:

```bash
./start-mcp.sh start     # Start the server
./start-mcp.sh stop      # Stop the server
./start-mcp.sh restart   # Restart the server
./start-mcp.sh status    # Check server status and health
./start-mcp.sh health    # Test health endpoint
./start-mcp.sh logs      # View server logs (real-time)
```

### Health Checks

The server provides health check endpoints for monitoring:

```bash
# Simple health check
curl http://localhost:3334/health

# Detailed status (shows all services and authentication state)
curl http://localhost:3334/health/status | jq '.'
```

### Common Connection Issues

**Issue: "Unable to connect to MCP server"**

```bash
# Check if server is running
./start-mcp.sh status

# If not running, start it
./start-mcp.sh start

# Check ports are listening
ss -tlnp | grep -E ":(3333|3334)"
```

**Issue: Connection drops frequently**

The server now includes:
- Keep-alive connections (65s timeout)
- Better connection management
- Automatic session tracking

If issues persist, check the logs:
```bash
./start-mcp.sh logs
```

**Issue: Server fails to start**

Common causes:
1. **Port already in use**: Stop existing server first
   ```bash
   ./start-mcp.sh stop
   ./start-mcp.sh start
   ```

2. **Missing dependencies**: Reinstall
   ```bash
   npm install
   npm run build
   ```

3. **SSL certificate issues**: Regenerate certificates
   ```bash
   mkcert -install
   mkcert localhost 127.0.0.1 ::1
   ```

📚 **Complete troubleshooting guide**: [MCP_CONNECTION_GUIDE.md](MCP_CONNECTION_GUIDE.md)

### Reliability Improvements (v0.3.0+)

This version includes several connection reliability improvements:

- **Health Check Endpoints**: `/health` and `/health/status` for monitoring
- **Keep-Alive Connections**: 65-second keep-alive with 2-minute socket timeouts
- **Connection Tracking**: Better management of active connections
- **Enhanced Logging**: Detailed connection logs with correlation IDs
- **Graceful Shutdown**: Proper cleanup of connections and resources
- **Startup Script**: `start-mcp.sh` for easy server management

## Configuration

Key environment variables (see [.env.example](.env.example) for full list):

```bash
# Server (required)
SERVER_VERSION=0.3.0
AUTH_SERVER_PORT=3333  # OAuth + Dashboard (HTTPS) - OAuth apps registered on this port
MCP_SERVER_PORT=3334   # MCP endpoint (HTTP) - for Claude Code compatibility

# Microsoft 365 (optional)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=common

# Slack (optional)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_APP_TOKEN=xapp-your-app-level-token  # For Socket Mode (message shortcuts)

# LocalFoundry (optional) - Local LLM text processing
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
LOCALFOUNDRY_TIMEOUT=60000

# Testing (optional)
USE_TEST_MODE=false
```

**OAuth Setup:**
- Microsoft: Redirect URI = `https://localhost:3333/auth/microsoft/callback`
- Slack: Redirect URI = `https://localhost:3333/auth/slack/callback`

**Slack Message Shortcuts (Socket Mode):**
To enable message shortcuts (flag messages for Claude triage):
1. In your Slack app, enable **Socket Mode** under Settings
2. Generate an **App Level Token** with `connections:write` scope
3. Copy the token (starts with `xapp-`) to `SLACK_APP_TOKEN` in `.env`
4. Enable **Interactivity & Shortcuts** in your app
5. Create a **Message Shortcut** with your desired callback_id

Socket Mode connects via WebSocket - no public URL or ngrok required.

**Ports:**
- Port 3333: OAuth authentication (HTTPS) - **do not change** (OAuth apps registered on this port)
- Port 3334: MCP endpoint (HTTP) - configurable via `MCP_SERVER_PORT`

## Development

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
npm run lint:fix

# Run with pretty logs
npm run start:pretty
```

## Available Tools

**Microsoft 365** (16 tools):
- **Auth**: authenticate, check-auth-status
- **Email**: list-emails (with folder filtering), read-email, send-email, move-email
- **Calendar**: list-events, get-event, create-event, update-event, delete-event, find-meeting-times
- **Room Booking**: list-meeting-rooms, check-room-availability, book-meeting-room, remove-meeting-room

### Microsoft 365 Email Tools

**`list-mail-folders`** - List all available mail folders in your mailbox
- No parameters required
- Returns all folder names, IDs, and item counts
- Use this to discover the exact folder names available in your mailbox
- Helpful for finding the correct folder name to use with `list-emails`

Example:
```typescript
// List all available folders
{}
```

Returns:
```typescript
{
  folders: [
    { id: "...", name: "Inbox", totalItems: 42, unreadItems: 5 },
    { id: "...", name: "Personal", totalItems: 128, unreadItems: 0 },
    { id: "...", name: "Archive", totalItems: 1523, unreadItems: 0 },
    // ... more folders
  ],
  count: 15
}
```

**`list-emails`** - List recent emails from a specific folder
- **folder** (optional, default: "inbox"): Folder to retrieve emails from
  - Common folders: inbox, spam, junk, sent, drafts, trash, deleted
  - Custom folder names: Any folder name in your mailbox (e.g., "Archive", "Projects")
  - **Nested folder paths**: Use "/" to access subfolders (e.g., "Areas/Line Management/Personal")
  - Use "all" for cross-folder search (original behavior)
  - Case-insensitive for standard folders
- **count** (optional, default: 10, max: 50): Number of emails to retrieve

Examples:
```typescript
// Default: List 10 most recent inbox emails (spam automatically excluded)
{ count: 10 }

// Explicit inbox filtering
{ count: 20, folder: "inbox" }

// Check spam folder
{ count: 15, folder: "spam" }

// Review sent emails
{ count: 25, folder: "sent" }

// Access custom folders at root level
{ count: 10, folder: "Archive" }
{ count: 20, folder: "Projects" }

// Access nested subfolders using path notation
{ count: 10, folder: "Areas/Line Management/Personal" }
{ count: 15, folder: "Projects/2024/Q1" }
{ count: 20, folder: "Clients/Acme Corp/Invoices" }

// Search all folders (backward compatibility)
{ count: 50, folder: "all" }
```

**Standard Folder Mapping**:
- `inbox` → inbox (default)
- `spam`, `junk` → junkemail (Microsoft Graph well-known name)
- `sent` → sentitems
- `drafts` → drafts
- `trash`, `deleted` → deleteditems
- Custom folder names → resolved via folder hierarchy traversal
- Nested paths → resolved by traversing parent/child relationships

**Note**: If a folder path doesn't exist, you'll get a helpful error message showing available folders at each level. Use `list-mail-folders` to discover the exact folder structure in your mailbox.

**`move-email`** - Move an email to a different folder in Outlook
- **emailId** (required): Email message ID from `list-emails` tool
- **folderPath** (required): Target folder path (supports nested paths with "/" delimiter)
  - Standard folders: inbox, sent, drafts, trash, archive
  - Custom folders: Any folder name in your mailbox
  - Nested paths: Use "/" to specify subfolders (e.g., "Projects/2026/Q1")
- **markAsRead** (optional, default: true): Whether to mark the email as read after moving

Examples:
```typescript
// Move email to Archive folder and mark as read (default)
{
  emailId: "AAMkAGI2T...",
  folderPath: "Archive"
}

// Move to nested folder path
{
  emailId: "AAMkAGI2T...",
  folderPath: "Projects/2026/Q1",
  markAsRead: true
}

// Move to standard folder without marking as read
{
  emailId: "AAMkAGI2T...",
  folderPath: "sent",
  markAsRead: false
}

// Move to deeply nested custom folder
{
  emailId: "AAMkAGI2T...",
  folderPath: "Clients/Acme Corp/Invoices"
}
```

Returns on success:
```typescript
{
  success: true,
  emailId: "AAMkAGI2T...",
  subject: "Meeting notes from Q1 review",
  fromFolder: "Inbox",
  toFolder: "Projects/2026/Q1",
  markedAsRead: true,
  wasIdempotent: false
}
```

**Idempotent Behavior**: Moving an email to its current folder succeeds without error. The response includes `wasIdempotent: true` to indicate the email was already in the target folder.

```typescript
// Email already in Projects/2026/Q1 folder
{
  emailId: "AAMkAGI2T...",
  folderPath: "Projects/2026/Q1"
}
// Returns success with wasIdempotent: true
```

**Error Handling**: Clear error messages with context for common failures:
- **EMAIL_NOT_FOUND**: Email ID doesn't exist or was deleted
- **FOLDER_NOT_FOUND**: Target folder path doesn't exist (includes available folders at each level)
- **PERMISSION_DENIED**: Insufficient permissions to move email or access folder
- **NETWORK_ERROR**: Connection issues with Microsoft Graph API
- **INVALID_INPUT**: Missing required parameters or invalid folder path format

**Note**: Use `list-mail-folders` to discover available folders before moving. The same folder resolution logic from `list-emails` applies to nested paths.

### Microsoft 365 Room Booking Tools

**Prerequisites**: Requires `Place.Read.All` permission for room discovery. Automatically requested during OAuth authentication.

**`list-meeting-rooms`** - Search for meeting rooms by office, capacity, and amenities
- **building** (optional): Filter by office location (e.g., "Edinburgh", "Glasgow", "Barcelona", "London")
- **minCapacity** (optional): Minimum room capacity (system applies 20% buffer automatically)
- **floorNumber** (optional): Filter by specific floor number
- **requiresVideo** (optional): Filter to rooms with video conferencing equipment
- **requiresAudio** (optional): Filter to rooms with audio equipment
- **wheelchairAccessible** (optional): Filter to ADA-compliant rooms

Example:
```typescript
// Find rooms in Edinburgh with capacity for 6+ people
{
  building: "Edinburgh",
  minCapacity: 6,
  requiresVideo: true
}
```

**`check-room-availability`** - Check availability for one or more rooms during a time period
- **roomEmails** (required): Array of room email addresses (from list-meeting-rooms)
- **startDateTime** (required): Meeting start time (ISO 8601 format)
- **endDateTime** (required): Meeting end time (ISO 8601 format)
- **timeZone** (optional, default: "UTC"): IANA timezone

Example:
```typescript
{
  roomEmails: ["edi-l2-barajas@company.com"],
  startDateTime: "2026-02-05T14:00:00Z",
  endDateTime: "2026-02-05T15:00:00Z"
}
```

**`book-meeting-room`** - Add a room to an existing calendar event
- **eventId** (required): Calendar event ID (from list-events)
- **roomEmail** (required): Room email address to book
- **roomName** (optional): Room display name (for location field)
- **updateLocation** (optional, default: true): Update event location field
- **verifyAvailability** (optional, default: true): Check availability before booking

Example:
```typescript
{
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l2-barajas@company.com",
  roomName: "EDI-L2 Barajas"
}
```

**`remove-meeting-room`** - Remove a room booking from an event
- **eventId** (required): Calendar event ID
- **roomEmail** (required): Room email address to remove
- **clearLocation** (optional, default: true): Clear event location field

#### Manual Room Booking Workflow

For ad-hoc room search and booking outside automated workflows:

**Example: Find and book a specific room**
```typescript
// 1. Search for rooms by specific criteria
const rooms = await listMeetingRooms({
  building: "Edinburgh",
  floorNumber: 2,
  minCapacity: 10,
  requiresVideo: true,
  wheelchairAccessible: true
});
// Returns: [{ id, emailAddress, displayName, capacity, videoDeviceName, ... }]

// 2. Check availability for top candidates
const availability = await checkRoomAvailability({
  roomEmails: rooms.slice(0, 5).map(r => r.emailAddress),
  startDateTime: "2026-02-05T14:00:00Z",
  endDateTime: "2026-02-05T15:00:00Z"
});
// Returns: [{ roomEmail, isAvailable, conflicts: [...] }]

// 3. Book first available room
const availableRoom = availability.find(a => a.isAvailable);
await bookMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: availableRoom.roomEmail,
  roomName: "EDI-L2 Barajas"
});
// Returns: { success: true, message: "Room booked successfully: EDI-L2 Barajas" }
```

**Example: Search by amenities**
```typescript
// Find accessible rooms with audio/video equipment
const accessibleRooms = await listMeetingRooms({
  building: "Glasgow",
  requiresVideo: true,
  requiresAudio: true,
  wheelchairAccessible: true
});

// Find large conference rooms
const largeRooms = await listMeetingRooms({
  building: "Barcelona",
  minCapacity: 20  // System applies 20% buffer: 20 → 24 capacity minimum
});
```

**Example: Remove and rebook rooms**
```typescript
// Meeting becomes virtual - remove room
await removeMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l2-barajas@company.com",
  clearLocation: true  // Clears location field
});
// Returns: { success: true, message: "Room removed successfully: edi-l2-barajas@company.com" }
// Note: Virtual meeting link (Teams/Zoom) is preserved

// Rebook different room (plans changed)
await removeMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l2-old-room@company.com",
  clearLocation: false  // Preserve custom location text
});

await bookMeetingRoom({
  eventId: "AAMkAGI2T...",
  roomEmail: "edi-l3-new-room@company.com",
  roomName: "EDI-L3 New Room"
});
```

#### Automatic Room Booking Workflow

The room booking system includes intelligent automation features for calendar triage workflows:

**Office Location Detection** - Automatically detects user's office location from calendar events:
- Searches for "Working from [Office]" calendar events
- Checks event location fields for office names (Edinburgh, Glasgow, Barcelona, London)
- Falls back to user prompt when auto-detection fails

**Category-Based Room Detection** - Only offers room booking for meetings with explicit indicators:
- **Opt-in categories**: "Office", "In-Person", "Room Needed"
- Skips room booking by default for meetings without these categories
- Prevents unnecessary room booking prompts for virtual meetings

**Smart Room Selection** - Automatically selects optimal room using:
- **Capacity buffer**: 20% buffer rounded up (e.g., 5 attendees → 6 capacity min, 8 attendees → 10 capacity min)
- **Smallest fit**: Prioritizes smallest available room that accommodates attendee count
- **Video priority**: Prefers rooms with video equipment for meetings with remote attendees
- **Availability check**: Verifies room is free before booking, suggests alternatives when conflicts detected

**Example Automatic Workflow**:
```typescript
// 1. Detect office from today's calendar
const events = await listEvents({ startDate: "2026-02-05", endDate: "2026-02-05" });
const office = detectOfficeLocation(events); // "Edinburgh"

// 2. Find meetings needing rooms (categories: ["Office"])
const meeting = events.find(e => needsRoomBooking(e.categories));
const attendeeCount = meeting.attendees.length; // 5 people

// 3. Search for suitable rooms
const rooms = await listMeetingRooms({
  building: office,
  minCapacity: 6, // 5 * 1.2 = 6
  requiresVideo: meeting.onlineMeeting ? true : false
});

// 4. Check availability
const availability = await checkRoomAvailability({
  roomEmails: rooms.map(r => r.emailAddress),
  startDateTime: meeting.start.dateTime,
  endDateTime: meeting.end.dateTime
});

// 5. Select and book best room
const availableRooms = rooms.filter(r => availability[r.emailAddress].isAvailable);
const bestRoom = selectBestRoom(availableRooms, attendeeCount, hasRemoteAttendees);
await bookMeetingRoom({
  eventId: meeting.id,
  roomEmail: bestRoom.emailAddress,
  roomName: bestRoom.displayName
});
```

**Slack** (16 tools):
- **Auth**: authenticate, check-auth-status
- **Channels**: list-channels, get-channel-history
- **Groups**: list-groups, get-group-history
- **Threads**: get-thread-replies
- **Canvas**: read-canvas, search-canvases
- **User**: get-user-identity
- **Reminders**: list-reminders, create-reminder, complete-reminder
- **Message Actions**: list-message-actions, get-message-action, delete-message-action

**LocalFoundry** (3 tools) - Local LLM text processing:
- **summarize**: Summarize long text content concisely (up to 50K characters)
- **clarify**: Answer specific questions about provided text
- **extract**: Extract structured JSON data from unstructured text

## Project Structure

```
src/
├── auth-server/        # OAuth HTTP server
├── mcp-server/         # MCP protocol handler
├── services/           # Service integrations (Microsoft, Slack, LocalFoundry)
│   ├── microsoft/
│   ├── slack/
│   └── localfoundry/   # Local LLM text processing
├── common/            # Shared utilities (logging, config, base classes)
└── types/             # TypeScript interfaces
```

## Testing

**152 total tests** - 129 passing (85% pass rate)

```bash
npm test                    # Run all tests
npm test -- oauth-server    # Run specific tests
npm test:coverage           # Coverage report
```

Core modules: 100% pass rate (50 tests)
Service modules: 85% pass rate (102 tests)

## Architecture

- **Dual-Port Design**: Separate servers for OAuth (HTTPS :3333) and MCP (HTTP :3334)
- **Base Classes**: `BaseAPIClient`, `BaseTokenStorage` for service integrations
- **Service Registry**: Dynamic service registration and tool discovery
- **StreamableHTTP Transport**: Modern SSE-capable transport for MCP protocol
- **Token Management**: Automatic refresh with 5-minute buffer
- **Error Handling**: JSON-RPC error mapping with correlation IDs

### Server Architecture

```
Port 3333 (HTTPS) - OAuth Server
  ├─ GET  /                     → Dashboard
  ├─ GET  /auth/:service/login  → OAuth flows
  ├─ GET  /auth/:service/callback → OAuth callbacks
  └─ GET/POST /mcp              → MCP (backward compatibility)

Port 3334 (HTTP) - MCP Server
  └─ GET/POST /mcp              → MCP Protocol (primary)

Socket Mode (WebSocket) - Slack Events
  └─ wss://wss.slack.com        → Message shortcuts via Socket Mode
```

📚 **Detailed architecture docs**: [docs/architecture/http-transport.md](docs/architecture/http-transport.md)

## Heartbeat System (Scheduled Tasks)

The heartbeat system automates recurring tasks on configurable schedules using cron expressions. It includes an event bus for downstream processing and supports hot-reload configuration.

### Quick Setup

1. **Copy example config:**
```bash
cp heartbeat-config.example.json heartbeat-config.json
```

2. **Configure your tasks:**
Edit `heartbeat-config.json` to enable/disable tasks and adjust schedules (see Configuration section below).

3. **Ensure environment variables are set:**
```bash
# Already in .env.example
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# For email triage (required)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
```

4. **Start the server:**
```bash
npm start
```

The heartbeat service automatically starts with the MCP server and runs tasks according to their schedules.

### Configuration Format

`heartbeat-config.json` structure:

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "unique-task-id",
      "name": "Human-readable task name",
      "type": "email-triage",
      "schedule": "0 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false,
        "eventType": "email",
        "llmTimeout": 30000,
        "batchSize": 10
      }
    }
  ]
}
```

**Common Fields:**
- `id` (string, required): Unique identifier for the task (alphanumeric, hyphens, underscores)
- `name` (string, required): Human-readable task name
- `type` (string, required): Task type - currently `"email-triage"` (more types coming)
- `schedule` (string, required): Cron expression (5-part format)
- `enabled` (boolean, required): Whether task is active
- `config` (object, required): Task-specific configuration (see Task Types below)

### Cron Schedule Format

Standard 5-part cron expression: `minute hour day month dayOfWeek`

**Common Examples:**
- `"0 * * * *"` - Every hour at :00 (e.g., 1:00, 2:00, 3:00)
- `"*/15 * * * *"` - Every 15 minutes (e.g., 1:00, 1:15, 1:30, 1:45)
- `"0 9 * * *"` - Daily at 9:00 AM
- `"0 9 * * 1-5"` - Weekdays at 9:00 AM (Monday-Friday)
- `"0 8,12,16 * * *"` - Three times daily (8:00, 12:00, 16:00)
- `"0 0 * * 0"` - Weekly on Sunday at midnight

**Fields:**
- `minute` (0-59)
- `hour` (0-23)
- `day` (1-31)
- `month` (1-12)
- `dayOfWeek` (0-6, where 0 = Sunday)

**Tip:** Test expressions at [crontab.guru](https://crontab.guru/)

### Task Types

#### Email Triage (`email-triage`)

Automatically processes unread emails, uses LocalFoundry LLM to extract action items, and creates markdown event files.

**Config Options:**
```typescript
{
  "maxEmails": 50,           // Max emails to process per execution (default: 50)
  "markAsRead": false,       // Mark emails as read after processing (default: false)
  "eventType": "email",      // Event type prefix for filenames (default: "email")
  "filterFolder": "inbox",   // Optional: Filter to specific folder (e.g., "inbox/important")
  "llmTimeout": 30000,       // LLM request timeout in ms (default: 30000)
  "batchSize": 10            // Number of concurrent email processing (default: 10)
}
```

**Example Use Cases:**

*Hourly inbox triage:*
```json
{
  "id": "email-triage-hourly",
  "name": "Hourly Email Triage",
  "type": "email-triage",
  "schedule": "0 * * * *",
  "enabled": true,
  "config": {
    "maxEmails": 50,
    "markAsRead": false,
    "eventType": "email"
  }
}
```

*High-priority emails every 15 minutes:*
```json
{
  "id": "priority-triage",
  "name": "Priority Email Triage",
  "type": "email-triage",
  "schedule": "*/15 * * * *",
  "enabled": true,
  "config": {
    "maxEmails": 10,
    "markAsRead": true,
    "eventType": "email-priority",
    "filterFolder": "inbox/important",
    "llmTimeout": 5000,
    "batchSize": 5
  }
}
```

### Event Files

Email triage creates markdown event files in `${HEARTBEAT_ROOT_DIR}/events/`:

**Filename Format:** `YYYYMMDD-{event-type}-{unique-id}.md`
- Example: `20260217-email-0001.md`, `20260217-email-0002.md`
- Unique IDs are 4-character base36 (0-9, a-z), reset daily
- Supports 1,679,616 unique events per day per type

**File Structure:**
```markdown
---
type: email-triage
timestamp: 2026-02-17T14:30:15Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata
- **From**: sender@example.com
- **Subject**: Email subject
- **Received**: 2026-02-17T09:15:00Z

## Action Items
- [ ] **high** (deadline): Complete project proposal by EOD
- [ ] **medium** (question): Clarify budget allocation

## Email Body
> Original email content...

## Extracted Data (JSON)
\`\`\`json
{
  "action_items": [...],
  "questions": [...],
  "summary": "..."
}
\`\`\`
```

### Hot-Reload Configuration

The heartbeat system automatically detects changes to `heartbeat-config.json` and reloads:

1. **Edit config file** - Change schedules, enable/disable tasks, update settings
2. **Save file** - System detects change within ~1 second
3. **Automatic reload** - Tasks are rescheduled with new configuration

**What reloads:**
- ✅ Task schedules (cron expressions)
- ✅ Task enabled/disabled state
- ✅ Task configuration (maxEmails, batchSize, etc.)
- ✅ New tasks added to config
- ✅ Tasks removed from config

**What requires restart:**
- Environment variables (HEARTBEAT_ROOT_DIR, LOCALFOUNDRY_ENDPOINT)
- Server port changes

### Monitoring

**View event files:**
```bash
# List today's events
ls -lt data/events/ | head -20

# View specific event
cat data/events/20260217-email-0001.md

# Count events by type
ls data/events/*.md | cut -d'-' -f2 | sort | uniq -c
```

**Check logs:**
```bash
# Server logs include heartbeat operations
./start-mcp.sh logs

# Search for specific operations
grep "email_triage" logs/cerebro-*.log
```

**Execution metrics logged for each task:**
```json
{
  "level": "info",
  "operation": "task_completed",
  "task_id": "email-triage-hourly",
  "duration_ms": 42500,
  "status": "success",
  "processed_count": 23
}
```

### Troubleshooting

**Issue: Tasks not executing**

Check logs for errors:
```bash
./start-mcp.sh logs | grep -i "error\|heartbeat"
```

Common causes:
- Invalid cron expression (check syntax at crontab.guru)
- `enabled: false` in task config
- Missing dependencies (Microsoft auth, LocalFoundry endpoint)

**Issue: Email triage not finding action items**

Solutions:
1. Verify LocalFoundry is running: `curl http://localhost:8080/health`
2. Increase `llmTimeout` to 60000ms
3. Reduce `batchSize` to 5 for less concurrent load
4. Check LocalFoundry logs for model issues

**Issue: Tasks running concurrently**

This is expected behavior if the previous execution hasn't finished. Logs show:
```
"Task already running, skipping execution"
```

Solutions:
- Reduce `maxEmails` to speed up execution
- Increase `llmTimeout` if LLM is slow
- Adjust schedule frequency (e.g., every 2 hours instead of hourly)

**Issue: Missed executions after restart**

Expected behavior: Missed executions are skipped (not queued). System resumes at next scheduled time to prevent backlog accumulation.

### Performance Tuning

**Faster email triage:**
```json
{
  "maxEmails": 25,
  "batchSize": 15,
  "llmTimeout": 5000
}
```

**More thorough processing:**
```json
{
  "maxEmails": 100,
  "batchSize": 5,
  "llmTimeout": 60000
}
```

📚 **Complete guide:** [specs/017-task-heartbeat/quickstart.md](specs/017-task-heartbeat/quickstart.md)

## Policy Engine (Triage Pipeline)

The policy engine evaluates triage events against a YAML rule set and automatically classifies, routes, and actions them — creating tasks, filing receipts, queuing newsletters, and escalating uncertain items to human review.

### How It Works

1. **Ingestion tasks** (email-ingestion, journal-triage) write `TriageEvent` artifacts to `{rootDir}/system/triage/`
2. **policy-pipeline task** loads the policy YAML, evaluates each event, and writes `PolicyDecision` artifacts to `{rootDir}/system/decisions/`
3. **Actions** are executed per decision: tasks created, reading-pack entries appended, human queue items filed
4. **Multi-pass enrichment**: uncertain events are sent to the local LLM (phi-4-mini) or Claude for deeper analysis, then re-evaluated

### System Directory Layout

```
{rootDir}/system/
  triage/           ← TriageEvent files (pending, enriched)
  decisions/        ← PolicyDecision files per event
  human/            ← HumanQueueItem files awaiting user input
  runs/             ← Per-cycle run logs (summary + trace)
  artifacts/
    tasks/          ← Obsidian task notes (one per CREATE_TASK action)
    reading-packs/  ← Daily reading-pack notes (appended per cycle)
    drafts/         ← Draft replies awaiting approval
```

> **Note:** All directories are created automatically on first heartbeat run. Do not create them manually.

### Configuration

Add `email-ingestion` and `policy-pipeline` tasks to `heartbeat-config.json`:

```json
{
  "rootDir": "./data",
  "policyDir": "./policies",
  "tasks": [
    {
      "id": "email-ingestion-hourly",
      "name": "Hourly Email Ingestion",
      "type": "email-ingestion",
      "schedule": "5 * * * *",
      "enabled": true,
      "config": { "maxEmails": 50, "markAsRead": false }
    },
    {
      "id": "policy-pipeline-hourly",
      "name": "Hourly Policy Pipeline",
      "type": "policy-pipeline",
      "schedule": "10 * * * *",
      "enabled": true,
      "config": {}
    }
  ]
}
```

The policy YAML lives at `{policyDir}/default-policy.yaml` (see [specs/019-policy-engine/contracts/default-policy.yaml](specs/019-policy-engine/contracts/default-policy.yaml) for a reference policy).

### Human Queue Workflow

When the policy engine cannot confidently classify an event, it creates a `HumanQueueItem` in `system/human/`:

1. A `hq_YYYYMMDD_NNN.md` file appears with `status: pending` and a question
2. Edit the file and set `status: resolved` with your `answer:` in the frontmatter
3. On the next policy-pipeline run, the resolved item triggers re-evaluation of the parent event with your answer injected into the rule context

### LLM Enrichment (Optional)

| Tier | Model | Trigger |
|------|-------|---------|
| Local | phi-4-mini (LocalFoundry) | All `pending` events each cycle |
| Cloud | Claude haiku | Events with a `claude_approval` item in `status: approved` |

To enable Claude enrichment, set `ANTHROPIC_API_KEY` in `.env`. LocalFoundry enrichment works without any additional setup if LocalFoundry is running.

**Docs:**
- [docs/guides/policy-engine.md](docs/guides/policy-engine.md) — Setup, human queue workflow, reading packs, troubleshooting
- [docs/guides/policy-rules.md](docs/guides/policy-rules.md) — YAML DSL reference, predicate operators, action types, examples
- [docs/architecture/triage-pipeline.md](docs/architecture/triage-pipeline.md) — Pipeline stages, file formats, safety gates, idempotency

## LocalFoundry Integration

LocalFoundry provides local LLM text processing without cloud services or authentication. Features include:

### Configuration

Add to your `.env` file:
```bash
# LocalFoundry LLM endpoint (required)
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions

# Model name (optional, default: phi-4)
LOCALFOUNDRY_MODEL=phi-4

# Request timeout in milliseconds (optional, default: 60000)
LOCALFOUNDRY_TIMEOUT=60000
```

### Available Tools

**`local.summarize`** - Summarize long text content
```typescript
{
  text: string,          // Text to summarize (up to 50K chars)
  maxLength?: number     // Max summary length in words (default: 300)
}
```

**`local.clarify`** - Answer questions about text
```typescript
{
  text: string,          // Context text
  question: string       // Specific question to answer
}
```

**`local.extract`** - Extract structured JSON from text
```typescript
{
  text: string,          // Text to extract from
  schema: string         // Desired JSON structure description
}
```

### Features

- ✅ **No Authentication**: Localhost-only endpoint, no OAuth required
- ✅ **Dashboard Status**: View LocalFoundry availability at `https://localhost:3333/`
- ✅ **Error Handling**: Clear messages for endpoint unreachable, timeout, invalid response
- ✅ **Configurable Timeout**: Adjust timeout for large text processing
- ✅ **Input Validation**: Text length limits, required field checking
- ✅ **Type-Safe**: Full TypeScript interfaces for all requests/responses

### Usage Examples

**Summarize a document:**
```bash
# Via Claude Code
> Summarize this long document: [paste 5000-word text]
# Uses local.summarize tool automatically
```

**Ask questions about code:**
```bash
# Via Claude Code
> What does the timeout parameter control in this config?
# [paste config file]
# Uses local.clarify tool
```

**Extract structured data:**
```bash
# Via Claude Code
> Extract attendees, decisions, and action items from this meeting note: [paste note]
# Uses local.extract tool, returns JSON
```

### Dashboard Status

Visit `https://localhost:3333/` to see LocalFoundry status card showing:
- ✓ **Available**: Endpoint responding correctly
- ○ **Unavailable**: Endpoint configured but not reachable
- ○ **Not Configured**: LOCALFOUNDRY_ENDPOINT not set

Status card displays endpoint URL and model name (no authentication button needed).

📚 **Detailed guide**: [specs/011-localfoundry-integration/quickstart.md](specs/011-localfoundry-integration/quickstart.md)

## Contributing

This project follows:
- **SpecKit methodology** - Feature specs in `specs/` directory
- **Test-Driven Development** - Tests before implementation
- **Skyscanner Production Standards** - See [constitution](.specify/memory/constitution.md)

## Completed Features

- **001**: Project Foundation - TypeScript, dual-port architecture, base classes
- **002-006**: Microsoft 365 Integration - Email, calendar, OAuth, token management
- **007-008**: Slack Integration - Channels, messages, canvas, reminders, OAuth
- **009**: SSE Transport - Modern streamable HTTP for MCP protocol
- **010**: Slack Message Actions - Socket Mode for message shortcuts and workflows
- **011**: LocalFoundry Integration - Local LLM text processing (summarize, clarify, extract)
- **012-016**: Microsoft 365 Extended - Email filtering, folder operations, event responses, room booking
- **017**: Heartbeat Framework - Scheduled task automation with cron expressions
- **018**: Journal Triage - Automatic calendar → journal sync with OneNote integration

### Journal Triage (Feature 018)

**Automatic calendar-to-journal synchronization** - Keeps your markdown journal up-to-date with calendar events and syncs prep notes to OneNote.

#### Key Features

- **📅 Calendar Sync**: Automatically creates journal entries from calendar events (7-day lookahead)
- **🔄 Smart Merge**: Updates meeting details while preserving your prep notes and meeting notes
- **🗒️ OneNote Integration**: Syncs prep notes to monthly OneNote sections (optional)
- **✅ EventId Tracking**: O(1) duplicate prevention and intelligent matching
- **❌ Cancellation Handling**: Marks cancelled meetings while preserving all your notes
- **📊 Heartbeat Summary**: Execution statistics appended to daily journal
- **🔒 File Locking**: Prevents concurrent write corruption with proper-lockfile
- **🔁 Retry Logic**: Exponential backoff for OneNote API failures (1s→2s→4s)

#### Configuration

Add to `heartbeat-config.json`:

```json
{
  "id": "journal-triage-hourly",
  "name": "Hourly Journal Triage",
  "type": "journal-triage",
  "schedule": "0 * * * *",
  "enabled": true,
  "config": {
    "lookaheadDays": 7,
    "journalDir": "areas/journal",
    "createOneNotePages": false,
    "oneNoteSectionFormat": "YYYY-MM Meetings"
  }
}
```

**Config Options:**
- `lookaheadDays` (number, default: 7) - Days ahead to fetch calendar events
- `journalDir` (string, default: "areas/journal") - Journal directory relative to rootDir
- `createOneNotePages` (boolean, default: false) - Enable OneNote sync for prep notes
- `oneNoteSectionFormat` (string, default: "YYYY-MM Meetings") - Monthly section naming pattern

#### Journal Format

Files stored in `{rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md`:

```markdown
---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Ready to start the day"
---

# Tuesday, February 18, 2026

## Today's Schedule

### 09:00-10:00 - Team Standup

**Attendees:** Alice, Bob
**Location:** Conference Room A
**Related:** [[project/sprint-planning]]
**EventId:** [eventId](AAMkADA0ZWY5...)

**Prep Notes:**
- Review yesterday's progress
- Prepare blockers discussion

**Meeting Notes:**


---

## Heartbeat Summary

**Last Run**: 2026-02-18T10:00:00Z
**Task**: journal-triage

- Created 1 new journal entries
- Updated 2 existing entries
- Synced 1 OneNote pages
- Errors: None

---
```

#### Workflow

1. **Fetch**: Task fetches calendar events for next N days
2. **Create/Update**: Creates new journal entries or updates existing ones by EventId
3. **Preserve**: All user content (prepNotes, meetingNotes, related links) is preserved
4. **Merge**: Only calendar metadata (time, title, location, attendees) is updated
5. **Cancel**: Meetings no longer in calendar are marked as cancelled (notes preserved)
6. **Sync**: If enabled, prep notes are synced to OneNote with meeting metadata

#### Quick Start

```bash
# 1. Create journal directory
mkdir -p ./data/areas/journal

# 2. Configure task in heartbeat-config.json
# (see configuration example above)

# 3. Start heartbeat service
npm start

# 4. View generated journals
ls -la ./data/areas/journal/2026-02/
cat ./data/areas/journal/2026-02/2026-02-18.md
```

📚 **Full documentation**: [specs/018-journal-triage/quickstart.md](specs/018-journal-triage/quickstart.md)

## License

MIT

## References

- [Feature Specs](specs/) - Detailed specifications
- [MCP Protocol](https://spec.modelcontextprotocol.io/)
- [Project Constitution](.specify/memory/constitution.md)
