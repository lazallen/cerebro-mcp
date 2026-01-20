# Claude Code Setup Guide

Complete guide to configuring Claude Code to work with Cerebro MCP.

## Prerequisites

1. **Claude Code installed** - The official Claude CLI tool
2. **Cerebro MCP running** - Server must be started before connecting
3. **SSL certificates** (recommended) - For HTTPS connections
4. **Services authenticated** (optional) - For service-specific tools

## Quick Start

### 1. Start the Server

```bash
cd ~/code/cerebro-mcp
npm start
```

**Expected output**:
```json
{"operation":"server_ready","mcpEndpoint":"https://localhost:3333/mcp","msg":"Server ready..."}
```

### 2. Configure Claude Code

Edit your Claude Code configuration file:

**Linux**: `~/.config/claude/config.json`
**macOS**: `~/Library/Application Support/Claude/config.json`
**Windows**: `%APPDATA%\Claude\config.json`

Add:
```json
{
  "mcpServers": {
    "cerebro": {
      "url": "https://localhost:3333/mcp"
    }
  }
}
```

### 3. Restart Claude Code

Close and reopen Claude Code to load the new configuration.

### 4. Verify Connection

In Claude Code, tools should be available:
- `microsoft.list-emails`
- `microsoft.list-events`
- `slack.list-channels`
- etc.

## Detailed Configuration

### Understanding the Config Format

```json
{
  "mcpServers": {
    "cerebro": {                           // Server identifier (can be any name)
      "url": "https://localhost:3333/mcp"  // Full URL to MCP endpoint
    }
  }
}
```

