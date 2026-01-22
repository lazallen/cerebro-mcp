# Tasks: Slack Message Actions via Socket Mode

**Input**: Design documents from `/specs/010-slack-message-actions/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Included as spec.md requires Test-First Development per constitution

**Organization**: Tasks grouped by implementation phase for Socket Mode architecture

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Configuration Changes)

**Purpose**: Update project configuration for Socket Mode

- [x] T001 ~~Add SLACK_SIGNING_SECRET to .env.example~~ **SUPERSEDED**: Replace with SLACK_APP_TOKEN
- [ ] T001a Add SLACK_APP_TOKEN to .env.example in project root
- [x] T002 Add .tasks/ directory to .gitignore in project root
- [x] T003 [P] Create TypeScript types for message actions in src/types/slack-message-action.ts

---

## Phase 2: Foundational (Storage Layer - Already Complete)

**Purpose**: Core storage that user stories depend on

**Status**: ✅ Complete from previous HTTP implementation - storage layer is transport-agnostic

- [x] T006 Implement MessageActionStorage class in src/services/slack/message-action-storage.ts
- [x] T007 Write unit tests for storage operations in src/services/slack/__tests__/message-action-storage.test.ts

**Checkpoint**: Storage layer tested and working

---

## Phase 3: Socket Mode Client (New - Replaces HTTP Endpoint)

**Purpose**: WebSocket client for receiving Slack events via Socket Mode

**⚠️ CRITICAL**: This replaces the HTTP webhook approach

### Dependencies

- [ ] T029 Install ws and @types/ws packages: `npm install ws && npm install -D @types/ws`

### Tests for Socket Mode Client

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T030 [US1] Write unit tests for SlackSocketModeClient in src/services/slack/__tests__/slack-socket-client.test.ts
  - Test apps.connections.open API call
  - Test WebSocket connection establishment
  - Test hello message handling
  - Test envelope parsing and acknowledgement
  - Test message_action payload extraction
  - Test reconnection logic
  - Test error handling

### Implementation for Socket Mode Client

- [ ] T031 [US1] Create SlackSocketModeClient class in src/services/slack/slack-socket-client.ts
- [ ] T032 [US1] Implement getWebSocketUrl() - calls apps.connections.open API
- [ ] T033 [US1] Implement connect() - establishes WebSocket connection
- [ ] T034 [US1] Implement WebSocket event handlers (open, message, close, error)
- [ ] T035 [US1] Implement handleMessage() - parse envelopes, acknowledge, extract payloads
- [ ] T036 [US1] Implement automatic reconnection with exponential backoff
- [ ] T037 [US1] Add logging for connection lifecycle events

**Checkpoint**: Socket Mode client can connect to Slack and receive events

---

## Phase 4: Integration (Wire Up Socket Mode to SlackService)

**Purpose**: Connect Socket Mode client to existing service infrastructure

- [ ] T038 [US1] Add Socket Mode client initialization to SlackService in src/services/slack/slack-service.ts
- [ ] T039 [US1] Wire message_action handler to MessageActionStorage.add()
- [ ] T040 [US1] Add connect/disconnect lifecycle methods to SlackService
- [ ] T041 [US1] Update SlackService to conditionally enable Socket Mode when SLACK_APP_TOKEN is set

**Checkpoint**: Message shortcuts received via Socket Mode are stored automatically

---

## Phase 5: Cleanup HTTP Endpoint (Remove Old Approach)

**Purpose**: Remove now-unused HTTP webhook infrastructure

- [ ] T042 Remove /tasks/slack route handler from src/auth-server/oauth-server.ts
- [ ] T043 Remove handleSlackMessageAction method from oauth-server.ts
- [ ] T044 Remove webhook endpoint logging from logServerStarted() in oauth-server.ts
- [ ] T045 Remove verifySlackSignature import from oauth-server.ts
- [ ] T046 Delete src/common/slack-signature.ts
- [ ] T047 Delete src/common/__tests__/slack-signature.test.ts
- [ ] T048 Remove SLACK_SIGNING_SECRET from .env.example (replaced by SLACK_APP_TOKEN)
- [ ] T049 Delete src/auth-server/__tests__/tasks-slack-endpoint.test.ts (HTTP endpoint tests)

**Checkpoint**: HTTP webhook code removed, only Socket Mode remains

---

## Phase 6: User Story 2 - Review Captured Messages via Claude (Priority: P1)

**Goal**: MCP tool lists stored message actions with optional filtering

**Status**: ✅ Already implemented - no changes needed for Socket Mode

- [x] T014 [US2] Write unit tests for list-message-actions tool in src/services/slack/__tests__/slack-service.test.ts
- [x] T015 [US2] Add list-message-actions tool definition to SlackService.getTools()
- [x] T016 [US2] Implement list-message-actions handler with processed filter
- [x] T017 [US2] Add summary generation (channelName, userName, messagePreview) in handler

**Checkpoint**: Claude can list captured messages via MCP tool

---

## Phase 7: User Story 3 - Process and Clear Captured Messages (Priority: P1)

**Goal**: MCP tools to get full details and delete processed actions

**Status**: ✅ Already implemented - no changes needed for Socket Mode

- [x] T018 [P] [US3] Write unit tests for get-message-action tool
- [x] T019 [P] [US3] Write unit tests for delete-message-action tool
- [x] T020 [US3] Add get-message-action tool definition to SlackService.getTools()
- [x] T021 [US3] Implement get-message-action handler with not_found error handling
- [x] T022 [US3] Add delete-message-action tool definition to SlackService.getTools()
- [x] T023 [US3] Implement delete-message-action handler with atomic file update

**Checkpoint**: Complete triage workflow functional - list, view details, delete

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verification, linting, documentation

- [ ] T050 Run full test suite and verify all tests pass: npm test
- [ ] T051 Run TypeScript type checking: npm run type-check
- [ ] T052 Run ESLint and fix any issues: npm run lint
- [ ] T053 Update quickstart.md with Socket Mode setup instructions
- [ ] T054 Update contracts/webhook-endpoint.md to socket-mode.md (or delete and create new)
- [ ] T055 Update README.md with Slack app configuration for Socket Mode

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: ✅ Already complete
- **Socket Mode Client (Phase 3)**: Depends on T029 (ws package)
- **Integration (Phase 4)**: Depends on Phase 3 completion
- **Cleanup (Phase 5)**: Depends on Phase 4 (new approach working before removing old)
- **User Story 2 (Phase 6)**: ✅ Already complete
- **User Story 3 (Phase 7)**: ✅ Already complete
- **Polish (Phase 8)**: Depends on all phases complete

### Critical Path

```
T029 (install ws)
  → T030 (write tests)
    → T031-T037 (implement client)
      → T038-T041 (integrate)
        → T042-T049 (cleanup)
          → T050-T055 (polish)
