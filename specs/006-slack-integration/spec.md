# Feature 006: Slack Integration

**Status**: Draft
**Priority**: P1 (High)
**Estimated Effort**: Medium
**Target Release**: v0.3.0

---

## Overview

Adds Slack integration service with capabilities for channels, threads, canvases, private groups, user identity, and reminders using Slack Web API. Provides tools for listing channels and groups, reading message history, fetching thread replies, accessing canvas content, retrieving user identity, and managing reminders.

---

## Business Context

### Problem Statement
Users need programmatic access to Slack workspaces to:
- List available public channels and private groups
- Read channel and group message history
- Retrieve threaded conversation replies
- Access and search Slack canvas documents
- Retrieve user identity information
- List, create, and complete reminders
- Authenticate with Slack workspaces

### Success Criteria
1. Users can authenticate with Slack using OAuth 2.0 user tokens
2. Users can list public channels and private groups with pagination support
3. Users can retrieve message history from channels and groups with configurable limits
4. Users can fetch replies from threaded conversations
5. Users can read canvas content by ID
6. Users can search for canvases within channels
7. Users can retrieve their Slack user identity details
8. Users can list their reminders
9. Users can create new reminders
10. Users can mark reminders as complete
11. All operations use cursor-based pagination where applicable
12. Service follows conditional registration pattern

---

## Technical Design

### Architecture

```
SlackService
├── Authentication Tools
│   ├── authenticate
│   └── check-auth-status
├── Channel Tools
│   ├── list-channels
│   └── get-channel-history
├── Group Tools
│   ├── list-groups
│   └── get-group-history
├── Thread Tools
│   └── get-thread-replies
├── Canvas Tools
│   ├── read-canvas
│   └── search-canvases
├── Identity Tools
│   └── get-user-identity
└── Reminder Tools
    ├── list-reminders
    ├── create-reminder
    └── complete-reminder
```

### API Endpoints

Slack Web API endpoints to be used:
- `POST /conversations.list` - List public channels and private groups
- `POST /conversations.history` - Get channel/group messages
- `POST /conversations.replies` - Get thread replies
- `POST /canvases.edit` - Read canvas content (with empty edits array)
- `POST /search.messages` - Search for canvas messages in channels
- `POST /users.identity` - Get user identity information
- `POST /reminders.list` - List user's reminders
- `POST /reminders.add` - Create a new reminder
- `POST /reminders.complete` - Mark reminder as complete

### OAuth Configuration

Slack OAuth 2.0 with user tokens:
- **Client ID**: From environment variable `SLACK_CLIENT_ID`
- **Client Secret**: From environment variable `SLACK_CLIENT_SECRET`
- **Scopes**:
  - `channels:read` - List public channels and basic info
  - `channels:history` - Read public channel messages
  - `groups:read` - List private groups and basic info
  - `groups:history` - Read private group messages
  - `canvases:read` - Read canvas content
  - `canvases:write` - Edit canvases (used for read-only with empty edits)
  - `identify` - Get basic user identity
  - `reminders:read` - List user's reminders
  - `reminders:write` - Create and complete reminders
- **Auth Endpoint**: `https://slack.com/oauth/v2/authorize`
- **Token Endpoint**: `https://slack.com/api/oauth.v2.access`
- **Redirect URI**: `http://localhost:3333/auth/slack/callback`

**Note**: Slack user tokens do not expire, so no refresh token mechanism is needed.

Updated service registration in `src/mcp-server/service-registration.ts`:
```typescript
// Slack
if (hasSlackCredentials()) {
  const slackConfig: ServiceConfig = {
    name: 'slack',
    displayName: 'Slack',
    apiEndpoint: 'https://slack.com/api',
    oauth: {
      clientId: process.env['SLACK_CLIENT_ID'] ?? '',
      clientSecret: process.env['SLACK_CLIENT_SECRET'] ?? '',
      redirectUri: 'http://localhost:3333/auth/slack/callback',
      scopes: [
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'canvases:read',
        'canvases:write',
        'identify',
        'reminders:read',
        'reminders:write',
      ],
      authEndpoint: 'https://slack.com/oauth/v2/authorize',
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
    },
    tokenStorePath: './.tokens/slack-tokens.json',
  };

  const slackService = new SlackService(slackConfig);
  await registry.register(slackService);
}
```

