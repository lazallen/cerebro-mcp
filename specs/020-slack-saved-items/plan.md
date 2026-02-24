# Implementation Plan: Slack Save for Later Integration

**Branch**: `020-slack-saved-items` | **Date**: 2026-02-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/020-slack-saved-items/spec.md`

## Summary

Adds a standalone `SlackSavedItemsService` that authenticates via Slack browser session credentials (xoxc/xoxd) — with no dependency on the existing OAuth-based Slack integration — and exposes two MCP tools: `list-saved-items` (returns all saved items with full message text fetched inline) and `mark-saved-item-complete`. The auth dashboard gains a credential management page for paste-based setup and refresh, with expiry-state highlighting. Credential lifetime is approximately 12 hours based on observed behaviour.

## Technical Context

**Language/Version**: TypeScript 5.3.3 / Node.js 18+
**Primary Dependencies**: `@modelcontextprotocol/sdk ^1.25.3`, `pino ^8.19.0` (existing); no new runtime dependencies required (Node 18+ `fetch` built-in)
**Storage**: File-based JSON at `.tokens/slack-session-credentials.json` (0o600 permissions, consistent with `.tokens/` pattern)
**Testing**: Jest with ts-jest; 80% coverage threshold (existing `jest.config.js`)
**Target Platform**: Node.js 18+ Linux/macOS (WSL2 in dev)
**Project Type**: Single project — extends existing `src/` layout
**Performance Goals**: `list-saved-items` completes in <5s for typical saved-item lists (≤200 items including message text fetches); `mark-saved-item-complete` completes in <2s
**Constraints**: No OAuth dependency; standalone service; graceful degradation when credentials absent; no new npm packages required
**Scale/Scope**: Personal tool; typically <50 saved items; single user

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Documentation-First | ✅ Pass | README, .env.example, quickstart.md, JSDoc all in scope |
| II. Service Architecture | ✅ Pass | Implements `BaseService`; pino structured logging; typed errors |
| III. Testing Standards | ✅ Pass | Unit tests for storage, client, service; integration test; 80% coverage |
| IV. MCP Tool Design | ✅ Pass | JSON Schema validation, user-friendly error messages, independent tools |
| V. Dashboard Integration | ✅ Pass | Status card + credential management page with expiry indicators |

**No violations. No Complexity Tracking entries required.**

## Project Structure

### Documentation (this feature)

```text
specs/020-slack-saved-items/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── types.ts         ← TypeScript interfaces
│   └── interfaces.ts    ← MCP tool input/output schemas
└── tasks.md             ← Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── slack-saved-items/          ← NEW: standalone service directory
│   │   ├── index.ts
│   │   ├── slack-saved-items-service.ts
│   │   ├── session-credential-storage.ts
│   │   └── webclient-api-client.ts
│   └── heartbeat/
│       └── tasks/
│           └── slack-saved-items-ingestion-task.ts  ← NEW: heartbeat task
└── types/
    └── slack-saved-items.ts        ← NEW: shared TypeScript interfaces

tests/
├── unit/
│   └── slack-saved-items/          ← NEW: unit test suite
│       ├── session-credential-storage.test.ts
│       ├── webclient-api-client.test.ts
│       ├── slack-saved-items-service.test.ts
│       └── slack-saved-items-ingestion-task.test.ts
└── integration/
    └── slack-saved-items.test.ts   ← NEW: integration test
```

**Modified files:**

```text
src/mcp-server/service-registration.ts                    ← register SlackSavedItemsService
src/auth-server/oauth-server.ts                           ← add credential management routes + dashboard card
src/services/heartbeat/tasks/task-registry.ts             ← register slack-saved-items-ingestion task type
heartbeat-config.example.json                             ← add slack-saved-items-ingestion example entry
.env.example                                              ← document token storage path + feature flag
README.md                                                 ← feature description + quickstart link
CLAUDE.md                                                 ← tech stack entry
```

**Structure Decision**: Single project, extending existing layout. New service is isolated in its own directory to reinforce the architectural independence from the OAuth Slack integration.

---

## Phase 0: Research Summary

See [research.md](./research.md) for full findings. Key resolved decisions:

| Topic | Decision |
|-------|----------|
| Undocumented API access | POST to `{workspaceUrl}/api/saved.list` and `saved.update` with xoxc as form field, xoxd as `d` cookie |
| Workspace URL | Resolve once via `auth.test` at service initialization; cache on `SessionCredentials` |
| Message text | `saved.list` returns no text; fetch inline via `conversations.history` (xoxc token works) |
| Rate limiting | Retry-once with `Retry-After` header; propagate error if still limited |
| Token storage class | Custom `SessionCredentialStorage` (not `BaseTokenStorage` — no OAuth flow) |
| Dashboard credential form | Paste-based; POST to `/auth/slack-saved-items/credentials` |
| Credential expiry estimate | `savedAt + 12h`; warn when ≤2h remaining |

---

## Phase 1: Design

### Data Model → [data-model.md](./data-model.md)

Three core types:

**`SessionCredentials`** (stored at `.tokens/slack-session-credentials.json`):
- `xoxcToken: string` — browser localStorage token
- `xoxdCookie: string` — browser `d` cookie value
- `savedAt: number` — ms epoch when last saved via dashboard
- `workspaceUrl?: string` — cached from `auth.test` (populated on first use)

**`SavedItem`** (returned by `list-saved-items`):
Full API response fields plus enriched `messageText` and `userName` from a `conversations.history` call.

**`SavedItemCounts`**:
- `uncompletedCount`, `uncompletedOverdueCount`, `archivedCount`, `completedCount`, `totalCount`

### API Contracts → [contracts/](./contracts/)

Two MCP tools:

**`list-saved-items`**
- Input: `{ cursor?: string }` — optional pagination cursor
- Output: `{ items: SavedItem[], counts: SavedItemCounts, nextCursor?: string }`
- Error cases: credentials not configured, credentials expired/invalid, API error

**`mark-saved-item-complete`**
- Input: `{ channel: string, ts: string }` — identifiers from `list-saved-items`
- Output: `{ success: true, channel: string, ts: string }`
- Error cases: credentials not configured/expired, invalid identifiers, API error

### Dashboard Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/auth/slack-saved-items/credentials` | GET | Credential management page (status + form + instructions) |
| `/auth/slack-saved-items/credentials` | POST | Save new xoxc + xoxd values |

