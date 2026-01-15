# Feature Specification: Project Foundation & Base Architecture

**Feature Branch**: `001-project-foundation`
**Created**: 2026-01-15
**Status**: Draft
**Input**: Set up TypeScript project foundation with base architecture

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Sets Up Local Development Environment (Priority: P1)

As a developer new to the project, I want to clone the repository, install dependencies, and run the MCP server locally so that I can start contributing to the codebase.

**Why this priority**: Without a working development environment, no development can proceed. This is the foundation for all other work.

**Independent Test**: Can be fully tested by cloning the repo, running `npm install`, running `npm run build`, and starting the server with `npm start`. Success is measured by the server starting without errors.

**Acceptance Scenarios**:

1. **Given** I have Node.js 18+ installed, **When** I clone the repo and run `npm install`, **Then** all dependencies install successfully with no errors
2. **Given** dependencies are installed, **When** I run `npm run build`, **Then** TypeScript compiles with no errors in strict mode
3. **Given** the project is built, **When** I run `npm start`, **Then** the MCP server starts and announces its capabilities
4. **Given** the server is running, **When** I run `npm test`, **Then** all tests pass with coverage > 80%

---

### User Story 2 - Developer Creates a New Service (Priority: P2)

As a developer, I want to use base classes and interfaces to create a new service integration (e.g., Google Calendar, GitHub) so that I can extend the MCP server with new functionality following established patterns.

**Why this priority**: The extensibility of the architecture determines how easily we can add new services in the future. This validates our architectural decisions.

**Independent Test**: Can be tested by creating a minimal "demo" service using the base classes, registering it with the server, and verifying it appears in the tool list. Delivers value by proving the architecture is extensible.

**Acceptance Scenarios**:

1. **Given** base classes exist (BaseAPIClient, BaseTokenStorage, BaseService), **When** I extend them for a new service, **Then** TypeScript provides full type safety and autocomplete
2. **Given** I've implemented a service, **When** I register it in the main index, **Then** it loads dynamically and its tools appear in the MCP tool list with proper namespacing
3. **Given** a service implements OAuth, **When** I call its authenticate tool, **Then** the unified auth server handles the OAuth flow and stores tokens securely

---

### User Story 3 - Developer Configures via Environment Variables (Priority: P2)

As a developer or operator, I want to configure the MCP server using environment variables (client IDs, secrets, ports, log levels) so that I can run the server in different environments without code changes.

**Why this priority**: Proper configuration management is essential for deployment flexibility and security. No hardcoded secrets allows safe code sharing.

**Independent Test**: Can be tested by creating a `.env` file with test credentials, starting the server, and verifying it uses the configured values. Delivers value by enabling secure configuration.

**Acceptance Scenarios**:

1. **Given** I create a `.env` file with configuration, **When** I start the server, **Then** it reads all configuration from environment variables
2. **Given** required configuration is missing, **When** I start the server, **Then** it validates config on startup and fails with clear error messages listing missing variables
3. **Given** I set `LOG_LEVEL=debug`, **When** I run the server, **Then** I see detailed debug logs for all operations

---

### User Story 4 - Developer Writes Tests with Mock Mode (Priority: P1)

As a developer, I want to write and run tests without making real API calls to external services so that I can verify functionality in CI/CD pipelines without authentication dependencies.

**Why this priority**: TDD is a constitutional requirement. Without mock mode, we cannot write tests before implementation or run tests in CI/CD.

**Independent Test**: Can be tested by setting `USE_TEST_MODE=true`, running tests, and verifying no real API calls are made. Delivers value by enabling fast, reliable testing.

**Acceptance Scenarios**:

1. **Given** `USE_TEST_MODE=true`, **When** I make API calls via BaseAPIClient, **Then** mock data is returned without real HTTP requests
2. **Given** test mode is enabled, **When** I run the test suite, **Then** all tests pass without requiring OAuth credentials
3. **Given** test mode mock data, **When** I implement a new tool, **Then** I can verify the tool logic works correctly with predictable test data

