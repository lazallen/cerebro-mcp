# Feature 010: Slack Message Actions via Socket Mode

**Status**: Draft
**Priority**: P1 (High)
**Estimated Effort**: Small
**Target Release**: v0.4.0

---

## Overview

Adds a Socket Mode client to receive Slack message shortcut (message_action) payloads via WebSocket. When users right-click a message in Slack and select a custom action, Slack sends the payload through the WebSocket connection. This feature captures those payloads for later processing via MCP tools, enabling Claude to triage and act on flagged messages.

**Key Difference from HTTP Webhooks**: Socket Mode uses an outbound WebSocket connection from the app to Slack, eliminating the need for a publicly accessible HTTP endpoint. This is ideal for local development and apps not intended for the Slack Marketplace.

---

## Business Context

### Problem Statement
Users want to flag Slack messages for later review or action using Slack's native "More actions" menu (message shortcuts). Currently, there is no way to capture these user-initiated actions and make them available for AI-assisted triage.

### Success Criteria
1. Socket Mode client connects to Slack via WebSocket
2. Message shortcuts are received and acknowledged within 3 seconds
3. Verified payloads are persisted to file-based storage
4. MCP tools allow listing, retrieving, and deleting stored actions
5. Claude can triage stored actions and take appropriate follow-up actions

---

## Technical Design

### Architecture

```
Slack Workspace
     │
     │ User triggers message shortcut
     ▼
┌─────────────────────────────────────────────────────┐
│  Slack Platform                                      │
│  ├── Generates interaction payload                   │
│  └── Sends via WebSocket to connected apps           │
└─────────────────────────────────────────────────────┘
     │
     │ WebSocket (wss://wss.slack.com/...)
     ▼
┌─────────────────────────────────────────────────────┐
│  Socket Mode Client                                  │
│  ├── Connects via apps.connections.open              │
│  ├── Receives message_action payloads                │
│  ├── Acknowledges with envelope_id                   │
│  ├── Stores to JSON file                             │
│  └── Handles reconnection                            │
└─────────────────────────────────────────────────────┘
     │
     │ File-based storage
     ▼
┌─────────────────────────────────────────────────────┐
│  .tasks/slack-actions.json                          │
│  [                                                  │
│    { id, timestamp, payload, processed: false },    │
│    ...                                              │
│  ]                                                  │
└─────────────────────────────────────────────────────┘
     │
     │ MCP Tools
     ▼
┌─────────────────────────────────────────────────────┐
│  SlackService MCP Tools                             │
│  ├── slack.list-message-actions                     │
│  ├── slack.get-message-action                       │
│  └── slack.delete-message-action                    │
└─────────────────────────────────────────────────────┘
```

### Socket Mode Connection Flow

1. **Obtain WebSocket URL**: Call `apps.connections.open` with App Level Token
2. **Connect**: Establish WebSocket connection to returned URL
3. **Hello Message**: Receive `{"type": "hello", ...}` confirming connection
4. **Receive Events**: Process incoming payloads with `envelope_id`
5. **Acknowledge**: Send `{"envelope_id": "<id>"}` within 3 seconds
6. **Reconnect**: Handle connection drops and URL refresh (~3600s lifetime)

### Connection API

**Endpoint**: `POST https://slack.com/api/apps.connections.open`

**Headers**:
```
Authorization: Bearer xapp-1-A0123456789-...
Content-Type: application/x-www-form-urlencoded
```

**Response**:
```json
{
  "ok": true,
  "url": "wss://wss.slack.com/link/?ticket=1234-5678&app_id=A0123456789"
}
```

### WebSocket Message Format

**Hello (on connect)**:
```json
{
  "type": "hello",
  "connection_info": {
    "app_id": "A0123456789"
  },
  "approximate_connection_time": 3600
}
```

