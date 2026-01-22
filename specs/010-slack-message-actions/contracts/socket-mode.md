# Socket Mode Connection Contract

## Overview

WebSocket-based connection for receiving Slack interactive payloads via Socket Mode.

---

## Connection Flow

### Step 1: Obtain WebSocket URL

**Endpoint**: `POST https://slack.com/api/apps.connections.open`

**Headers**:
| Header | Required | Value |
|--------|----------|-------|
| Authorization | Yes | `Bearer xapp-1-A0123456789-...` (App Level Token) |
| Content-Type | Yes | `application/x-www-form-urlencoded` |

**Response (Success)**:
```json
{
  "ok": true,
  "url": "wss://wss.slack.com/link/?ticket=abc123&app_id=A0123456789"
}
```

**Response (Error)**:
```json
{
  "ok": false,
  "error": "invalid_auth"
}
```

### Step 2: Establish WebSocket Connection

Connect to the URL returned from Step 1 using a WebSocket client.

```typescript
const ws = new WebSocket(url);
```

### Step 3: Receive Hello Message

On successful connection, Slack sends a hello message:

```json
{
  "type": "hello",
  "connection_info": {
    "app_id": "A0123456789"
  },
  "approximate_connection_time": 3600
}
```

The `approximate_connection_time` indicates how long (in seconds) the connection will remain active before Slack closes it.

---

## Message Format

### Envelope Structure

All events are wrapped in an envelope:

```json
{
  "envelope_id": "unique-envelope-id-123",
  "type": "interactive",
  "accepts_response_payload": false,
  "payload": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| envelope_id | string | Unique identifier for acknowledgement |
| type | string | Event type: "interactive", "events_api", "slash_commands" |
| accepts_response_payload | boolean | Whether response payload is accepted |
| payload | object | The actual event payload |

### Message Action Payload

When a user triggers a message shortcut:

```json
{
  "envelope_id": "abc123-def456",
  "type": "interactive",
  "accepts_response_payload": false,
  "payload": {
    "type": "message_action",
    "callback_id": "triage_message",
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
      "ts": "1737542900.000001",
      "text": "The actual message content"
    },
    "response_url": "https://hooks.slack.com/app/..."
  }
}
```

---

## Acknowledgement

**CRITICAL**: All events MUST be acknowledged within 3 seconds.

### Acknowledgement Format

Send back the envelope_id:

```json
{
  "envelope_id": "abc123-def456"
}
```

### Failure to Acknowledge

If not acknowledged within 3 seconds:
- Slack may retry the event
- Connection may be marked as unhealthy
- Events may be dropped

---

## Connection Lifecycle

### Disconnect Message

Slack sends a disconnect message before closing:

```json
{
  "type": "disconnect",
  "reason": "warning",
  "debug_info": {
    "host": "wss-primary.slack.com"
  }
}
```

### Reconnection Strategy

1. On WebSocket close, wait before reconnecting (exponential backoff)
2. Call `apps.connections.open` to get a new WebSocket URL
3. Establish new connection
4. Events may be replayed during reconnection

### Recommended Backoff

```
Attempt 1: 1 second
Attempt 2: 2 seconds
Attempt 3: 4 seconds
Attempt 4: 8 seconds
Attempt 5+: 30 seconds (max)
```

---

## Test Cases

### TC-001: Successful Connection

**Given**: Valid App Level Token
**When**: Call apps.connections.open and connect to WebSocket
**Then**: Receive hello message with connection_info

### TC-002: Invalid Token

**Given**: Invalid or expired App Level Token
**When**: Call apps.connections.open
**Then**: Response contains `ok: false, error: "invalid_auth"`

### TC-003: Message Action Received

**Given**: Connected WebSocket
**When**: User triggers message shortcut in Slack
**Then**: Receive envelope with type "interactive" and payload.type "message_action"

### TC-004: Acknowledgement Sent

**Given**: Received message action envelope
**When**: Send acknowledgement with envelope_id
**Then**: Slack accepts acknowledgement, no retry

### TC-005: Connection Close Handling

**Given**: Active WebSocket connection
**When**: Connection closes (timeout or disconnect message)
**Then**: Client reconnects with new URL from apps.connections.open

### TC-006: Reconnection Backoff

**Given**: Connection attempt fails
**When**: Retry connection
**Then**: Wait increases exponentially up to 30 seconds

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| SLACK_APP_TOKEN | App Level Token for Socket Mode | `xapp-1-A0123456789-1234567890123-abc...` |

---

## Security Notes

- **No signature verification required**: Socket Mode connections are pre-authenticated
- App Level Token should be kept secret (environment variable, not committed)
- WebSocket URL is dynamic and short-lived
- Connection uses TLS (wss://)