### API Request Pattern

All Slack API requests:
- Use POST method
- Send JSON body
- Include OAuth token in Authorization header: `Bearer <token>`
- Return JSON responses with `ok` boolean field
- Use cursor-based pagination with `response_metadata.next_cursor`
- Maximum 200 items per page

---

## Functional Requirements

### FR-026: Slack Authentication
- **Priority**: P1
- **Description**: Authenticate user with Slack workspace using OAuth 2.0
- **Input Parameters**: None (initiates OAuth flow)
- **Output**:
  - OAuth authorization URL
  - Success message with instructions
- **Acceptance**:
  - Generates valid OAuth URL with all required scopes
  - Returns URL for user to complete authentication in browser
  - Tokens stored after OAuth callback completes

### FR-027: Check Authentication Status
- **Priority**: P1
- **Description**: Verify if user has valid Slack authentication
- **Input Parameters**: None
- **Output**:
  - Authentication status (boolean)
  - Team name and ID (if authenticated)
  - User name and ID (if authenticated)
  - Scopes granted (if authenticated)
- **Acceptance**:
  - Returns true if valid token exists
  - Returns false if no token or invalid token
  - Includes workspace and user details when authenticated

### FR-028: List Channels
- **Priority**: P1
- **Description**: List all public channels in the Slack workspace
- **Input Parameters**:
  - `limit` (optional): Number of channels to return (default: 100, max: 200)
  - `cursor` (optional): Pagination cursor from previous response
- **Output**:
  - Array of channels with:
    - Channel ID
    - Channel name
    - Is private flag
    - Is archived flag
    - Member count
    - Topic
    - Purpose
  - Next cursor for pagination (if more results)
  - Response metadata
- **Acceptance**:
  - Returns public channels only
  - Supports cursor-based pagination
  - Caps limit at 200 per request
  - Excludes archived channels by default

### FR-029: Get Channel History
- **Priority**: P1
- **Description**: Retrieve message history from a specific channel
- **Input Parameters**:
  - `channelId` (required): Slack channel ID
  - `limit` (optional): Number of messages to return (default: 50, max: 200)
  - `cursor` (optional): Pagination cursor from previous response
  - `oldest` (optional): Unix timestamp to fetch messages after this time
  - `latest` (optional): Unix timestamp to fetch messages before this time
- **Output**:
  - Array of messages with:
    - Message type
    - User ID
    - Text content
    - Timestamp
    - Thread timestamp (if part of thread)
    - Reply count (if thread parent)
    - Reactions (if any)
  - Next cursor for pagination (if more results)
  - Has more flag
- **Acceptance**:
  - Returns messages in reverse chronological order (newest first)
  - Supports time-based filtering with oldest/latest
  - Supports cursor-based pagination
  - Includes thread metadata
  - Caps limit at 200 per request

### FR-030: Get Thread Replies
- **Priority**: P1
- **Description**: Retrieve all replies in a threaded conversation
- **Input Parameters**:
  - `channelId` (required): Slack channel ID containing the thread
  - `threadTs` (required): Thread parent message timestamp
  - `limit` (optional): Number of replies to return (default: 50, max: 200)
  - `cursor` (optional): Pagination cursor from previous response
- **Output**:
  - Array of messages (parent + replies) with:
    - Message type
    - User ID
    - Text content
    - Timestamp
    - Thread timestamp
    - Reactions (if any)
  - Next cursor for pagination (if more results)
  - Has more flag
- **Acceptance**:
  - Returns parent message as first item
  - Returns all replies in chronological order
  - Supports cursor-based pagination
  - Caps limit at 200 per request
  - Throws error if thread not found

### FR-031: Read Canvas
- **Priority**: P1
- **Description**: Read content from a Slack canvas by ID
- **Input Parameters**:
  - `canvasId` (required): Slack canvas ID
- **Output**:
  - Canvas ID
  - Document content object with:
    - Type (always "canvas")
    - Markdown content
    - Version information
