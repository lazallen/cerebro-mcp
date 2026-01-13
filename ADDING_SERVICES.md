# Adding a New Service to Cerebro MCP

Quick reference guide for adding service integrations (Slack, Google, etc.)

## Prerequisites

- Understand OAuth 2.0 flow for the service
- Have API credentials (client ID and secret)
- Know the API endpoint and required scopes
- Review `services/microsoft/` as reference implementation

## Quick Start Checklist

### 1. Create Directory Structure (5 min)

```bash
mkdir -p services/{service}
mkdir -p services/{service}/{auth,utils,test}
mkdir -p services/{service}/{feature1,feature2}  # e.g., channels, messages
```

### 2. Create Configuration (5 min)

Copy `services/microsoft/config.js` and modify:
- Change service name and metadata
- Update `AUTH_CONFIG` with service-specific OAuth details
- Update API endpoint
- Change token file path to `~/.{service}-token.json`

### 3. Create Token Storage (5 min)

Copy `services/microsoft/auth/token-storage.js` and modify:
- Rename class to `{Service}TokenStorage`
- Update environment variable names
- Override OAuth methods only if service differs from standard OAuth 2.0

### 4. Create API Client (10 min)

Copy `services/microsoft/utils/graph-api.js` and modify:
- Rename to `{service}-api.js`
- Update API endpoint
- Override `extractItemsFromResponse()` if needed
- Override `getNextPageUrl()` if pagination differs
- Add service-specific helper methods

### 5. Create Auth Tools (5 min)

Copy `services/microsoft/auth/tools.js` and modify:
- Update OAuth URL path: `/auth/{service}/login`
- Update service name in messages
- Keep `authenticate` and `check-auth-status` tools

### 6. Create Feature Modules (30+ min)

For each feature (channels, messages, etc.):
1. Create directory: `services/{service}/{feature}/`
2. Create handler files: `list.js`, `create.js`, `send.js`, etc.
3. Create `index.js` that exports tools array
4. Follow pattern from `services/microsoft/email/` or `/calendar/`

### 7. Create Service Entry Point (5 min)

Copy `services/microsoft/index.js` and modify:
- Update service metadata
- Import your feature modules
- Combine all tools

### 8. Register Service (2 min)

In `index.js`, add after Microsoft loading:
```javascript
try {
  const {service}Service = require('./services/{service}');
  services.{service} = {service}Service;
  console.error(`✓ Loaded service: ${{service}Service.displayName}`);
} catch (error) {
  console.error(`ℹ {Service} not available: ${error.message}`);
}
```

### 9. Update Auth Server (2 min)

In `common/auth-server.js`, uncomment the service loading block (around line 34) and modify:
```javascript
try {
  const {service}Config = require('../services/{service}/config');
  if ({service}Config && {service}Config.AUTH_CONFIG) {
    services.{service} = {
      name: '{Service}',
      config: {service}Config.AUTH_CONFIG,
      TokenStorage: require('../services/{service}/auth/token-storage')
    };
    console.log('✓ {Service} service loaded');
  }
} catch (error) {
  console.log('ℹ {Service} not available:', error.message);
}
```

### 10. Update Configuration Files (3 min)

- `.env.example`: Uncomment service vars
- `claude-config-sample.json`: Add service credentials
- `README.md`: Add service to "Currently Supported" list

## File Template Reference

### Minimal Service Implementation

Absolute minimum files needed:

```
services/{service}/
├── index.js           # 20 lines - service metadata + tool aggregation
├── config.js          # 30 lines - service configuration
├── auth/
│   ├── token-storage.js  # 15 lines - extend BaseTokenStorage
│   └── tools.js       # 50 lines - authenticate + check-auth-status
├── utils/
│   └── {service}-api.js  # 40 lines - extend BaseAPIClient
└── {feature}/
    ├── index.js       # 30 lines - tools array
    └── handler.js     # 40 lines - tool handler
```

Total: ~225 lines of code minimum for a basic service!

## Common Patterns

### Tool Handler Pattern

```javascript
async function handleAction(args) {
  try {
    const accessToken = await ensureAuthenticated();
    const { requiredParam } = args;

    if (!requiredParam) {
      throw new Error('requiredParam is required');
    }

    const response = await callServiceAPI(accessToken, 'endpoint', {
      param: requiredParam
    });

    return {
      content: [{
        type: "text",
        text: `Action completed: ${response.result}`
      }]
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
}
```

### Tool Definition Pattern

```javascript
{
  name: "action-name",  // lowercase with hyphens
  description: "Clear description of what this tool does",
  inputSchema: {
    type: "object",
    properties: {
      requiredParam: {
        type: "string",
        description: "Clear description of this parameter"
      },
      optionalParam: {
        type: "number",
        description: "Optional parameter (default: 10)"
      }
    },
    required: ["requiredParam"]
  },
  handler: handleAction
}
```

## Testing Workflow

1. **Syntax Check**: `node -e "require('./services/{service}')"`
2. **Start Server**: `npm start` - Check for service loaded message
3. **Check Tools**: Look for `{service}.tool_name` in tool list
4. **Start Auth Server**: `npm run auth-server`
5. **Authenticate**: Use `{service}.authenticate` in Claude
6. **Test Tool**: Call a tool like `{service}.send_message`

## Common Mistakes to Avoid

1. ❌ **Adding service prefix in tool names** - Server adds it automatically
   - Wrong: `name: "slack.send_message"`
   - Right: `name: "send-message"`

2. ❌ **Forgetting to export handler** - Tool won't work
   - Add: `handler: handleFunction` in tool definition

3. ❌ **Wrong relative paths** - Import errors
   - From `services/{service}/utils/`: use `../config`
   - From `services/{service}/feature/`: use `../config`

4. ❌ **Not extending base classes** - Missing functionality
   - Always extend `BaseTokenStorage` and `BaseAPIClient`

5. ❌ **Forgetting error handling** - Server crashes
   - Always wrap handlers in try-catch

6. ❌ **Wrong token file path** - Conflicts with other services
   - Use: `~/.{service}-token.json` (unique per service)

## Service-Specific Considerations

### OAuth Variations

If service uses non-standard OAuth:
- Override `buildAuthCodeRequest()` in TokenStorage
- Override `buildRefreshTokenRequest()` in TokenStorage
- Check OAuth docs for grant_type, response format

### API Variations

If service has unique API patterns:
- Override `buildRequestHeaders()` in API client (add custom headers)
- Override `extractItemsFromResponse()` (different response format)
- Override `getNextPageUrl()` (different pagination)

### Rate Limiting

Consider adding rate limiting in API client:
```javascript
async makeRequest(method, path, data, queryParams) {
  await this.rateLimiter.waitIfNeeded();
  return super.makeRequest(method, path, data, queryParams);
}
```

## Documentation Updates

After adding service, update:

1. **README.md**:
   - Add to "Currently Supported Services"
   - Add setup instructions in new section
   - Add available tools list

2. **CLAUDE.md**:
   - Already has comprehensive guide!
   - Just verify examples work for your service

3. **Package.json**:
   - Add test script: `"test:{service}": "jest services/{service}/test"`
   - Add keywords related to service

## Need Help?

- **Reference**: Look at `services/microsoft/` for complete example
- **Base Classes**: Review `common/base-*.js` for available methods
- **Auth Server**: Check `common/auth-server.js` for OAuth handling
- **Main Server**: Review `index.js` for service loading logic

Good luck! The architecture makes it straightforward to add new services. 🚀
