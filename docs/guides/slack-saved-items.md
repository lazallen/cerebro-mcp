# Slack Saved Items — Setup & Usage Guide

Cerebro can read and manage messages you've saved in Slack using the native **Save for Later** bookmark button. This guide covers credential setup, the MCP tools, and the optional heartbeat ingestion task that automatically feeds saved items into the triage pipeline.

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Step 1: Extract Your Session Credentials](#step-1-extract-your-session-credentials)
  - [Option A: Automatic extraction script (recommended)](#option-a-automatic-extraction-script-recommended)
  - [Option B: Manual extraction via DevTools](#option-b-manual-extraction-via-devtools)
- [Step 2: Save Credentials via the Dashboard](#step-2-save-credentials-via-the-dashboard)
- [Step 3: Use the MCP Tools](#step-3-use-the-mcp-tools)
- [Step 4 (Optional): Enable Heartbeat Ingestion](#step-4-optional-enable-heartbeat-ingestion)
- [Refreshing Credentials](#refreshing-credentials)
- [Credential Security](#credential-security)
- [Troubleshooting](#troubleshooting)

---

## How It Works

Unlike the regular Slack integration (which uses OAuth), Slack Saved Items uses **browser session credentials** — a token/cookie pair extracted from your active Slack web session.

```
Browser session  →  xoxc token + xoxd cookie
                        ↓
               .tokens/slack-session-credentials.json
                        ↓
         WebclientApiClient  →  Slack Webclient API
                        ↓
   list-saved-items / mark-saved-item-complete (MCP tools)
                        ↓ (optional heartbeat)
        TriageEvent files  →  Policy pipeline
```

**Why session credentials?** Slack's public API does not expose the Save for Later list. The Webclient API (used by the Slack web app itself) does. Session credentials give access to this endpoint.

**Lifetime**: Credentials expire after roughly 12 hours. You must re-extract them from your browser and save them via the dashboard.

---

## Prerequisites

- Cerebro MCP server running (`npm start`)
- Slack open and logged in via **Chrome or Edge** (the credential extraction uses DevTools)
- No additional environment variables required

---

## Step 1: Extract Your Session Credentials

You need two values from your active Slack browser session: the `xoxc` token (from localStorage) and the `xoxd` cookie.

> **Why can't this be automated fully?** The `xoxd` cookie is `HttpOnly`, meaning normal JavaScript (bookmarklets, page scripts) cannot read it. The only way to extract it programmatically is via the **Chrome DevTools Protocol (CDP)**, which operates at the browser level rather than the page level.

### Option A: Automatic extraction script (recommended)

The script at `scripts/extract-slack-credentials.js` connects to Chrome/Edge via CDP, extracts both values, and POSTs them to the auth server in one step.

**1. Start Chrome/Edge with remote debugging enabled**

You only need to do this once — set it as your default shortcut.

*Windows (Chrome):*
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

*Windows (Edge):*
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
```

*macOS (Chrome):*
```bash
open -a "Google Chrome" --args --remote-debugging-port=9222
```

> **WSL2 note**: The browser runs on Windows, so the CDP port is on Windows `localhost`. Run this script from a Windows terminal (where Node.js is installed on Windows), or see `--cdp-host` below.

**2. Open Slack in that browser** and make sure you're logged in.

**3. Run the script:**

```bash
# With Cerebro server already running (npm start)
npm run slack:extract-credentials

# Or directly
node scripts/extract-slack-credentials.js
```

**Output on success:**
```
Connecting to Chrome DevTools at localhost:9222...
Found Slack tab: https://app.slack.com/client/T0123456/...
Extracted credentials for app.slack.com:
  xoxc: xoxc-12345678-... (150 chars)
  xoxd: xoxd-e-abcdef... (180 chars)
Saving to http://localhost:3333/auth/slack-saved-items/credentials...
✅ Credentials saved! Estimated expiry: 2/21/2026, 1:39:06 AM
```

**Options:**
```bash
# Use a different CDP port
node scripts/extract-slack-credentials.js --port 9223

# Connect to Chrome on Windows from WSL2 (use Windows host IP)
node scripts/extract-slack-credentials.js --cdp-host 172.20.0.1

# Print credentials without saving (for inspection)
node scripts/extract-slack-credentials.js --dry-run

# Use a different auth server address
node scripts/extract-slack-credentials.js --auth-url http://localhost:3333
```

**Finding the Windows host IP in WSL2:**
```bash
cat /etc/resolv.conf | grep nameserver | awk '{print $2}'
# e.g. 172.20.0.1
```

---

### Option B: Manual extraction via DevTools

If you can't enable remote debugging, extract the values by hand.

### Get the xoxc token

1. Open [https://app.slack.com](https://app.slack.com) in Chrome or Edge and sign in to your workspace
2. Press **F12** to open DevTools
3. Click the **Application** tab
4. In the left sidebar, expand **Storage** → **Local Storage** → `https://{yourworkspace}.slack.com`
5. Click the row where the **Key** column shows `localConfig_v2`
6. The value is a large JSON blob — click into it and use **Ctrl+F** to search for `"token"`
7. Copy the value that starts with `xoxc-` (it will be several hundred characters long)

### Get the xoxd cookie

1. Still in DevTools → **Application** tab
2. In the left sidebar, expand **Storage** → **Cookies** → `https://{yourworkspace}.slack.com`
3. Find the cookie named exactly `d`
4. Copy its **Value** (starts with `xoxd-`)

> **Tip**: Both values are long strings. Copy the full value — truncating either will cause authentication failures.

---

## Step 2: Save Credentials via the Dashboard

> **Skip this step if you used Option A** — the script POSTs credentials to the server automatically.

1. Open the auth dashboard at **http://localhost:3333**
2. Find the **Slack Saved Items** section in the service list
3. Click **Manage Credentials** (or navigate directly to `http://localhost:3333/auth/slack-saved-items/credentials`)
4. Paste your `xoxc-...` token into the **xoxc Token** field
5. Paste your `xoxd-...` cookie into the **xoxd Cookie** field
6. Click **Save Credentials**

You should see a green confirmation. The status badge changes to:

| Badge | Meaning |
|-------|---------|
| ✅ **Configured** | Valid credentials, >2 hours remaining |
| ⚠️ **Expiring soon** | ≤2 hours remaining — refresh now |
| ❌ **Expired** | Credentials have expired — re-extract |
| ○ **Not configured** | No credentials stored yet |

---

## Step 3: Use the MCP Tools

Two MCP tools are available once credentials are configured.

### `list-saved-items`

Returns your uncompleted saved items including the full message text.

**Input:**
```json
{}
```

Or with pagination:
```json
{ "cursor": "dXNlcjpVMDYxNTg..." }
```

**Output:**
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
    "archivedCount": 0,
    "totalCount": 15
  },
  "nextCursor": "dXNlcjpVMDYxNTg..."
}
```

When `nextCursor` is present, pass it as `cursor` in the next call to page through results.

### `mark-saved-item-complete`

Marks a saved item as complete in Slack. Use the `itemId` (as `channel`) and `ts` from the list response.

**Input:**
```json
{
  "channel": "C1234567890",
  "ts": "1740000000.123456"
}
```

**Output:**
```json
{
  "success": true,
  "channel": "C1234567890",
  "ts": "1740000000.123456"
}
```

### Example: Triage your Slack queue

A typical triage session in Claude Code:

```
> List my Slack saved items
→ uses list-saved-items, shows 5 items with message text

> Mark the Q1 report item as done
→ uses mark-saved-item-complete with the itemId and ts from the list
```

---

## Step 4 (Optional): Enable Heartbeat Ingestion

The `slack-saved-items-ingestion` heartbeat task automatically pulls your saved items into the triage pipeline on a schedule, so they appear alongside emails and calendar events for policy evaluation.

### Add the task to `heartbeat-config.json`

```json
{
  "id": "slack-saved-items-15min",
  "name": "Slack Saved Items Ingestion",
  "type": "slack-saved-items-ingestion",
  "schedule": "*/15 * * * *",
  "enabled": true,
  "config": {
    "markAsComplete": true
  }
}
```

**Config options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `markAsComplete` | boolean | `false` | Mark each item as complete in Slack after ingesting it. Set `true` to clear your queue automatically. |

### How the task runs

1. **Fetch** — calls `saved.list` and paginates through all uncompleted items
2. **Ingest** — writes a `TriageEvent` markdown file to `{rootDir}/system/triage/` for each item
3. **Complete** (if `markAsComplete: true`) — calls `saved.update` to mark the item done in Slack

TriageEvent files are named `YYYYMMDD-slack-{ts}.md` and use `source: slack-saved`. They are picked up by the policy pipeline on its next cycle.

### What a TriageEvent looks like

```yaml
---
eventId: 20260220-slack-1740000000-123456
source: slack-saved
status: pending
title: Can you review the Q1 report by Friday?
author: U09876ABCD
receivedAt: 2025-02-20T00:00:00.000Z
snippet: Can you review the Q1 report by Friday?
signals:
  asksForAction: true
  mentionsMoney: false
  mentionsMeeting: false
  isAutomated: false
  isBulk: false
sourceData:
  itemId: C1234567890
  ts: "1740000000.123456"
  state: uncompleted
  dateCreated: 1740000000
  dateSnoozedUntil: 0
  isArchived: false
---
```

### Idempotency

Re-running the task with the same saved item produces no duplicate event file — the file is overwritten in place using the same `eventId`. This means you can safely lower the schedule interval without risk of duplicate triage events.

---

## Refreshing Credentials

Session credentials expire after roughly 12 hours. When they expire:

- MCP tools return a `credentials_expired` error with a link to the dashboard
- The heartbeat task logs a warning and skips ingestion until credentials are refreshed

**To refresh:**

If using the automatic script:
```bash
npm run slack:extract-credentials
```
Just make sure Slack is still open in Chrome/Edge with remote debugging enabled. The script handles everything.

If refreshing manually:
1. Go back to [Option B](#option-b-manual-extraction-via-devtools) to extract fresh values
2. Paste them at the dashboard ([http://localhost:3333/auth/slack-saved-items/credentials](http://localhost:3333/auth/slack-saved-items/credentials))

The dashboard shows an **Expiring soon** warning (amber) when less than 2 hours remain, giving you time to refresh before tools start failing.

---

## Credential Security

Credentials are stored at `.tokens/slack-session-credentials.json` with `0600` file permissions (owner read/write only). They are:

- **Gitignored** — never committed to version control
- **Never logged** — the server logs do not include token or cookie values
- **Equivalent to a full Slack browser session** — treat the xoxc and xoxd values like passwords

---

## Troubleshooting

| Error code | Cause | Fix |
|------------|-------|-----|
| `credentials_not_configured` | No credentials saved yet | Follow Steps 1–2 |
| `credentials_expired` | Credentials older than ~12 hours | Re-extract and save new values |
| `credentials_invalid` | Wrong workspace URL, token, or cookie | Verify you copied the full value from the correct workspace |
| `rate_limited` | Too many API requests | Wait 30–60 seconds and try again |
| `api_error` | Unexpected Slack API response | Check logs; try refreshing credentials |
| Empty `messageText` | Message was deleted or access revoked | Expected behaviour — the item still appears with an empty text field |

**Heartbeat task not running?**

```bash
# Check server logs for ingestion messages
./start-mcp.sh logs | grep "slack_saved_items"
```

Look for `slack_saved_items_ingestion_start` to confirm the task fired, and `slack_saved_items_ingestion_aborted` if credentials are missing.

**Credentials not persisting after restart?**

The credentials file is read from disk on each tool call — no restart required after saving new credentials. If tools still report `credentials_not_configured` immediately after saving, check that the file was written:

```bash
ls -la .tokens/slack-session-credentials.json
# Should show: -rw------- (0600 permissions)
```
