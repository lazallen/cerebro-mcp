# Implementation Plan: Slack Message Actions via Socket Mode

**Branch**: `010-slack-message-actions` | **Date**: 2026-01-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-slack-message-actions/spec.md`

## Summary

Add a Socket Mode client to receive Slack message shortcut (message_action) payloads via WebSocket connection. The client connects to Slack using `apps.connections.open`, receives events, acknowledges them, and stores payloads using the existing `MessageActionStorage` class. Three MCP tools (`list-message-actions`, `get-message-action`, `delete-message-action`) enable AI-assisted triage of flagged messages.

**Architecture Change**: Replaced HTTP webhook endpoint with Socket Mode WebSocket client. This eliminates the need for a publicly accessible endpoint and removes signature verification complexity.

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+
**Primary Dependencies**: @modelcontextprotocol/sdk, ws (WebSocket client), uuid
**Storage**: File-based JSON (`.tasks/slack-actions.json`)
**Testing**: Jest with TypeScript support
**Target Platform**: Linux/macOS server (local development)
**Project Type**: Single project (MCP server)
**Performance Goals**: Acknowledge events within 3 seconds (Slack requirement)
**Constraints**: Must handle WebSocket reconnection, ~3600s connection lifetime
**Scale/Scope**: Low volume (user-initiated message shortcuts)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is currently a template. Based on established project patterns:

| Principle | Status | Notes |
|-----------|--------|-------|
| TypeScript-First | PASS | All code uses strict TypeScript |
| Test-First Development | PASS | Tests required for all new code |
| Modular Service Architecture | PASS | Extends existing SlackService |
| OAuth & Security | PASS | Uses Slack App Level Token |
| Observability | PASS | Will use existing pino logging |

**No violations to track.**

## Project Structure

### Documentation (this feature)

```text
specs/010-slack-message-actions/
├── plan.md              # This file
├── spec.md              # Updated for Socket Mode
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── auth-server/
│   └── oauth-server.ts      # REMOVE /tasks/slack route (cleanup)
├── common/
│   └── slack-signature.ts   # REMOVE (not needed for Socket Mode)
├── services/
│   └── slack/
│       ├── slack-service.ts          # Add Socket Mode integration
│       ├── slack-socket-client.ts    # NEW: Socket Mode WebSocket client
│       ├── message-action-storage.ts # KEEP: File-based storage class
│       └── __tests__/
│           ├── slack-socket-client.test.ts    # NEW
│           └── message-action-storage.test.ts # KEEP
├── types/
│   └── slack-message-action.ts       # KEEP: MessageAction types
└── index.ts

.tasks/                      # Runtime storage directory
└── slack-actions.json       # Stored message actions
```

**Changes from HTTP approach**:
- REMOVE: `src/common/slack-signature.ts` (signature verification not needed)
- REMOVE: HTTP endpoint in `oauth-server.ts`
- ADD: `src/services/slack/slack-socket-client.ts` (Socket Mode client)
- KEEP: `message-action-storage.ts` (storage logic unchanged)
- KEEP: `slack-message-action.ts` (types unchanged)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No violations - table not needed.*

## Implementation Phases

### Phase 1: Socket Mode Client

Create the core WebSocket client that connects to Slack.

**Files**:
- `src/services/slack/slack-socket-client.ts` (NEW)
- `src/services/slack/__tests__/slack-socket-client.test.ts` (NEW)

**Tasks**:
1. Create `SlackSocketModeClient` class
2. Implement `connect()` method:
   - Call `apps.connections.open` with App Level Token
   - Parse response for WebSocket URL
   - Establish WebSocket connection
3. Handle WebSocket lifecycle:
   - `open` event: Log connection established
   - `message` event: Parse and process events
   - `close` event: Trigger reconnection
   - `error` event: Log and handle errors
4. Implement `disconnect()` method for graceful shutdown
5. Add automatic reconnection with exponential backoff

**Key Implementation Details**:
```typescript
class SlackSocketModeClient {
  private ws: WebSocket | null = null;
  private appToken: string;
  private reconnectAttempts = 0;
  private onMessageAction: (payload: SlackMessageActionPayload) => void;

