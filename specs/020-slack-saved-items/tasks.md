# Tasks: Slack Save for Later Integration

**Input**: Design documents from `specs/020-slack-saved-items/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Included — constitution check mandates 80% coverage (plan.md III. Testing Standards).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared state)
- **[Story]**: Which user story this task belongs to (US1–US5)
- All file paths are relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared TypeScript types and directory structure before any implementation begins.

- [X] T001 Create `src/types/slack-saved-items.ts` with all shared types: `SessionCredentials`, `CredentialStatus`, `SavedItemState`, `SavedItem`, `SavedItemCounts`, `ListSavedItemsInput`, `ListSavedItemsOutput`, `MarkSavedItemCompleteInput`, `MarkSavedItemCompleteOutput`, `RawSavedItem`, `RawSavedListResponse` (derived from `specs/020-slack-saved-items/contracts/types.ts`)
- [X] T002 Create empty directories `src/services/slack-saved-items/` and `tests/unit/slack-saved-items/` (placeholder `.gitkeep` files if needed)

**Checkpoint**: Types available — all subsequent source files import from `src/types/slack-saved-items.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Credential storage and API client — the two building blocks used by every user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Implement `SessionCredentialStorage` in `src/services/slack-saved-items/session-credential-storage.ts` — methods: `load(): SessionCredentials | undefined`, `save(xoxc, xoxd): SessionCredentials` (sets `savedAt = Date.now()`), `isExpired(): boolean` (`savedAt + 12h < now`), `isExpiringSoon(): boolean` (`savedAt + 10h < now`); persists to `.tokens/slack-session-credentials.json` with `chmod 0o600`; consistent with existing `.tokens/` pattern
- [X] T004 [P] Implement `WebclientApiClient` in `src/services/slack-saved-items/webclient-api-client.ts` — methods: `savedList(cursor?: string): Promise<RawSavedListResponse>`, `savedUpdate(channelId: string, ts: string): Promise<void>`, `fetchMessageText(channelId: string, ts: string): Promise<{ text: string; userName: string }>`, `resolveWorkspaceUrl(): Promise<string>` (calls `auth.test`, caches on `SessionCredentials.workspaceUrl`); private `postForm(url, fields)` uses Node 18 `fetch`, injects xoxc as form field and xoxd as `d` cookie header, retries once on 429 using `Retry-After` header value, propagates error if still rate-limited
- [X] T005 [P] Unit tests for `SessionCredentialStorage` in `tests/unit/slack-saved-items/session-credential-storage.test.ts` — covers: `load()` returns `undefined` when file absent; `save()` writes file and returns credentials with `savedAt` set; `isExpired()` returns `false` just before 12h and `true` just after; `isExpiringSoon()` returns `false` just before 10h and `true` just after; file permissions set to `0o600`
- [X] T006 [P] Unit tests for `WebclientApiClient` in `tests/unit/slack-saved-items/webclient-api-client.test.ts` — covers: `savedList()` passes cursor in request body; `savedUpdate()` sends correct fields; `fetchMessageText()` returns text and userName from `conversations.history`; `fetchMessageText()` returns empty string on API error (not thrown); 429 triggers one retry with `Retry-After` delay; second consecutive 429 throws `rate_limited` error; `auth.test` failure throws `credentials_invalid`

**Checkpoint**: Foundation ready — storage and client independently tested; user story phases can begin in parallel

---

## Phase 3: User Story 1 - View Slack Saved Items (Priority: P1) 🎯 MVP

**Goal**: Expose the `list-saved-items` MCP tool returning all saved items with full message text and metadata.

**Independent Test**: Save a message in Slack, call `list-saved-items` via MCP client, verify the item appears with `messageText` populated and counts reflect the correct totals. Test pagination with `nextCursor`.

### Implementation for User Story 1

