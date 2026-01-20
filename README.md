# Cerebro MCP TypeScript

TypeScript MCP server providing Claude with access to Microsoft 365, Slack, and extensible service integrations via a unified HTTP server.

## Features

- **Dual-Port Architecture** - OAuth (HTTPS :3333) + MCP (HTTP :3334) for security and compatibility
- **Multi-Service** - Microsoft 365 (email, calendar) and Slack (channels, messages, reminders)
- **Type-Safe** - TypeScript strict mode, no `any` types
- **OAuth 2.0** - Automatic token refresh and web-based authentication dashboard
- **Streamable HTTP** - Modern MCP transport compatible with Claude Code
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

# Testing (optional)
USE_TEST_MODE=false
```

**OAuth Setup:**
- Microsoft: Redirect URI = `https://localhost:3333/auth/microsoft/callback`
- Slack: Redirect URI = `https://localhost:3333/auth/slack/callback`

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

**Slack** (13 tools):
- **Auth**: authenticate, check-auth-status
- **Channels**: list-channels, get-channel-history
- **Groups**: list-groups, get-group-history
- **Threads**: get-thread-replies
- **Canvas**: read-canvas, search-canvases
- **User**: get-user-identity
- **Reminders**: list-reminders, create-reminder, complete-reminder

## Project Structure

```
src/
├── auth-server/        # OAuth HTTP server
├── mcp-server/         # MCP protocol handler
├── services/           # Service integrations (Microsoft, Slack)
│   ├── microsoft/
│   └── slack/
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
```

📚 **Detailed architecture docs**: [docs/architecture/http-transport.md](docs/architecture/http-transport.md)

## Contributing

This project follows:
- **SpecKit methodology** - Feature specs in `specs/` directory
- **Test-Driven Development** - Tests before implementation
- **Skyscanner Production Standards** - See [constitution](.specify/memory/constitution.md)

## License

MIT

## References

- [Feature Specs](specs/) - Detailed specifications
- [MCP Protocol](https://spec.modelcontextprotocol.io/)
- [Project Constitution](.specify/memory/constitution.md)
