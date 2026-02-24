# Research: Slack Save for Later Integration

**Feature**: 020-slack-saved-items | **Date**: 2026-02-20

## 1. Undocumented Slack Webclient API

### Decision
Use Slack's undocumented `saved.list` and `saved.update` Webclient APIs, accessed via browser session credentials (xoxc + xoxd). This is the only programmatic path to Slack's native "Save for Later" feature.

### Rationale
No official Slack API exists for saved items. The `slack-mcp-server` Go project at `~/code/slack-mcp-server` already proves this approach works reliably in production.

### API Details (from slack-mcp-server source)

**Authentication mechanism:**
- xoxc token: sent as form field `token=xoxc-...`
- xoxd token: sent as HTTP Cookie header `d={xoxd_value}`
- User-Agent must mimic a real browser (Chrome on macOS)

**`saved.list` endpoint:**
```
POST https://{workspaceUrl}/api/saved.list
Content-Type: application/x-www-form-urlencoded
Cookie: d={xoxd}

token={xoxc}&cursor={cursor}&_x_reason=get_items&_x_mode=online&_x_sonic=true&_x_app_name=client
```

Response:
```json
{
  "ok": true,
  "saved_items": [
    {
      "item_id": "C1234567890",
      "item_type": "message",
      "date_created": 1740000000,
      "date_due": 0,
      "date_completed": 0,
      "date_updated": 1740000000,
      "is_archived": false,
      "date_snoozed_until": 0,
      "ts": "1740000000.123456",
      "state": "uncompleted"
    }
  ],
  "counts": {
    "uncompleted_count": 5,
    "uncompleted_overdue_count": 0,
    "archived_count": 0,
    "completed_count": 12,
    "total_count": 17
  },
  "response_metadata": {
    "next_cursor": ""
  }
}
```

States: `"uncompleted"`, `"completed"`, `"archived"`

**`saved.update` endpoint (mark complete):**
```
POST https://{workspaceUrl}/api/saved.update
Content-Type: application/x-www-form-urlencoded
Cookie: d={xoxd}

token={xoxc}&item_type=message&item_id={channelId}&ts={ts}&date_due=0&mark=completed&_x_reason=manually_mark_completed&_x_mode=online&_x_sonic=true&_x_app_name=client
```

Response: `{ "ok": true }`

