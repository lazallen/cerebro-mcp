# Feature 009: SSE Transport for MCP Server

**Status**: 🔶 Partially Implemented - Dual-Port Support Required
**Priority**: P1 (Critical)
**Estimated Effort**: Medium
**Target Release**: v0.4.0
**Started**: 2026-01-20

---

## Implementation Status

**STATUS**: 🔶 **PARTIALLY IMPLEMENTED**

### Current State (2026-01-20)

The codebase uses `StreamableHTTPServerTransport` from MCP SDK v1.25.2, which is the modern, recommended approach. However, **SSL certificate trust issues prevent Claude Code CLI from connecting**.

### Problem Identified

**Root Cause**: OAuth and MCP share the same HTTP server on port 3333:
- OAuth **requires HTTPS** (port 3333) for secure authentication
- Claude Code CLI **fails with HTTPS** due to self-signed certificate trust issues
- Cannot use HTTP for OAuth (security requirement)
- Cannot disable SSL verification in Claude Code CLI

**Current Limitation**:
```
Port 3333 (HTTPS) - Unified Server
  ├─ GET  /                     → OAuth Dashboard ✅
  ├─ GET  /auth/:service/*      → OAuth Flows ✅
  └─ GET/POST /mcp              → MCP Endpoint ❌ (SSL trust issue)
```

### Solution: Dual-Port Architecture

Run two separate HTTP servers:

**Proposed Architecture**:
```
Port 3333 (HTTPS) - OAuthServer
  ├─ GET  /                     → Dashboard
  ├─ GET  /auth/:service/login  → OAuth
  ├─ GET  /auth/:service/callback → OAuth
  └─ GET/POST /mcp              → MCPServer (backward compat)

Port 3334 (HTTP) - MCPServer Direct
  └─ GET/POST /mcp              → MCP Protocol
```

**Benefits**:
- ✅ HTTPS for OAuth (secure authentication - non-negotiable)
- ✅ HTTP for MCP (Claude Code CLI compatibility)
- ✅ Backward compatibility (existing `/mcp` on 3333 still works)
- ✅ Independent scaling/monitoring
- ✅ No SSL certificate issues for MCP clients

### Implementation Required

#### New Functional Requirements

**FR-051: Dual-Port HTTP Server Architecture**
- **Priority**: P1
- **Description**: Run MCP server on separate port with HTTP
- **Input**: Environment variable `MCP_SERVER_PORT` (default: 3334)
- **Output**: Two HTTP servers running independently
- **Acceptance**:
  - OAuth server on port 3333 (HTTPS)
  - MCP server on port 3334 (HTTP)
  - Both share same ServiceRegistry
  - Both work simultaneously without conflicts

**FR-052: HTTP-Only MCP Transport**
- **Priority**: P1
- **Description**: MCP endpoint accessible via plain HTTP
- **Input**: HTTP requests to `http://localhost:3334/mcp`
- **Output**: MCP protocol responses without SSL
- **Acceptance**:
  - Claude Code CLI connects successfully
  - No SSL certificate trust issues
  - Full MCP protocol functionality maintained

### Estimated Changes

**Difficulty**: Easy (< 100 lines)
**Files to Modify**:
1. `src/common/config.ts` - Add `mcpServerPort` config (~10 lines)
2. `src/index.ts` - Create second HTTP server (~40-50 lines)
3. `.env.example` - Document `MCP_SERVER_PORT` (~5 lines)
4. Test files - Update port references (~20-30 lines)

**Total**: ~75-95 lines of code

### Key Differences from Original Spec

| Spec Proposal | Current Implementation | Status | Reason |
|--------------|----------------------|--------|--------|
| Use SSEServerTransport | Uses StreamableHTTPServerTransport | ✅ Better | SSEServerTransport is deprecated |
| Separate `/sse` and `/message` routes | Single `/mcp` route | ✅ Simpler | Transport abstracts internally |
| Single HTTP server | **Dual HTTP servers needed** | 🔶 Required | SSL trust issues with unified approach |
| HTTP or HTTPS | **Both: HTTPS for OAuth, HTTP for MCP** | 🔶 Required | Security + compatibility |

### All Spec Goals Status

