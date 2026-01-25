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

**Microsoft 365** (11 tools):
- **Auth**: authenticate, check-auth-status
- **Email**: list-emails, read-email, send-email
- **Calendar**: list-events, get-event, create-event, update-event, delete-event, find-meeting-times

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
