# Quickstart: Slack Save for Later

This guide shows how to set up and use cerebro-mcp's Slack saved-items integration.

## What this does

cerebro-mcp can now read and manage messages you've saved in Slack using the native "Save for Later" bookmark button. Two MCP tools are available:

- **`list-saved-items`** — retrieves your full saved-items list including message text
- **`mark-saved-item-complete`** — marks a saved item as done in Slack

> **Note**: This integration uses Slack browser session credentials, not the standard OAuth flow. Credentials expire every ~12 hours and must be refreshed via the auth dashboard.

---

## Step 1: Start the auth dashboard

```bash
npm start
# Auth dashboard available at http://localhost:3333
```

---

## Step 2: Extract your Slack session credentials

You need two values from your browser's Slack session. Credentials expire roughly every 12 hours, so you'll repeat this step regularly.

1. Open Slack in **Chrome or Edge** and ensure you're logged in
2. Press **F12** to open DevTools
3. **Get your xoxc token:**
   - Click the **Application** tab
   - Under *Storage* → **Local Storage** → `https://{yourworkspace}.slack.com`
   - Find the key `localConfig_v2`
   - Click its value, then search for `"token"` in the displayed JSON
   - Copy the value that starts with `xoxc-`
4. **Get your xoxd cookie:**
   - Still in DevTools → **Application** tab
   - Under *Storage* → **Cookies** → `https://{yourworkspace}.slack.com`
   - Find the cookie named `d`
   - Copy its value (starts with `xoxd-`)

---

## Step 3: Save credentials via the dashboard

1. Visit `http://localhost:3333`
2. Find the **Slack Saved Items** section
3. Click **Manage Credentials**
4. Paste your xoxc token and xoxd cookie into the form
5. Click **Save** — you should see a green confirmation message

The dashboard shows:
- ✅ **Configured** — credentials are valid and have >2 hours remaining
- ⚠️ **Expiring soon** — credentials have ≤2 hours remaining; refresh now
- ❌ **Expired** — credentials have expired; re-extract and save new values
- ○ **Not configured** — no credentials stored yet

---

## Step 4: Use the tools

### List saved items

```
mcp__cerebro__slack_list-saved-items()
```

Returns all saved items including message text:

```json
{
  "items": [
    {
      "itemId": "C1234567890",
      "ts": "1740000000.123456",
      "state": "uncompleted",
      "messageText": "Can you review the Q1 report by Friday?",
      "userId": "U09876ABCD",
      "dateCreated": 1740000000,
      "dateSnoozedUntil": 0,
      "isArchived": false
    }
  ],
  "counts": {
    "uncompletedCount": 3,
    "completedCount": 12,
    "totalCount": 15
  }
}
```

**Paginating through results:**

```
mcp__cerebro__slack_list-saved-items({ cursor: "dXNlcjpVMDYxNTg..." })
```

When `nextCursor` is present in the response, pass it as `cursor` in the next call. When absent, you've reached the last page.

> **Tip**: `list-saved-items` returns items in **all states** (active, snoozed, completed, archived). In the triage workflow, filter to `state === "uncompleted"` to show only items needing action.

### Mark an item complete

Use the `itemId` (as `channel`) and `ts` from the list response:

```
mcp__cerebro__slack_mark-saved-item-complete({
  channel: "C1234567890",
  ts: "1740000000.123456"
})
```

The item is marked complete in Slack immediately.

---

## Refreshing credentials

When you see an error like:

```
Session credentials have expired. Visit http://localhost:3333 to refresh.
```

Go back to Step 2 to extract fresh credentials and Step 3 to save them. The dashboard highlights the **Expiring soon** or **Expired** status in amber/red to prompt you before tools start failing.

---

## Credential security

Session credentials are stored at `.tokens/slack-session-credentials.json` with `0o600` file permissions (owner read/write only). They are gitignored and never logged. The xoxc/xoxd values are equivalent to a full Slack browser session — treat them like passwords.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `credentials_not_configured` | No credentials saved yet | Follow Steps 2–3 |
| `credentials_expired` | Credentials older than ~12h | Re-extract and save new values |
| `credentials_invalid` | Wrong workspace or token | Verify you copied the correct values |
| `rate_limited` | Too many requests | Wait 30–60 seconds and try again |
| No message text | Message deleted or access revoked | Expected; `messageText` will be empty string |
