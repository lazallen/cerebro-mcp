# Cerebro MCP TypeScript

TypeScript implementation of Cerebro MCP - A Model Context Protocol server providing Claude with access to Microsoft 365, Slack, and extensible service integrations.

## Project Status

**Current Phase**: Service Integration Complete ✅

This project is under active development following SpecKit methodology with test-driven development and Skyscanner production standards compliance.

### Completed Features

- ✅ **Feature 001**: Project Foundation & Base Architecture
  - TypeScript strict mode configuration
  - Core interfaces and type definitions
  - Base classes (BaseAPIClient, BaseTokenStorage)
  - Structured logging with pino
  - Configuration management
  - Code quality tooling (ESLint, Prettier)

- ✅ **Feature 002**: Unified OAuth Authentication Server
  - Multi-service OAuth 2.0 authentication
  - HTTP/HTTPS with automatic SSL detection
  - Token exchange and refresh flows
  - Service registration and management
  - Legacy URL support for backward compatibility

- ✅ **Feature 003**: MCP Protocol Handler
  - Model Context Protocol server implementation
  - Tool registration and execution
  - Service lifecycle management
  - Error handling and logging

- ✅ **Feature 004**: Microsoft 365 Service Integration
  - OAuth authentication with Microsoft Graph API
  - Calendar tools (list, read, create, update, delete events)
  - Email tools (list, read, send messages)
  - findMeetingTimes for scheduling assistance
  - Automatic token refresh

- ✅ **Feature 005**: Microsoft Calendar findMeetingTimes
  - Enhanced scheduling with meeting time suggestions
  - Attendee availability checking
  - Time constraint support
  - Meeting duration preferences

- ✅ **Feature 006**: Slack Workspace Integration
  - OAuth authentication with Slack Web API
  - Channel and private group tools
  - Message history and thread replies
  - Canvas document access
  - User identity retrieval
  - Reminder management (list, create, complete)

## Features

- **Multi-Service Architecture**: Extensible design for integrating multiple services
- **Type-Safe**: Built with TypeScript in strict mode - no `any` types
- **OAuth 2.0 Support**: Unified authentication server with automatic token refresh
- **Structured Logging**: JSON-formatted logs with correlation IDs using pino
- **Test Mode**: Mock mode for testing without real API calls
- **Production-Ready**: Follows Skyscanner production standards

## Prerequisites

- **Node.js**: >= 18.0.0 (LTS)
- **npm**: >= 8.0.0

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd cerebro-mcp-ts

# Install dependencies
npm install

# Set up SSL certificates (required for OAuth callbacks)
# Install mkcert if not already installed:
# - macOS: brew install mkcert
# - Linux: Follow instructions at https://github.com/FiloSottile/mkcert#installation
# - Windows: choco install mkcert (or download from releases)

# Generate local certificates
mkcert -install
mkcert localhost 127.0.0.1 ::1

# This creates:
# - localhost+2.pem (certificate)
# - localhost+2-key.pem (private key)

# Copy environment configuration
cp .env.example .env

# Edit .env with your credentials
# (See Configuration section below)
```

**Why HTTPS?** OAuth providers like Microsoft and Slack require HTTPS redirect URIs for security. Using `mkcert` creates locally-trusted certificates so your browser accepts the connection.

## Configuration

All configuration is managed through environment variables. Copy `.env.example` to `.env` and configure:

### Required Variables

```bash
# Server Configuration
SERVER_NAME=cerebro-mcp-ts
SERVER_VERSION=0.1.0
AUTH_SERVER_PORT=3333  # OAuth callback port (DO NOT CHANGE - OAuth apps registered on this port)

# Logging
LOG_LEVEL=info  # debug, info, warn, error
LOG_PRETTY=true # Pretty print logs (true for development)
NODE_ENV=development

# Microsoft 365 (if using Microsoft integration)
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://localhost:3333/auth/microsoft/callback

# Slack (if using Slack integration)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_REDIRECT_URI=https://localhost:3333/auth/slack/callback
```

See [.env.example](.env.example) for complete configuration options with documentation.

## Development

### Build

```bash
# Build TypeScript to JavaScript
npm run build

# Build and watch for changes
npm run build:watch
```

### Run

```bash
# Run the built application (JSON logs)
npm start

# Run with pretty-printed logs (human-readable)
npm run start:pretty

