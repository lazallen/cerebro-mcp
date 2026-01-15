# Cerebro MCP TypeScript

TypeScript implementation of Cerebro MCP - A Model Context Protocol server providing Claude with access to Microsoft 365, Slack, and extensible service integrations.

## Project Status

**Current Phase**: Foundation (Feature 001 Complete ✅)

This project is under active development following SpecKit methodology with test-driven development and Skyscanner production standards compliance.

### Completed Features

- ✅ **Feature 001**: Project Foundation & Base Architecture
  - TypeScript strict mode configuration
  - Core interfaces and type definitions
  - Base classes (BaseAPIClient, BaseTokenStorage)
  - Structured logging with pino
  - Configuration management
  - Code quality tooling (ESLint, Prettier)

### Upcoming Features

- 🚧 **Feature 002**: Unified OAuth Authentication Server
- 📋 **Feature 003**: MCP Protocol Handler
- 📋 **Feature 004**: Microsoft 365 Service Integration
- 📋 **Feature 005**: Slack Service Integration

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

# Copy environment configuration
cp .env.example .env

# Edit .env with your credentials
# (See Configuration section below)
```

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
MICROSOFT_REDIRECT_URI=http://localhost:3333/auth/microsoft/callback

# Slack (if using Slack integration)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_REDIRECT_URI=http://localhost:3333/auth/slack/callback
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
# Run the built application
npm start

# Run in development mode with ts-node
npm run dev
```

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

**Version**: 0.1.0
**Status**: Foundation Phase Complete ✅
