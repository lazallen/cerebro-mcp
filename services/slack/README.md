# Slack Service Documentation

The Slack service provides read-only access to your Slack workspace, including channels, messages, threads, and canvases through the MCP protocol.

## Features

- **OAuth 2.0 Authentication**: Secure user token authentication
- **Channel Access**: List and browse public channels
- **Message History**: Read channel message history
- **Thread Support**: Access complete thread conversations
- **Canvas Integration**: Read and search Slack canvases
- **Persistent Tokens**: User tokens don't expire

## Quick Start

1. **Create Slack App** (see Setup below)
2. **Configure credentials** in `.env`
3. **Start auth server**: `npm run auth-server`
4. **Authenticate**: Use `slack.authenticate` in Claude
5. **Use tools**: Access workspace with `slack.*` tools

## Setup

### 1. Create Slack App

1. Visit [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Enter app name (e.g., "Cerebro MCP")
4. Select your workspace
5. Click "Create App"

### 2. Configure OAuth Scopes

1. In your app settings, go to **"OAuth & Permissions"**
2. Scroll to **"User Token Scopes"**
3. Add the following scopes:

   **Required Scopes:**
   - `channels:read` - List public channels
   - `channels:history` - Read public channel messages
   - `groups:read` - List private channels
   - `groups:history` - Read private channel messages
   - `canvases:read` - Read canvas content
   - `canvases:write` - Create/edit canvases

   **Optional Scopes:**
   - `reminders:read` - Read reminders
   - `reminders:write` - Create reminders

### 3. Configure Redirect URL

1. Still in **"OAuth & Permissions"**
2. Under **"Redirect URLs"**, click "Add New Redirect URL"
3. Enter: `https://localhost:3333/auth/slack/callback`
4. Click "Add"
5. Click "Save URLs"

**Note**: Slack allows `localhost` over HTTPS for development.

### 4. Get Credentials

1. Go to **"Basic Information"**
2. Under **"App Credentials"**, find:
   - **Client ID**
   - **Client Secret** (click "Show" to reveal)
3. Copy both values

### 5. Configure Environment

Add to your `.env` file:

```bash
# Slack Configuration
SLACK_CLIENT_ID=your-client-id-here
SLACK_CLIENT_SECRET=your-client-secret-here
SLACK_REDIRECT_URI=https://localhost:3333/auth/slack/callback
```

### 6. Update Claude Config

Add Slack credentials to your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cerebro": {
      "command": "node",
      "args": ["/path/to/cerebro-mcp/index.js"],
      "env": {
        "MS_CLIENT_ID": "your-ms-client-id",
        "MS_CLIENT_SECRET": "your-ms-secret",
        "SLACK_CLIENT_ID": "your-slack-client-id",
        "SLACK_CLIENT_SECRET": "your-slack-secret",
        "SLACK_REDIRECT_URI": "https://localhost:3333/auth/slack/callback"
      }
    }
  }
}
```

## Authentication

### First Time Setup

1. **Start the auth server**:
   ```bash
   npm run auth-server
   ```

2. **In Claude**, use the authentication tool:
   ```
   slack.authenticate
   ```

3. **Visit the URL** provided (http://localhost:3333/auth/slack/login)

4. **Sign in to Slack** and grant permissions

5. **Redirected automatically** - tokens saved to `~/.slack-token.json`

6. **Start using Slack tools** immediately!

### Token Storage

- **Location**: `~/.slack-token.json`
- **Format**: JSON with access token and metadata
- **Expiration**: User tokens don't expire
- **Refresh**: Not needed (tokens are persistent)

### Re-authentication

To re-authenticate (e.g., to add new scopes):

```
slack.authenticate force=true
```

## Available Tools

### Authentication Tools

#### `slack.authenticate`

Initiate OAuth flow to authenticate with Slack.

**Parameters:**
- `force` (optional, boolean): Force re-authentication even if already authenticated

**Example:**
```
slack.authenticate
slack.authenticate force=true
```

#### `slack.check-auth-status`

Check current authentication status and view token information.

**Example:**
```
slack.check-auth-status
```

### Channel Tools

#### `slack.list-channels`

List public channels in your workspace.

**Parameters:**
- `limit` (optional, number): Max channels to return (default: 20, max: 200)
- `cursor` (optional, string): Pagination cursor for next page

**Example:**
```
slack.list-channels limit=50
```

#### `slack.get-channel-history`

Get recent messages from a channel.

**Parameters:**
- `channel` (required, string): Channel ID (e.g., 'C12345678')
- `limit` (optional, number): Max messages to return (default: 10, max: 200)

**Example:**
```
slack.get-channel-history channel="C12345678" limit=20
```

### Thread Tools

#### `slack.get-thread-replies`

Fetch all replies in a specific thread.

**Parameters:**
- `channel` (required, string): Channel ID where thread is located
- `thread_ts` (required, string): Thread timestamp (parent message 'ts' value)

**Example:**
```
slack.get-thread-replies channel="C12345678" thread_ts="1234567890.123456"
```

### Canvas Tools

#### `slack.read-canvas`

Read the content of a specific canvas by ID.

**Parameters:**
- `canvas_id` (required, string): Canvas ID (e.g., 'F1234567890')

**Example:**
```
slack.read-canvas canvas_id="F1234567890"
```

**Returns:**
- Canvas title
- Canvas metadata (owner, created, updated)
- Full canvas content (markdown or formatted text)

#### `slack.search-canvases`

Search for canvases using keywords.

**Parameters:**
- `query` (optional, string): Search keywords (e.g., 'Weekly 1:1', 'meeting notes')
- `count` (optional, number): Max results to return (default: 10, max: 20)

**Example:**
```
slack.search-canvases query="Weekly 1:1" count=5
```

**Note**: Canvas features require a paid Slack workspace.

## Canvas Feature Details

### What are Canvases?

Canvases are Slack's collaborative documents that can be:
- Shared in channels or DMs
- Edited by multiple people
- Used for meeting notes, project documentation, etc.
- Rich with formatting, lists, tables, and more

### How to Find Canvas IDs

1. **Using search-canvases**:
   ```
   slack.search-canvases query="project notes"
   ```
   This returns canvas IDs you can use with `read-canvas`

2. **From channel history**:
   Canvas references appear in message history with their IDs

3. **From Slack URL**:
   Canvas URLs contain the ID: `https://workspace.slack.com/files/F1234567890`
   The ID is `F1234567890`