**Undocumented `_x_*` fields** are required on every request (telemetry injected by Slack's web client):
- `_x_reason`: human-readable purpose string
- `_x_mode`: always `"online"`
- `_x_sonic`: always `true`
- `_x_app_name`: always `"client"`

### Alternatives Considered
- **Official Slack API**: No saved-items endpoints exist. Rejected.
- **Slack SDK**: The official `@slack/web-api` package doesn't support these endpoints. Rejected.

---

## 2. Workspace URL Resolution

### Decision
Call `auth.test` once at service initialization using the xoxc token, cache the `url` field on `SessionCredentials`, and use it for all subsequent Webclient API calls.

### API Call
```
POST https://slack.com/api/auth.test
Content-Type: application/x-www-form-urlencoded
Cookie: d={xoxd}

token={xoxc}
```

Response includes `url: "https://myworkspace.slack.com/"`. Strip trailing slash before use.

### Rationale
The workspace subdomain cannot be reliably inferred from the xoxc token format alone. `auth.test` is the canonical way Slack clients resolve workspace context. The result is stable (workspace URLs don't change) so caching is safe.

---

## 3. Message Text Retrieval

### Decision
Fetch message text inline during `list-saved-items` using `conversations.history`. Accept the latency cost (one extra API call per item) in exchange for complete item data as required by FR-001.

### API Call
```
GET https://slack.com/api/conversations.history
  ?channel={item_id}
  &latest={ts}
  &oldest={ts}
  &limit=1
  &inclusive=true
  &token={xoxc}
Cookie: d={xoxd}
```

Response: `{ "messages": [{ "text": "...", "user": "U1234567890", "ts": "..." }] }`

### Implementation Notes
- The xoxc browser session token has access to `conversations.history` just as it does the Webclient APIs. No separate OAuth token is required.
- If `conversations.history` fails for an item (deleted message, access revoked), return empty text and empty userName rather than failing the whole list call.
- User IDs from `messages[0].user` are not resolved to real names in this feature (no users API call to keep latency manageable). The raw user ID is returned.

### Alternatives Considered
- **Omit message text**: Simplest approach but contradicts FR-001 clarification (user explicitly chose full text).
- **Lazy fetch (on demand)**: Would require a third MCP tool or a separate `get-saved-item` call. Adds surface area. Rejected.
- **Resolve user names**: Would require `users.info` call per unique user. Not worth the latency for a triage tool. Deferred.

---

## 4. Rate Limiting

### Decision
Implement retry-once strategy: on HTTP 429, read `Retry-After` header (seconds), sleep, retry the original request once. If still 429, surface a clear error to the caller.

### Rationale
Matches the strategy proven in `slack-mcp-server`. Personal tool with low request volume makes a single retry sufficient. Exponential backoff would add complexity without benefit at this scale.

### Implementation
```
if (response.status === 429) {
  const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
  await sleep(retryAfter * 1000);
  // retry once
  if (retried.status === 429) throw RateLimitError
}
```

---

## 5. Credential Storage

### Decision
Custom `SessionCredentialStorage` class (not extending `BaseTokenStorage`). Stores `{ xoxcToken, xoxdCookie, savedAt, workspaceUrl? }` at `.tokens/slack-session-credentials.json` with 0o600 permissions.

### Rationale
`BaseTokenStorage` is designed around OAuth flows (exchange code, refresh token, expiry from provider response). Session credentials have a completely different lifecycle: user-initiated paste, fixed estimated expiry, no refresh API. Extending `BaseTokenStorage` would require implementing `exchangeCodeForTokens` and `refreshAccessToken` as no-ops, which is misleading. A purpose-built class is cleaner.

### Expiry Estimate
Observed behaviour from `slack-mcp-server` documentation and real-world use: xoxd cookies typically last 12–24 hours. The implementation uses `savedAt + 12h` as the expiry estimate (conservative) and `savedAt + 10h` as the warning threshold (2h window as specified in FR-010).

### Storage Format
```json
{
  "xoxcToken": "xoxc-1234567890-...",
  "xoxdCookie": "xoxd-abcdef...",
  "savedAt": 1740000000000,
  "workspaceUrl": "https://myworkspace.slack.com"
}
```

---

## 6. Service Architecture

### Decision
Create a standalone `SlackSavedItemsService` in `src/services/slack-saved-items/` that implements `BaseService` independently of `SlackService`.

### Rationale
FR-003 requires the feature to have no dependency on the OAuth-based integration. Placing the implementation inside `SlackService` would create tight coupling and make future removal of `SlackService` harder. A separate service directory enforces the boundary architecturally.

### Alternatives Considered
- **Extend or modify `SlackService`**: Easiest to implement but couples the two systems. Rejected.
- **Add methods to existing Slack files**: Violates single-responsibility; harder to remove with OAuth integration. Rejected.

---

## 7. Dashboard Integration

### Decision
Add a dedicated credential management section to the auth dashboard via two new routes on `OAuthServer`:
- `GET /auth/slack-saved-items/credentials` — serves the credential management page
- `POST /auth/slack-saved-items/credentials` — accepts form submission and saves credentials immediately (FR-011)

The credential management page contains:
1. Status indicator (configured / expiring-soon / expired / not_configured) with colour coding
2. Saved-at and estimated-expiry timestamps
3. Step-by-step extraction instructions (collapsed by default to reduce page length)
4. Paste fields for xoxc and xoxd
5. Submit button
6. Inline success/error feedback (no page reload — via JSON response + JavaScript update)

### Rationale
The existing `OAuthServer` already has a pattern for adding service-specific routes. New routes follow the same structure. The credential management page is self-contained HTML served by the Node.js HTTP server — no new framework required.

### Credential Extraction Instructions (to appear on the page)
1. Open Slack in Chrome/Edge
2. Open DevTools (F12) → Application tab
3. **xoxc token**: Local Storage → `https://{workspace}.slack.com` → find key `localConfig_v2` → extract `token` field (starts with `xoxc-`)
4. **xoxd cookie**: Cookies → `https://{workspace}.slack.com` → find cookie named `d` → copy the value (starts with `xoxd-`)