```

### Parallel Opportunities

**Phase 3** (after T029):
- T030 (tests) must come first
- T031-T037 can be done incrementally but are sequential

**Phase 5** (cleanup):
- T042-T049 can run in parallel (different files, no dependencies between them)

---

## Implementation Strategy

### MVP First (Socket Mode Connection)

1. Complete Phase 1: Setup (T001a, T002, T003)
2. Skip Phase 2: Already complete
3. Complete Phase 3: Socket Mode Client (T029-T037)
4. **STOP and VALIDATE**: Test connection with real Slack app
5. Complete Phase 4: Integration (T038-T041)
6. **STOP and VALIDATE**: Test end-to-end with message shortcut

### Cleanup After Validation

1. Only after Socket Mode is working:
2. Complete Phase 5: Cleanup HTTP (T042-T049)
3. Complete Phase 8: Polish (T050-T055)

---

## Notes

- All file paths are absolute from repository root
- Tests use Jest with TypeScript support
- Storage uses atomic writes (temp file + rename) - unchanged from HTTP approach
- Socket Mode does NOT require signature verification (pre-authenticated WebSocket)
- Log metadata only (action type, channel), never message content
- Tool names follow namespace pattern: `slack.{tool-name}`
- WebSocket connections need reconnection handling (~3600s lifetime)
