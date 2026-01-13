# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm install` - **ALWAYS run first** to install dependencies
- `npm start` - Start the MCP server
- `npm run auth-server` - Start the unified OAuth authentication server on port 3333 (**required for authentication**)
- `npm run test-mode` - Start the server in test mode with mock data
- `npm run inspect` - Use MCP Inspector to test the server interactively
- `npm test` - Run all tests
- `npm run test:microsoft` - Run Microsoft service tests only
- `npx kill-port 3333` - Kill process using port 3333 if auth server won't start

## Architecture Overview

This is a **multi-service MCP (Model Context Protocol) server** that provides Claude with access to multiple productivity services and APIs. The architecture is organized into services, each with its own modules:

### Core Structure
- `index.js` - Main entry point that dynamically loads services and adds namespace prefixes to tools
- `config.js` - Shared configuration (server metadata, global settings)
- `common/` - Shared infrastructure for all services:
  - `auth-server.js` - Unified OAuth server handling multiple services on port 3333
  - `base-token-storage.js` - Abstract base class for token management
  - `base-api-client.js` - Abstract base class for API clients

### Services Architecture
```
services/
├── microsoft/              # Microsoft 365 / Outlook service
│   ├── index.js           # Service entry point (exports tools)
│   ├── config.js          # Microsoft-specific configuration
│   ├── auth/              # OAuth 2.0 authentication
│   ├── calendar/          # Calendar operations
│   ├── email/             # Email management
│   ├── folder/            # Folder operations
│   ├── rules/             # Email rules
│   ├── utils/             # MS Graph API client, OData helpers
│   └── test/              # Service-specific tests
└── slack/                 # Future: Slack service (same structure)
```

### Tool Naming Convention
All tools use **service namespaces**:
- Microsoft tools: `microsoft.list_emails`, `microsoft.send_email`, `microsoft.authenticate`, etc.
- Future Slack tools: `slack.send_message`, `slack.list_channels`, etc.

This makes it clear which service each tool belongs to.

### Key Components
- **Token Management**: Each service stores tokens separately:
  - Microsoft: `~/.microsoft-token.json`
  - Future services will use their own token files
- **Service Isolation**: Each service is completely self-contained in its directory
- **Dynamic Loading**: Services are loaded automatically if their dependencies are configured
- **Test Mode**: Mock data responses when `USE_TEST_MODE=true` (service-specific)

## Authentication Flow

### Microsoft 365
1. Azure app registration required with permissions (Mail.Read, Mail.Send, Calendars.ReadWrite, etc.)
2. Start unified auth server: `npm run auth-server`
3. Use `microsoft.authenticate` tool to get OAuth URL
4. Visit URL: `http://localhost:3333/auth/microsoft/login` (or legacy `/auth`)
5. Complete browser authentication
6. Callback to: `http://localhost:3333/auth/microsoft/callback` (or legacy `/auth/callback`)
7. Tokens automatically stored in `~/.microsoft-token.json` and refreshed

**Legacy Support**: The server supports legacy callback URLs (`/auth/callback` and `/auth`) for backward compatibility. These will be removed in a future version. Please migrate to the new format:
- Old: `http://localhost:3333/auth/callback` → New: `http://localhost:3333/auth/microsoft/callback`
- Old: `http://localhost:3333/auth` → New: `http://localhost:3333/auth/microsoft/login`

### Future Services
The unified auth server supports multiple services with routes like:
- `/auth/:service/login` - Initiate OAuth flow
- `/auth/:service/callback` - Handle OAuth callback

## Configuration Requirements

### Environment Variables
- **For .env file**: Use `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`
- **For Claude Desktop config**: Use `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET`
- **Important**: Always use the client secret VALUE from Azure, not the Secret ID
- Copy `.env.example` to `.env` and populate with real credentials

