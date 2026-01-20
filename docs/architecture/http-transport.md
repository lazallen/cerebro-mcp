# HTTP Transport Architecture

This document explains the dual-port HTTP architecture used by Cerebro MCP, including the separated OAuth and MCP servers, StreamableHTTP transport layer, and connection lifecycle.

## Overview

Cerebro MCP uses a **dual-port architecture** where two HTTP servers run simultaneously:

1. **Port 3333 (HTTPS)**: OAuth authentication server - secure login flows and dashboard
2. **Port 3334 (HTTP)**: MCP protocol server - tool discovery and execution without SSL issues

This design provides:
- **Security**: OAuth authentication remains on HTTPS with proper SSL
- **Compatibility**: MCP endpoint on HTTP avoids SSL certificate trust issues with Claude Code CLI
- **Backward Compatibility**: Port 3333 still supports MCP for existing clients

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│         Dual-Port Application Architecture         │
│                    src/index.ts                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Port 3333 (HTTPS) - OAuthServer                   │
│  ┌───────────────────────────────────────────┐    │
│  │      (src/auth-server/oauth-server.ts)   │    │
│  ├───────────────────────────────────────────┤    │
│  │  Routes:                                  │    │
│  │  • GET  /                → Dashboard      │    │
│  │  • GET  /auth/:svc/login → OAuth start   │    │
│  │  • GET  /auth/:svc/callback → OAuth cb   │    │
│  │  • GET/POST /mcp         → MCP (compat) ─┐    │
│  └───────────────────────────────────────────┘│    │
│                                                │    │
│  Port 3334 (HTTP) - MCP Server Direct          │    │
│  ┌───────────────────────────────────────────┐│    │
│  │      (src/mcp-server/mcp-server.ts)      ││    │
│  ├───────────────────────────────────────────┤│    │
│  │  StreamableHTTPServerTransport            ││    │
│  │  • Handles SSE connections (GET /mcp)     ││    │
│  │  • Handles messages (POST /mcp)           ││◄───┘
│  │  • Session management (UUID-based)        ││
│  │  • Connection resumability                ││
│  └───────────────────────────────────────────┘│
│                                                     │
│  ServiceRegistry (Shared) → Microsoft, Slack       │
└─────────────────────────────────────────────────────┘