- [X] T007 [US1] Implement `SlackSavedItemsService` in `src/services/slack-saved-items/slack-saved-items-service.ts` — implements `BaseService`; constructor accepts `SessionCredentialStorage` and `WebclientApiClient`; `initialize()` loads credentials and if present calls `resolveWorkspaceUrl()`; `isAuthenticated()` returns `true` iff credentials exist and not expired; `shutdown()` is a no-op; pino structured logging on all state transitions
- [X] T008 [US1] Implement `list-saved-items` tool handler inside `SlackSavedItemsService` — accepts `{ cursor?: string }`; checks `isAuthenticated()` first (returns `credentials_not_configured` or `credentials_expired` as appropriate); calls `savedList(cursor)`, fetches `messageText` via `fetchMessageText()` per item (failure returns `""` not an error), maps `RawSavedItem[]` to `SavedItem[]`; returns `{ items, counts, nextCursor? }`; all errors shaped as `ToolErrorResponse`
- [X] T009 [US1] Create `src/services/slack-saved-items/index.ts` exporting `SlackSavedItemsService`, `SessionCredentialStorage`, `WebclientApiClient`
- [X] T010 [US1] Register `SlackSavedItemsService` in `src/mcp-server/service-registration.ts` — instantiate `SessionCredentialStorage` and `WebclientApiClient`; construct `SlackSavedItemsService`; add to services array following existing registration pattern; no new imports from `src/services/slack/` (architecturally isolated)
- [X] T011 [US1] Unit tests for `list-saved-items` in `tests/unit/slack-saved-items/slack-saved-items-service.test.ts` — covers: credentials not configured returns `credentials_not_configured` error; expired credentials returns `credentials_expired` error; successful list maps all `SavedItem` fields correctly; message text fetch failure returns item with `messageText: ""`; rate-limited API returns `rate_limited` error; empty saved list returns `{ items: [], counts: { totalCount: 0, ... } }`; cursor passed through to API call

**Checkpoint**: `list-saved-items` fully functional — user can retrieve saved items via MCP tool (MVP deliverable)

---

## Phase 4: User Story 2 - Mark Saved Item as Complete (Priority: P2)

**Goal**: Expose the `mark-saved-item-complete` MCP tool to remove actioned items from the Slack saved list.

**Independent Test**: Save a message in Slack, get `itemId` and `ts` from `list-saved-items`, call `mark-saved-item-complete`, verify the item no longer appears as active in Slack.

### Implementation for User Story 2

- [X] T012 [US2] Implement `mark-saved-item-complete` tool handler inside `SlackSavedItemsService` in `src/services/slack-saved-items/slack-saved-items-service.ts` — accepts `{ channel: string, ts: string }`; validates both fields present (returns `invalid_input` if missing); checks `isAuthenticated()`; calls `savedUpdate(channel, ts)`; returns `{ success: true, channel, ts }` on success; maps errors to `ToolErrorResponse` codes
- [X] T013 [US2] Extend unit tests in `tests/unit/slack-saved-items/slack-saved-items-service.test.ts` — covers: success path returns `{ success: true, channel, ts }`; missing `channel` returns `invalid_input`; missing `ts` returns `invalid_input`; expired credentials returns `credentials_expired`; API error returns `api_error`

**Checkpoint**: Both MCP tools functional — list and mark-complete work independently

---

## Phase 5: User Story 3 - Manage Session Credentials via Dashboard (Priority: P3)

**Goal**: Add credential management page to auth dashboard for paste-based setup and daily refresh, with expiry-state colour coding.

**Independent Test**: Navigate to `/auth/slack-saved-items/credentials`; verify `not_configured` state when no file exists; paste xoxc + xoxd; verify page shows `configured` with timestamps; simulate expiry; verify `expired` state highlighted with call-to-action.

### Implementation for User Story 3