- **Acceptance**:
  - Returns full canvas content in markdown format
  - Uses canvases.edit API with empty edits array (read-only pattern)
  - Throws error if canvas not found or no access
  - Validates canvas ID format

### FR-032: Search Canvases
- **Priority**: P1
- **Description**: Search for canvases within a specific channel
- **Input Parameters**:
  - `channelId` (required): Slack channel ID to search in
  - `limit` (optional): Number of results to return (default: 20, max: 100)
- **Output**:
  - Array of canvas messages with:
    - Canvas ID (extracted from attachments)
    - Message text
    - User ID
    - Timestamp
    - Channel ID
  - Total count of canvases found
- **Acceptance**:
  - Searches for messages with canvas attachments
  - Uses search.messages API with query: `in:<channel_id> has:files`
  - Filters results to only canvas file types
  - Extracts canvas IDs from message attachments
  - Returns empty array if no canvases found
  - Caps limit at 100 results

### FR-033: List Private Groups
- **Priority**: P1
- **Description**: List all private groups (private channels) the user is a member of
- **Input Parameters**:
  - `limit` (optional): Number of groups to return (default: 100, max: 200)
  - `cursor` (optional): Pagination cursor from previous response
- **Output**:
  - Array of groups with:
    - Group ID
    - Group name
    - Is private flag (always true)
    - Is archived flag
    - Member count
    - Topic
    - Purpose
  - Next cursor for pagination (if more results)
  - Response metadata
- **Acceptance**:
  - Returns only private groups where user is a member
  - Supports cursor-based pagination
  - Caps limit at 200 per request
  - Excludes archived groups by default

### FR-034: Get Group History
- **Priority**: P1
- **Description**: Retrieve message history from a specific private group
- **Input Parameters**:
  - `groupId` (required): Slack group (private channel) ID
  - `limit` (optional): Number of messages to return (default: 50, max: 200)
  - `cursor` (optional): Pagination cursor from previous response
  - `oldest` (optional): Unix timestamp to fetch messages after this time
  - `latest` (optional): Unix timestamp to fetch messages before this time
- **Output**:
  - Array of messages with:
    - Message type
    - User ID
    - Text content
    - Timestamp
    - Thread timestamp (if part of thread)
    - Reply count (if thread parent)
    - Reactions (if any)
  - Next cursor for pagination (if more results)
  - Has more flag
- **Acceptance**:
  - Returns messages in reverse chronological order (newest first)
  - Supports time-based filtering with oldest/latest
  - Supports cursor-based pagination
  - Includes thread metadata
  - Caps limit at 200 per request
  - User must be member of group

### FR-035: Get User Identity
- **Priority**: P1
- **Description**: Retrieve the authenticated user's Slack identity information
- **Input Parameters**: None
- **Output**:
  - User ID
  - Team/workspace ID
  - User name
  - Real name
  - Email address
  - Profile image URLs (various sizes)
  - Team name
  - Team domain
- **Acceptance**:
  - Returns identity of authenticated user
  - Includes complete user profile information
  - Includes team/workspace details
  - Works with valid authentication token

### FR-036: List Reminders
- **Priority**: P1
- **Description**: List all active reminders for the authenticated user
- **Input Parameters**: None
- **Output**:
  - Array of reminders with:
    - Reminder ID
    - Text/description
    - Time (when reminder triggers)
    - User ID (creator)
    - Recurring flag
    - Completion status
- **Acceptance**:
  - Returns all active (not completed) reminders
  - Ordered by time ascending (soonest first)
  - Includes recurring reminder information
  - Empty array if no reminders

### FR-037: Create Reminder
- **Priority**: P1
- **Description**: Create a new reminder for the authenticated user
- **Input Parameters**:
  - `text` (required): Reminder description/text
  - `time` (required): Unix timestamp or relative time (e.g., "in 1 hour", "tomorrow at 9am")
- **Output**:
  - Success status
  - Reminder ID
  - Created reminder details:
    - Text
    - Time
    - User ID
- **Acceptance**:
  - Creates reminder for authenticated user
  - Supports Unix timestamps
  - Supports relative time strings
  - Returns created reminder details
  - Validates time parameter format