**Key Points**:
- Use `https://` when SSL certificates are configured
- Use `http://localhost:3333/mcp` if running without SSL
- The `/mcp` path is required (it's the MCP endpoint)
- Port 3333 is the default (configured in server)

### Multiple Servers

You can configure multiple MCP servers:

```json
{
  "mcpServers": {
    "cerebro": {
      "url": "https://localhost:3333/mcp"
    },
    "another-server": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

## SSL Certificate Setup

For HTTPS connections (recommended for security):

### Using mkcert (Easiest)

```bash
# Install mkcert
# macOS:
brew install mkcert

# Linux:
# Download from: https://github.com/FiloSottile/mkcert/releases

# Install local CA
mkcert -install

# Generate certificates in cerebro-mcp directory
cd ~/code/cerebro-mcp
mkcert localhost 127.0.0.1 ::1

# This creates:
# - localhost.pem (certificate)
# - localhost-key.pem (private key)

# Restart server
npm start
```

Server will auto-detect and use these certificates.

### Without SSL (Development Only)

If you don't have SSL certificates:

1. Server will run on HTTP
2. Update config to use `http://`:
   ```json
   {
     "mcpServers": {
       "cerebro": {
         "url": "http://localhost:3333/mcp"
       }
     }
   }
   ```

**Note**: HTTP is less secure and not recommended for production use.

## Troubleshooting

### "Does not adhere to MCP server configuration schema"

**Cause**: Invalid JSON or wrong config format

**Solutions**:

1. **Check JSON syntax**:
   ```bash
   # Validate JSON
   cat ~/.config/claude/config.json | jq .
   ```

   Common issues:
   - Trailing commas (not allowed in JSON)
   - Missing quotes around strings
   - Incorrect bracket/brace matching

2. **Verify config file location**:
   - Claude Code vs Claude Desktop use different paths
   - Check you're editing the right file

3. **Verify URL format**:
   ```json
   ✅ Correct: "url": "https://localhost:3333/mcp"
   ❌ Wrong: "url": "localhost:3333/mcp"      (missing protocol)
   ❌ Wrong: "url": "https://localhost:3333"  (missing /mcp path)
   ```

### "Connection Failed" or "Server Not Available"

**Diagnosis**:

```bash
# 1. Check if server is running
curl https://localhost:3333/

# Should return HTML dashboard
# If it fails, server is not running

# 2. Check MCP endpoint specifically
curl https://localhost:3333/mcp

# Should hang (waiting for SSE) or return response
# If 404, endpoint misconfigured

# 3. Check server logs
npm start

# Look for:
# {"operation":"server_ready","mcpEndpoint":"https://localhost:3333/mcp"}
```

**Solutions**:

1. **Server not running**:
   ```bash
   cd ~/code/cerebro-mcp
   npm start
   ```

2. **Wrong port**:
   - Default is 3333
   - Check `AUTH_SERVER_PORT` in `.env`
   - Update config to match

3. **Firewall blocking**:
   ```bash
   # Check if port is open
   netstat -an | grep 3333

   # Should show LISTEN on port 3333
   ```

4. **SSL certificate issues**:
   - Regenerate certificates with mkcert
   - Or switch to HTTP (development only)

### "SSL Certificate Error" or "Certificate Not Trusted"

**Cause**: Self-signed certificate not trusted

**Solutions**:

1. **Install mkcert CA**:
   ```bash
   mkcert -install
   ```
   This installs the mkcert certificate authority in your system's trust store.

2. **Regenerate certificates**:
   ```bash
   cd ~/code/cerebro-mcp
   rm localhost*.pem
   mkcert localhost 127.0.0.1 ::1
   npm start
   ```

3. **Temporary workaround** (development only):
   - Use HTTP instead of HTTPS
   - Update config to `http://localhost:3333/mcp`

### Tools Not Showing Up

**Possible causes**:

1. **Services not authenticated**:
   ```bash
   # Visit dashboard
   open https://localhost:3333/

   # Click "Authenticate" for each service
   # Follow OAuth flow
   ```

2. **No credentials configured**:
   - Check `.env` file has service credentials
   - Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
   - Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`

3. **Services not registered**:
   - Check server logs for service registration
   - Look for: `{"operation":"oauth_service_registered","service":"microsoft"}`

### Connection Drops or Becomes Unstable

**Diagnosis**:

```bash
# Check server logs for errors
npm start

# Look for:
# - Connection timeouts
# - Transport errors
# - Session errors
```

**Solutions**:

1. **Increase timeout** (if tool execution is slow):
   ```bash
   # In .env
   MCP_TIMEOUT=60000  # 60 seconds
   ```

2. **Check network**:
   - Ensure stable localhost connection
   - Check for proxy/VPN interference

3. **Restart both**:
   ```bash
   # 1. Stop server (Ctrl+C)
   # 2. Close Claude Code
   # 3. Start server
   npm start
   # 4. Open Claude Code
   ```

## Advanced Configuration

### Custom Port

If you need to use a different port:

1. **Change server port**:
   ```bash
   # In .env
   AUTH_SERVER_PORT=4000
   ```

2. **Update Claude Code config**:
   ```json
   {
     "mcpServers": {
       "cerebro": {
         "url": "https://localhost:4000/mcp"
       }
     }
   }
   ```

3. **Important**: OAuth callback URLs must match port
   - Microsoft: Redirect URI must be `https://localhost:4000/auth/microsoft/callback`
   - Slack: Redirect URI must be `https://localhost:4000/auth/slack/callback`
   - You'll need to update your OAuth app registrations

### Debug Logging

Enable verbose logging:

```bash
# In .env
MCP_LOG_TOOL_INPUT=true  # Log tool input parameters
LOG_LEVEL=debug          # Verbose logging
```

Then check logs:
```bash
npm start | pino-pretty
```

### Test Mode

For testing without real services:

```bash
# In .env
USE_TEST_MODE=true
```

This returns mock data for all tools without making real API calls.

## Verification Checklist

After setup, verify everything works:

- [ ] Server starts without errors
- [ ] Dashboard accessible at `https://localhost:3333/`
- [ ] Claude Code config file has correct JSON
- [ ] Claude Code shows Cerebro tools in available tools
- [ ] Can execute a tool (e.g., `microsoft.check-auth-status`)
- [ ] OAuth authentication works (can authenticate via browser)
- [ ] Authenticated tools work (e.g., `microsoft.list-emails` after auth)

## Getting Help

If you're still having issues:

1. **Check server logs**:
   ```bash
   npm start
   ```
   Look for errors or warnings

2. **Check test suite**:
   ```bash
   npm test
   ```
   Ensure all tests pass

3. **Review architecture docs**:
   - [HTTP Transport Architecture](../architecture/http-transport.md)
   - [Spec 009: SSE Transport](../../specs/009-sse-transport/spec.md)

4. **Check OAuth setup**:
   - Verify credentials in `.env`
   - Check OAuth app redirect URIs match server port

## Example: Complete Setup Flow

Here's a complete example from scratch:

```bash
# 1. Clone and setup
cd ~/code/cerebro-mcp
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Microsoft/Slack credentials

# 3. Generate SSL certificates
brew install mkcert  # or appropriate for your OS
mkcert -install
mkcert localhost 127.0.0.1 ::1

# 4. Build and start
npm run build
npm start

# Expected output:
# {"operation":"server_ready","mcpEndpoint":"https://localhost:3333/mcp"}

# 5. Configure Claude Code
cat > ~/.config/claude/config.json << 'EOF'
{
  "mcpServers": {
    "cerebro": {
      "url": "https://localhost:3333/mcp"
    }
  }
}
EOF

# 6. Restart Claude Code
# Close and reopen the application

# 7. Authenticate services
open https://localhost:3333/
# Click "Authenticate" for each service

# 8. Test in Claude Code
# Ask Claude: "List my recent emails"
# Should use the microsoft.list-emails tool
```

## Network Debugging

### Using Browser DevTools

To see the SSE connection and messages:

1. Open browser to `https://localhost:3333/`
2. Open DevTools (F12)
3. Go to Network tab
4. Filter by "EventSource" or "SSE"
5. You'll see the `/mcp` connection

This shows:
- SSE connection establishment
- Events flowing from server
- POST requests for messages

### Using curl

Test the endpoint manually:

```bash
# Test SSE connection (will hang, waiting for events)
curl -N https://localhost:3333/mcp \
  -H "Accept: text/event-stream"

# Should see:
# event: endpoint
# data: {"sessionId":"...","endpoint":"/mcp"}

# Test POST message
curl -X POST https://localhost:3333/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'

# Should return JSON-RPC response
```

## Security Considerations

### Localhost Only

The server only binds to `localhost` - it's not accessible from other machines on your network. This is intentional for security.

### HTTPS Recommended

Use HTTPS (with mkcert) to:
- Encrypt communication (even on localhost)
- Follow OAuth best practices
- Prevent token interception

### Token Storage

OAuth tokens are:
- Stored encrypted at rest in `~/.cerebro-mcp/`
- Never transmitted to Claude Code
- Only used server-side for API calls

## References

- [Main README](../../README.md) - Project overview
- [HTTP Transport Architecture](../architecture/http-transport.md) - Technical details
- [MCP Protocol Spec](https://spec.modelcontextprotocol.io/) - MCP documentation
- [Spec 009](../../specs/009-sse-transport/spec.md) - Implementation details