- [X] T014 [US3] Add `GET /auth/slack-saved-items/credentials` route in `src/auth-server/oauth-server.ts` — renders HTML page with: credential status badge (`configured` green / `expiring_soon` amber / `expired` red / `not_configured` grey); `savedAt` and `estimatedExpiresAt` timestamps when present; inline step-by-step extraction instructions (Chrome/Edge DevTools for xoxc from `localConfig_v2` and xoxd `d` cookie); xoxc + xoxd input form with POST action; status-appropriate layout matching existing dashboard aesthetics
- [X] T015 [US3] Add `POST /auth/slack-saved-items/credentials` route in `src/auth-server/oauth-server.ts` — reads `xoxcToken` and `xoxdCookie` from form body; validates both non-empty (returns 400 with error if missing); calls `SessionCredentialStorage.save(xoxc, xoxd)`; returns inline success confirmation without page reload (JSON `{ success: true, estimatedExpiresAt }` for fetch-based form submission); reloading credentials file takes effect immediately without restart (FR-011)
- [X] T016 [US3] Add Slack Saved Items status card to auth dashboard home page in `src/auth-server/oauth-server.ts` — shows current status with colour indicator, `savedAt` timestamp, and link to `/auth/slack-saved-items/credentials`; mirrors layout and structure of existing service status cards
- [X] T017 [US3] Update `.env.example` to add a comment-only block documenting that `.tokens/slack-session-credentials.json` holds Slack saved-items credentials and that they are managed via the auth dashboard (no env var — per FR-006 decision)

**Checkpoint**: Auth dashboard fully operational — credential setup and refresh require no file editing

---

## Phase 6: User Story 4 - Automated Heartbeat Ingestion (Priority: P4)

**Goal**: Implement `slack-saved-items-ingestion` heartbeat task that ingests uncompleted saved items into the triage pipeline and marks them complete.

**Independent Test**: Save a message in Slack; configure task in `heartbeat-config.json`; trigger task; verify `TriageEvent` file appears in `{rootDir}/system/triage/`; verify item is marked complete in Slack.

### Implementation for User Story 4

- [X] T018 [US4] Implement `SlackSavedItemsIngestionTask` in `src/services/heartbeat/tasks/slack-saved-items-ingestion-task.ts` — constructor `(webclientApiClient: WebclientApiClient, systemDir: string)`; `execute(taskConfig)` paginates through all pages of `savedList()`, collects items where `state === 'uncompleted'`, calls `buildTriageEvent(item)` then `saveEvent(absoluteSystemDir, event)` for each; if `markAsComplete !== false` calls `savedUpdate(item.itemId, item.ts)` after each successful save (failure logs warning and continues); on credential-expired error at top of execute logs clear message directing user to dashboard and returns early without processing; logs `items_fetched`, `events_written`, `items_completed` on completion
- [X] T019 [US4] Implement `buildTriageEvent(item: SavedItem): TriageEvent` inside `SlackSavedItemsIngestionTask` — `eventId = {yyyymmdd}-slack-{item.ts.replace('.', '-')}`; `source = 'slack-saved'`; `title = item.messageText.slice(0, 80) || \`Slack message ${item.ts}\``; `author = item.userId`; `receivedAt = new Date(item.dateCreated * 1000).toISOString()`; `snippet = item.messageText.slice(0, 500)`; signals: `asksForAction` (regex on messageText), `mentionsMoney` (regex), `mentionsMeeting` (regex), `isAutomated: false`, `isBulk: false`, `hasAttachments: false`, `hasUnsubscribe: false`, `prioritySender: false`, `outlookFirstSender: false`; `sourceData = { itemId, ts, state, dateCreated, dateSnoozedUntil, isArchived }`
- [X] T020 [US4] Add `slackSavedItemsApiClient` to the `dependencies` parameter type in `createTaskRegistry` in `src/services/heartbeat/tasks/task-registry.ts` — add conditional registration block: `if (dependencies?.slackSavedItemsApiClient && resolvedSystemDir)` instantiate `SlackSavedItemsIngestionTask` and register under key `'slack-saved-items-ingestion'`; follow exact same try/catch + debug log pattern as other task registrations
- [X] T021 [US4] Wire `WebclientApiClient` into heartbeat service task registry dependencies — update `src/services/heartbeat/heartbeat-service.ts` to instantiate `SessionCredentialStorage` and `WebclientApiClient` during service init and pass `slackSavedItemsApiClient` to `createTaskRegistry()`; only instantiate if `.tokens/slack-session-credentials.json` can be loaded (graceful when credentials absent)
- [X] T022 [US4] Add `slack-saved-items-ingestion-15min` entry to `heartbeat-config.example.json` — `id: "slack-saved-items-ingestion-15min"`, `name: "Slack Saved Items Ingestion (Every 15 Minutes)"`, `type: "slack-saved-items-ingestion"`, `schedule: "*/15 * * * *"`, `enabled: false`, `config: { "markAsComplete": true }`
- [X] T023 [P] [US4] Unit tests for `SlackSavedItemsIngestionTask` in `tests/unit/slack-saved-items/slack-saved-items-ingestion-task.test.ts` — covers: uncompleted items produce `TriageEvent` files and call `savedUpdate()`; expired credentials exits early with log (no items processed); per-item `savedUpdate()` failure logs warning and continues to next item; `markAsComplete: false` skips all `savedUpdate()` calls; `buildTriageEvent()` maps all fields correctly including fallback title; idempotent — re-run with same items does not create duplicate events