### Reading Canvas Content

Once you have a canvas ID:

```
slack.read-canvas canvas_id="F1234567890"
```

This returns:
- **Title**: Canvas name
- **Metadata**: Owner, created date, last updated
- **Content**: Full canvas content formatted as markdown

### Canvas Limitations

- **Paid plans only**: Canvas API requires a paid Slack workspace
- **Read-only mode**: Current implementation focuses on reading canvases
- **Search limitations**: Search relies on Slack's search API which may not index all canvases

## Common Use Cases

### Reading Team Meeting Notes

```
# Find the canvas
slack.search-canvases query="team meeting"

# Read the canvas content
slack.read-canvas canvas_id="F1234567890"
```

### Monitoring Channel Activity

```
# List channels
slack.list-channels limit=20

# Get recent messages
slack.get-channel-history channel="C12345678" limit=50

# Read a thread
slack.get-thread-replies channel="C12345678" thread_ts="1234567890.123456"
```

### Accessing 1:1 Notes

```
# Search for 1:1 canvas
slack.search-canvases query="1:1 John"

# Read the canvas
slack.read-canvas canvas_id="F1234567890"
```

## Troubleshooting

### Authentication Issues

**"Not authenticated with Slack"**
- Run `slack.authenticate` first
- Make sure auth server is running (`npm run auth-server`)
- Check that you completed the OAuth flow in browser

**"Invalid client credentials"**
- Verify `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in `.env`
- Make sure you copied the full Client Secret (not just part of it)
- Check for extra spaces in credentials

**"Redirect URI mismatch"**
- Verify redirect URL in Slack app settings matches exactly:
  `https://localhost:3333/auth/slack/callback`
- Make sure you saved the redirect URL in Slack app settings

### Scope Issues

**"Missing scope: canvases:read"**
- Add `canvases:read` and `canvases:write` scopes to your Slack app
- Re-authenticate: `slack.authenticate force=true`
- Grant the new permissions when prompted

**"Canvas features not available"**
- Canvas API requires a paid Slack workspace
- Verify your workspace is on a paid plan
- Check that canvas scopes are added to your app

### API Errors

