# Slack Integration Setup

## Prerequisites

1. **Install mkcert** (for local HTTPS certificates):
   ```bash
   # macOS
   brew install mkcert

   # Linux
   sudo apt install mkcert

   # Windows
   choco install mkcert
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

## Setup Steps

### 1. Generate SSL Certificates

```bash
# Install local CA (one-time setup)
mkcert -install

# Generate certificates for localhost
cd /path/to/cerebro-mcp
mkcert localhost 127.0.0.1 ::1
```

This creates two files:
- `localhost+2.pem` (certificate)
- `localhost+2-key.pem` (private key)

### 2. Create Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name your app (e.g., "Cerebro MCP")
4. Select your workspace

### 3. Configure OAuth & Permissions

1. Navigate to **"OAuth & Permissions"**
2. Under **"Redirect URLs"**, add:
   ```
   https://localhost:3333/auth/slack/callback
   ```
3. Under **"User Token Scopes"**, add:
   - `channels:read`
   - `channels:history`
4. Click **"Save URLs"**

### 4. Get Your Credentials

1. Go to **"Basic Information"**
2. Under **"App Credentials"**, copy:
   - **Client ID**
   - **Client Secret**

### 5. Configure Environment

Add to your `.env` file:

```bash
SLACK_CLIENT_ID=your-client-id-here
SLACK_CLIENT_SECRET=your-client-secret-here
```

Or set in Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cerebro": {
      "command": "node",
      "args": ["/path/to/cerebro-mcp/index.js"],
      "env": {
        "SLACK_CLIENT_ID": "your-client-id",
        "SLACK_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### 6. Start the Auth Server

```bash
npm run auth-server
```

The server will automatically use HTTPS if it finds the certificate files.

### 7. Authenticate in Claude

Use the `slack.authenticate` tool in Claude:

```
slack.authenticate
```

Visit the provided URL in your browser, authorize the app, and you're done!

### 8. Use Slack Tools

```
slack.list-channels
slack.get-channel-history channel="C12345678"
slack.get-thread-replies channel="C12345678" thread_ts="1234567890.123456"
```

## Test Mode

For testing without real Slack credentials:

```bash
USE_TEST_MODE=true npm start
```

Then use the tools with mock data.

## Troubleshooting

**"Certificate not found" error:**
- Run `mkcert localhost 127.0.0.1 ::1` in the project directory
- Ensure files `localhost+2.pem` and `localhost+2-key.pem` exist

**"redirect_uri_mismatch" error:**
- Verify the redirect URI in Slack app is exactly: `https://localhost:3333/auth/slack/callback`
- Ensure auth server is running on port 3333

**"invalid_client_id" error:**
- Check that CLIENT_ID and CLIENT_SECRET are correct
- Use values from "Basic Information" → "App Credentials"

**Browser security warning:**
- Run `mkcert -install` to install the local CA
- Restart your browser

## Certificate Renewal

mkcert certificates are valid for 825 days. To renew:

```bash
mkcert localhost 127.0.0.1 ::1
npm run auth-server
```

## Production Deployment

For production, deploy the auth server to a cloud service (Heroku, Railway, Render) with a real domain and Let's Encrypt SSL certificate.