**Checkpoint**: Heartbeat ingestion operational — saved items flow automatically into triage pipeline on schedule

---

## Phase 7: User Story 5 - Unified Triage View (Priority: P5)

**Goal**: Validate the full pipeline with an integration test and complete documentation. The triage skill update (surfacing saved items alongside email in the cerebro repository) is an external change tracked separately.

**Independent Test**: Run `tests/integration/slack-saved-items.test.ts` — verifies full pipeline from list → mark-complete → heartbeat ingestion → TriageEvent written, with idempotency check.

### Implementation for User Story 5

- [X] T024 [US5] Integration test in `tests/integration/slack-saved-items.test.ts` — end-to-end: mock Webclient API returns two uncompleted items → `list-saved-items` tool returns both with `messageText` populated → `mark-saved-item-complete` succeeds for each → heartbeat task writes two `TriageEvent` files to temp dir and calls `savedUpdate()` for each → re-run of heartbeat task produces no duplicate event files (idempotency) → credentials expired path: heartbeat exits early, no events written, no items marked
- [X] T025 [US5] Update `README.md` to add Slack Saved Items feature description: brief summary (session-credential based, independent of OAuth integration), quickstart link (`docs/slack-saved-items-quickstart.md` or `specs/020-slack-saved-items/quickstart.md`), note on credential refresh (~12h lifetime, dashboard at `:3333`)
- [X] T026 [P] [US5] Update `CLAUDE.md` with tech stack entry for feature 020 — no new runtime npm dependencies (`fetch` built-in Node 18+); `SessionCredentialStorage` pattern (custom, not BaseTokenStorage); file path `.tokens/slack-session-credentials.json`

**Checkpoint**: Feature complete — all five user stories independently tested; documentation current

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 completion
- **US2 (Phase 4)**: Depends on US1 completion (extends same service file)
- **US3 (Phase 5)**: Depends on Phase 2 completion — can run in **parallel with US1**
- **US4 (Phase 6)**: Depends on Phase 2 completion — can run in **parallel with US1/US2/US3**
- **US5 (Phase 7)**: Depends on all prior phases complete

### User Story Dependencies

| Story | Depends On | Can Parallelise With |
|-------|-----------|----------------------|
| US1 (P1) | Phase 2 | US3, US4 |
| US2 (P2) | US1 (same file) | US3, US4 |
| US3 (P3) | Phase 2 | US1, US4 |
| US4 (P4) | Phase 2 | US1, US3 |
| US5 (P5) | US1, US2, US3, US4 | — |

### Within Each User Story

- Unit tests can be written in parallel with implementation (different mindsets, same files — run tests after implementation)
- Models/types before services
- Service before tool registration
- All story tasks complete before moving to next priority

