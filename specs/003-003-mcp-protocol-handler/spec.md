# Feature Specification: MCP Protocol Handler

**Feature Branch**: `003-mcp-protocol-handler`
**Created**: 2026-01-15
**Status**: Draft
**Input**: Model Context Protocol server implementation with stdio transport

## Overview

Implement the MCP (Model Context Protocol) server layer that enables Claude to communicate with the Cerebro server via stdio transport. This includes tool registration, capability negotiation, request handling, and response serialization.

## Critical Constraints

**STDIO TRANSPORT ONLY**: Claude communicates via stdin/stdout using JSON-RPC 2.0 protocol. The server MUST use `StdioServerTransport` from `@modelcontextprotocol/sdk`. No HTTP endpoints for MCP communication.

**TOOL NAMESPACING**: All tools MUST be namespaced by service name (e.g., `microsoft.list-emails`, `slack.get-channel-history`) to avoid naming collisions across services.

**BACKWARD COMPATIBILITY**: OAuth server MUST continue running on port 3333 alongside MCP server. Both servers operate independently but share service registries.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claude Discovers Available Tools (Priority: P1)

As Claude, I want to discover all available tools when I connect to the MCP server so that I know which capabilities are available and can choose appropriate tools for user requests.

**Why this priority**: Tool discovery is the foundation of MCP - without it, no tools can be called. This must work before any tool execution.

**Independent Test**: Can be fully tested by starting the MCP server, sending a `tools/list` request via stdio, and verifying the response contains all registered tools with correct schemas. Delivers value by enabling Claude to see available capabilities.

**Acceptance Scenarios**:

1. **Given** MCP server is started with no services registered, **When** Claude sends `tools/list` request, **Then** response contains empty array with no errors
2. **Given** Microsoft service is registered with 3 tools, **When** Claude sends `tools/list` request, **Then** response contains 3 tools prefixed with `microsoft.` namespace
3. **Given** multiple services are registered, **When** Claude sends `tools/list` request, **Then** response contains all tools from all services with correct namespacing
4. **Given** a service has invalid tool schema, **When** Claude sends `tools/list` request, **Then** that tool is excluded with error logged but other tools appear

---

### User Story 2 - Claude Calls a Tool Successfully (Priority: P1)

As Claude, I want to call a registered tool by sending its namespaced name and input parameters so that I can execute operations and get results back to fulfill user requests.

**Why this priority**: Tool execution is the core functionality - the entire purpose of MCP. Must be rock-solid.

**Independent Test**: Can be fully tested by mocking a service with a test tool handler, sending `tools/call` request with tool name and parameters, and verifying response contains expected result. Delivers value by enabling actual tool functionality.

**Acceptance Scenarios**:

1. **Given** tool `test.hello` is registered, **When** Claude calls it with valid input `{"name": "World"}`, **Then** response contains result `{"message": "Hello, World!"}` with no errors
2. **Given** tool expects parameter `email_id`, **When** Claude calls it without that parameter, **Then** response contains validation error with clear message about missing parameter
3. **Given** tool execution throws APIError, **When** Claude calls the tool, **Then** response contains error with service name, operation context, and original error message
4. **Given** tool execution takes 2 seconds, **When** Claude calls it, **Then** response is returned after completion with correct result (no timeout)

---

### User Story 3 - MCP Server Handles Protocol Errors Gracefully (Priority: P1)

As the MCP server, I want to handle malformed requests, invalid tool names, and protocol errors gracefully by returning proper JSON-RPC error responses so that Claude can display helpful error messages to users.

**Why this priority**: Error handling prevents server crashes and provides actionable feedback. Critical for production reliability.

**Independent Test**: Can be fully tested by sending various malformed requests (invalid JSON, wrong method names, missing params) and verifying proper error responses are returned without crashing. Delivers value by ensuring robustness.

**Acceptance Scenarios**:

1. **Given** Claude sends malformed JSON, **When** server attempts to parse, **Then** it returns JSON-RPC parse error (-32700) and continues running
2. **Given** Claude calls tool `nonexistent.tool`, **When** server looks up tool, **Then** it returns "Tool not found" error with list of available tools
3. **Given** tool handler throws unexpected error, **When** server catches exception, **Then** it returns internal error (-32603) with sanitized error message and logs full stack trace
4. **Given** initialization/capability exchange fails, **When** server detects this, **Then** it logs error details and exits gracefully with code 1

