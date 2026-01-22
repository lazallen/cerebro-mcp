# Data Model: Slack Message Actions

## Overview

Data model for storing and managing Slack message action payloads captured via webhook.

---

## Entities

### StoredMessageAction

The primary entity representing a captured Slack message shortcut action.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID) | Yes | Unique identifier for internal reference |
| receivedAt | string (ISO 8601) | Yes | Timestamp when action was received |
| processed | boolean | Yes | Flag indicating triage status (default: false) |
| payload | SlackMessageActionPayload | Yes | Complete Slack payload |

**Validation Rules**:
- `id` must be valid UUID v4
- `receivedAt` must be valid ISO 8601 timestamp
- `processed` defaults to `false` on creation

---

### SlackMessageActionPayload

The payload structure as sent by Slack for message shortcuts.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | 'message_action' | Yes | Action type identifier |
| action_ts | string | Yes | Timestamp of the action |
| team | Team | Yes | Workspace information |
| user | User | Yes | User who triggered the action |
| channel | Channel | Yes | Channel where message exists |
| message | Message | Yes | The actioned message |
| callback_id | string | Yes | Shortcut callback identifier |
| trigger_id | string | Yes | Trigger ID for follow-up modals |
| response_url | string | Yes | URL for delayed responses |
| token | string | No | Deprecated verification token |

---

### Team (nested)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Slack team/workspace ID (T-prefixed) |
| domain | string | Yes | Workspace domain name |

---

### User (nested)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Slack user ID (U-prefixed) |
| username | string | Yes | User's handle (without @) |
| name | string | Yes | User's display name |
| team_id | string | Yes | Team ID reference |

---

### Channel (nested)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Slack channel ID (C-prefixed) |
| name | string | Yes | Channel name (without #) |

---

### Message (nested)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | Yes | Message type (usually 'message') |
| user | string | Yes | Author's user ID |
| ts | string | Yes | Message timestamp (Slack format) |
| text | string | Yes | Message content |
| blocks | Block[] | No | Rich text blocks (if present) |
| attachments | Attachment[] | No | Legacy attachments (if present) |
| thread_ts | string | No | Parent thread timestamp (if in thread) |

---

## TypeScript Interfaces

```typescript
// src/types/slack-message-action.ts

export interface StoredMessageAction {
  id: string;
  receivedAt: string;
  processed: boolean;
  payload: SlackMessageActionPayload;
}

export interface SlackMessageActionPayload {
  type: 'message_action';
  action_ts: string;
  team: {
    id: string;
    domain: string;
  };
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  channel: {
    id: string;
    name: string;
  };
  message: SlackMessage;
  callback_id: string;
  trigger_id: string;
  response_url: string;
  token?: string;
}

export interface SlackMessage {
  type: string;
  user: string;
  ts: string;
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
  thread_ts?: string;
}

// Summary view for list operations
export interface MessageActionSummary {
  id: string;
  receivedAt: string;
  processed: boolean;
  channelName: string;
  userName: string;
  messagePreview: string;  // First 100 chars of message text
}
```

---

## Storage Schema

### File: `.tasks/slack-actions.json`

```json
{
  "version": 1,
  "actions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "receivedAt": "2026-01-22T10:30:00.000Z",
      "processed": false,
      "payload": {
        "type": "message_action",
        "action_ts": "1737543000.123456",
        "team": { "id": "T0123456", "domain": "myworkspace" },
        "user": { "id": "U0123456", "username": "jdoe", "name": "John Doe", "team_id": "T0123456" },
        "channel": { "id": "C0123456", "name": "general" },
        "message": { "type": "message", "user": "U9876543", "ts": "1737542900.000001", "text": "Important message here" },
        "callback_id": "triage_message",
        "trigger_id": "123456.789012.abcdef",
        "response_url": "https://hooks.slack.com/app/..."
      }
    }
  ]
}
```

**Schema Versioning**: `version` field allows future migrations.

---

## Relationships

```
StoredMessageAction
    └── payload: SlackMessageActionPayload
            ├── team: Team
            ├── user: User (who triggered)
            ├── channel: Channel
            └── message: Message
                    └── user: string (message author ID)
```

---

## State Transitions

```
                  ┌─────────┐
    Webhook ───►  │ stored  │  (processed = false)
                  └────┬────┘
                       │
                 List via MCP
                       │
                       ▼
                  ┌─────────┐
   Get details ─► │ viewed  │  (still processed = false)
                  └────┬────┘
                       │
              Delete via MCP
                       │
                       ▼
                  ┌─────────┐
                  │ deleted │  (removed from storage)
                  └─────────┘
```

Note: The `processed` flag is available for future "mark as processed" feature but is not actively used in v1.