# Run in development mode with ts-node (JSON logs)
npm run dev

# Run in development mode with pretty-printed logs
npm run dev:pretty
```

**Tip**: Use `start:pretty` or `dev:pretty` for easier log reading during development. Production should use the standard `start` command for structured JSON logging.

### Code Quality

```bash
# Run ESLint
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting without changes
npm run format:check

# Type check without building
npm run type-check
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm test:watch

# Run tests with coverage
npm test:coverage
```

## Project Structure

```
cerebro-mcp-ts/
├── src/
│   ├── types/           # TypeScript interfaces and types
│   │   ├── tool.ts     # MCP tool definitions
│   │   ├── api.ts      # API client types
│   │   ├── token.ts    # OAuth token types
│   │   └── service.ts  # Service configuration types
│   │
│   ├── common/          # Shared base classes
│   │   ├── base-api-client.ts     # Generic API client
│   │   ├── base-token-storage.ts  # OAuth token management
│   │   ├── logger.ts              # Structured logging
│   │   └── config.ts              # Global configuration
│   │
│   ├── utils/          # Utility functions (future)
│   └── index.ts        # Main entry point
│
├── tests/              # Test files
│   ├── unit/          # Unit tests
│   ├── integration/   # Integration tests
│   └── fixtures/      # Test fixtures
│
├── specs/             # SpecKit feature specifications
├── .specify/          # SpecKit configuration
├── dist/              # Compiled JavaScript (generated)
└── docs/              # Documentation (future)
```

## Architecture

### Base Classes

#### BaseAPIClient<T>

Generic base class for making HTTP/HTTPS API requests with:
- Bearer token authentication
- Automatic pagination handling
- Configurable timeouts
- Mock mode for testing
- Typed error handling

```typescript
import { BaseAPIClient } from './common/base-api-client';

class MyServiceClient extends BaseAPIClient<MyResponseType> {
  protected async getAccessToken(): Promise<string> {
    // Implement token retrieval
  }
}
```

#### BaseTokenStorage

Abstract base class for OAuth token management with:
- File-based token persistence
- Automatic token refresh (5-minute buffer)
- Concurrent operation deduplication
- Secure file permissions (0600)

```typescript
import { BaseTokenStorage } from './common/base-token-storage';

class MyServiceTokenStorage extends BaseTokenStorage {
  async exchangeCodeForTokens(code: string): Promise<TokenData> {
    // Implement OAuth code exchange
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    // Implement token refresh
  }
}
```

### Type System

All core types are defined with TypeScript strict mode:
- No `any` types
- Strict null checks
- Generic type parameters for reusability
- Comprehensive error types

## Logging

Structured JSON logging with pino:

```typescript
import { logger, generateCorrelationId } from './common/logger';

const correlationId = generateCorrelationId();

logger.info({
  correlationId,
  service: 'my-service',
  operation: 'my_operation',
  msg: 'Operation completed'
});
```

Log levels: `debug`, `info`, `warn`, `error`

Configure via `LOG_LEVEL` environment variable.

## Services

### Microsoft 365 Integration

The Microsoft 365 service provides access to calendars and email through Microsoft Graph API.

#### Setup

1. **Register an Azure AD application**:
   - Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
   - Create a new registration
   - Set redirect URI: `https://localhost:3333/auth/microsoft/callback` (use HTTPS)
   - Note the Application (client) ID and Directory (tenant) ID

2. **Create a client secret**:
   - In your app registration, go to Certificates & secrets
   - Create a new client secret
   - Copy the secret value immediately

