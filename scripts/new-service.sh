#!/bin/bash
# Script to scaffold a new service for Cerebro MCP
# Usage: ./scripts/new-service.sh servicename "Service Display Name"

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 <service-name> <\"Service Display Name\">"
    echo "Example: $0 slack \"Slack\""
    exit 1
fi

SERVICE_NAME="$1"
SERVICE_DISPLAY_NAME="$2"
SERVICE_UPPER=$(echo "$SERVICE_NAME" | tr '[:lower:]' '[:upper:]')

echo "🚀 Creating new service: $SERVICE_DISPLAY_NAME ($SERVICE_NAME)"

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p "services/$SERVICE_NAME"
mkdir -p "services/$SERVICE_NAME/auth"
mkdir -p "services/$SERVICE_NAME/utils"
mkdir -p "services/$SERVICE_NAME/test"

# Create config.js
echo "📝 Creating config.js..."
cat > "services/$SERVICE_NAME/config.js" << EOF
/**
 * $SERVICE_DISPLAY_NAME Service Configuration
 */
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp';

module.exports = {
  // Service metadata
  SERVICE_NAME: '$SERVICE_NAME',
  SERVICE_DISPLAY_NAME: '$SERVICE_DISPLAY_NAME',
  SERVICE_VERSION: '1.0.0',

  // Test mode setting
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',

  // Authentication configuration
  AUTH_CONFIG: {
    clientId: process.env.${SERVICE_UPPER}_CLIENT_ID || '',
    clientSecret: process.env.${SERVICE_UPPER}_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:3333/auth/$SERVICE_NAME/callback',
    scopes: [
      // TODO: Add service-specific scopes
    ],
    tokenStorePath: path.join(homeDir, '.$SERVICE_NAME-token.json'),
    tokenEndpoint: '', // TODO: Add service token endpoint
    authServerUrl: 'http://localhost:3333'
  },

  // Service API
  ${SERVICE_UPPER}_API_ENDPOINT: '', // TODO: Add service API endpoint

  // Pagination settings
  DEFAULT_PAGE_SIZE: 20,
  MAX_RESULT_COUNT: 100,
};
EOF

# Create token-storage.js
echo "📝 Creating auth/token-storage.js..."
cat > "services/$SERVICE_NAME/auth/token-storage.js" << EOF
/**
 * $SERVICE_DISPLAY_NAME Token Storage
 * Extends BaseTokenStorage with $SERVICE_DISPLAY_NAME-specific OAuth handling
 */

const BaseTokenStorage = require('../../../common/base-token-storage');
const path = require('path');

class ${SERVICE_DISPLAY_NAME}TokenStorage extends BaseTokenStorage {
  constructor(config) {
    const defaultConfig = {
      tokenStorePath: path.join(process.env.HOME || process.env.USERPROFILE, '.$SERVICE_NAME-token.json'),
      clientId: process.env.${SERVICE_UPPER}_CLIENT_ID,
      clientSecret: process.env.${SERVICE_UPPER}_CLIENT_SECRET,
      redirectUri: 'http://localhost:3333/auth/$SERVICE_NAME/callback',
      scopes: [
        // TODO: Add scopes
      ],
      tokenEndpoint: '', // TODO: Add token endpoint
      refreshTokenBuffer: 5 * 60 * 1000,
      ...config
    };

    super(defaultConfig);
  }

  // Override methods only if $SERVICE_DISPLAY_NAME uses non-standard OAuth 2.0
}

module.exports = ${SERVICE_DISPLAY_NAME}TokenStorage;
EOF

# Create tools.js
echo "📝 Creating auth/tools.js..."
cat > "services/$SERVICE_NAME/auth/tools.js" << EOF
/**
 * Authentication tools for $SERVICE_DISPLAY_NAME
 */
const config = require('../config');

async function handleAuthenticate(args) {
  const force = args && args.force === true;

  if (config.USE_TEST_MODE) {
    // TODO: Implement test mode
    return {
      content: [{
        type: "text",
        text: 'Successfully authenticated with $SERVICE_DISPLAY_NAME (test mode)'
      }]
    };
  }

  const authUrl = \`\${config.AUTH_CONFIG.authServerUrl}/auth/$SERVICE_NAME/login?client_id=\${config.AUTH_CONFIG.clientId}\`;

  return {
    content: [{
      type: "text",
      text: \`Authentication required. Please visit: \${authUrl}\\n\\nAfter authentication, you will be redirected back.\`
    }]
  };
}

async function handleCheckAuthStatus() {
  // TODO: Implement auth status check
  return {
    content: [{ type: "text", text: "Not implemented yet" }]
  };
}

const authTools = [
  {
    name: "authenticate",
    description: "Authenticate with $SERVICE_DISPLAY_NAME",
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
    description: "Check authentication status with $SERVICE_DISPLAY_NAME",
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
EOF

# Create index.js
echo "📝 Creating index.js..."
cat > "services/$SERVICE_NAME/index.js" << EOF
/**
 * $SERVICE_DISPLAY_NAME Service Entry Point
 */

const config = require('./config');
const { authTools } = require('./auth/tools');

// TODO: Import feature modules
// const { messagesTools } = require('./messages');

// Combine all tools
const allTools = [
  ...authTools,
  // TODO: Add feature module tools
];

module.exports = {
  // Service metadata
  name: '$SERVICE_NAME',
  displayName: '$SERVICE_DISPLAY_NAME',
  version: config.SERVICE_VERSION,
  description: '$SERVICE_DISPLAY_NAME integration',

  // All tools from this service
  tools: allTools,

  // Service configuration
  config: config
};
EOF

# Create API client
echo "📝 Creating utils/${SERVICE_NAME}-api.js..."
cat > "services/$SERVICE_NAME/utils/${SERVICE_NAME}-api.js" << EOF
/**
 * $SERVICE_DISPLAY_NAME API Client
 */

const BaseAPIClient = require('../../../common/base-api-client');
const config = require('../config');

class ${SERVICE_DISPLAY_NAME}APIClient extends BaseAPIClient {
  constructor(getAccessTokenFn) {
    super({
      apiEndpoint: config.${SERVICE_UPPER}_API_ENDPOINT,
      getAccessToken: getAccessTokenFn,
      useTestMode: config.USE_TEST_MODE
    });
  }

  // Override methods for $SERVICE_DISPLAY_NAME-specific API patterns
}

async function call${SERVICE_DISPLAY_NAME}API(accessToken, endpoint, params) {
  const client = new ${SERVICE_DISPLAY_NAME}APIClient(() => accessToken);
  return client.makeRequest('POST', endpoint, params);
}

module.exports = {
  ${SERVICE_DISPLAY_NAME}APIClient,
  call${SERVICE_DISPLAY_NAME}API
};
EOF

echo ""
echo "✅ Service scaffolding complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update services/$SERVICE_NAME/config.js with API endpoints and scopes"
echo "2. Implement feature modules in services/$SERVICE_NAME/{feature}/"
echo "3. Update services/$SERVICE_NAME/index.js to import feature modules"
echo "4. Register service in index.js (add 3 lines after Microsoft loading)"
echo "5. Uncomment service loading in common/auth-server.js"
echo "6. Add environment variables to .env.example"
echo ""
echo "📚 See ADDING_SERVICES.md or CLAUDE.md for detailed instructions"
echo ""