- ✅ **SSE-capable transport** - StreamableHTTPServerTransport supports SSE natively
- ✅ **No stdio pollution** - All communication via HTTP
- ✅ **OAuth dashboard accessible while MCP connected** - Both run simultaneously
- ✅ **Clean structured logging** - pino logger with correlation IDs
- ✅ **Connection stability** - Built-in session management and resumability support
- 🔶 **Single HTTP server for OAuth and MCP** - Need dual-port for SSL compatibility
- 🔶 **Claude Code connectivity** - Blocked by SSL trust issues (dual-port solves this)

### Verification (After Dual-Port Implementation)

1. **Start server**:
   ```bash
   npm start
   ```

2. **Check logs** - Should see:
   ```
   {"operation":"mcp_server_init","msg":"MCP server initialized with Streamable HTTP transport"}
   {"operation":"server_ready","oauthEndpoint":"https://localhost:3333/","msg":"OAuth server ready"}
   {"operation":"server_ready","mcpEndpoint":"http://localhost:3334/mcp","msg":"MCP server ready"}
   ```

3. **Configure Claude Code** (using HTTP on port 3334):
   ```bash
   claude mcp add --transport http cerebro http://localhost:3334/mcp
   ```

4. **Connect and test**:
   - Claude Code should connect successfully (no SSL issues)
   - Tools should be discoverable
   - Tool execution should work
   - OAuth still secure on HTTPS port 3333

5. **Verify dual servers**:
   - Access OAuth dashboard: `https://localhost:3333/`
   - MCP endpoint HTTP: `curl http://localhost:3334/mcp`
   - MCP endpoint HTTPS (backward compat): `curl https://localhost:3333/mcp`

### Test Coverage

✅ **Unit Tests**: `src/mcp-server/__tests__/mcp-server-http.test.ts` (19 tests passing)
- Transport initialization
- Request handling (GET for SSE, POST for messages)
- Error handling
- Connection lifecycle
- Session management
- Logging and observability

🔶 **Integration Tests Needed**:
- Dual-port server startup
- Both ports accessible simultaneously
- ServiceRegistry shared correctly
- OAuth and MCP work independently

---

## Overview

Convert the MCP server from stdio transport to SSE (Server-Sent Events) HTTP transport, enabling it to run on the same HTTP server as the OAuth authentication endpoint without port conflicts or stdio pollution.

---

## Business Context

### Problem Statement

Currently, the MCP server uses stdio transport which creates architectural conflicts:

1. **Claude Code Incompatibility**: When Claude Code launches the MCP server via stdio, the HTTP OAuth server logs pollute stdout, breaking MCP protocol communication
2. **Separate Process Required**: Users must run two separate processes - one for MCP (stdio) and one for OAuth (HTTP)
3. **Authentication UX**: Users cannot interact with the authentication dashboard while the MCP server is running in Claude Code
4. **Port Confusion**: Having both transports creates confusion about how services communicate