---

### User Story 4 - MCP Server Integrates with OAuth Server (Priority: P2)

As a developer, I want the MCP server and OAuth server to coexist in the same process, sharing service registries and token storage, so that authenticated services can be used by tools without duplication.

**Why this priority**: Important for architecture consistency, but MCP server can function independently for testing purposes.

**Independent Test**: Can be tested by starting both servers, registering a service with OAuth server, and verifying MCP server sees the same registered service. Delivers value by proving unified architecture works.

**Acceptance Scenarios**:

1. **Given** both MCP and OAuth servers are started, **When** service is registered with OAuth server, **Then** its tools appear in MCP `tools/list` response
2. **Given** user authenticates via OAuth flow, **When** token is saved, **Then** service tools become callable via MCP (service reports `isAuthenticated()` true)
3. **Given** both servers are running, **When** SIGINT is received, **Then** both servers shut down gracefully in correct order (MCP first, OAuth second)

---

### User Story 6 - Server Only Exposes Configured Services (Priority: P1)

As a user, I want the MCP server to only expose tools for services that have valid credentials configured so that Claude doesn't offer functionality that won't work and I get clear feedback about which services are available.

**Why this priority**: Essential for user experience - prevents confusing errors when tools are called but credentials are missing. Users should only see tools they can actually use.

**Independent Test**: Can be fully tested by starting server with only Microsoft credentials, sending `tools/list`, and verifying only Microsoft tools appear (no Slack tools). Restart with no credentials and verify empty tool list. Delivers value by making the system self-configuring based on available credentials.

**Acceptance Scenarios**:

1. **Given** only Microsoft credentials are set in env vars, **When** server starts, **Then** logs show "Microsoft 365 service registered" and "Slack service not registered - missing credentials"
2. **Given** only Microsoft service is registered, **When** Claude sends `tools/list`, **Then** response contains only `microsoft.*` tools (no `slack.*` tools)
3. **Given** no service credentials are configured, **When** server starts, **Then** server starts successfully with 0 registered services and logs helpful message about setting credentials
4. **Given** user sets Microsoft credentials and restarts, **When** Claude sends `tools/list`, **Then** Microsoft tools now appear in the list
5. **Given** Microsoft credentials are invalid format, **When** server attempts registration, **Then** service is not registered and logs validation error with specific variable names

---

### User Story 5 - Developer Adds New MCP Capability (Priority: P3)

As a developer, I want to add support for new MCP capabilities (resources, prompts, sampling) by extending the server implementation so that Cerebro can evolve with the MCP specification.

**Why this priority**: Important for future extensibility but tools are sufficient for initial release.

**Independent Test**: Can be tested by implementing a new capability handler, updating capability negotiation, and verifying Claude can discover and use the new capability. Delivers value by proving architecture is extensible.

**Acceptance Scenarios**:

1. **Given** developer implements resources capability, **When** capability negotiation happens, **Then** server advertises resources capability to Claude
2. **Given** resources capability is advertised, **When** Claude sends `resources/list` request, **Then** server responds with available resources
3. **Given** new capability is unsupported, **When** Claude requests it, **Then** server returns appropriate "not implemented" error

---

## Functional Requirements

### FR-001: MCP Server Initialization
The MCP server MUST initialize with `StdioServerTransport` using `process.stdin` and `process.stdout`.

### FR-002: Server Start/Stop Lifecycle
The MCP server MUST provide `start()` and `stop()` methods for lifecycle management and MUST handle graceful shutdown on SIGINT/SIGTERM.

### FR-003: Service Registry Integration
The MCP server MUST maintain a reference to the global `ServiceRegistry` and dynamically discover tools from all registered services.

### FR-004: Tool Discovery (tools/list)
The MCP server MUST implement `tools/list` handler that returns all tools from all registered services with:
- Namespaced tool names (`{service}.{tool}`)
- Tool descriptions
- JSON Schema for input parameters
- Standardized format per MCP specification

### FR-005: Tool Execution (tools/call)
The MCP server MUST implement `tools/call` handler that:
- Parses namespaced tool name to extract service and tool parts
- Looks up service in registry
- Validates service is authenticated (if required)
- Calls tool handler with provided input
- Serializes result to MCP response format
- Handles errors with proper error codes

### FR-006: Input Validation
The MCP server MUST validate tool input against the tool's JSON Schema before calling the handler and return validation errors if input is invalid.