### Microsoft Configuration
- Default timezone: "Central European Standard Time"
- Default page size: 25, max results: 50
- Token storage: `~/.microsoft-token.json`
- Scopes: Mail.Read, Mail.ReadWrite, Mail.Send, Calendars.Read, Calendars.ReadWrite, Contacts.Read, User.Read, offline_access

### Common Setup Issues
1. **Missing dependencies**: Always run `npm install` first
2. **Wrong secret**: Use Azure secret VALUE, not ID (AADSTS7000215 error)
3. **Auth server not running**: Start `npm run auth-server` before authenticating
4. **Port conflicts**: Use `npx kill-port 3333` if port is in use
5. **Wrong tool names**: Remember to use service prefix (e.g., `microsoft.list_emails`, not `list_emails`)

## Test Mode

Set `USE_TEST_MODE=true` to use mock data instead of real API calls. Mock responses are service-specific and defined in each service's `utils/mock-data.js`.

## Adding New Services - Complete Guide

This section provides a comprehensive guide for adding a new service (like Slack) to Cerebro MCP. The Microsoft service implementation serves as the reference pattern.

### Step-by-Step: Adding Slack Service

#### Phase 1: Create Service Directory Structure

Create the service directory with all required subdirectories:

```bash
mkdir -p services/slack
mkdir -p services/slack/auth
mkdir -p services/slack/channels
mkdir -p services/slack/messages
mkdir -p services/slack/users
mkdir -p services/slack/utils
mkdir -p services/slack/test
```

Final structure should match:
```
services/slack/
├── index.js              # Service entry point (exports metadata + tools)
├── config.js             # Slack-specific configuration
├── auth/                 # OAuth authentication
│   ├── index.js         # Auth module exports
│   ├── token-storage.js # Extends common/base-token-storage.js
│   ├── token-manager.js # Simple token helpers (optional)
│   └── tools.js         # Auth tools (authenticate, check-auth-status)
├── channels/             # Channels feature module
│   ├── index.js         # Exports channelsTools array
│   ├── list.js          # List channels handler
│   └── create.js        # Create channel handler
├── messages/             # Messages feature module
│   ├── index.js         # Exports messagesTools array
│   ├── list.js          # List messages handler
│   ├── send.js          # Send message handler
│   └── delete.js        # Delete message handler
├── users/                # Users feature module
│   ├── index.js         # Exports usersTools array
│   └── list.js          # List users handler
├── utils/                # Slack-specific utilities
│   ├── slack-api.js     # Extends common/base-api-client.js
│   ├── mock-data.js     # Test mode mock responses
│   └── helpers.js       # Slack-specific helper functions
└── test/                 # Service tests
    ├── auth/
    ├── channels/
    └── messages/
```

#### Phase 2: Implement Configuration

**File: `services/slack/config.js`**

```javascript
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp';

module.exports = {
  // Service metadata
  SERVICE_NAME: 'slack',
  SERVICE_DISPLAY_NAME: 'Slack',
  SERVICE_VERSION: '1.0.0',

  // Test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Authentication configuration
  AUTH_CONFIG: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:3333/auth/slack/callback',
    scopes: [
      'channels:read',
      'channels:write',
      'chat:write',
      'users:read',
      'groups:read'
    ],
    tokenStorePath: path.join(homeDir, '.slack-token.json'),
    tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
    authServerUrl: 'http://localhost:3333'
  },

  // Slack API
  SLACK_API_ENDPOINT: 'https://slack.com/api/',

  // Pagination settings
  DEFAULT_PAGE_SIZE: 20,
  MAX_RESULT_COUNT: 100,
};
```

**Key Points**:
- Use `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` env vars
- Redirect URI uses `/auth/slack/callback` pattern
- Token file: `~/.slack-token.json` (separate from Microsoft)
- Scopes are Slack-specific permissions

#### Phase 3: Implement Token Storage

**File: `services/slack/auth/token-storage.js`**