### FR-038: Complete Reminder
- **Priority**: P1
- **Description**: Mark a reminder as complete
- **Input Parameters**:
  - `reminderId` (required): Reminder ID to complete
- **Output**:
  - Success status
  - Completed reminder ID
- **Acceptance**:
  - Marks reminder as complete
  - Reminder removed from active list
  - Throws error if reminder not found
  - User can only complete their own reminders

---

## User Stories

### User Story 1: Authenticate with Slack (P1)
**As a** user
**I want to** authenticate with my Slack workspace
**So that** I can access channels and messages programmatically

**Acceptance Criteria**:
- User can initiate OAuth flow via authenticate tool
- User receives authorization URL to complete in browser
- User can check authentication status
- Tokens are stored securely after OAuth callback

### User Story 2: Browse Slack Channels (P1)
**As a** user
**I want to** list all public channels in my workspace
**So that** I can see what channels are available

**Acceptance Criteria**:
- User can list all public channels
- Results include channel name, ID, and metadata
- Pagination supported for workspaces with many channels
- Archived channels excluded by default

### User Story 3: Read Channel Messages (P1)
**As a** user
**I want to** retrieve message history from channels
**So that** I can analyze conversations and extract information

**Acceptance Criteria**:
- User can fetch recent messages from any public channel
- Results include message text, author, and timestamp
- Time-based filtering supported (oldest/latest)
- Thread metadata included (reply count, thread_ts)
- Pagination supported for long histories

### User Story 4: Follow Threaded Conversations (P1)
**As a** user
**I want to** retrieve all replies in a thread
**So that** I can read complete threaded discussions

**Acceptance Criteria**:
- User can fetch thread by channel ID and thread timestamp
- Results include parent message and all replies
- Replies returned in chronological order
- Pagination supported for long threads

### User Story 5: Access Canvas Documents (P1)
**As a** user
**I want to** read Slack canvas documents
**So that** I can extract structured content and documentation

**Acceptance Criteria**:
- User can read canvas by ID
- Canvas content returned in markdown format
- Works with canvases from any accessible channel

### User Story 6: Discover Canvases in Channels (P1)
**As a** user
**I want to** find all canvases within a specific channel
**So that** I can locate documentation and structured content

**Acceptance Criteria**:
- User can search for canvases in a channel
- Results include canvas IDs and associated messages
- Returns empty array if no canvases in channel
- Supports pagination for channels with many canvases

### User Story 7: Access Private Groups (P1)
**As a** user
**I want to** list and read messages from private groups I'm a member of
**So that** I can access private team conversations

**Acceptance Criteria**:
- User can list all private groups they belong to
- Results include group name, ID, and metadata
- User can fetch message history from private groups
- Access restricted to groups where user is member
- Pagination supported

### User Story 8: Retrieve User Identity (P1)
**As a** user
**I want to** access my Slack identity information
**So that** I can verify my account details and workspace membership

**Acceptance Criteria**:
- User can fetch their complete Slack profile
- Results include user ID, name, email, and profile images
- Team/workspace information included
- Works with authenticated token

### User Story 9: Manage Reminders (P1)
**As a** user
**I want to** create, list, and complete reminders in Slack
**So that** I can manage tasks and notifications programmatically

**Acceptance Criteria**:
- User can list all active reminders
- User can create new reminders with text and time
- Supports both Unix timestamps and relative time strings
- User can mark reminders as complete
- Reminders properly associated with authenticated user

---

## Implementation Plan

