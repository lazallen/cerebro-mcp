# MCP Tools Contract: Message Action Tools

## Overview

Three MCP tools for managing stored Slack message actions.

---

## Tool: slack.list-message-actions

### Description

Lists all stored message actions with optional filtering by processed status.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "processed": {
      "type": "boolean",
      "description": "Filter by processed status. Omit to return all."
    }
  },
  "required": []
}
```

### Output

```json
{
  "actions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "receivedAt": "2026-01-22T10:30:00.000Z",
      "processed": false,
      "channelName": "general",
      "userName": "John Doe",
      "messagePreview": "Important message content here..."
    }
  ],
  "total": 1
}
```

### Test Cases

| ID | Input | Expected Output |
|----|-------|-----------------|
| LIST-001 | `{}` | All actions returned |
| LIST-002 | `{ "processed": false }` | Only unprocessed actions |
| LIST-003 | `{ "processed": true }` | Only processed actions |
| LIST-004 | (empty storage) | `{ "actions": [], "total": 0 }` |

---

## Tool: slack.get-message-action

### Description

Retrieves full details of a specific stored action by ID.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "The action ID (UUID)"
    }
  },
  "required": ["id"]
}
```

### Output (Success)

```json
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
    "message": {
      "type": "message",
      "user": "U9876543",
      "ts": "1737542900.000001",
      "text": "Important message content here"
    },
    "callback_id": "triage_message",
    "trigger_id": "123456.789012.abcdef",
    "response_url": "https://hooks.slack.com/app/..."
  }
}
```

### Output (Not Found)

```json
{
  "error": "not_found",
  "message": "Action with ID '...' not found"
}
```

### Test Cases

| ID | Input | Expected Output |
|----|-------|-----------------|
| GET-001 | `{ "id": "valid-uuid" }` | Full action with payload |
| GET-002 | `{ "id": "invalid-uuid" }` | Error: not_found |
| GET-003 | `{}` (missing id) | Validation error |

---

## Tool: slack.delete-message-action

### Description

Removes a stored action by ID.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "The action ID (UUID) to delete"
    }
  },
  "required": ["id"]
}
```

### Output (Success)

```json
{
  "success": true,
  "deletedId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Output (Not Found)

```json
{
  "error": "not_found",
  "message": "Action with ID '...' not found"
}
```

### Test Cases

| ID | Input | Expected Output |
|----|-------|-----------------|
| DEL-001 | `{ "id": "valid-uuid" }` | Success, action removed |
| DEL-002 | `{ "id": "invalid-uuid" }` | Error: not_found |
| DEL-003 | `{}` (missing id) | Validation error |
| DEL-004 | Delete same ID twice | Second call returns not_found |

---

## Error Handling

All tools use consistent error format:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

Error codes:
- `not_found` - Action ID does not exist
- `storage_error` - File system error
- `validation_error` - Invalid input parameters

---

## Tool Registration

Tools are registered in `SlackService.getTools()` with namespace prefix:

```typescript
{
  name: 'slack.list-message-actions',
  description: 'List stored Slack message actions for triage',
  inputSchema: { ... }
}
```