**Event Envelope (message_action)**:
```json
{
  "envelope_id": "unique-envelope-id-123",
  "type": "interactive",
  "accepts_response_payload": false,
  "payload": {
    "type": "message_action",
    "callback_id": "your_shortcut_callback_id",
    "trigger_id": "123456.789012.abcdef",
    "team": {
      "id": "T0123456",
      "domain": "workspace-name"
    },
    "user": {
      "id": "U0123456",
      "username": "user.name",
      "name": "User Name",
      "team_id": "T0123456"
    },
    "channel": {
      "id": "C0123456",
      "name": "channel-name"
    },
    "message": {
      "type": "message",
      "user": "U9876543",
      "ts": "1234567890.000001",
      "text": "The actual message content that was actioned"
    },
    "response_url": "https://hooks.slack.com/app/..."
  }
}
```

**Acknowledgement (required)**:
```json
{
  "envelope_id": "unique-envelope-id-123"
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_APP_TOKEN` | App Level Token (xapp-...) for Socket Mode | Yes |
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) for API calls | Existing |

### Storage Format

**File Path**: `.tasks/slack-actions.json`

**Schema**:
```typescript
interface StoredMessageAction {
  id: string;                    // UUID for internal reference
  receivedAt: string;            // ISO 8601 timestamp
  processed: boolean;            // Flag for triage status
  payload: SlackMessageActionPayload;  // Full Slack payload
}

interface SlackMessageActionPayload {
  type: 'message_action';
  callback_id: string;
  trigger_id: string;
  team: { id: string; domain: string };
  user: { id: string; username: string; name: string; team_id: string };
  channel: { id: string; name: string };
  message: {
    type: string;
    user: string;
    ts: string;
    text: string;
    // Additional fields may be present (attachments, blocks, etc.)
  };
  response_url: string;
}
```

### MCP Tools

#### slack.list-message-actions
Lists all stored message actions, optionally filtered by processed status.

**Input**:
- `processed` (optional): boolean - Filter by processed status

**Output**:
- Array of stored actions (id, receivedAt, processed, summary)
- Total count

#### slack.get-message-action
Retrieves full details of a specific stored action.

**Input**:
- `id` (required): string - Action ID

**Output**:
- Complete stored action with full payload

#### slack.delete-message-action
Removes a stored action (after triage/processing).

**Input**:
- `id` (required): string - Action ID

**Output**:
- Success status

---

## Functional Requirements

### FR-039: Connect to Slack via Socket Mode
- **Priority**: P1
- **Description**: Establish WebSocket connection to Slack using Socket Mode
- **Input**: App Level Token from environment
- **Output**: Active WebSocket connection
- **Acceptance**:
  - Calls `apps.connections.open` to get WebSocket URL
  - Establishes WebSocket connection
  - Receives and logs "hello" message
  - Handles connection errors gracefully
  - Reconnects automatically on disconnect

### FR-040: Receive Message Action Payloads
- **Priority**: P1
- **Description**: Process incoming message_action payloads via WebSocket
- **Input**: WebSocket message with envelope
- **Output**: Acknowledged payload
- **Acceptance**:
  - Parses envelope to extract payload
  - Identifies message_action type
  - Acknowledges within 3 seconds
  - Ignores non-message_action events gracefully

### FR-041: Store Message Action Payloads
- **Priority**: P1
- **Description**: Persist received payloads to file-based storage
- **Input**: Verified message_action payload
- **Output**: Stored action with generated ID
- **Acceptance**:
  - Generates UUID for each action
  - Records receivedAt timestamp
  - Sets processed flag to false
  - Stores full payload
  - Creates `.tasks/` directory if not exists
  - Appends to existing actions array

### FR-042: List Stored Message Actions (MCP Tool)
- **Priority**: P1
- **Description**: MCP tool to retrieve stored message actions
- **Input Parameters**:
  - `processed` (optional): Filter by processed status
- **Output**:
  - Array of actions with: id, receivedAt, processed, channel name, message preview
  - Total count