### Phase 1: Service Foundation
1. Create `src/services/slack/` directory structure
2. Implement `SlackTokenStorage` class extending `BaseTokenStorage`
   - No refresh token logic needed (user tokens don't expire)
   - Store access token, team info, user info
3. Implement `SlackApiClient` class extending `BaseAPIClient`
   - POST-based request method
   - Handle Slack's `ok` field in responses
   - Extract errors from `error` field when `ok=false`
4. Create `SlackService` class extending `BaseService`
   - Implement `getTools()` returning 13 tool definitions
   - Add namespace prefix: `slack.tool-name`

### Phase 2: Authentication Tools
1. Implement `authenticate()` handler
   - Return OAuth URL with proper scopes
   - Include state parameter for security
2. Implement `checkAuthStatus()` handler
   - Read token from storage
   - Call `/auth.test` API to validate token
   - Return team and user information

### Phase 3: Channel Tools
1. Implement `listChannels()` handler
   - POST to `/conversations.list`
   - Support cursor pagination
   - Filter to public channels only
2. Implement `getChannelHistory()` handler
   - POST to `/conversations.history`
   - Support cursor pagination and time filters
   - Include thread metadata in results

### Phase 4: Thread Tools
1. Implement `getThreadReplies()` handler
   - POST to `/conversations.replies`
   - Support cursor pagination
   - Return parent message plus all replies

### Phase 5: Canvas Tools
1. Implement `readCanvas()` handler
   - POST to `/canvases.edit` with empty edits array
   - Extract markdown content from response
2. Implement `searchCanvases()` handler
   - POST to `/search.messages` with file filter query
   - Filter results to canvas file types only
   - Extract canvas IDs from attachments

### Phase 6: Group Tools
1. Implement `listGroups()` handler
   - POST to `/conversations.list` with `types=private_channel`
   - Support cursor pagination
   - Filter to private groups only
2. Implement `getGroupHistory()` handler
   - POST to `/conversations.history`
   - Support cursor pagination and time filters
   - Include thread metadata in results

### Phase 7: Identity Tools
1. Implement `getUserIdentity()` handler
   - POST to `/users.identity`
   - Extract user profile and team information
   - Return complete identity object

### Phase 8: Reminder Tools
1. Implement `listReminders()` handler
   - POST to `/reminders.list`
   - Return all active reminders
   - Order by time ascending
2. Implement `createReminder()` handler
   - POST to `/reminders.add`
   - Support Unix timestamp and relative time
   - Return created reminder details
3. Implement `completeReminder()` handler
   - POST to `/reminders.complete`
   - Mark reminder as complete
   - Return success status

### Phase 9: Service Registration
1. Update `src/mcp-server/service-registration.ts`
   - Replace TODO comment with full Slack service registration
   - Use conditional registration based on `hasSlackCredentials()`
   - Configure OAuth with all required parameters

### Phase 10: Testing
1. Create `src/services/slack/__tests__/slack-service.test.ts`
2. Add unit tests for all 13 tools
3. Test pagination logic
4. Test error handling (invalid channel, unauthorized, etc.)
5. Test authentication status checking

### Phase 11: Documentation
1. Update README.md with Slack service section
2. Document OAuth setup and scope requirements
3. Add usage examples for each tool
4. Document cursor pagination pattern

---

## Test Plan

### Unit Tests (Target: ≥80% coverage)

**Service Registration**:
- ✓ getTools() returns 13 tools
- ✓ Each tool has correct name with slack. prefix
- ✓ Required parameters marked as required
- ✓ Tool namespacing follows pattern

**Authentication Tools**:
- ✓ authenticate returns valid OAuth URL
- ✓ OAuth URL includes all required scopes
- ✓ checkAuthStatus returns false when not authenticated
- ✓ checkAuthStatus returns true with details when authenticated
- ✓ checkAuthStatus includes team and user information

**List Channels Tool**:
- ✓ Lists channels with default limit of 100
- ✓ Respects custom limit parameter
- ✓ Caps limit at 200
- ✓ Supports cursor-based pagination
- ✓ Returns channel metadata (name, ID, topic, purpose)
- ✓ Handles empty channel list

**Get Channel History Tool**:
- ✓ Retrieves messages from channel
- ✓ Defaults to 50 messages
- ✓ Respects custom limit
- ✓ Caps limit at 200
- ✓ Supports cursor pagination
- ✓ Supports oldest/latest time filters
- ✓ Includes thread metadata
- ✓ Returns messages in reverse chronological order
- ✓ Requires channelId parameter

**Get Thread Replies Tool**:
- ✓ Retrieves thread parent and replies
- ✓ Defaults to 50 messages
- ✓ Respects custom limit
- ✓ Caps limit at 200
- ✓ Supports cursor pagination
- ✓ Returns messages in chronological order
- ✓ Requires channelId and threadTs parameters
- ✓ Throws error if thread not found

**Read Canvas Tool**:
- ✓ Reads canvas by ID
- ✓ Returns markdown content
- ✓ Uses canvases.edit with empty edits
- ✓ Requires canvasId parameter
- ✓ Throws error if canvas not found

**Search Canvases Tool**:
- ✓ Searches for canvases in channel
- ✓ Uses search.messages with file filter
- ✓ Extracts canvas IDs from attachments
- ✓ Filters to canvas file types only
- ✓ Defaults to 20 results
- ✓ Caps limit at 100
- ✓ Returns empty array if no canvases found
- ✓ Requires channelId parameter

**List Groups Tool**:
- ✓ Lists private groups user is member of
- ✓ Defaults to 100 groups
- ✓ Respects custom limit
- ✓ Caps limit at 200
- ✓ Supports cursor pagination
- ✓ Returns group metadata (name, ID, topic, purpose)
- ✓ Filters to private_channel type
- ✓ Handles empty group list

**Get Group History Tool**:
- ✓ Retrieves messages from private group
- ✓ Defaults to 50 messages
- ✓ Respects custom limit
- ✓ Caps limit at 200
- ✓ Supports cursor pagination
- ✓ Supports oldest/latest time filters
- ✓ Includes thread metadata
- ✓ Returns messages in reverse chronological order
- ✓ Requires groupId parameter
- ✓ Throws error if user not member of group

**Get User Identity Tool**:
- ✓ Retrieves authenticated user's identity
- ✓ Returns user ID and name
- ✓ Returns email address
- ✓ Returns profile image URLs
- ✓ Returns team/workspace information
- ✓ Works with valid token
- ✓ Throws error if not authenticated

**List Reminders Tool**:
- ✓ Lists all active reminders
- ✓ Returns empty array if no reminders
- ✓ Includes reminder ID, text, and time
- ✓ Orders by time ascending
- ✓ Includes recurring flag
- ✓ Excludes completed reminders

**Create Reminder Tool**:
- ✓ Creates reminder with text and time
- ✓ Supports Unix timestamp
- ✓ Supports relative time strings
- ✓ Returns created reminder ID
- ✓ Returns reminder details
- ✓ Requires text parameter
- ✓ Requires time parameter
- ✓ Validates time format

**Complete Reminder Tool**:
- ✓ Marks reminder as complete
- ✓ Returns success status
- ✓ Requires reminderId parameter
- ✓ Throws error if reminder not found
- ✓ Throws error if not user's reminder

**Token Storage**:
- ✓ Stores access token without refresh token
- ✓ Saves team information
- ✓ Saves user information
- ✓ Retrieves valid token
- ✓ Handles missing token file

**API Client**:
- ✓ Makes POST requests to Slack API
- ✓ Includes Authorization header with Bearer token
- ✓ Handles Slack ok=false responses as errors
- ✓ Extracts error messages from response
- ✓ Supports request timeout

### Integration Tests (Manual)

**OAuth Flow**:
- [ ] Authenticate with Slack workspace
- [ ] Verify all scopes appear in consent screen
- [ ] Complete OAuth callback successfully
- [ ] Token stored in `.tokens/slack-tokens.json`
- [ ] Check auth status returns authenticated

**Channel Operations**:
- [ ] List channels from real workspace
- [ ] Verify pagination with next_cursor
- [ ] Get channel history with various limits
- [ ] Filter history by time range (oldest/latest)
- [ ] Verify thread metadata in messages

**Thread Operations**:
- [ ] Retrieve actual threaded conversation
- [ ] Verify parent message included first
- [ ] Verify all replies returned in order
- [ ] Test pagination for long threads

**Canvas Operations**:
- [ ] Read existing canvas document
- [ ] Verify markdown content returned
- [ ] Search for canvases in channel
- [ ] Verify canvas IDs extracted correctly

**Group Operations**:
- [ ] List private groups user is member of
- [ ] Verify pagination with next_cursor
- [ ] Get group message history
- [ ] Verify access control (must be member)
- [ ] Filter history by time range

**Identity Operations**:
- [ ] Retrieve user identity information
- [ ] Verify user profile details returned
- [ ] Verify team/workspace information
- [ ] Validate email address present

**Reminder Operations**:
- [ ] List active reminders
- [ ] Create reminder with Unix timestamp
- [ ] Create reminder with relative time ("in 2 hours")
- [ ] Complete reminder successfully
- [ ] Verify completed reminder removed from list
- [ ] Test recurring reminders

**Error Handling**:
- [ ] Invalid channel ID returns proper error
- [ ] Invalid thread timestamp returns error
- [ ] Invalid canvas ID returns error
- [ ] Unauthorized access handled gracefully
- [ ] API rate limits handled appropriately

---

## Security Considerations

### Data Privacy
- Slack workspace data is sensitive organizational information
- Only request minimum necessary scopes
- Never log message content or user information
- Respect channel and group privacy settings

### Access Control
- User tokens grant access based on user's permissions in workspace
- Service cannot access private groups unless user is a member
- Reminders are scoped to authenticated user only
- Proper error handling for permission denied scenarios

### OAuth Scope Justification
- `channels:read`: Required for listing public channels and basic channel info
- `channels:history`: Required for reading public channel message history and threads
- `groups:read`: Required for listing private groups user is member of
- `groups:history`: Required for reading private group messages
- `canvases:read`: Required for reading canvas content
- `canvases:write`: Required for canvases.edit API (used with empty edits for read-only)
- `identify`: Required for retrieving user identity information (profile, email, team)
- `reminders:read`: Required for listing user's reminders
- `reminders:write`: Required for creating and completing reminders
- Scopes follow principle of least privilege for necessary functionality

### Token Security
- User tokens stored securely in `.tokens/slack-tokens.json`
- File permissions restricted (handled by BaseTokenStorage)
- Tokens do not expire but can be revoked by user in Slack settings
- Service validates token before each API call

---

## Dependencies

### Internal Dependencies
- Feature 003 (MCP Protocol Handler) - **COMPLETED**
- Feature 002 (OAuth Server) - **COMPLETED**
- Base Service Architecture (BaseService, BaseAPIClient, BaseTokenStorage) - **COMPLETED**

### External Dependencies
- Slack Web API v1
- Valid Slack workspace with user permissions
- OAuth app registered in Slack with correct redirect URI
- Environment variables: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`

---

## Success Metrics

### Development Metrics
- [ ] All 13 Slack tools implemented
- [ ] Unit test coverage ≥ 80% for new code
- [ ] Zero ESLint/TypeScript errors
- [ ] Build passes successfully
- [ ] Service registration conditional on credentials

### Functional Metrics
- [ ] All user stories acceptance criteria met
- [ ] All functional requirements implemented
- [ ] Manual integration tests pass
- [ ] OAuth flow works end-to-end
- [ ] Cursor pagination works correctly
- [ ] Error handling comprehensive

---

## Future Enhancements (Out of Scope)

- Write operations (post messages, edit messages, create canvases)
- Direct message (DM) support
- File upload/download operations
- User presence information
- Workspace emoji and custom emoji support
- Slash command integration
- Interactive message components (buttons, select menus)
- Bot user tokens (currently user tokens only)
- Real-time events via Socket Mode or Events API
- Message reactions management (add/remove reactions)
- User profile editing
- Team directory and user list access
- Workspace settings and permissions
- App home tab and modals
- Workflow automation triggers
- Reminder editing (currently only create/complete)
- Shared channel access

---

## References

- [Slack Web API Documentation](https://api.slack.com/web)
- [Slack OAuth Documentation](https://api.slack.com/authentication/oauth-v2)
- [Slack Permission Scopes](https://api.slack.com/scopes)
- [Conversations API](https://api.slack.com/methods/conversations.list)
- [Canvases API](https://api.slack.com/methods/canvases.edit)
- [Search API](https://api.slack.com/methods/search.messages)
- [Users Identity API](https://api.slack.com/methods/users.identity)
- [Reminders API](https://api.slack.com/methods/reminders.add)
- Python Reference Implementation: `~/code/cerebro-mcp/services/slack/`
