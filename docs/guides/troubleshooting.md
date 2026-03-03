# MCP Connection Troubleshooting Guide

This guide helps you debug and fix connection issues between Claude Code and the Cerebro MCP server.

## Quick Diagnosis

Run these commands to check the server status:

```bash
# Check if server is running
./start-mcp.sh status

# View server logs
./start-mcp.sh logs

# Test health endpoint
curl http://localhost:3334/health
```

## Common Issues and Solutions

### 1. "Unable to connect to MCP server"

**Symptoms:**
- Claude Code shows "Unable to connect" or times out
- No response from the server

**Diagnosis:**
```bash
# Check if ports are listening
ss -tlnp | grep -E ":(3333|3334)"

# Test connectivity
curl http://localhost:3334/health
```

**Solutions:**

**A. Server not running:**
```bash
./start-mcp.sh start
```

**B. Port conflicts:**
```bash
# Find what's using the ports
lsof -i:3333
lsof -i:3334

# Stop conflicting processes
./start-mcp.sh stop
./start-mcp.sh start
```

**C. Firewall issues:**
```bash
# Check if localhost connections are blocked
sudo iptables -L | grep 3334
```

### 2. "Connection refused" or "ECONNREFUSED"

**Symptoms:**
- Immediate connection rejection
- "Connection refused" in Claude Code

**Solutions:**

**A. Server crashed - check logs:**
```bash
tail -50 logs/mcp-server.log
```

**B. Wrong port configuration:**
- Check `~/.claude.json` (should have: `"url": "http://localhost:3334/mcp"`)
- Check `.env` file (MCP_SERVER_PORT should be 3334)

**C. Restart the server:**
```bash
./start-mcp.sh restart
```

### 3. "Mcp-Session-Id header is required" (FIXED in v0.3.0+)

**Symptoms:**
- First connection works fine
- Second and subsequent connections fail
- Error: "Mcp-Session-Id header is required"

**Cause:** This was caused by the transport running in stateful mode, which required session ID headers.

**Solution:** **This is already fixed in v0.3.0+**. The server now runs in stateless mode.

If you still see this error:
```bash
# Ensure you're running the latest version
git pull
npm install
npm run build
./start-mcp.sh restart
```

### 4. "Text/event-stream" error

**Symptoms:**
- Server returns: "Client must accept text/event-stream"
- Connection establishes but fails immediately

**Cause:** This is normal when testing with curl. The MCP protocol uses Server-Sent Events (SSE) which requires special headers.

**Solution:** This should work automatically with Claude Code. If you see this in Claude Code, check:

```bash
# Verify server version is updated
./start-mcp.sh status | grep version

# Rebuild if needed
npm run build
./start-mcp.sh restart
```

### 5. Server starts but Claude can't connect

**Symptoms:**
- Health check works: `curl http://localhost:3334/health` returns OK
- Claude Code still can't connect

**Solutions:**

**A. Check Claude Code configuration:**
```bash
# View your project's MCP config
cat ~/.claude.json | jq '.projects["/home/stuartdavidson/code/cerebro-mcp"]'
```

Should show:
```json
{
  "mcpServers": {
    "cerebro": {
      "type": "http",
      "url": "http://localhost:3334/mcp"
    }
  }
}
```

**B. Restart Claude Code:**
- Close and reopen VSCode
- Or restart the Claude extension

**C. Check network binding:**
```bash
# Server should listen on localhost (127.0.0.1)
ss -tlnp | grep 3334
```

If it shows `0.0.0.0:3334` or `:::3334`, that's fine. If it shows a different IP, check your network configuration.

### 6. Connection drops frequently

**Symptoms:**
- Initially connects but disconnects after a few minutes
- "Session expired" or timeout errors

**Solutions:**

**A. Increase timeout in Claude config:**

Edit `~/.claude.json` and add timeout:
```json
{
  "mcpServers": {
    "cerebro": {
      "type": "http",
      "url": "http://localhost:3334/mcp",
      "timeout": 120000
    }
  }
}
```

**B. Check for system sleep/hibernation:**
- Server may stop when system sleeps
- Use the startup script to manage restarts:
```bash
./start-mcp.sh restart
```

**C. Enable keep-alive (already configured in v0.3.0+):**
The server now has better keep-alive settings. Ensure you're running the latest version:
```bash
git pull
npm install
npm run build
./start-mcp.sh restart
```

### 7. Authentication errors

**Symptoms:**
- "Authentication required" errors
- Tools return 401 or 403

**Solutions:**

