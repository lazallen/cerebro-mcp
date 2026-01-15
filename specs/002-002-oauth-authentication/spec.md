# Feature Specification: Unified OAuth Authentication Server

**Feature Branch**: `002-oauth-authentication-server`
**Created**: 2026-01-15
**Status**: Draft
**Input**: Unified OAuth authentication server with fixed callback URLs

## Critical Constraints

**IMMUTABLE CALLBACK URLS**: OAuth applications are already registered with external providers (Microsoft, Slack). The callback URLs **CANNOT** be changed without re-registering OAuth apps. The implementation MUST use these exact callback URL patterns:

- **Microsoft**: `http://localhost:3333/auth/microsoft/callback` or `https://localhost:3333/auth/microsoft/callback`
- **Slack**: `http://localhost:3333/auth/slack/callback` or `https://localhost:3333/auth/slack/callback`
- **Port**: 3333 (configurable via `AUTH_SERVER_PORT`, but defaults to 3333)
- **Pattern**: `/auth/:service/callback` where `:service` is the service name (microsoft, slack, etc.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - User Authenticates with Microsoft 365 (Priority: P1)

As a user, I want to authenticate with Microsoft 365 by clicking a URL in Claude, logging in via browser, and having my tokens securely stored so that I can use Microsoft 365 tools (email, calendar) through the MCP server.

**Why this priority**: Microsoft 365 authentication is the primary use case and must work reliably. Without this, no Microsoft 365 tools function.

**Independent Test**: Can be fully tested by calling the authenticate tool, clicking the returned URL, completing Microsoft OAuth login in browser, and verifying tokens are saved to `~/.cerebro-tokens/microsoft-token.json`. Delivers value by enabling all Microsoft 365 tools.

**Acceptance Scenarios**:

1. **Given** auth server is running on port 3333, **When** user navigates to `http://localhost:3333/auth/microsoft/login`, **Then** they are redirected to Microsoft login page with correct OAuth parameters
2. **Given** user completes Microsoft login, **When** Microsoft redirects to callback URL with auth code, **Then** auth server exchanges code for tokens and saves them securely
3. **Given** tokens are saved, **When** user calls Microsoft 365 tools, **Then** tools use saved tokens for API authentication
4. **Given** tokens expire, **When** API call is made, **Then** BaseTokenStorage automatically refreshes tokens before the request

---

### User Story 2 - User Authenticates with Slack (Priority: P1)

As a user, I want to authenticate with Slack by clicking a URL in Claude, selecting a workspace, and having my user tokens stored so that I can use Slack tools (channels, threads, canvases) through the MCP server.

**Why this priority**: Slack authentication is equally important as Microsoft. Multi-service support validates the unified auth server architecture.

**Independent Test**: Can be fully tested by calling the authenticate tool, clicking the returned URL, completing Slack OAuth login and workspace selection, and verifying tokens are saved to `~/.cerebro-tokens/slack-token.json`. Delivers value by enabling all Slack tools.

**Acceptance Scenarios**:

1. **Given** auth server is running, **When** user navigates to `http://localhost:3333/auth/slack/login`, **Then** they are redirected to Slack OAuth page with correct user scopes
2. **Given** user authorizes workspace access, **When** Slack redirects to callback URL with auth code, **Then** auth server exchanges code for user token
3. **Given** user token is saved, **When** user calls Slack tools, **Then** tools use saved user token for API authentication
4. **Given** Slack user tokens don't expire, **When** API calls are made, **Then** no token refresh is needed

---

### User Story 3 - Developer Adds New OAuth Service (Priority: P2)

As a developer, I want to add a new OAuth service (e.g., Google Calendar, GitHub) by implementing service-specific configuration and registering it with the auth server so that the unified auth server handles its OAuth flow without code changes to the core server.

**Why this priority**: Extensibility is important but secondary to core Microsoft/Slack functionality working.

**Independent Test**: Can be tested by creating a new service config, registering OAuth app with provider using callback URL pattern `/auth/newservice/callback`, and verifying the auth server routes requests correctly. Delivers value by proving architecture is extensible.

**Acceptance Scenarios**:

1. **Given** a new service config is created with OAuth parameters, **When** it's registered with the auth server, **Then** it appears in the loaded services list
2. **Given** service is registered, **When** user navigates to `/auth/newservice/login`, **Then** they are redirected to the provider's OAuth page
3. **Given** OAuth provider redirects to callback, **When** callback is received at `/auth/newservice/callback`, **Then** auth server exchanges code for tokens using service config

---

### User Story 4 - User Sees Helpful Error Messages (Priority: P2)

As a user, when OAuth authentication fails (missing credentials, OAuth errors, network issues), I want clear, actionable error messages displayed in the browser so that I understand what went wrong and how to fix it.

**Why this priority**: Good error handling improves user experience but core functionality must work first.

**Independent Test**: Can be tested by triggering various error conditions (missing env vars, OAuth error responses, invalid codes) and verifying HTML error pages display with helpful context. Delivers value by making troubleshooting easier.

**Acceptance Scenarios**:

1. **Given** service credentials are not set, **When** user initiates login, **Then** error page shows which environment variables are missing
2. **Given** OAuth provider returns error, **When** callback is received with error parameter, **Then** error page shows the error code and description from provider
3. **Given** no authorization code in callback, **When** callback URL is called without code parameter, **Then** error page explains code is missing and suggests trying again

---

### User Story 5 - Auth Server Supports HTTP and HTTPS (Priority: P3)

As a developer, I want the auth server to automatically use HTTPS if SSL certificates are available (for Slack) and fall back to HTTP otherwise (for Microsoft) so that services with different SSL requirements can coexist.

**Why this priority**: Nice to have but both services work with HTTP. HTTPS is only required for Slack in production scenarios.

**Independent Test**: Can be tested by running server with and without SSL certificates (mkcert), verifying HTTPS is used when certs exist and HTTP when they don't.

**Acceptance Scenarios**:

1. **Given** SSL certificates exist (localhost+2.pem files), **When** auth server starts, **Then** it uses HTTPS on port 3333
2. **Given** SSL certificates don't exist, **When** auth server starts, **Then** it uses HTTP on port 3333 and logs instructions for enabling HTTPS
3. **Given** HTTPS is enabled, **When** user authenticates with Slack, **Then** OAuth flow completes successfully with HTTPS callback

---

### Edge Cases

- What happens when auth server port 3333 is already in use?
- How does the system handle concurrent authentication requests from multiple services?
- What happens when OAuth provider callback URL doesn't match registered URL?
- How does the system handle OAuth state parameter validation (CSRF protection)?
- What happens when token exchange API call fails or times out?
- How does the system behave when service config is malformed or missing required fields?
- What happens when user closes browser before completing OAuth flow?
- How does legacy callback URL support (`/auth/callback`) work for backward compatibility?

## Requirements *(mandatory)*

### Functional Requirements

#### Server Initialization & Configuration
- **FR-001**: System MUST start HTTP/HTTPS server on configurable port (default 3333)
- **FR-002**: System MUST load SSL certificates if available (localhost+2.pem, localhost+2-key.pem) and use HTTPS, otherwise use HTTP
- **FR-003**: System MUST dynamically load service configurations from services directory
- **FR-004**: System MUST validate service configurations have required fields: clientId, clientSecret, redirectUri, scopes/userScopes, authEndpoint, tokenEndpoint
- **FR-005**: System MUST log which services are loaded successfully and which failed with clear error messages
- **FR-006**: System MUST fail gracefully if no services are configured (start server but show warning)

#### Fixed Callback URL Pattern (CRITICAL)
- **FR-007**: System MUST use URL pattern `/auth/:service/callback` for OAuth callbacks where `:service` matches service name
- **FR-008**: Microsoft callback MUST be exactly `/auth/microsoft/callback` (already registered with Microsoft Azure AD)
- **FR-009**: Slack callback MUST be exactly `/auth/slack/callback` (already registered with Slack OAuth)
- **FR-010**: System MUST NOT allow callback URL modification that would break existing OAuth registrations
- **FR-011**: System MUST use configurable port via `AUTH_SERVER_PORT` environment variable (default 3333)
- **FR-012**: System MUST construct full callback URLs as `{protocol}://localhost:{port}/auth/{service}/callback`

#### OAuth Flow - Login Initiation
- **FR-013**: System MUST handle GET requests to `/auth/:service/login` by redirecting to OAuth provider's authorization endpoint
- **FR-014**: System MUST construct authorization URL with: client_id, response_type=code, redirect_uri, scope/user_scope, state (CSRF token)
- **FR-015**: System MUST validate service credentials are set before initiating OAuth flow
- **FR-016**: System MUST return HTML error page if credentials are missing with instructions on which env vars to set
- **FR-017**: System MUST log OAuth initiation with service name and redirection URL
- **FR-018**: System MUST support both Microsoft OAuth (scope parameter, space-separated) and Slack OAuth (user_scope parameter, comma-separated)

#### OAuth Flow - Callback Handling
- **FR-019**: System MUST handle GET requests to `/auth/:service/callback` with query parameters (code, state, error)
- **FR-020**: System MUST check for OAuth error in query parameters and display error page with error code and description
- **FR-021**: System MUST validate authorization code is present in callback query parameters
- **FR-022**: System MUST exchange authorization code for access token by calling service TokenStorage.exchangeCodeForTokens()
- **FR-023**: System MUST return success HTML page on successful token exchange showing token storage path
- **FR-024**: System MUST return error HTML page on token exchange failure with error message
- **FR-025**: System MUST log all callback events: code received, token exchange started, success/failure

#### Service Routing & Discovery
- **FR-026**: System MUST parse service name from URL path (`/auth/:service/:action`)
- **FR-027**: System MUST return 404 error page if service is not found in loaded services
- **FR-028**: System MUST list available services in error message when service not found
- **FR-029**: System MUST support adding new services without modifying core auth server code
- **FR-030**: System MUST provide home page at `/` listing all loaded services and endpoints

#### Legacy Support (Backward Compatibility)
- **FR-031**: System MUST support legacy callback URL `/auth/callback` and forward to Microsoft service for backward compatibility
- **FR-032**: System MUST support legacy login URL `/auth` and forward to Microsoft service for backward compatibility
- **FR-033**: System MUST log warnings when legacy URLs are used with message to update to new URL pattern
- **FR-034**: Legacy routes MUST be documented as deprecated in logs and error messages

#### HTML Response Rendering
- **FR-035**: System MUST render HTML pages for all user-facing responses (success, error, info)
- **FR-036**: HTML pages MUST include styled content with appropriate colors (success=green, error=red, info=blue)
- **FR-037**: Success pages MUST show service name, token storage path, and confirmation message
- **FR-038**: Error pages MUST show error type, detailed message, and actionable next steps
- **FR-039**: All pages MUST include message "You can close this window and return to Claude"

#### Security & Error Handling
- **FR-040**: System MUST include state parameter in OAuth requests for CSRF protection
- **FR-041**: System MUST handle OAuth provider errors gracefully with user-friendly messages
- **FR-042**: System MUST validate authorization code exists before attempting token exchange
- **FR-043**: System MUST log all errors with context (service name, operation, error details)
- **FR-044**: System MUST handle network failures during token exchange with retry logic or clear error messages

#### Graceful Shutdown
- **FR-045**: System MUST handle SIGINT (Ctrl+C) and SIGTERM signals for graceful shutdown
- **FR-046**: System MUST close HTTP/HTTPS server before process exit
- **FR-047**: System MUST log shutdown message before terminating

#### Integration with Services
- **FR-048**: System MUST integrate with service-specific TokenStorage implementations for token exchange
- **FR-049**: System MUST pass service configuration (clientId, clientSecret, redirectUri, scopes) to OAuth requests
- **FR-050**: System MUST support both token types: refresh tokens (Microsoft) and non-expiring user tokens (Slack)

### Key Entities

- **ServiceConfig**: OAuth configuration for a service including clientId, clientSecret, redirectUri, scopes, authEndpoint, tokenEndpoint, tokenStorePath
- **ServiceRoute**: Parsed URL route with service name and action (login/callback)
- **OAuthRequest**: OAuth authorization request with query parameters (client_id, redirect_uri, scope, state, response_type)
- **OAuthCallback**: OAuth callback data with code, state, error, error_description
- **TokenStorage**: Service-specific token storage implementation (from base architecture)
- **HTMLResponse**: Rendered HTML page with title, heading, content, and type (success/error/info)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Auth server starts successfully on port 3333 (or configured port) within 2 seconds
- **SC-002**: All registered services load and display in startup logs with endpoints
- **SC-003**: Microsoft OAuth flow completes end-to-end with token saved to correct path
- **SC-004**: Slack OAuth flow completes end-to-end with user token saved to correct path
- **SC-005**: Callback URLs match exactly the registered URLs with OAuth providers (no 404s or mismatches)
- **SC-006**: Error pages display for all error scenarios with actionable messages
- **SC-007**: Legacy callback URLs (`/auth` and `/auth/callback`) forward correctly to Microsoft with deprecation warnings
- **SC-008**: HTTPS is used when SSL certificates are present, HTTP otherwise
- **SC-009**: New services can be added by creating config and registering with provider using URL pattern
- **SC-010**: All OAuth flows are logged with service name, action, and outcome for debugging

### Skyscanner Production Standards Compliance

This feature must comply with:
- **Security & Privacy**: OAuth 2.0 best practices, state parameter for CSRF, secure token handling, HTTPS support
- **API Design**: RESTful URL patterns, consistent error responses, proper HTTP status codes
- **Observability**: Structured logging for all OAuth events, error context, service identification
- **Code Quality & Style**: TypeScript strict mode, clear separation of concerns, reusable functions

## Out of Scope

The following are explicitly **not** included in this feature:
- Token storage implementation (BaseTokenStorage) - covered in feature 001
- Service-specific implementations (Microsoft, Slack services) - covered in separate specs
- MCP protocol integration - covered in separate spec
- OAuth token refresh logic - handled by BaseTokenStorage in feature 001
- SSL certificate generation (mkcert) - manual setup step, documented in README

## Dependencies

- Feature 001 (Project Foundation & Base Architecture) - BaseTokenStorage interface
- Node.js built-in modules: http, https, url, fs, path, querystring
- SSL certificates (optional): localhost+2.pem, localhost+2-key.pem (generated via mkcert)
- OAuth app registrations:
  - Microsoft Azure AD app with redirect URI: `http://localhost:3333/auth/microsoft/callback`
  - Slack app with redirect URI: `http://localhost:3333/auth/slack/callback`

## OAuth App Registration Details

For reference, the OAuth apps must be configured as follows:

### Microsoft Azure AD
- **Redirect URI**: `http://localhost:3333/auth/microsoft/callback` (or https)
- **Platform**: Web
- **Application Type**: Public client/native
- **Required Scopes**: Mail.Read, Mail.Send, Calendars.ReadWrite, MailboxSettings.Read, User.Read

### Slack App
- **Redirect URI**: `http://localhost:3333/auth/slack/callback` (or https)
- **OAuth Scopes**: User Token Scopes: `channels:read`, `channels:history`, `canvases:read`, `canvases:write`

## References

- Constitution: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
- Feature 001: [001-project-foundation](../001-001-project-foundation/spec.md)
- Original Python auth server: `~/code/cerebro-mcp/common/auth-server.js`
- OAuth 2.0 Security Best Current Practice: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics
- Microsoft OAuth: https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow
- Slack OAuth: https://api.slack.com/authentication/oauth-v2