3. **Configure API permissions**:
   - Go to API permissions → Add permission → Microsoft Graph → Delegated permissions
   - Add: `Calendars.ReadWrite`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`
   - Grant admin consent if required

4. **Set environment variables**:
   ```bash
   MICROSOFT_CLIENT_ID=your-application-id
   MICROSOFT_CLIENT_SECRET=your-client-secret
   MICROSOFT_TENANT_ID=common  # or your specific tenant ID
   ```

#### Available Tools

**Authentication**:
- `authenticate` - Get OAuth URL to authenticate with Microsoft
- `check-auth-status` - Check if authenticated

**Calendar**:
- `list-calendars` - List all calendars
- `list-events` - List calendar events with optional filters
- `get-event` - Get event details by ID
- `create-event` - Create a new calendar event
- `update-event` - Update an existing event
- `delete-event` - Delete a calendar event
- `find-meeting-times` - Find available meeting times across attendees

**Email**:
- `list-messages` - List email messages with filters
- `get-message` - Get message details by ID
- `send-message` - Send an email message

### Slack Workspace Integration

The Slack service provides access to channels, messages, canvases, and reminders through Slack Web API.

#### Setup

1. **Create a Slack app**:
   - Go to [Slack API](https://api.slack.com/apps) → Create New App
   - Choose "From scratch"
   - Name your app and select a workspace

2. **Configure OAuth & Permissions**:
   - Go to OAuth & Permissions
   - Add redirect URL: `https://localhost:3333/auth/slack/callback` (use HTTPS)
   - Add the following User Token Scopes:
     - `channels:read` - View basic channel information
     - `channels:history` - View messages in public channels
     - `groups:read` - View basic private channel information
     - `groups:history` - View messages in private channels
     - `canvases:read` - View canvas documents
     - `canvases:write` - Edit canvases (used for read-only access)
     - `identify` - View user identity information
     - `reminders:read` - View reminders
     - `reminders:write` - Create and complete reminders

3. **Get credentials**:
   - Note the Client ID from Basic Information
   - Note the Client Secret from Basic Information

4. **Set environment variables**:
   ```bash
   SLACK_CLIENT_ID=your-client-id
   SLACK_CLIENT_SECRET=your-client-secret
   ```

#### Available Tools

**Authentication**:
- `authenticate` - Get OAuth URL to authenticate with Slack
- `check-auth-status` - Check if authenticated

**Channels**:
- `list-channels` - List public channels (supports pagination)
- `get-channel-history` - Get message history from a channel

**Private Groups**:
- `list-groups` - List private channels you're a member of
- `get-group-history` - Get message history from a private group

**Threads**:
- `get-thread-replies` - Get replies in a message thread

**Canvases**:
- `read-canvas` - Read canvas content by ID (returns markdown)
- `search-canvases` - Search for canvases in a channel

**Identity**:
- `get-user-identity` - Get authenticated user's profile and team info

**Reminders**:
- `list-reminders` - List all active reminders
- `create-reminder` - Create a new reminder
- `complete-reminder` - Mark a reminder as complete

#### Notes

- **User Tokens**: Slack user tokens do not expire, so no token refresh is needed
- **Pagination**: All list operations support cursor-based pagination
- **Private Access**: You can only access private groups you're a member of
- **Rate Limits**: Slack enforces rate limits per workspace

## Authentication Flow

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Use the authenticate tool** for your service (Microsoft or Slack)

3. **Visit the OAuth URL** provided in the response

4. **Grant permissions** in the OAuth consent screen

5. **Automatic redirect** back to the server with access token

6. **Token storage**: Tokens are saved securely in `.tokens/` directory

7. **Automatic refresh** (Microsoft only): Tokens are refreshed automatically when expired

## Testing

### Mock Mode

Enable mock mode to test without real API calls:

```bash
USE_TEST_MODE=true npm test
```

Set mock handlers in tests:

```typescript
const client = new MyServiceClient('https://api.example.com', 'my-service');
client.setMockHandler(async (config) => ({
  data: { /* mock data */ },
  status: 200,
}));
```

## Contributing

This project follows:
- **SpecKit methodology**: Feature specs in `specs/` directory
- **Test-Driven Development**: Tests before implementation
- **Skyscanner Production Standards**: See [constitution](.specify/memory/constitution.md)

### Development Workflow

1. Create feature spec in `specs/XXX-feature-name/spec.md`
2. Get spec approval
3. Write failing tests
4. Implement feature
5. Verify all tests pass
6. Run linting and formatting
7. Submit PR with standards checklist

### Code Standards

- TypeScript strict mode (no `any`)
- 80%+ test coverage
- Zero ESLint errors
- TSDoc comments for public APIs
- Naming: PascalCase (classes), camelCase (functions), kebab-case (files)

## License

MIT

## References

- [Constitution](.specify/memory/constitution.md) - Project principles and standards
- [Feature Specs](specs/) - Detailed feature specifications
- [MCP Specification](https://spec.modelcontextprotocol.io/) - Model Context Protocol
- [Skyscanner Production Standards](https://github.com/Skyscanner/production-standards)

---

**Version**: 0.3.0
**Status**: Service Integration Complete ✅ (Features 001-006)