Dashboard status card states: `configured` / `expiring-soon` (≤2h) / `expired` / `not_configured`

### Service Implementation Outline

**`SlackSavedItemsService`** implements `BaseService`:

```
initialize()
  → load SessionCredentials from storage
  → if credentials exist, call auth.test to resolve/cache workspaceUrl
  → log status

getTools() → [list-saved-items, mark-saved-item-complete]

isAuthenticated()
  → returns true if credentials exist AND not expired (savedAt + 12h > now)

shutdown() → no-op
```

**`SessionCredentialStorage`**:
- `load(): SessionCredentials | undefined`
- `save(xoxc, xoxd): SessionCredentials` — sets `savedAt = Date.now()`
- `isExpired(): boolean` — `savedAt + 12h < now`
- `isExpiringSoon(): boolean` — `savedAt + 10h < now` (2h warning window)

**`WebclientApiClient`**:
- `savedList(cursor?: string): Promise<SavedListApiResponse>`
- `savedUpdate(channelId: string, ts: string): Promise<void>`
- `fetchMessageText(channelId: string, ts: string): Promise<{ text: string, userName: string }>`
- `resolveWorkspaceUrl(): Promise<string>` — calls `auth.test`, caches on credentials
- Private `postForm(url, fields): Promise<unknown>` — injects xoxc + xoxd, handles 429

### Heartbeat Task → `slack-saved-items-ingestion-task.ts`

Mirrors the `EmailIngestionTask` pattern exactly.

**Constructor** takes `(webclientApiClient: WebclientApiClient, systemDir: string)`

**Config interface**:
```
SlackSavedItemsIngestionConfig {
  markAsComplete?: boolean    // default: true
}
```

**`execute(taskConfig)` flow:**
1. Load config; default `markAsComplete = true`
2. Paginate through all pages of `savedList()` — collect all items where `state === 'uncompleted'`
3. For each item:
   a. Build `TriageEvent` via `buildTriageEvent(item)` — `source: 'slack-saved'`
   b. Call `saveEvent(systemDir, event)` — idempotency handled by `saveEvent` (same eventId = no duplicate)
   c. If `markAsComplete` and save succeeded → call `savedUpdate(item.itemId, item.ts)`; on failure log warning and continue
4. Log completion summary: items fetched, events written, items marked complete

**`buildTriageEvent(item: SavedItem)` mapping:**
```
eventId    = `{yyyymmdd}-slack-{item.ts.replace('.', '-')}`
source     = 'slack-saved'
title      = first 80 chars of messageText (fallback: `Slack message ${item.ts}`)
author     = item.userId (raw Slack user ID)
receivedAt = new Date(item.dateCreated * 1000).toISOString()
snippet    = messageText.slice(0, 500)
signals    = {
  asksForAction:   regex match on messageText
  mentionsMoney:   regex match on messageText
  mentionsMeeting: regex match on messageText
  isAutomated:     false  (user-saved items are not automated)
  isBulk:          false
  hasAttachments:  false  (Slack attachments not surfaced in saved.list)
  hasUnsubscribe:  false
  prioritySender:  false  (no sender list for Slack in this feature)
  outlookFirstSender: false
}
sourceData = { itemId, ts, state, dateCreated, dateSnoozedUntil, isArchived }
```

**Task registry registration** (in `task-registry.ts`):
- Dependency: `slackSavedItemsApiClient` passed via `dependencies` (injected from heartbeat service init)
- Only registered if `slackSavedItemsApiClient && resolvedSystemDir` are present
- Registered under key `'slack-saved-items-ingestion'`

**`heartbeat-config.example.json` entry:**
```json
{
  "id": "slack-saved-items-ingestion-15min",
  "name": "Slack Saved Items Ingestion (Every 15 Minutes)",
  "type": "slack-saved-items-ingestion",
  "schedule": "*/15 * * * *",
  "enabled": false,
  "config": {
    "markAsComplete": true
  }
}
```