  async connect(): Promise<void> {
    const url = await this.getWebSocketUrl();
    this.ws = new WebSocket(url);
    this.setupEventHandlers();
  }

  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    return data.url;
  }
}
```

### Phase 2: Event Processing

Handle incoming WebSocket messages and route them appropriately.

**Tasks**:
1. Parse incoming WebSocket messages as JSON
2. Handle `hello` message type (log connection info)
3. Handle `disconnect` message type (prepare for reconnection)
4. Handle `interactive` envelope type:
   - Extract `envelope_id` and `payload`
   - Check if `payload.type === 'message_action'`
   - Send acknowledgement immediately
   - Pass payload to handler
5. Ignore other event types gracefully

**Envelope Processing**:
```typescript
private handleMessage(data: string): void {
  const envelope = JSON.parse(data);

  if (envelope.type === 'hello') {
    logger.info({ operation: 'socket_connected', appId: envelope.connection_info.app_id });
    return;
  }

  if (envelope.type === 'disconnect') {
    logger.info({ operation: 'socket_disconnect_requested' });
    return;
  }

  // Acknowledge immediately
  this.acknowledge(envelope.envelope_id);

  // Process message actions
  if (envelope.payload?.type === 'message_action') {
    this.onMessageAction(envelope.payload);
  }
}

private acknowledge(envelopeId: string): void {
  this.ws?.send(JSON.stringify({ envelope_id: envelopeId }));
}
```

### Phase 3: Integration with SlackService

Wire up the Socket Mode client to the existing service infrastructure.

**Files**:
- `src/services/slack/slack-service.ts` (MODIFY)

**Tasks**:
1. Add `SlackSocketModeClient` as optional dependency
2. Initialize client if `SLACK_APP_TOKEN` is set
3. Pass `MessageActionStorage.add()` as the event handler
4. Connect client when service initializes
5. Disconnect client on service shutdown
6. Add logging for connection status

### Phase 4: Cleanup HTTP Endpoint

Remove the now-unused HTTP webhook infrastructure.

**Files**:
- `src/auth-server/oauth-server.ts` (MODIFY)
- `src/common/slack-signature.ts` (DELETE)
- `src/common/__tests__/slack-signature.test.ts` (DELETE)

**Tasks**:
1. Remove `/tasks/slack` route handler from oauth-server.ts
2. Remove `handleSlackMessageAction` method
3. Remove webhook endpoint logging from `logServerStarted`
4. Remove `verifySlackSignature` import
5. Delete `slack-signature.ts` and its test file
6. Remove `SLACK_SIGNING_SECRET` from .env.example

### Phase 5: Testing

**Unit Tests** (`slack-socket-client.test.ts`):
- Mock WebSocket and fetch
- Test `apps.connections.open` API call
- Test WebSocket connection establishment
- Test hello message handling
- Test envelope parsing
- Test acknowledgement sending
- Test message_action payload extraction
- Test reconnection logic
- Test error handling

**Integration Tests** (manual):
- Configure Slack app with Socket Mode
- Generate App Level Token
- Verify connection establishes
- Trigger message shortcut
- Verify payload stored
- Test MCP tools

### Phase 6: Documentation Updates

**Files**:
- `specs/010-slack-message-actions/contracts/webhook-endpoint.md` (DELETE or UPDATE)
- `specs/010-slack-message-actions/quickstart.md` (UPDATE)
- `README.md` (UPDATE if needed)
- `.env.example` (UPDATE)

**Tasks**:
1. Update quickstart with Socket Mode setup instructions
2. Document `SLACK_APP_TOKEN` environment variable
3. Remove references to HTTP endpoint
4. Update Slack app configuration steps

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_APP_TOKEN` | App Level Token (xapp-...) for Socket Mode | Yes (for this feature) |
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) for API calls | Existing |
| `SLACK_SIGNING_SECRET` | **REMOVED** - not needed for Socket Mode | No |

## Dependencies to Add

```json
{
  "dependencies": {
    "ws": "^8.x"
  },
  "devDependencies": {
    "@types/ws": "^8.x"
  }
}
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebSocket connection drops | High | Medium | Automatic reconnection with backoff |
| Connection URL expires | High | Low | Reconnect fetches new URL |
| Slack API changes | Low | High | Pin to known working behavior |
| Rate limiting on reconnect | Low | Medium | Exponential backoff |

## Success Criteria

- [ ] Socket Mode client connects successfully
- [ ] Hello message received and logged
- [ ] Message shortcuts received via WebSocket
- [ ] Acknowledgements sent within 3 seconds
- [ ] Payloads stored correctly
- [ ] Automatic reconnection works
- [ ] MCP tools function correctly
- [ ] HTTP endpoint removed
- [ ] All tests pass
- [ ] No ESLint/TypeScript errors