### FR-007: Error Handling
The MCP server MUST handle errors consistently:
- Parse errors → JSON-RPC error code -32700
- Invalid request → JSON-RPC error code -32600
- Method not found → JSON-RPC error code -32601
- Invalid params → JSON-RPC error code -32602
- Internal error → JSON-RPC error code -32603
- Tool-specific errors → Custom error codes with context

### FR-008: Error Context
All error responses MUST include:
- Service name (if applicable)
- Operation being attempted
- Original error message
- Correlation ID for log tracing

### FR-009: Capability Negotiation
The MCP server MUST support capability negotiation via `initialize` request and respond with:
- Server name and version
- Supported capabilities (tools, resources if implemented)
- Protocol version

### FR-010: Structured Logging
The MCP server MUST log all protocol events with correlation IDs:
- Connection established
- Tool list requests
- Tool call requests (with tool name, not full input for security)
- Tool call results (success/failure, execution time)
- Errors with full context
- Connection closed

### FR-011: Tool Result Serialization
Tool results MUST be serialized to JSON-compatible format:
- Primitive types passed through
- Dates converted to ISO 8601 strings
- Errors converted to error objects with message, code, context
- Large responses truncated if needed with warning

### FR-012: Concurrent Request Handling
The MCP server MUST handle concurrent tool calls safely:
- Multiple requests can be in flight simultaneously
- Token refresh operations must be deduplicated (already handled by BaseTokenStorage)
- Responses must be correlated correctly to requests via JSON-RPC id

### FR-013: Authentication Status Check
Before executing a tool, the MCP server MUST verify the service `isAuthenticated()` and return helpful error if authentication is missing:
- Error message includes authentication URL
- Error suggests running authentication flow first

### FR-014: Graceful Degradation
If a service fails to initialize or encounters errors during tool listing, the MCP server MUST:
- Log the error with full context
- Continue serving tools from other working services
- Exclude broken service's tools from discovery

### FR-015: Tool Execution Timeout
Tool execution MUST have a configurable timeout (default 30 seconds) and return timeout error if exceeded.

### FR-016: Coexistence with OAuth Server
The MCP server MUST coexist with the OAuth authentication server:
- Both run in same process
- Both share service registry reference
- OAuth server continues on port 3333
- MCP server uses stdio only

### FR-017: Conditional Service Registration
Services MUST only be registered if their required environment variables are present:
- Service MUST check for required credentials (client ID, client secret, etc.)
- If required env vars are missing, service MUST NOT be registered
- If service is not registered, its tools MUST NOT appear in `tools/list`
- Server MUST log which services are enabled/disabled based on configuration
- Server MUST start successfully even if all services are disabled (allows testing)

**Example**:
```typescript
// Microsoft service registration (pseudo-code)
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  const microsoftService = new MicrosoftService(config);
  await serviceRegistry.register(microsoftService);
  logger.info({ service: 'microsoft', msg: 'Microsoft 365 service registered' });
} else {
  logger.info({
    service: 'microsoft',
    msg: 'Microsoft 365 service not registered - missing credentials',
    requiredVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']
  });
}
```

### FR-018: Service Configuration Validation
Each service MUST validate its configuration before registration:
- Check for required environment variables
- Validate format of configuration values (URLs, ports, etc.)
- Return clear error messages for invalid configuration
- Log specific missing variables to help user troubleshooting

### FR-019: Startup Sequence
The server startup MUST follow this sequence:
1. Load configuration
2. Initialize service registry (empty initially)
3. Conditionally register services based on environment variables (FR-017)
4. Start OAuth server (port 3333) with registered services
5. Start MCP server (stdio transport)
6. Log "Server ready" with count of registered services

### FR-020: Shutdown Sequence
The server shutdown MUST follow this sequence:
1. Stop accepting new MCP requests
2. Wait for in-flight requests to complete (with timeout)
3. Close MCP server and stdio transport
4. Stop OAuth server
5. Shutdown all registered services
6. Exit process with code 0

### FR-021: Environment Variable Configuration
MCP server behavior MUST be configurable via environment variables:
- `MCP_TIMEOUT`: Tool execution timeout in milliseconds (default 30000)
- `MCP_LOG_TOOL_INPUT`: Whether to log full tool input (default false, security)
- `USE_TEST_MODE`: Enable test mode with mock handlers (inherited from base)

