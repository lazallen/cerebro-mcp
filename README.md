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

**Microsoft 365** (12 tools):
- **Auth**: authenticate, check-auth-status
- **Email**: list-emails (with folder filtering), read-email, send-email, move-email
- **Calendar**: list-events, get-event, create-event, update-event, delete-event, find-meeting-times

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

## License

MIT

## References

- [Feature Specs](specs/) - Detailed specifications
- [MCP Protocol](https://spec.modelcontextprotocol.io/)
- [Project Constitution](.specify/memory/constitution.md)
