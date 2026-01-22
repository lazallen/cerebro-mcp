# Quickstart: Slack Message Actions

## Overview

Guide for setting up and testing Slack message actions integration.

---

## Prerequisites

1. Slack workspace with admin access
2. Cerebro MCP server running locally
3. ngrok or similar for exposing localhost to Slack

---

## Setup Steps

### 1. Configure Environment

Add to `.env`:
```bash
SLACK_SIGNING_SECRET=your_signing_secret_here
```

### 2. Create Slack App (if not exists)

1. Go to https://api.slack.com/apps
2. Create new app or use existing Cerebro app
3. Note the **Signing Secret** from Basic Information

### 3. Configure Interactivity

1. Navigate to **Interactivity & Shortcuts**
2. Enable Interactivity
3. Set **Request URL**: `https://your-domain.ngrok.io/tasks/slack`

### 4. Create Message Shortcut

1. In **Interactivity & Shortcuts**, click **Create New Shortcut**
2. Select **On messages**
3. Configure:
   - Name: "Send to Claude" (or your preferred name)
   - Callback ID: `triage_message`
   - Description: "Flag this message for AI triage"
4. Save changes

### 5. Expose Local Server

```bash
# Start ngrok
ngrok http 3333

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Update Slack Request URL to: https://abc123.ngrok.io/tasks/slack
```

### 6. Start Server

```bash
npm run dev
```

---

## Testing Scenarios

### Scenario 1: Capture a Message

**Steps**:
1. Open Slack workspace
2. Find any message in a channel
3. Click the "..." menu (or right-click)
4. Select "More message shortcuts"
5. Click "Send to Claude" (your shortcut name)

**Expected**:
- Slack shows brief "Working..." then disappears
- Server logs show payload received
- Action stored in `.tasks/slack-actions.json`

### Scenario 2: List Captured Actions (MCP)

**Using Claude Code**:
```
Use the slack.list-message-actions tool to show captured messages
```

**Expected Output**:
```json
{
  "actions": [
    {
      "id": "...",
      "receivedAt": "2026-01-22T10:30:00.000Z",
      "processed": false,
      "channelName": "general",
      "userName": "John Doe",
      "messagePreview": "The message content..."
    }
  ],
  "total": 1
}
```

### Scenario 3: Get Action Details (MCP)

**Using Claude Code**:
```
Get details for action ID "550e8400-e29b-41d4-a716-446655440000"
```

**Expected**:
- Full payload including message content, user, channel, team

### Scenario 4: Delete After Triage (MCP)

**Using Claude Code**:
```
Delete the message action with ID "550e8400-e29b-41d4-a716-446655440000"
```

**Expected**:
- Action removed from storage
- Subsequent list shows reduced count

---

## Triage Workflow Example

```
User: Show me unprocessed Slack messages

Claude: [Uses slack.list-message-actions with processed=false]
        Found 3 unprocessed messages:
        1. #general - John: "Need review on PR #123"
        2. #dev - Sarah: "Production alert at 3pm"
        3. #random - Bob: "Team lunch Friday?"

User: Get details on the second one

Claude: [Uses slack.get-message-action]
        Full message from Sarah in #dev:
        "Production alert at 3pm - CPU spike on web-01"
        Received: 2026-01-22 10:30 AM

User: I've addressed this, remove it

Claude: [Uses slack.delete-message-action]
        Deleted action successfully.
```

---

## Troubleshooting

### "Invalid signature" errors

- Verify `SLACK_SIGNING_SECRET` matches Slack app
- Check system clock is accurate (timestamp validation)
- Ensure raw body is used for signature (not parsed)

### Shortcut not appearing

- Reinstall app to workspace after adding shortcut
- Check shortcut is saved and published
- Verify correct workspace selected

### Request timeout

- Endpoint must respond within 3 seconds
- Storage operations should be fast (file-based)
- Check for file system permissions on `.tasks/`

### Storage file not created

- Check `.tasks/` directory permissions
- Verify process has write access to project root
- Look for error logs on startup