- **Acceptance**:
  - Returns all actions if no filter
  - Filters by processed status when specified
  - Returns summary (not full payload) for list view
  - Handles empty storage gracefully

### FR-043: Get Message Action Details (MCP Tool)
- **Priority**: P1
- **Description**: MCP tool to retrieve full details of a specific action
- **Input Parameters**:
  - `id` (required): Action ID
- **Output**:
  - Complete stored action with full payload
- **Acceptance**:
  - Returns full payload including message content
  - Returns 404-style error if ID not found
  - Includes all Slack context (user, channel, team)

### FR-044: Delete Message Action (MCP Tool)
- **Priority**: P1
- **Description**: MCP tool to remove a stored action after processing
- **Input Parameters**:
  - `id` (required): Action ID
- **Output**:
  - Success status
  - Deleted action ID
- **Acceptance**:
  - Removes action from storage file
  - Returns error if ID not found
  - File updated atomically

---

## User Stories

### User Story 1: Capture Slack Message for Later Review (P1)
**As a** Slack user
**I want to** right-click a message and select a custom action
**So that** the message is captured for AI-assisted triage later

**Acceptance Criteria**:
- Socket Mode client is connected and receiving events
- Message action payload is received via WebSocket
- Payload is stored with unique ID and timestamp
- Acknowledgement sent to Slack within 3 seconds

### User Story 2: Review Captured Messages via Claude (P1)
**As a** user working with Claude
**I want to** list all captured Slack messages
**So that** Claude can help me triage and respond to them

**Acceptance Criteria**:
- MCP tool lists all stored message actions
- List includes summary info (channel, message preview, when captured)
- Can filter to show only unprocessed items
- Claude can read the list and suggest actions

### User Story 3: Process and Clear Captured Messages (P1)
**As a** user working with Claude
**I want to** view full details and delete processed messages
**So that** my inbox stays clean and organized

**Acceptance Criteria**:
- MCP tool retrieves full message payload by ID
- MCP tool deletes message action by ID
- Claude can orchestrate triage workflow (read, act, delete)

---

## Implementation Plan

### Phase 1: Socket Mode Client
1. Create `SlackSocketModeClient` class
2. Implement `apps.connections.open` API call
3. Establish WebSocket connection
4. Handle "hello" message and connection lifecycle
5. Implement automatic reconnection logic

### Phase 2: Event Processing
1. Parse incoming WebSocket messages
2. Extract envelope_id and payload
3. Filter for message_action type
4. Send acknowledgement immediately
5. Pass payload to storage layer

### Phase 3: Storage Layer (Already Exists)
1. Use existing `MessageActionStorage` class
2. Verify storage operations work with Socket Mode payloads
3. No changes needed if payload structure matches

### Phase 4: Integration
1. Initialize Socket Mode client in SlackService
2. Connect client when service starts
3. Wire up event handler to storage
4. Add logging and error handling

### Phase 5: Testing
1. Unit tests for Socket Mode client
2. Unit tests for WebSocket message parsing
3. Integration test with mock WebSocket
4. Manual end-to-end test with Slack

### Phase 6: Cleanup
1. Remove HTTP endpoint from oauth-server.ts
2. Remove slack-signature.ts (not needed)
3. Update documentation

---

## Test Plan

### Unit Tests

**Socket Mode Client**:
- [ ] Obtains WebSocket URL from apps.connections.open
- [ ] Establishes WebSocket connection
- [ ] Handles "hello" message correctly
- [ ] Parses envelope messages correctly
- [ ] Extracts payload from envelope
- [ ] Sends acknowledgement with envelope_id
- [ ] Handles connection close gracefully
- [ ] Reconnects automatically after disconnect
- [ ] Handles API errors gracefully

**Event Processing**:
- [ ] Identifies message_action type
- [ ] Ignores non-message_action events
- [ ] Acknowledges within timeout
- [ ] Passes payload to storage handler