**Reference**: Current implementation in [src/index.ts:63-67](../../src/index.ts#L63-L67) starts both OAuth HTTP server (port 3333) and MCP stdio server simultaneously.

### User Value

With SSE transport, users can:
- Run a single HTTP server that handles both MCP protocol and OAuth authentication
- Use Claude Code to interact with MCP tools via HTTP
- Access the authentication dashboard at the same time
- Have cleaner logs with no stdio pollution
- Configure a single port for all functionality

### Impact

**Without this feature:**
- Complex dual-process architecture
- Authentication requires stopping Claude Code connection
- Debugging is difficult due to mixed stdout
- Cannot use HTTP-based MCP features

**With this feature:**
- Single unified HTTP server on one port
- OAuth dashboard accessible while MCP is active
- Clean separation of concerns
- Better debugging and monitoring
- Simplified deployment

---

## Technical Design

### Architecture Changes

#### Current Architecture
```
┌─────────────────┐
│   src/index.ts  │
├─────────────────┤
│ OAuth Server    │ ──> HTTP :3333
│ (port 3333)     │
│                 │
│ MCP Server      │ ──> stdio
│ (stdio)         │
└─────────────────┘
```

#### New Architecture
```
┌─────────────────────────────────┐
│        src/index.ts             │
├─────────────────────────────────┤
│  Unified HTTP Server (:3333)    │
│                                 │
│  ┌───────────┐  ┌────────────┐ │
│  │  OAuth    │  │    MCP     │ │
│  │  Routes   │  │ SSE Routes │ │
│  │           │  │            │ │
│  │ /auth/*   │  │ /sse       │ │
│  │ /         │  │ /message   │ │
│  └───────────┘  └────────────┘ │
└─────────────────────────────────┘
```

### MCP SDK SSE Transport

The `@modelcontextprotocol/sdk` provides `SSEServerTransport` for HTTP-based communication:

```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
```

**Key Methods:**
- `handlePostMessage(request, response)` - Handle POST to /message endpoint
- `handleSseConnection(request, response)` - Handle GET to /sse endpoint

### Implementation Strategy

#### Option 1: Unified HTTP Server (Recommended)

Extend the existing OAuth server to handle MCP routes:

**Pros:**
- Single port for all functionality
- OAuth and MCP share the same server
- Simpler deployment and configuration

**Cons:**
- Couples OAuth and MCP concerns
- Larger oauth-server.ts file

#### Option 2: Separate HTTP Servers on Different Ports

Run OAuth on :3333 and MCP on :3334:

**Pros:**
- Complete separation of concerns
- Independent scaling

**Cons:**
- Two ports to manage
- Doesn't solve the original problem
- More complex configuration

**Decision: Use Option 1** - Unified HTTP server on port 3333

### Detailed Implementation

#### File: `src/mcp-server/mcp-server.ts`

**Changes:**
1. Remove `StdioServerTransport` import
2. Add `SSEServerTransport` import
3. Change constructor to not initialize transport
4. Add `handleSSEConnection()` method
5. Add `handlePostMessage()` method
6. Update `start()` to not connect transport

```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export class MCPServer {
  private readonly server: Server;
  private readonly serviceRegistry: ServiceRegistry;
  private transport?: SSEServerTransport;

  constructor(serviceRegistry: ServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
    // ... config ...
    
    // Create MCP server (no transport yet)
    this.server = new Server(
      { name: globalConfig.serverName, version: globalConfig.serverVersion },
      { capabilities: { tools: {} } }
    );
  }

  /**
   * Handle SSE connection (GET /sse)
   */
  handleSSEConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.transport) {
      this.transport = new SSEServerTransport('/message', res);
      this.server.connect(this.transport);
    }
    this.transport.handleSseConnection(req, res);
  }

  /**
   * Handle MCP message (POST /message)
   */
  async handlePostMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.transport) {
      res.writeHead(400);
      res.end('SSE connection not established');
      return;
    }
    await this.transport.handlePostMessage(req, res);
  }

  async start(): Promise<void> {
    this.setupHandlers();
    // No transport connection here - happens on first SSE request
  }
}
```

#### File: `src/auth-server/oauth-server.ts`

**Changes:**
1. Add MCPServer reference
2. Add route handlers for `/sse` and `/message`
3. Update `handleRequest()` to route MCP endpoints

```typescript
import { MCPServer } from '../mcp-server';

export class OAuthServer {
  private mcpServer?: MCPServer;

  /**
   * Register MCP server for handling MCP routes
   */
  registerMCPServer(mcpServer: MCPServer): void {
    this.mcpServer = mcpServer;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url ?? '/', true);
    const pathname = parsedUrl.pathname ?? '/';

    // MCP SSE endpoint
    if (pathname === '/sse' && req.method === 'GET') {
      if (!this.mcpServer) {
        this.renderError(res, 'MCP Not Available', 'MCP server not registered');
        return;
      }
      this.mcpServer.handleSSEConnection(req, res);
      return;
    }

    // MCP message endpoint
    if (pathname === '/message' && req.method === 'POST') {
      if (!this.mcpServer) {
        res.writeHead(400);
        res.end('MCP server not registered');
        return;
      }
      await this.mcpServer.handlePostMessage(req, res);
      return;
    }

    // ... existing OAuth routes ...
  }
}
```

#### File: `src/index.ts`

**Changes:**
1. Create MCP server without starting
2. Register MCP server with OAuth server
3. Start only OAuth server (which now handles MCP routes)

```typescript
async function main(): Promise<void> {
  // 1. Initialize service registry
  await registerServices(serviceRegistry);

  // 2. Create MCP server (without transport)
  mcpServer = new MCPServer(serviceRegistry);
  await mcpServer.start();

  // 3. Start OAuth server
  oauthServer = new OAuthServer();
  
  // Register MCP server with OAuth server for route handling
  oauthServer.registerMCPServer(mcpServer);

  // Register services with OAuth server
  for (const [serviceName, service] of serviceRegistry.services.entries()) {
    // ... existing registration code ...
  }

  await oauthServer.start();

  logger.info({
    operation: 'server_ready',
    httpPort: globalConfig.authServerPort,
    mcpEndpoint: `${protocol}://localhost:${globalConfig.authServerPort}/sse`,
    oauthDashboard: `${protocol}://localhost:${globalConfig.authServerPort}/`,
    msg: 'Unified HTTP server ready (OAuth + MCP SSE)',
  });
}
```

### Claude Code Configuration

Users will need to update their Claude Code MCP configuration to use HTTP/SSE transport:

**Before (stdio):**
```json
{
  "mcpServers": {
    "cerebro": {
      "command": "node",
      "args": ["/path/to/cerebro-mcp/dist/index.js"]
    }
  }
}
```

**After (SSE):**
```json
{
  "mcpServers": {
    "cerebro": {
      "url": "http://localhost:3333/sse"
    }
  }
}
```

---

## User Stories

### User Story 1: Single Server Process (P1)

**As a** developer
**I want to** run a single HTTP server for both OAuth and MCP
**So that** I don't need to manage multiple processes

**Acceptance Criteria**:
1. Single HTTP server runs on port 3333
2. OAuth routes work at `/auth/*` and `/`
3. MCP SSE endpoint works at `/sse`
4. MCP message endpoint works at `/message`
5. Both functionalities work simultaneously

**Independent Test**: Start server, access `http://localhost:3333/` (OAuth dashboard) and connect Claude Code to `http://localhost:3333/sse` (MCP) - both should work.

---

### User Story 2: Clean Logging (P1)

**As a** developer
**I want** structured logs without stdio pollution
**So that** I can debug issues effectively

**Acceptance Criteria**:
1. All logs go to stderr or log files
2. stdout is not polluted with server logs
3. MCP protocol communication is separate from application logs
4. Correlation IDs track requests across OAuth and MCP

**Independent Test**: Start server with `npm start | pino-pretty` and verify clean, structured JSON logs.

---

### User Story 3: Authentication While Running (P1)

**As a** user
**I want to** authenticate services while Claude Code is connected
**So that** I don't need to disconnect to authenticate

**Acceptance Criteria**:
1. OAuth dashboard accessible at `http://localhost:3333/`
2. Authentication flows work while MCP is connected
3. No interference between OAuth and MCP traffic
4. New tokens available to MCP tools immediately

**Independent Test**: Connect Claude Code to MCP endpoint, then authenticate a service via browser - both should work without conflicts.

---

### User Story 4: Claude Code Integration (P1)

**As a** user
**I want to** configure Claude Code to use HTTP/SSE transport
**So that** I can use Cerebro MCP from Claude Code

**Acceptance Criteria**:
1. Claude Code config uses `url` instead of `command`
2. SSE endpoint URL is documented
3. Connection establishes successfully
4. Tools are discoverable and executable
5. Error messages are clear

**Independent Test**: Configure Claude Code with SSE URL, verify connection, list tools, execute a tool.

---

## Functional Requirements

### FR-047: SSE Transport Support
- **Priority**: P1
- **Description**: MCP server uses SSE transport instead of stdio
- **Input**: HTTP GET to `/sse`
- **Output**: SSE connection established
- **Acceptance**:
  - SSEServerTransport initialized
  - Connection maintained
  - Events flow bidirectionally
  - Connection closures handled

### FR-048: HTTP Message Endpoint
- **Priority**: P1
- **Description**: Handle MCP protocol messages via POST
- **Input**: HTTP POST to `/message` with JSON-RPC payload
- **Output**: JSON-RPC response
- **Acceptance**:
  - POST requests parsed
  - MCP protocol messages routed
  - Responses returned correctly
  - Errors handled properly

### FR-049: Unified HTTP Server
- **Priority**: P1
- **Description**: Single HTTP server handles OAuth and MCP routes
- **Input**: HTTP requests to various paths
- **Output**: Appropriate responses based on route
- **Acceptance**:
  - OAuth routes (`/auth/*`, `/`) work
  - MCP routes (`/sse`, `/message`) work
  - No route conflicts
  - Clean separation of concerns

### FR-050: Backward Compatibility Mode
- **Priority**: P2
- **Description**: Optional stdio mode for backward compatibility
- **Input**: Environment variable `MCP_TRANSPORT=stdio`
- **Output**: Server runs in stdio mode
- **Acceptance**:
  - Env var detected
  - Stdio transport used instead of SSE
  - OAuth server optionally disabled
  - Logs indicate transport mode

---

## Success Criteria

- **SC-001**: Single HTTP server runs on one port with both OAuth and MCP functionality
- **SC-002**: Claude Code successfully connects via SSE transport
- **SC-003**: All existing MCP tools work identically via SSE
- **SC-004**: OAuth authentication works while MCP is connected
- **SC-005**: No stdio pollution - clean structured logs
- **SC-006**: Connection establishment time < 1 second
- **SC-007**: SSE connection stable for > 1 hour
- **SC-008**: Zero data loss during transport switch

---

## Test Plan

### Unit Tests

**MCP Server**:
- ✓ `handleSSEConnection()` creates transport
- ✓ `handlePostMessage()` routes to transport
- ✓ Multiple connections handled correctly
- ✓ Connection cleanup on close

**OAuth Server**:
- ✓ `/sse` route calls MCP server
- ✓ `/message` route calls MCP server
- ✓ OAuth routes still work
- ✓ Route conflicts prevented

### Integration Tests

- [ ] Start unified HTTP server
- [ ] Access OAuth dashboard at `/`
- [ ] Connect to `/sse` with SSE client
- [ ] Send JSON-RPC message to `/message`
- [ ] Verify tool list returned
- [ ] Execute a tool via MCP
- [ ] Authenticate a service via OAuth
- [ ] Verify authenticated tool works
- [ ] Test connection resilience
- [ ] Test error scenarios

---

## Security Considerations

- **Localhost Only**: Server remains bound to localhost
- **No Additional Attack Surface**: Same HTTP server, just different routes
- **CORS**: Not needed (localhost only)
- **Authentication**: MCP relies on OAuth tokens (unchanged)
- **DoS**: Rate limiting on message endpoint (future enhancement)

---

## Dependencies

### Internal Dependencies
- Feature 002 (OAuth Server) - Base HTTP server
- Feature 003 (MCP Protocol Handler) - MCP server implementation

### External Dependencies
- `@modelcontextprotocol/sdk` >= 1.0.0 (already installed)
- SSE browser/client support (built into Claude Code)

---

## Migration & Deployment

### Deployment Steps

1. Update code to use SSE transport
2. Build: `npm run build`
3. Update Claude Code config to use SSE URL
4. Restart server: `npm start`
5. Verify `/sse` endpoint accessible
6. Test tool execution

### Breaking Changes

**Claude Code Configuration**: Users must update MCP config from `command` to `url` format

**Migration Script**: Provide example config and documentation

### Rollback Plan

If issues arise:
1. Revert code changes
2. Restart with stdio transport
3. Update Claude Code config back to `command` format
4. No data loss or token issues

---

## Documentation Updates

### Files to Update
- **README.md**: Update setup instructions for SSE transport
- **CHANGELOG.md**: Document transport change

### New Documentation
- `docs/sse-transport.md`: SSE transport architecture and configuration
- `docs/claude-code-setup.md`: How to configure Claude Code for SSE

---

## Implementation Checklist

### Phase 1: Core SSE Support
- [ ] Add SSE transport to MCPServer
- [ ] Implement `handleSSEConnection()`
- [ ] Implement `handlePostMessage()`
- [ ] Add unit tests

### Phase 2: OAuth Server Integration
- [ ] Add MCP route handlers to OAuthServer
- [ ] Implement `registerMCPServer()`
- [ ] Route `/sse` and `/message` to MCP
- [ ] Add integration tests

### Phase 3: Main Entry Point
- [ ] Update `src/index.ts` to use unified server
- [ ] Remove stdio transport initialization
- [ ] Update startup logs
- [ ] Test end-to-end

### Phase 4: Documentation
- [ ] Update README with SSE setup
- [ ] Create Claude Code config examples
- [ ] Document architecture change
- [ ] Update CHANGELOG

### Phase 5: Testing
- [ ] Manual testing with Claude Code
- [ ] Test OAuth while MCP connected
- [ ] Test connection resilience
- [ ] Performance testing

---

## Acceptance Criteria

- [ ] Spec document created
- [ ] SSE transport implemented in MCPServer
- [ ] OAuth server handles MCP routes
- [ ] Single unified HTTP server runs
- [ ] Claude Code connects successfully
- [ ] All tools work via SSE
- [ ] OAuth authentication works simultaneously
- [ ] No stdio pollution
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Documentation updated
- [ ] Configuration examples provided
- [ ] Migration guide created