```javascript
const BaseTokenStorage = require('../../../common/base-token-storage');
const path = require('path');

class SlackTokenStorage extends BaseTokenStorage {
  constructor(config) {
    const defaultConfig = {
      tokenStorePath: path.join(process.env.HOME || process.env.USERPROFILE, '.slack-token.json'),
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      redirectUri: 'http://localhost:3333/auth/slack/callback',
      scopes: [
        'channels:read',
        'channels:write',
        'chat:write',
        'users:read'
      ],
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
      refreshTokenBuffer: 5 * 60 * 1000,
      ...config
    };

    super(defaultConfig);
  }

  // Override if Slack uses different OAuth 2.0 request format
  // For standard OAuth 2.0, no override needed
}

module.exports = SlackTokenStorage;
```

**Key Points**:
- Extends `common/base-token-storage.js`
- Override methods only if Slack's OAuth differs from standard
- Base class handles: token loading, saving, refreshing, expiry checking

#### Phase 4: Implement API Client

**File: `services/slack/utils/slack-api.js`**

```javascript
const BaseAPIClient = require('../../../common/base-api-client');
const config = require('../config');
const mockData = require('./mock-data');

class SlackAPIClient extends BaseAPIClient {
  constructor(getAccessTokenFn) {
    super({
      apiEndpoint: config.SLACK_API_ENDPOINT,
      getAccessToken: getAccessTokenFn,
      useTestMode: config.USE_TEST_MODE
    });
  }

  // Override if Slack uses different response format
  extractItemsFromResponse(response) {
    // Slack typically uses response.channels, response.messages, etc.
    return response.channels || response.messages || response.users || [];
  }

  // Override if Slack uses different pagination
  getNextPageUrl(response) {
    // Slack uses cursor-based pagination
    return response.response_metadata?.next_cursor || null;
  }

  // Override for test mode
  async mockRequest(method, path, data, queryParams) {
    return mockData.simulateSlackAPIResponse(method, path, data, queryParams);
  }

  // Add Slack-specific helper methods
  async callSlackMethod(method, params) {
    return this.makeRequest('POST', method, params);
  }
}

// Export helper function for easy use
async function callSlackAPI(accessToken, method, params) {
  const client = new SlackAPIClient(() => accessToken);
  return client.makeRequest('POST', method, params);
}

module.exports = {
  SlackAPIClient,
  callSlackAPI
};
```

**Key Points**:
- Extends `common/base-api-client.js`
- Override methods for Slack-specific API patterns
- Base class handles: authentication, error handling, retries

#### Phase 5: Implement Auth Tools

**File: `services/slack/auth/tools.js`**

```javascript
const config = require('../config');
const tokenManager = require('./token-manager'); // or use TokenStorage directly

async function handleAuthenticate(args) {
  const force = args && args.force === true;

  if (config.USE_TEST_MODE) {
    tokenManager.createTestTokens();
    return {
      content: [{
        type: "text",
        text: 'Successfully authenticated with Slack (test mode)'
      }]
    };
  }

  // Generate Slack OAuth URL
  const authUrl = `${config.AUTH_CONFIG.authServerUrl}/auth/slack/login?client_id=${config.AUTH_CONFIG.clientId}`;

  return {
    content: [{
      type: "text",
      text: `Authentication required. Please visit: ${authUrl}\n\nAfter authentication, you will be redirected back.`
    }]
  };
}

async function handleCheckAuthStatus() {
  const tokens = tokenManager.loadTokenCache();

  if (!tokens || !tokens.access_token) {
    return {
      content: [{ type: "text", text: "Not authenticated with Slack" }]
    };
  }

  return {
    content: [{ type: "text", text: "Authenticated with Slack and ready" }]
  };
}

const authTools = [
  {
    name: "authenticate",
    description: "Authenticate with Slack to access your workspace",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Force re-authentication"
        }
      },
      required: []
    },
    handler: handleAuthenticate
  },
  {
    name: "check-auth-status",
    description: "Check authentication status with Slack",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    handler: handleCheckAuthStatus
  }
];

module.exports = {
  authTools,
  handleAuthenticate,
  handleCheckAuthStatus
};
```