---

### User Story 5 - Developer Observes Server Operations (Priority: P3)

As a developer or operator, I want structured logging with correlation IDs and appropriate log levels so that I can debug issues and monitor server health.

**Why this priority**: Observability is important but the server must work first. This can be enhanced after core functionality proves stable.

**Independent Test**: Can be tested by making API calls and verifying structured JSON logs appear with correlation IDs, timestamps, and proper log levels.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** I make an API call, **Then** structured JSON logs appear with timestamp, level, correlation ID, service name
2. **Given** an error occurs, **When** I check the logs, **Then** error logs include full context (service, operation, error details, stack trace)
3. **Given** I set `LOG_LEVEL=info`, **When** I run the server, **Then** only info/warn/error logs appear (no debug logs)

---

### Edge Cases

- What happens when TypeScript strict mode catches type errors at compile time?
- How does the system handle missing environment variables at startup?
- What happens when a service fails to load during dynamic service discovery?
- How does BaseAPIClient handle network timeouts or connection failures?
- What happens when token refresh fails during an API call?
- How does the system behave with invalid OAuth credentials?

## Requirements *(mandatory)*

### Functional Requirements

#### Project Structure & Build System
- **FR-001**: System MUST use TypeScript 5.x with strict mode enabled (no implicit any, strict null checks)
- **FR-002**: System MUST compile without errors or warnings in strict mode
- **FR-003**: System MUST provide npm scripts for: build, test, start, lint, format
- **FR-004**: System MUST use ESLint with TypeScript plugin for linting
- **FR-005**: System MUST use Prettier for consistent code formatting
- **FR-006**: System MUST target Node.js 18+ (LTS) runtime

#### Base Architecture & Type System
- **FR-007**: System MUST define TypeScript interfaces for: Tool, ToolHandler, ServiceConfig, TokenData, APIResponse
- **FR-008**: System MUST provide BaseAPIClient<T> abstract class with generic type parameter for API responses
- **FR-009**: System MUST provide BaseTokenStorage abstract class for OAuth token management
- **FR-010**: System MUST provide BaseService abstract class for service lifecycle management
- **FR-011**: All API client methods MUST use proper TypeScript return types (never `any`)
- **FR-012**: All configuration objects MUST have TypeScript interface definitions

#### Configuration Management
- **FR-013**: System MUST load all configuration from environment variables (no hardcoded secrets)
- **FR-014**: System MUST validate required environment variables on startup
- **FR-015**: System MUST fail fast with clear error messages for missing configuration
- **FR-016**: System MUST provide `.env.example` file with all configuration options documented
- **FR-017**: Configuration MUST include: LOG_LEVEL, AUTH_SERVER_PORT, USE_TEST_MODE, service credentials

#### Testing Infrastructure
- **FR-018**: System MUST use Jest or Vitest for testing with TypeScript support
- **FR-019**: System MUST support test/mock mode via `USE_TEST_MODE=true` environment variable
- **FR-020**: BaseAPIClient MUST provide mock request handling for test mode
- **FR-021**: System MUST provide mock data for test scenarios
- **FR-022**: Tests MUST achieve minimum 80% code coverage
- **FR-023**: Tests MUST run successfully in CI/CD without external dependencies

#### Logging & Observability
- **FR-024**: System MUST use structured logging library (pino or winston)
- **FR-025**: All logs MUST be JSON-formatted with standard fields: timestamp, level, message, service, correlationId
- **FR-026**: System MUST support LOG_LEVEL configuration: debug, info, warn, error
- **FR-027**: API calls MUST be logged with correlation IDs for request tracing
- **FR-028**: Errors MUST be logged with full context: service name, operation, error details, stack trace