**A. Re-authenticate services:**
1. Open https://localhost:3333/ in your browser
2. Click on the service that needs authentication
3. Complete the OAuth flow

**B. Check token files:**
```bash
ls -la .tokens/
# Should see: microsoft-tokens.json, slack-tokens.json
```

**C. Clear and re-authenticate:**
```bash
rm .tokens/*.json
# Then visit https://localhost:3333/ to re-auth
```

## Server Management

### Starting the server
```bash
./start-mcp.sh start
```

### Stopping the server
```bash
./start-mcp.sh stop
```

### Restarting the server
```bash
./start-mcp.sh restart
```

### Viewing logs
```bash
./start-mcp.sh logs    # Follow logs in real-time
# Or
tail -100 logs/mcp-server.log  # Last 100 lines
```

### Checking server health
```bash
./start-mcp.sh health
# Or detailed status:
curl http://localhost:3334/health/status | jq '.'
```

## Advanced Diagnostics

### Enable debug logging

Edit `.env` file:
```bash
LOG_LEVEL=debug
MCP_LOG_TOOL_INPUT=true
```

Then restart:
```bash
./start-mcp.sh restart
```

### Monitor connections in real-time

```bash
# Terminal 1: Watch server logs
./start-mcp.sh logs

# Terminal 2: Monitor network connections
watch -n 1 'ss -tnp | grep -E ":(3333|3334)"'
```

### Test MCP protocol manually

```bash
# Test SSE endpoint (should stream events)
curl -N -H "Accept: text/event-stream" http://localhost:3334/mcp
```

### Check service status programmatically

```bash
curl -s http://localhost:3334/health/status | jq '.services[] | select(.authenticated == false)'
```

This shows any services that need authentication.

## Preventive Measures

### 1. Auto-start on boot (systemd)

Create `/etc/systemd/user/cerebro-mcp.service`:
```ini
[Unit]
Description=Cerebro MCP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/stuartdavidson/code/cerebro-mcp
ExecStart=/usr/bin/node /home/stuartdavidson/code/cerebro-mcp/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:/home/stuartdavidson/code/cerebro-mcp/logs/mcp-server.log
StandardError=append:/home/stuartdavidson/code/cerebro-mcp/logs/mcp-server.log

[Install]
WantedBy=default.target
```

Enable:
```bash
systemctl --user enable cerebro-mcp
systemctl --user start cerebro-mcp
```

### 2. Add health check cron job

Add to crontab (`crontab -e`):
```bash
*/5 * * * * /home/stuartdavidson/code/cerebro-mcp/start-mcp.sh health > /dev/null || /home/stuartdavidson/code/cerebro-mcp/start-mcp.sh start
```

This checks health every 5 minutes and restarts if needed.

### 3. Monitor with external tool

Use a monitoring tool like `monit` or `supervisord` to keep the server running.

## Getting Help

If you still have issues:

1. **Collect diagnostic info:**
   ```bash
   echo "=== Server Status ===" > diagnostic.txt
   ./start-mcp.sh status >> diagnostic.txt 2>&1
   echo -e "\n=== Health Check ===" >> diagnostic.txt
   curl -s http://localhost:3334/health/status >> diagnostic.txt 2>&1
   echo -e "\n=== Last 50 log lines ===" >> diagnostic.txt
   tail -50 logs/mcp-server.log >> diagnostic.txt
   echo -e "\n=== Port Status ===" >> diagnostic.txt
   ss -tlnp | grep -E ":(3333|3334)" >> diagnostic.txt
   ```

2. **Check the logs:** `logs/mcp-server.log`

3. **Review configuration:** `.env` and `~/.claude.json`

## Architecture Overview

```
Claude Code (VSCode Extension)
    ↓ HTTP
    ↓ (http://localhost:3334/mcp)
    ↓
MCP HTTP Server (Port 3334)
    ↓
    ├─ Health Checks (/health, /health/status)
    ├─ MCP Protocol Handler (Streamable HTTP)
    └─ Service Registry
        ├─ Microsoft 365 (OAuth via port 3333)
        ├─ Slack (OAuth via port 3333)
        └─ LocalFoundry (Direct connection)
```

**Key Ports:**
- **3333**: OAuth authentication (HTTPS) + Legacy MCP endpoint
- **3334**: Primary MCP HTTP endpoint (HTTP) + Health checks

**Why two ports?**
- Port 3333 uses HTTPS for secure OAuth flows (callbacks are pre-registered)
- Port 3334 uses HTTP to avoid SSL certificate issues with MCP clients
- Both ports serve MCP requests, but 3334 is recommended for Claude Code