#### Phase 6: Implement Feature Modules

**File: `services/slack/messages/send.js`**

```javascript
const config = require('../config');
const { callSlackAPI } = require('../utils/slack-api');
const { ensureAuthenticated } = require('../auth');

async function handleSendMessage(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Validate inputs
    const { channel, text } = args;
    if (!channel || !text) {
      throw new Error('channel and text are required');
    }

    // Call Slack API
    const response = await callSlackAPI(accessToken, 'chat.postMessage', {
      channel: channel,
      text: text
    });

    // Check Slack API response
    if (!response.ok) {
      throw new Error(`Slack API error: ${response.error}`);
    }

    return {
      content: [{
        type: "text",
        text: `Message sent successfully to ${channel}`
      }]
    };
  } catch (error) {
    console.error('Error sending Slack message:', error);
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
}

module.exports = handleSendMessage;
```

**File: `services/slack/messages/index.js`**

```javascript
const handleSendMessage = require('./send');
const handleListMessages = require('./list');

const messagesTools = [
  {
    name: "send-message",
    description: "Send a message to a Slack channel",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID or name (e.g., #general)"
        },
        text: {
          type: "string",
          description: "Message text to send"
        }
      },
      required: ["channel", "text"]
    },
    handler: handleSendMessage
  },
  {
    name: "list-messages",
    description: "List recent messages in a Slack channel",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID or name"
        },
        limit: {
          type: "number",
          description: "Number of messages to retrieve (default: 20)"
        }
      },
      required: ["channel"]
    },
    handler: handleListMessages
  }
];

module.exports = {
  messagesTools
};
```

**Pattern**: Each feature module exports a tools array with tool definitions.

#### Phase 7: Implement Service Entry Point

**File: `services/slack/index.js`**

```javascript
const config = require('./config');
const { authTools } = require('./auth/tools');
const { channelsTools } = require('./channels');
const { messagesTools } = require('./messages');
const { usersTools } = require('./users');

// Combine all tools from different modules
const allTools = [
  ...authTools,
  ...channelsTools,
  ...messagesTools,
  ...usersTools
];

module.exports = {
  // Service metadata
  name: 'slack',
  displayName: 'Slack',
  version: config.SERVICE_VERSION,
  description: 'Slack integration for workspace messaging and collaboration',

  // All tools from this service (WITHOUT namespace prefix)
  tools: allTools,

  // Service configuration
  config: config
};
```

**Key Points**:
- Combines all module tools into single array
- Tool names should NOT include `slack.` prefix - main server adds it automatically
- Exports service metadata for registration

#### Phase 8: Register Service in Main Server

**File: `index.js`** (add after Microsoft service loading)

```javascript
// Try to load Slack service
try {
  const slackService = require('./services/slack');
  services.slack = slackService;
  console.error(`✓ Loaded service: ${slackService.displayName}`);
} catch (error) {
  console.error(`ℹ Slack service not available: ${error.message}`);
}
```

**That's it!** The main server will:
- Load the Slack service automatically
- Add `slack.` prefix to all tools
- Route `slack.send_message` calls to the correct handler

#### Phase 9: Update Auth Server

The unified auth server (`common/auth-server.js`) already supports Slack! You just need to uncomment the service loading code around line 34:

```javascript
// Uncomment this block:
try {
  const slackConfig = require('../services/slack/config');
  if (slackConfig && slackConfig.AUTH_CONFIG) {
    services.slack = {
      name: 'Slack',
      config: slackConfig.AUTH_CONFIG,
      TokenStorage: require('../services/slack/auth/token-storage')
    };
    console.log('✓ Slack service loaded');
  }
} catch (error) {
  console.log('ℹ Slack service not available:', error.message);
}
```