**"Channel not found"**
- Verify the channel ID is correct (starts with 'C')
- Make sure you have access to the channel
- Use `slack.list-channels` to find valid channel IDs

**"Canvas not found"**
- Verify the canvas ID is correct (starts with 'F')
- Make sure you have access to the canvas
- Canvas may have been deleted or moved

**"Rate limited"**
- Slack has rate limits on API calls
- Wait a moment and try again
- Reduce the frequency of requests

## Architecture

### Module Structure

```
services/slack/
├── index.js              # Service entry point, exports all tools
├── config.js             # Slack-specific configuration
├── auth/
│   ├── index.js          # Authentication helpers
│   ├── token-manager.js  # Token storage and retrieval
│   ├── token-storage.js  # Token persistence
│   └── tools.js          # Auth tool definitions
├── channels/
│   ├── index.js          # Channel tools export
│   ├── list.js           # List channels handler
│   └── history.js        # Channel history handler
├── threads/
│   ├── index.js          # Thread tools export
│   └── replies.js        # Thread replies handler
├── canvases/
│   ├── index.js          # Canvas tools export
│   ├── read.js           # Read canvas handler
│   └── search.js         # Search canvases handler
└── utils/
    ├── slack-api.js      # Slack API client
    └── mock-data.js      # Test mode mock data
```

### API Client

The Slack service uses a custom API client (`utils/slack-api.js`) that:
- Handles all Slack Web API calls
- Uses POST requests with JSON bodies (Slack convention)
- Manages pagination with cursors
- Provides error handling and response parsing
- Supports test mode with mock data

### Token Management

Tokens are managed by the token manager which:
- Stores tokens in `~/.slack-token.json`
- Loads tokens on demand
- Validates token presence
- Does not handle refresh (user tokens don't expire)

## Development

### Test Mode

Run without real API calls:

```bash
USE_TEST_MODE=true npm start
```

Mock data is provided for:
- Channel listing
- Message history
- Thread replies
- Authentication flow

### Adding New Features

To add a new Slack feature:

1. **Create feature module** (e.g., `services/slack/reactions/`)
2. **Implement handlers** with Slack API calls
3. **Define tools** with MCP schemas
4. **Export tools** in module index
5. **Register in** `services/slack/index.js`

Example structure:
```javascript
// services/slack/newfeature/index.js
const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

async function handleNewFeature(args) {
  const accessToken = await ensureAuthenticated();
  const response = await callSlackAPI(accessToken, 'api.method', args);
  // Process response
  return { content: [{ type: "text", text: result }] };
}

const newFeatureTools = [{
  name: "new-feature",
  description: "Does something new",
  inputSchema: { /* ... */ },
  handler: handleNewFeature
}];

module.exports = { newFeatureTools };
```

## API Reference

All Slack API methods follow the pattern:
- **Base URL**: `https://slack.com/api/`
- **Method**: POST with JSON body
- **Auth**: Bearer token in Authorization header
- **Response**: JSON with `ok` field indicating success

### Common Parameters

- `limit`: Max results (varies by endpoint)
- `cursor`: Pagination token from previous response
- `channel`: Channel ID (format: C1234567890)
- `ts` / `thread_ts`: Timestamp (format: 1234567890.123456)

### Rate Limits

Slack enforces rate limits:
- **Tier 3 methods**: 50+ requests per minute
- **Tier 2 methods**: 20 requests per minute
- **Tier 1 methods**: Limited request rates

The service does not currently implement rate limit handling. Consider adding delays between requests if hitting limits.

## Security

### Token Storage

- Tokens stored locally in `~/.slack-token.json`
- File permissions should be restricted to user only
- Never commit token files to version control
- Tokens include workspace and user information

### Scopes and Permissions

- Request minimum scopes needed
- User tokens grant access based on user permissions
- Canvas access requires appropriate workspace plan
- Users can revoke access at any time via Slack settings

### Best Practices

- Don't log or expose access tokens
- Validate all user inputs
- Handle API errors gracefully
- Respect user privacy and workspace policies

## Support

For issues or questions:
- Check troubleshooting section above
- Review [Slack API Documentation](https://api.slack.com/)
- Check main README for general MCP server issues
- Open issue on project repository

## Future Enhancements

Potential features for future versions:
- Message posting
- Reaction management
- File uploads
- Canvas editing
- Bot token support
- Webhook integration
- Advanced search
- User management