#### Base API Client
- **FR-029**: BaseAPIClient MUST handle HTTP/HTTPS requests with Bearer token authentication
- **FR-030**: BaseAPIClient MUST implement pagination support for APIs that return paginated results
- **FR-031**: BaseAPIClient MUST include proper error handling with typed error responses
- **FR-032**: BaseAPIClient MUST support configurable request timeouts
- **FR-033**: BaseAPIClient MUST switch between real and mock requests based on USE_TEST_MODE

#### Base Token Storage
- **FR-034**: BaseTokenStorage MUST load/save tokens to user's home directory (e.g., `~/.cerebro-tokens/`)
- **FR-035**: BaseTokenStorage MUST implement automatic token refresh with 5-minute expiry buffer
- **FR-036**: BaseTokenStorage MUST prevent concurrent token refresh attempts (deduplication)
- **FR-037**: BaseTokenStorage MUST provide `getValidAccessToken()` method with auto-refresh
- **FR-038**: Token files MUST have restrictive permissions (0600) for security

#### Code Quality
- **FR-039**: All code MUST pass ESLint checks with zero errors
- **FR-040**: All code MUST be formatted with Prettier
- **FR-041**: Git pre-commit hooks MUST run lint and format checks
- **FR-042**: All public APIs MUST have TSDoc documentation comments
- **FR-043**: All files MUST follow naming convention: kebab-case for file names, PascalCase for classes/interfaces

### Key Entities

- **Tool**: Represents an MCP tool with name, description, JSON schema, and handler function
- **ToolHandler**: Function signature for tool execution handlers (input → output)
- **ServiceConfig**: Configuration for a service (client ID, secret, scopes, endpoints, etc.)
- **TokenData**: OAuth token information (access token, refresh token, expiry timestamp)
- **APIResponse<T>**: Generic type for API responses with data payload
- **APIError**: Typed error with HTTP status, service name, operation, message
- **LogContext**: Structured log entry fields (level, message, correlationId, service, etc.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: TypeScript compilation completes with zero errors and zero warnings in strict mode
- **SC-002**: All unit tests pass with minimum 80% code coverage
- **SC-003**: ESLint and Prettier checks pass with zero violations
- **SC-004**: Server starts successfully and announces MCP capabilities within 5 seconds
- **SC-005**: Test suite runs in under 10 seconds with `USE_TEST_MODE=true`
- **SC-006**: New developer can clone repo, install, build, and run tests in under 5 minutes
- **SC-007**: All environment variables are documented in `.env.example` with clear descriptions
- **SC-008**: Logs are structured JSON and include required fields (timestamp, level, correlationId)
- **SC-009**: Mock mode allows all tests to run without network access or credentials
- **SC-010**: Code review checklist confirms all Skyscanner production standards compliance

### Skyscanner Production Standards Compliance

This feature must comply with:
- **Code Quality & Style**: TypeScript standards, ESLint rules, naming conventions
- **Security & Privacy**: No secrets in code, environment-based config, secure token storage
- **Build, Test & Deploy**: Automated tests, CI/CD ready, build artifacts
- **Observability**: Structured logging, correlation IDs, appropriate log levels

## Out of Scope

The following are explicitly **not** included in this feature:
- Implementation of actual services (Microsoft, Slack) - covered in separate specs
- OAuth authentication server implementation - covered in separate spec
- MCP protocol handler implementation - covered in separate spec
- Docker containerization - to be added later
- Production deployment configuration - to be added later
- Performance benchmarking - to be added later

## Dependencies

- Node.js 18+ installed
- npm or yarn package manager
- TypeScript 5.x
- @modelcontextprotocol/sdk
- Jest or Vitest (testing framework)
- pino or winston (logging)
- ESLint + TypeScript plugin
- Prettier
- dotenv (environment variables)

## References

- Constitution: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
- Original Python project: `~/code/cerebro-mcp`
- Skyscanner Production Standards: `/tmp/production-standards/docs/standards/`
- MCP Specification: https://spec.modelcontextprotocol.io/