The auth server will automatically:
- Handle `/auth/slack/login` - OAuth initiation
- Handle `/auth/slack/callback` - OAuth callback
- Store tokens in `~/.slack-token.json`

#### Phase 10: Update Configuration Files

**`.env.example`** - Already includes Slack placeholders! Just uncomment:

```bash
# Slack Configuration
SLACK_CLIENT_ID=your-slack-client-id-here
SLACK_CLIENT_SECRET=your-slack-client-secret-here
```

**`claude-config-sample.json`** - Add Slack env vars:

```json
{
  "mcpServers": {
    "cerebro": {
      "env": {
        "OUTLOOK_CLIENT_ID": "...",
        "OUTLOOK_CLIENT_SECRET": "...",
        "SLACK_CLIENT_ID": "your-slack-client-id",
        "SLACK_CLIENT_SECRET": "your-slack-client-secret",
        "USE_TEST_MODE": "false"
      }
    }
  }
}
```

### Quick Reference: File Checklist

When adding a new service, create these files:

**Required Files**:
- [ ] `services/{service}/index.js` - Service entry point
- [ ] `services/{service}/config.js` - Service configuration
- [ ] `services/{service}/auth/token-storage.js` - Extends BaseTokenStorage
- [ ] `services/{service}/auth/tools.js` - Auth tools (authenticate, check-auth-status)
- [ ] `services/{service}/utils/{service}-api.js` - Extends BaseAPIClient
- [ ] At least one feature module with tools (e.g., `messages/index.js`)

**Update These Files**:
- [ ] `index.js` - Add service loading (3 lines)
- [ ] `common/auth-server.js` - Uncomment service loading block
- [ ] `.env.example` - Uncomment service env vars
- [ ] `claude-config-sample.json` - Add service credentials

**Optional Files**:
- [ ] `services/{service}/utils/mock-data.js` - Test mode responses
- [ ] `services/{service}/utils/helpers.js` - Service-specific utilities
- [ ] `services/{service}/test/**/*.test.js` - Unit tests

### Common Patterns to Follow

1. **Tool Naming**: Use lowercase with hyphens (e.g., `send-message`, not `sendMessage`)
2. **Error Handling**: Always wrap handlers in try-catch, return `isError: true`
3. **Authentication**: Always call `ensureAuthenticated()` before API calls
4. **Token Storage**: Store in `~/.{service}-token.json`
5. **OAuth Callback**: Use `/auth/{service}/callback` pattern
6. **Environment Variables**: Use `{SERVICE}_CLIENT_ID` and `{SERVICE}_CLIENT_SECRET`

### Testing Your New Service

```bash
# 1. Install dependencies
npm install

# 2. Start auth server
npm run auth-server

# 3. Start MCP server
npm start

# 4. In Claude, authenticate
slack.authenticate

# 5. Test a tool
slack.send_message channel="#general" text="Hello from Cerebro!"
```

### Common Issues

1. **Service not loading**: Check console for errors, ensure all required files exist
2. **Auth not working**: Verify OAuth credentials and callback URL in service dashboard
3. **Tools not found**: Ensure service exports tools array with correct format
4. **Import errors**: Check relative paths (e.g., `../config` vs `./config`)

### Resources

- Microsoft service: `services/microsoft/` - Complete reference implementation
- Base classes: `common/base-*.js` - Abstract patterns to extend
- Main server: `index.js` - Service loading and namespacing
- Auth server: `common/auth-server.js` - Multi-service OAuth handling

## OData Query Handling (Microsoft)

The Microsoft Graph API client properly handles OData filters with URI encoding. Filters are processed separately from other query parameters to ensure correct escaping of special characters.

## Error Handling

- Authentication failures return "UNAUTHORIZED" error
- API errors include status codes and response details
- Token expiration triggers automatic re-authentication flow
- Empty API responses are handled gracefully
- Service-specific error handling in each service's modules
