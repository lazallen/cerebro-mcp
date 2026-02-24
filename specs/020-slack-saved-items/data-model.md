# Data Model: Slack Save for Later Integration

**Feature**: 020-slack-saved-items | **Date**: 2026-02-20

---

## Entities

### 1. `SessionCredentials`

The Slack browser session values required to call the Webclient APIs. Stored at `.tokens/slack-session-credentials.json`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `xoxcToken` | `string` | Yes | Browser localStorage token (prefix `xoxc-`) |
| `xoxdCookie` | `string` | Yes | Browser `d` cookie value (prefix `xoxd-`) |
| `savedAt` | `number` | Yes | Unix timestamp (ms) when credentials were last saved via the dashboard |
| `workspaceUrl` | `string` | No | Cached workspace base URL (e.g. `https://myworkspace.slack.com`), populated on first successful `auth.test` call |

**Derived/computed:**
- `estimatedExpiresAt = savedAt + 12 * 60 * 60 * 1000` (12-hour conservative estimate)
- `isExpired = estimatedExpiresAt < Date.now()`
- `isExpiringSoon = estimatedExpiresAt - Date.now() < 2 * 60 * 60 * 1000` (< 2 hours remaining)

**Validation rules:**
- `xoxcToken` must start with `"xoxc-"`
- `xoxdCookie` must start with `"xoxd-"` or be a non-empty string
- `savedAt` must be a positive integer ≤ `Date.now()`

---

### 2. `SavedItem`

A message the user has bookmarked via Slack's native "Save for Later" feature. Returned by `list-saved-items`.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `itemId` | `string` | API `item_id` | Channel or DM identifier |
| `itemType` | `string` | API `item_type` | Always `"message"` in current Slack implementation |
| `ts` | `string` | API `ts` | Message timestamp in Slack format (`seconds.microseconds`) |
| `state` | `SavedItemState` | API `state` | Current state: `uncompleted`, `completed`, or `archived` |
| `dateCreated` | `number` | API `date_created` | Unix timestamp (seconds) when item was saved |
| `dateDue` | `number` | API `date_due` | Unix timestamp (seconds) for due date; `0` if none |
| `dateCompleted` | `number` | API `date_completed` | Unix timestamp (seconds) when completed; `0` if not completed |
| `dateUpdated` | `number` | API `date_updated` | Unix timestamp (seconds) of last state change |
| `dateSnoozedUntil` | `number` | API `date_snoozed_until` | Unix timestamp (seconds) for snooze expiry; `0` if not snoozed |
| `isArchived` | `boolean` | API `is_archived` | Whether the item has been archived |
| `messageText` | `string` | `conversations.history` | Full message text; empty string if fetch fails |
| `userId` | `string` | `conversations.history` | Raw Slack user ID of message author; empty string if unavailable |

**State transitions:**
```
uncompleted → completed   (via mark-saved-item-complete)
uncompleted → archived    (via Slack UI — read-only from cerebro-mcp)
archived    → uncompleted (via Slack UI — read-only from cerebro-mcp)
```

---

### 3. `SavedItemCounts`

Summary counts returned alongside the item list.

| Field | Type | API field | Description |
|-------|------|-----------|-------------|
| `uncompletedCount` | `number` | `uncompleted_count` | Items still requiring action |
| `uncompletedOverdueCount` | `number` | `uncompleted_overdue_count` | Uncompleted items past their due date |
| `archivedCount` | `number` | `archived_count` | Archived items |
| `completedCount` | `number` | `completed_count` | Completed items |
| `totalCount` | `number` | `total_count` | All items across all states |

---

### 4. `CredentialStatus`

Dashboard display model — not persisted, computed on demand.

| State | Condition | Visual treatment |
|-------|-----------|-----------------|
| `configured` | Credentials exist and `!isExpired && !isExpiringSoon` | Green indicator |
| `expiring_soon` | Credentials exist and `isExpiringSoon && !isExpired` | Amber indicator + call-to-action |
| `expired` | Credentials exist and `isExpired` | Red indicator + call-to-action |
| `not_configured` | No credentials file or file empty | Grey indicator + setup prompt |

---

## Storage

### File: `.tokens/slack-session-credentials.json`

```json
{
  "xoxcToken": "xoxc-1234567890-0987654321-abcdef1234567890",
  "xoxdCookie": "xoxd-abcdef1234567890ghijklmnopqrstuvwxyz",
  "savedAt": 1740000000000,
  "workspaceUrl": "https://myworkspace.slack.com"
}
```

- File permissions: `0o600` (owner read/write only)
- Written atomically (temp file → rename) to prevent corruption
- Gitignored via existing `.gitignore` entry covering `.tokens/`

---

## API Response Mapping

### `saved.list` → `SavedItem[]`

```
API field           → TypeScript field
─────────────────────────────────────
item_id             → itemId
item_type           → itemType
ts                  → ts
state               → state
date_created        → dateCreated
date_due            → dateDue
date_completed      → dateCompleted
date_updated        → dateUpdated
date_snoozed_until  → dateSnoozedUntil
is_archived         → isArchived
(enriched)          → messageText  (from conversations.history)
(enriched)          → userId       (from conversations.history)
```

### Counts mapping

```
API field                   → TypeScript field
───────────────────────────────────────────────
uncompleted_count           → uncompletedCount
uncompleted_overdue_count   → uncompletedOverdueCount
archived_count              → archivedCount
completed_count             → completedCount
total_count                 → totalCount
```