### FR-022: Test Mode Support
In test mode (`USE_TEST_MODE=true`), the MCP server MUST:
- Support registering mock tool handlers
- Skip authentication checks for services
- Allow overriding tool schemas for testing

## Technical Requirements

### TR-001: TypeScript Implementation
All MCP protocol code MUST be written in TypeScript with strict mode enabled, no `any` types.

### TR-002: MCP SDK Version
MUST use `@modelcontextprotocol/sdk` version 1.25.2 or compatible version.

### TR-003: File Structure
```
src/
  mcp-server/
    index.ts              # Barrel export
    mcp-server.ts         # Main MCP server class
    protocol-handler.ts   # JSON-RPC protocol handling
    error-mapper.ts       # Map errors to MCP error codes
  types/
    mcp.ts               # MCP-specific types (if needed beyond SDK)
tests/
  unit/
    mcp-server/
      mcp-server.test.ts          # Server lifecycle tests
      protocol-handler.test.ts    # Protocol parsing tests
      tool-execution.test.ts      # Tool call tests
      error-handling.test.ts      # Error scenarios
```

### TR-004: Class Design
```typescript
export class MCPServer {
  private readonly transport: StdioServerTransport;
  private readonly server: Server;
  private readonly serviceRegistry: ServiceRegistry;

  constructor(serviceRegistry: ServiceRegistry);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  private setupHandlers(): void;
  private handleToolsList(): Promise<ToolListResponse>;
  private handleToolsCall(request: ToolCallRequest): Promise<ToolCallResponse>;
}

// Service factory with conditional registration
export async function registerServices(registry: ServiceRegistry): Promise<void> {
  // Microsoft 365
  if (hasMicrosoftCredentials()) {
    const microsoftService = await createMicrosoftService();
    await registry.register(microsoftService);
    logger.info({ service: 'microsoft', msg: 'Microsoft 365 service registered' });
  } else {
    logger.info({
      service: 'microsoft',
      msg: 'Microsoft 365 service not registered - missing credentials',
      requiredVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID']
    });
  }

  // Slack
  if (hasSlackCredentials()) {
    const slackService = await createSlackService();
    await registry.register(slackService);
    logger.info({ service: 'slack', msg: 'Slack service registered' });
  } else {
    logger.info({
      service: 'slack',
      msg: 'Slack service not registered - missing credentials',
      requiredVars: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']
    });
  }

  // Log summary
  const registeredCount = registry.list().length;
  logger.info({
    operation: 'service_registration_complete',
    registeredServices: registeredCount,
    msg: `Service registration complete: ${registeredCount} service(s) registered`
  });
}

function hasMicrosoftCredentials(): boolean {
  return !!(
    process.env['MICROSOFT_CLIENT_ID'] &&
    process.env['MICROSOFT_CLIENT_SECRET'] &&
    process.env['MICROSOFT_TENANT_ID']
  );
}

function hasSlackCredentials(): boolean {
  return !!(
    process.env['SLACK_CLIENT_ID'] &&
    process.env['SLACK_CLIENT_SECRET']
  );
}
```

### TR-005: Error Type Hierarchy
```typescript
// Extend APIError for MCP-specific errors
export class MCPError extends APIError {
  public readonly code: number;  // JSON-RPC error code
  public readonly toolName?: string;

  constructor(message: string, code: number, ...);
  toJSONRPC(): JSONRPCError;
}

export class ToolNotFoundError extends MCPError { }
export class ToolValidationError extends MCPError { }
export class ToolExecutionError extends MCPError { }
export class AuthenticationRequiredError extends MCPError { }
```

### TR-006: Testing Requirements
- Unit tests for all protocol handlers (tools/list, tools/call, initialize)
- Unit tests for error mapping and serialization
- Integration tests with mock service and tool
- Integration tests for concurrent requests
- Test coverage MUST be ≥ 80%

### TR-007: Performance Requirements
- Tool discovery (`tools/list`) MUST complete in < 100ms
- Tool call overhead (excluding actual tool execution) MUST be < 10ms
- Server startup MUST complete in < 2 seconds

### TR-008: Logging Format
All MCP logs MUST use structured format:
```typescript
logger.info({
  operation: 'mcp_tool_call',
  toolName: 'microsoft.list-emails',
  correlationId: 'abc-123',
  executionTimeMs: 245,
  success: true,
  msg: 'Tool call completed successfully'
});
```