Claude Code ←─(HTTP)──→ http://localhost:3334/mcp    (Primary)
Browser    ←─(HTTPS)─→ https://localhost:3333/       (Dashboard)
Legacy     ←─(HTTPS)─→ https://localhost:3333/mcp    (Backward compat)
```

## Components

### 1. OAuthServer (src/auth-server/oauth-server.ts)

**Purpose**: Handles OAuth 2.0 authentication flows and serves the authentication dashboard.

**Key Responsibilities**:
- HTTP/HTTPS server management (port 3333)
- SSL certificate detection and auto-configuration
- OAuth route handling (`/auth/*`, `/`)
- MCP route delegation (`/mcp` → MCPServer)
- Service registration and status tracking

**Route Handling**:
```typescript
// OAuth routes (handled by OAuthServer)
GET  /                           → Authentication dashboard (HTML)
GET  /auth/:service/login        → Initiate OAuth flow
GET  /auth/:service/callback     → Handle OAuth callback

// MCP routes (delegated to MCPServer)
GET  /mcp                        → SSE connection establishment
POST /mcp                        → MCP protocol messages
```

**Integration with MCPServer**:
```typescript
// src/auth-server/oauth-server.ts (lines 162-168)
registerMCPServer(mcpServer: MCPServer): void {
  this.mcpServer = mcpServer;
}

// Route delegation (lines 317-323)
if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
  await this.mcpServer.handleRequest(req, res);
}
```

### 2. MCPServer (src/mcp-server/mcp-server.ts)

**Purpose**: Implements the MCP protocol using StreamableHTTP transport.

**Key Responsibilities**:
- StreamableHTTPServerTransport initialization and management
- MCP protocol handler registration (tools/list, tools/call)
- Request routing to transport layer
- Error mapping (internal → JSON-RPC format)
- Tool execution with timeout handling

**Transport Layer**:
```typescript
// src/mcp-server/mcp-server.ts (lines 42-44)
this.transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// Connection (line 76)
await this.server.connect(this.transport);

// Request handling (lines 96-122)
async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  await this.transport.handleRequest(req, res);
}
```

### 3. StreamableHTTPServerTransport (from @modelcontextprotocol/sdk)

**Purpose**: Modern HTTP-based transport for MCP protocol with SSE support.

**Features**:
- **SSE Connection Handling**: GET requests establish server-sent event streams
- **Message Handling**: POST requests carry JSON-RPC messages
- **Session Management**: UUID-based session identification
- **Connection Resumability**: Event store for reconnection support
- **Bidirectional Communication**: Server can push notifications to client

**Why StreamableHTTP instead of SSE?**
- `SSEServerTransport` is **deprecated** in MCP SDK
- `StreamableHTTPServerTransport` is the **modern recommended approach**
- Better session management and resumability
- Unified request handling (no separate routes needed)
- More flexible (supports JSON response mode alternative to SSE)

## Request Flow

### SSE Connection Establishment (Claude Code connects)

1. **Claude Code initiates connection**:
   ```
   GET https://localhost:3333/mcp
   Accept: text/event-stream
   ```

2. **OAuthServer receives request**, checks pathname `/mcp`

3. **OAuthServer delegates to MCPServer**:
   ```typescript
   await this.mcpServer.handleRequest(req, res);
   ```

4. **MCPServer delegates to StreamableHTTPTransport**:
   ```typescript
   await this.transport.handleRequest(req, res);
   ```

5. **Transport establishes SSE stream**:
   ```
   HTTP/1.1 200 OK
   Content-Type: text/event-stream
   Cache-Control: no-cache
   Connection: keep-alive

   event: endpoint
   data: {"sessionId":"uuid-here","endpoint":"/mcp"}
   ```

6. **Connection remains open** for server-sent events

### MCP Message Exchange (Tool execution)

1. **Claude Code sends JSON-RPC message**:
   ```
   POST https://localhost:3333/mcp
   Content-Type: application/json

   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "tools/list",
     "params": {}
   }
   ```

2. **Request flows through**: OAuthServer → MCPServer → Transport

3. **Transport delivers to MCP Server**, handler processes:
   ```typescript
   server.setRequestHandler(ListToolsRequestSchema, async () => {
     return { tools: serviceRegistry.getAllTools() };
   });
   ```

4. **Response sent back through transport**:
   ```
   HTTP/1.1 200 OK
   Content-Type: application/json

   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "tools": [...]
     }
   }
   ```

## Session Management

### Session Lifecycle

**Initialization**:
```typescript
// UUID generated for each connection
sessionIdGenerator: () => randomUUID()
```

**Tracking**:
- Transport maintains session state internally
- No manual session storage required
- Automatic cleanup on connection close

**Resumability** (optional):
- Event store can be configured for connection recovery
- Clients reconnect with `Last-Event-ID` header
- Server replays missed events

## Connection Lifecycle

```
Client                    OAuthServer              MCPServer           Transport
  │                           │                        │                  │
  ├─── GET /mcp ────────────►│                        │                  │
  │                           ├─── handleRequest ────►│                  │
  │                           │                        ├── handleRequest ─►│
  │                           │                        │                  │
  │◄────── SSE Stream ────────────────────────────────────────────────────┤
  │    (event: endpoint)      │                        │                  │
  │                           │                        │                  │
  ├─── POST /mcp ────────────►│                        │                  │
  │    (JSON-RPC message)     ├─── handleRequest ────►│                  │
  │                           │                        ├── handleRequest ─►│
  │                           │                        │   (process msg)  │
  │◄────── JSON Response ──────────────────────────────────────────────────┤
  │                           │                        │                  │
  ├─── Connection Close ─────►│                        │                  │
  │                           │                        │◄─── onclose ─────┤
  │                           │                        │   (cleanup)      │
```

## Observability

### Structured Logging

All operations logged with structured JSON format using pino:

**Initialization**:
```json
{
  "operation": "mcp_transport_init",
  "transportType": "StreamableHTTPServerTransport",
  "sessionManagement": "enabled",
  "msg": "MCP server initialized with HTTP/SSE transport"
}
```

**Connection Events**:
```json
{
  "operation": "mcp_http_request",
  "method": "GET",
  "url": "/mcp",
  "msg": "MCP HTTP request: GET /mcp"
}
```

**Tool Execution**:
```json
{
  "operation": "mcp_tool_call",
  "correlationId": "uuid-here",
  "toolName": "microsoft.list-emails",
  "executionTimeMs": 234,
  "msg": "Tool call successful: microsoft.list-emails"
}
```

### Correlation IDs

Every operation includes a correlation ID for request tracing:
- Generated via `generateCorrelationId()` from `src/common`
- Propagated through tool execution
- Included in error responses
- Enables end-to-end tracing

## Error Handling

### Error Flow

1. **Internal Error Occurs** (e.g., tool execution fails)
2. **Wrapped as MCPError** (ToolExecutionError, AuthenticationRequiredError, etc.)
3. **Mapped to JSON-RPC Format** via `mapErrorToJSONRPC()`
4. **Returned to Client** with proper error code and data

### Error Types

| Error Type | JSON-RPC Code | Description |
|-----------|---------------|-------------|
| ToolNotFoundError | -32601 (Method not found) | Tool doesn't exist |
| ToolValidationError | -32602 (Invalid params) | Invalid input parameters |
| AuthenticationRequiredError | -32000 (Server error) | Service not authenticated |
| ToolExecutionError | -32603 (Internal error) | Tool execution failed |
| ToolTimeoutError | -32000 (Server error) | Tool exceeded timeout |

## Performance Considerations

### Connection Management

**Concurrent Connections**:
- Server supports multiple simultaneous Claude Code connections
- Each connection has unique session ID
- No connection limit enforced (relies on Node.js limits)

**Connection Timeout**:
- Tool execution timeout: 30 seconds (configurable via `MCP_TIMEOUT`)
- No SSE connection timeout (maintained indefinitely)

### Resource Cleanup

**Automatic Cleanup**:
- Transport `onclose` callback triggered on disconnect
- Resources released immediately
- No manual session tracking needed

## Security

### Localhost-Only Binding

Server binds to `localhost` only:
```typescript
server.listen(port, 'localhost')
```

### HTTPS Enforcement

**Production Mode**:
- Requires valid SSL certificates
- Auto-detects certificates via `detectSSLCertificates()`
- Falls back to HTTP in development

**Certificate Locations** (checked in order):
1. `./localhost.pem` + `./localhost-key.pem`
2. `./cert.pem` + `./key.pem`
3. Fallback to HTTP

### Token Security

- OAuth tokens stored encrypted at rest
- Never transmitted to MCP clients
- Used only server-side for API calls

## Testing Strategy

### Unit Tests

**Location**: `src/mcp-server/__tests__/mcp-server-http.test.ts`

**Coverage**:
- Transport initialization
- Request handling (GET/POST)
- Error handling
- Session management
- Connection lifecycle
- Logging/observability

### Integration Tests

**Location**: `tests/integration/unified-http-server.test.ts`

**Coverage**:
- OAuth and MCP routes coexist
- No route conflicts
- Concurrent access
- Full request/response cycle

### E2E Tests

**Location**: `tests/e2e/sse-connection.test.ts`

**Coverage**:
- SSE connection establishment
- MCP protocol handshake
- Tool discovery
- Tool execution
- Connection stability

## Configuration

### Environment Variables

```bash
# Transport configuration
MCP_TIMEOUT=30000              # Tool execution timeout (ms)
MCP_LOG_TOOL_INPUT=false       # Log tool input parameters

# Server configuration
AUTH_SERVER_PORT=3333          # Server port (don't change - OAuth apps registered here)
SERVER_VERSION=0.3.0           # Server version for capabilities
```

### Transport Options

StreamableHTTPServerTransport supports:
- `sessionIdGenerator`: Function to generate session IDs
- `eventStore`: Optional event store for resumability
- `enableJsonResponse`: Alternative to SSE (JSON polling)
- `retryInterval`: SSE retry timing

Currently configured:
```typescript
new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  // eventStore: Not configured (connections are stateful but not resumable)
})
```

## Future Enhancements

### Potential Improvements

1. **Connection Health Monitoring**:
   - Heartbeat mechanism
   - Connection duration tracking
   - Stale connection detection

2. **Event Store for Resumability**:
   - Add in-memory or persistent event store
   - Support `Last-Event-ID` header for reconnection
   - Replay missed events

3. **Metrics and Monitoring**:
   - Active connection count
   - Request latency histograms
   - Error rate tracking
   - Tool execution statistics

4. **Rate Limiting**:
   - Per-connection rate limits
   - Tool execution throttling
   - Prevent abuse

## References

- **MCP SDK Documentation**: [spec.modelcontextprotocol.io](https://spec.modelcontextprotocol.io/)
- **StreamableHTTP Implementation**: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js`
- **Spec 009**: [specs/009-sse-transport/spec.md](../../specs/009-sse-transport/spec.md)
- **Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

## Changelog

- **2026-01-20**: Initial documentation of existing architecture
- Transport: StreamableHTTPServerTransport (v1.25.2)
- Status: Fully implemented and tested