---

## Parallel Example: Foundational Phase

```bash
# All four foundational tasks are fully independent — launch together:
Task: "Implement SessionCredentialStorage in src/services/slack-saved-items/session-credential-storage.ts"
Task: "Implement WebclientApiClient in src/services/slack-saved-items/webclient-api-client.ts"
Task: "Unit tests for SessionCredentialStorage in tests/unit/slack-saved-items/session-credential-storage.test.ts"
Task: "Unit tests for WebclientApiClient in tests/unit/slack-saved-items/webclient-api-client.test.ts"
```

## Parallel Example: US3 + US4 after Phase 2

```bash
# Once Phase 2 is complete, US3 and US4 can run concurrently:
Task: "Dashboard routes (GET/POST /auth/slack-saved-items/credentials) in src/auth-server/oauth-server.ts"
Task: "SlackSavedItemsIngestionTask in src/services/heartbeat/tasks/slack-saved-items-ingestion-task.ts"
```

---

## Implementation Strategy

### MVP First (Phases 1–3: US1 Only)

1. Complete Phase 1: Setup (types + directories)
2. Complete Phase 2: Foundational (storage + client) — **CRITICAL**
3. Complete Phase 3: US1 (`list-saved-items` tool end-to-end)
4. **STOP and VALIDATE**: Call `list-saved-items` via MCP client with real Slack session credentials; confirm items returned with `messageText`
5. Optionally deploy — the feature has immediate standalone value at this point

### Incremental Delivery

1. Phases 1–2 → storage + client ready
2. Phase 3 (US1) → `list-saved-items` working → validate → **MVP**
3. Phase 4 (US2) → `mark-saved-item-complete` working → validate
4. Phase 5 (US3) → dashboard credential management → validate (no file editing needed)
5. Phase 6 (US4) → heartbeat ingestion → validate (items auto-ingested on schedule)
6. Phase 7 (US5) → integration test + docs → feature complete

### Solo Developer Strategy

Single developer working sequentially in priority order:

1. **Phase 1–2** (T001–T006): Set up types and foundational classes — ~2h
2. **Phase 3** (T007–T011): Service + `list-saved-items` + registration — ~2h → MVP checkpoint
3. **Phase 4** (T012–T013): `mark-saved-item-complete` — ~1h
4. **Phase 5** (T014–T017): Dashboard credential management — ~2h
5. **Phase 6** (T018–T023): Heartbeat task + registry wiring — ~2h
6. **Phase 7** (T024–T026): Integration test + docs — ~1h

---

## Task Summary

| Phase | Tasks | User Story | Priority |
|-------|-------|-----------|---------|
| Phase 1: Setup | T001–T002 | — | — |
| Phase 2: Foundational | T003–T006 | — | — |
| Phase 3 | T007–T011 | US1: View Saved Items | P1 🎯 |
| Phase 4 | T012–T013 | US2: Mark Complete | P2 |
| Phase 5 | T014–T017 | US3: Dashboard Credentials | P3 |
| Phase 6 | T018–T023 | US4: Heartbeat Ingestion | P4 |
| Phase 7 | T024–T026 | US5: Integration + Docs | P5 |

**Total**: 26 tasks across 7 phases

---

## Notes

- `[P]` tasks have no shared file or state dependencies — safe to launch concurrently
- `[Story]` label maps each task to its user story for traceability
- Tests included throughout (constitution mandates 80% coverage)
- `src/services/slack-saved-items/` is architecturally isolated — **no imports from `src/services/slack/`** (the OAuth integration)
- Credential lifetime is ~12h; the 2h warning window comes from the `isExpiringSoon()` check (`savedAt + 10h`)
- `saveEvent()` from `src/lib/triage/triage-event-store` handles idempotency — same `eventId` will not produce a duplicate file
- `heartbeat-service.ts` (T021) is the main wiring point — check it before T020 to ensure the `slackSavedItemsApiClient` dependency flows correctly through to the registry