### TR-009: Dependency Injection
The `MCPServer` class MUST accept `ServiceRegistry` via constructor (dependency injection) for testability.

### TR-010: No MCP SDK Modifications
MUST NOT modify or patch `@modelcontextprotocol/sdk` code. Use composition and adapters if needed.

## Non-Functional Requirements

### NFR-001: Reliability
The MCP server MUST handle errors without crashing and continue processing requests after recoverable errors.

### NFR-002: Observability
All significant operations MUST be logged with correlation IDs for request tracing.

### NFR-003: Security
- Tool input MUST NOT be logged by default (may contain sensitive data)
- Authentication MUST be checked before tool execution
- Errors MUST NOT leak sensitive information in messages to Claude

### NFR-004: Maintainability
Code MUST follow project conventions:
- TSDoc comments for public APIs
- Naming: PascalCase (classes), camelCase (functions), kebab-case (files)
- File length ≤ 500 lines

### NFR-005: Testability
All components MUST be testable in isolation with mock dependencies.

## Success Criteria

1. MCP server starts successfully and establishes stdio transport
2. Claude can discover all registered tools via `tools/list`
3. Claude can call tools successfully with valid input
4. Errors are handled gracefully with proper JSON-RPC error responses
5. All tests pass with ≥ 80% coverage
6. Both MCP and OAuth servers coexist without conflicts
7. Graceful shutdown works for both servers
8. Zero ESLint/TypeScript errors
9. Documentation includes setup instructions and examples

## Out of Scope

- Resources capability (future feature)
- Prompts capability (future feature)
- Sampling capability (future feature)
- HTTP transport (stdio only)
- Multiple concurrent sessions (single stdin/stdout)
- Tool streaming responses (future enhancement)

## Dependencies

- **Feature 001**: Project foundation (completed)
- **Feature 002**: OAuth authentication server (completed)
- **MCP SDK**: @modelcontextprotocol/sdk v1.25.2

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| MCP SDK API changes | High | Low | Pin to exact version, test upgrades carefully |
| Tool execution hangs | High | Medium | Implement 30s timeout with clear error |
| Error serialization fails | Medium | Low | Wrap all errors, test edge cases |
| Stdio transport issues | High | Low | Test with actual Claude integration early |
| Service registry race conditions | Medium | Low | Use immutable registries, test concurrent calls |

## Testing Strategy

### Unit Tests
- Protocol handler parsing and serialization
- Tool lookup and namespacing logic
- Error mapping to JSON-RPC codes
- Input validation against JSON Schema
- Mock service with test tools

### Integration Tests
- Full MCP server lifecycle (start, call tools, stop)
- Concurrent tool calls
- Error scenarios (service down, authentication missing)
- Coexistence with OAuth server

### Manual Testing with Claude
- Connect real Claude instance via stdio
- Verify tool discovery in Claude UI
- Execute various tools and verify responses
- Test error scenarios and verify user-friendly messages

## Acceptance Checklist

- [ ] MCP server class implemented with stdio transport
- [ ] Conditional service registration based on environment variables (FR-017)
- [ ] Service configuration validation with helpful error messages (FR-018)
- [ ] Tool discovery (`tools/list`) handler working
- [ ] Tool discovery only returns tools for registered services
- [ ] Tool execution (`tools/call`) handler working
- [ ] Input validation against JSON Schema
- [ ] Error handling with proper JSON-RPC codes
- [ ] Capability negotiation (initialize)
- [ ] Structured logging with correlation IDs
- [ ] Logging shows which services are registered/not registered at startup
- [ ] Integration with ServiceRegistry
- [ ] Authentication check before tool execution
- [ ] Graceful shutdown for both servers
- [ ] Server starts successfully with 0 services (all credentials missing)
- [ ] Server starts successfully with partial services (some credentials present)
- [ ] Unit tests for all handlers (≥ 80% coverage)
- [ ] Unit tests for conditional service registration logic
- [ ] Integration tests with mock service
- [ ] Integration tests with no services registered
- [ ] ESLint and TypeScript pass
- [ ] Documentation updated (README, setup guide)
- [ ] Documentation includes examples of partial service configuration
- [ ] Manual testing with Claude successful

## References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/anthropics/modelcontextprotocol)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Project Constitution](.specify/memory/constitution.md)
- [Feature 001 Spec](../001-001-project-foundation/spec.md)
- [Feature 002 Spec](../002-002-oauth-authentication/spec.md)
