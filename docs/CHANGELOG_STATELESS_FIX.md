# Stateless Mode Fix - Resolves Sequential Connection Failures

## Issue

After the initial connection reliability improvements, a new issue was discovered:
- **First connection**: Works perfectly ✓
- **Second connection**: Fails with "Mcp-Session-Id header is required" error ✗
- **All subsequent connections**: Continue to fail ✗

This made the MCP server essentially unusable for repeated connections from Claude Code.

## Root Cause

The `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` (v1.25.3) was configured in **stateful mode** by default:

```typescript
// OLD - Stateful mode (problematic)
this.transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
```

In stateful mode:
1. Server generates a session ID on first connection
2. Session ID is returned in response headers
3. **Client must send this session ID in ALL subsequent requests**
4. Requests without the session ID are rejected with "Mcp-Session-Id header is required"

The problem was that the MCP client (Claude Code) wasn't maintaining these session IDs across requests, causing all subsequent connections to fail.

## Solution

Switch to **stateless mode** by setting `sessionIdGenerator` to `undefined`:

```typescript
// NEW - Stateless mode (working)
this.transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // undefined = stateless mode
});
```

In stateless mode:
- No session IDs are generated or required
- Each request is treated independently
- No state is maintained between requests
- Connections work repeatedly without session tracking

## Changes Made

### File: `src/mcp-server/mcp-server.ts`

**Before:**
```typescript
// Create Streamable HTTP transport with per-session server creation
this.transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
```

**After:**
```typescript
// Create Streamable HTTP transport in STATELESS mode
// Stateless mode: no session IDs required, each request is independent
// This prevents "Mcp-Session-Id header is required" errors on subsequent connections
this.transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // undefined = stateless mode
});
```

**Also removed:**
- Removed unused `randomUUID` import (no longer needed in stateless mode)
- Updated initialization log to indicate stateless mode

## Testing

Verified with 10 sequential connections - all succeeded:

```bash
Test 1: ✓ SUCCESS
Test 2: ✓ SUCCESS
Test 3: ✓ SUCCESS
Test 4: ✓ SUCCESS
Test 5: ✓ SUCCESS
Test 6: ✓ SUCCESS
Test 7: ✓ SUCCESS
Test 8: ✓ SUCCESS
Test 9: ✓ SUCCESS
Test 10: ✓ SUCCESS
```

## Trade-offs

### Stateless Mode Benefits:
✓ Works with any MCP client (no session management required)
✓ Simpler - no session state to track
✓ More reliable - no session ID mismatches
✓ Better for serverless/distributed deployments
✓ Prevents connection failures on reconnect

### Stateless Mode Limitations:
✗ No per-session state preservation
✗ No message history across requests
✗ Each request must include all necessary context

**For this use case (tool execution), stateless mode is ideal** because:
- Each tool call is independent
- No session state is needed between requests
- Reliability is more important than session tracking

## Impact on Existing Functionality

**No breaking changes** - this only affects the transport layer:
- ✓ Tool discovery still works
- ✓ Tool execution still works
- ✓ Authentication still works
- ✓ All services still work (Microsoft, Slack, LocalFoundry)
- ✓ Health checks still work
- ✓ OAuth flows still work

The only difference is that the server no longer tracks session IDs, which wasn't being used anyway.

## Verification Steps

To verify the fix:

```bash
# 1. Rebuild
npm run build

# 2. Restart server
./start-mcp.sh restart

# 3. Test repeated connections
for i in {1..5}; do
  echo "Test $i:"
  curl -s -X POST http://localhost:3334/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
    | head -2
  echo ""
done
```

All requests should return:
```
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"cerebro-mcp-ts","version":"0.3.0"}},"jsonrpc":"2.0","id":1}
```

## Relation to Other Fixes

This fix complements the earlier connection reliability improvements:

1. **Health Checks** (earlier) - Monitor server status
2. **Keep-Alive** (earlier) - Prevent connection drops
3. **Enhanced Logging** (earlier) - Debug connection issues
4. **Stateless Mode** (this fix) - Fix sequential connection failures

Together, these fixes ensure:
- ✓ Server stays healthy and running
- ✓ Connections don't drop due to timeouts
- ✓ Issues can be easily diagnosed
- ✓ **Repeated connections work reliably**

## References

- MCP SDK Documentation: StreamableHTTPServerTransport
- Issue: "Mcp-Session-Id header is required" on second connection
- Solution: Use stateless mode for independent request handling

---

**Version**: 0.3.0+
**Date**: 2026-01-29
**Status**: Deployed and tested
**Testing**: 10 sequential connections - 100% success rate