**Storage Operations** (existing tests remain valid):
- [ ] New action stored with UUID
- [ ] receivedAt timestamp recorded
- [ ] processed defaults to false
- [ ] List returns all actions
- [ ] List filter by processed works
- [ ] Get by ID returns correct action
- [ ] Get with invalid ID returns error
- [ ] Delete removes action
- [ ] Delete with invalid ID returns error
- [ ] Empty storage handled gracefully
- [ ] Directory created if not exists

**MCP Tools** (existing tests remain valid):
- [ ] list-message-actions returns summaries
- [ ] list-message-actions filter works
- [ ] get-message-action returns full payload
- [ ] delete-message-action removes item
- [ ] Tool names prefixed with slack.
- [ ] Required parameters enforced

### Integration Tests (Manual)

- [ ] Configure Slack app with Socket Mode enabled
- [ ] Generate App Level Token
- [ ] Start application and verify WebSocket connects
- [ ] Trigger message shortcut from Slack
- [ ] Verify payload received and stored
- [ ] List actions via MCP tool
- [ ] Get action details via MCP tool
- [ ] Delete action via MCP tool
- [ ] Verify reconnection after connection drop

---

## Security Considerations

### Authentication
- App Level Token used only for establishing connection
- No signature verification needed (WebSocket is pre-authenticated)
- Token stored in environment variable, never committed

### Data Privacy
- Message content stored locally in `.tasks/` directory
- Storage file should be gitignored
- No sensitive data logged (only metadata)
- Actions can be deleted after processing

### Access Control
- Only authenticated WebSocket receives events
- MCP tools require authenticated session
- No external API exposure of stored data

### Connection Security
- WebSocket uses TLS (wss://)
- Token transmitted only in initial HTTP request
- Connection URL is dynamic and short-lived

---

## Dependencies

### Internal Dependencies
- Feature 006 (Slack Integration) - **COMPLETED** - SlackService class

### External Dependencies
- Slack app with Socket Mode enabled
- App Level Token with `connections:write` scope
- Environment variable: `SLACK_APP_TOKEN`
- Message shortcut configured in Slack app

### Slack App Configuration
The Slack app needs:
1. **Socket Mode** enabled under Settings
2. **App Level Token** generated with `connections:write` scope
3. **Interactivity & Shortcuts** enabled
4. **Message Shortcut** created with a callback_id
5. **Bot Token Scopes**: `commands` (for shortcuts)

---

## Success Metrics

### Development Metrics
- [ ] Socket Mode client connecting successfully
- [ ] WebSocket receiving events
- [ ] Storage layer complete
- [ ] 3 MCP tools implemented
- [ ] Unit test coverage >= 80%
- [ ] Zero ESLint/TypeScript errors

### Functional Metrics
- [ ] Slack shortcut triggers event successfully
- [ ] Payloads stored correctly
- [ ] MCP tools accessible via Claude
- [ ] End-to-end triage workflow functional

---

## Future Enhancements (Out of Scope)

- Mark action as processed (without deleting)
- Bulk operations (delete multiple, mark multiple processed)
- Action categories or tags
- Response back to Slack (open modal, post message via response_url)
- Support for other interaction types (block_actions, view_submission)
- Database storage instead of file-based
- Action expiration/auto-cleanup
- Multiple concurrent WebSocket connections

---

## References

- [Slack Socket Mode Documentation](https://docs.slack.dev/apis/events-api/using-socket-mode)
- [apps.connections.open API](https://docs.slack.dev/reference/methods/apps.connections.open)
- [Implementing Shortcuts](https://docs.slack.dev/interactivity/implementing-shortcuts)
- [Shortcuts Interaction Payload](https://docs.slack.dev/reference/interaction-payloads/shortcuts-interaction-payload)
- [Slack Bolt for JavaScript](https://slack.dev/bolt-js/concepts#socket-mode)
