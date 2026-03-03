# Tasks: Triage Review UI

**Input**: Design documents from `/specs/022-triage-review-ui/`
**Branch**: `022-triage-review-ui`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/api.md ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the directory scaffold and wire the new router into the existing auth server. No user-facing behaviour yet.

- [x] T001 Create directory `src/auth-server/triage/public/` and add empty placeholder files `index.html`, `app.js`, `styles.css` (touched so TypeScript build does not complain)
- [x] T002 Create `TriageRouter` skeleton class in `src/auth-server/triage-router.ts` with a constructor accepting `systemDir: string` and a `handleRequest(req, res, pathname)` stub that returns 404
- [x] T003 Instantiate `TriageRouter` in `src/auth-server/oauth-server.ts` and delegate all requests where `pathname.startsWith('/triage')` to `triageRouter.handleRequest(req, res, pathname)` inside `handleRequest()`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data model change and shared write helper that all resolution paths depend on. Must be complete before any user story work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add `source?: string` and `title?: string` to the `HumanQueueItem` interface in `src/lib/triage/human-queue-store.ts`, and update `createItem()` to include these fields in the YAML frontmatter dump when present
- [x] T005 Update the `createHumanQueueItem()` call in `src/services/heartbeat/tasks/policy-pipeline-task.ts` (the `ASK_HUMAN` case in `executeAction`) to pass `source: event.source` and `title: event.title` so new HQ items carry these fields
- [x] T006 Implement `resolveHQItem(systemDir: string, id: string, updates: Partial<HumanQueueItem>): Promise<boolean>` in `src/lib/triage/human-queue-store.ts` — uses `proper-lockfile` for atomic read-modify-write; returns `false` if item not found, throws if item is not `pending`
- [x] T007 Implement the `POST /triage/api/items/:id/resolve` route skeleton in `src/auth-server/triage-router.ts` — parse JSON body, validate `resolution` field, look up item by id, return `409` if already resolved, `404` if not found; dispatch to three stub handlers (`handleDone`, `handleDefer`, `handleDelegate`) that each return `501 Not Implemented` until their story phase is complete

**Checkpoint**: `npm test && npm run lint` passes. Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Browse and Select Pending HQ Items (Priority: P1) 🎯 MVP

**Goal**: The UI loads, lists all pending HQ items with source badges and titles, and populates the detail panel when an item is clicked. Empty-state message shown when queue is empty.

**Independent Test**: Open `http://localhost:3333/triage` with 3 pending HQ items in `system/human/`. All 3 appear with correct source badges and titles. Clicking any item populates the detail panel with its content and question.

- [x] T008 [US1] Implement `GET /triage/api/items` handler in `src/auth-server/triage-router.ts` — scan `system/human/`, parse frontmatter with `gray-matter`, filter to `status: pending`, build `TriageItemView[]` (fallback `source: 'other'`, `title: 'Untitled'` for items missing those fields), return sorted JSON
- [x] T009 [US1] Implement `GET /triage` and `GET /triage/static/:file` routes in `src/auth-server/triage-router.ts` — serve `index.html`, `app.js`, `styles.css` from `src/auth-server/triage/public/` relative to `process.cwd()`
- [x] T010 [P] [US1] Write `src/auth-server/triage/public/styles.css` — full dark theme using CSS custom properties (`--bg-canvas: #0d1117`, `--bg-surface: #161b22`, etc.), two-column CSS Grid layout (320 px list | 1fr detail), independent panel scroll, source badge colour map, resolution controls pinned to bottom of detail panel
- [x] T011 [P] [US1] Write `src/auth-server/triage/public/index.html` — two-panel shell with `#item-list` container (right), `#detail-panel` container (left) containing metadata header, `#item-body` scrollable content area, and `#resolution-controls` footer section (Done button, Defer button, textarea, Accept button)
- [x] T012 [US1] Write initial `src/auth-server/triage/public/app.js` — `fetchItems()` calls `GET /triage/api/items`, renders `<li>` per item with source badge icon and title into `#item-list`, shows "Nothing to review" empty-state when list is empty; click handler selects item, populates `#detail-panel` with metadata and `bodyMarkdown` rendered as plain text, pre-populates Delegate textarea with `item.question`

**Checkpoint**: US1 fully functional. Items visible, selectable, detail panel populated. Empty-state works.

---

## Phase 4: User Story 2 — Resolve an Item: Done (Priority: P2)

**Goal**: Clicking Done marks the item resolved, queues an archive MOVE action for email/meeting-invite items, and auto-advances to the next item.

**Independent Test**: With a selected HQ item (email source), click Done. Verify the file has `status: resolved`, `answer: done`, `resolvedAt` set, and the `system/decisions/{eventRef}.md` file has a new `MOVE` action with `folder: Archive`. Verify the item disappears from the UI list.

- [x] T013 [US2] Write `src/lib/triage/archive-action.ts` — export `appendArchiveAction(systemDir: string, eventRef: string): Promise<void>` that reads `system/decisions/{eventRef}.md` with gray-matter, checks if a MOVE-to-Archive action already exists (guard against duplicate clicks), appends `{ type: 'MOVE', folder: 'Archive', applied: false, requiresApproval: false }` to the `actionsJson` array, writes back atomically with `proper-lockfile`; no-op if the decision file does not exist
- [x] T014 [US2] Implement `handleDone(systemDir, item)` in `src/auth-server/triage-router.ts` — call `resolveHQItem` with `{ answer: 'done', status: 'resolved', resolvedAt: new Date().toISOString() }`; if `item.source` is `'email'` or `'meeting-invite'`, call `appendArchiveAction(systemDir, item.eventRef)`; return `{ ok: true, resolution: 'done' }`
- [x] T015 [US2] Add Done button click handler in `src/auth-server/triage/public/app.js` — POST to `/triage/api/items/{id}/resolve` with `{ resolution: 'done' }`, show brief loading state on button, on `200` remove item from local list and auto-advance to next item (or show empty-state if none remain), on error show inline error message

**Checkpoint**: Done resolution fully functional. File written, archive action queued, UI auto-advances.

---

## Phase 5: User Story 3 — Resolve an Item: Defer (Priority: P3)

**Goal**: Clicking Defer triggers LLM enrichment of the HQ item using `./context/` repo context, writes a well-formed task file to `./context/tasks/`, marks the HQ item resolved, and removes it from the list. Defer button shows a loading state during the 2–5 s LLM call.

**Independent Test**: Click Defer on a selected HQ item. A new `.md` file appears in `./context/tasks/` with valid YAML frontmatter (`status: todo`, `priority`, `title`, `tags`) and a `## Context` body section. The HQ item file has `status: resolved`. The item disappears from the UI list within the next poll.

- [x] T016 [US3] Create `src/lib/triage/defer-enrichment.ts` — define `DeferEnrichmentService` class with constructor accepting `contextDir: string`; implement `loadContext(): Promise<string>` method that reads `methodology.md`, up to 3 files from `projects/`, up to 3 markdown files from `contextDir` root, and up to 5 most-recently-modified files from `tasks/` (as format examples); concatenates into a context digest capped at ~12,000 characters
- [x] T017 [US3] Implement `enrich(item: TriageItemView): Promise<string>` in `src/lib/triage/defer-enrichment.ts` — build system prompt explaining task file YAML schema and markdown body sections, build user prompt combining HQ item question + body + context digest, call `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk` messages API, return raw model response text
- [x] T018 [US3] Implement `writeTaskFile(responseText: string, hqItemId: string): Promise<string>` in `src/lib/triage/defer-enrichment.ts` — parse YAML frontmatter from response with gray-matter (fallback to minimal task if parse fails), generate kebab-slug filename from `title` field, handle filename collisions with `-YYYYMMDD` suffix, write atomically to `contextDir/tasks/{slug}.md`; return the relative file path
- [x] T019 [US3] Implement `handleDefer(systemDir, contextDir, item)` in `src/auth-server/triage-router.ts` — instantiate `DeferEnrichmentService`, call `enrich()` then `writeTaskFile()`, then call `resolveHQItem` with `{ answer: 'deferred', status: 'resolved', resolvedAt }`, return `{ ok: true, resolution: 'defer', taskFile }` on success; return `500` with error message if LLM call fails
- [x] T020 [US3] Add Defer button handler in `src/auth-server/triage/public/app.js` — disable both Done and Defer buttons and show spinner text on Defer button during request; on `200` remove item from list and auto-advance; on error re-enable buttons and show inline error

**Checkpoint**: Defer fully functional. Task file written to `./context/tasks/`, HQ item resolved, UI auto-advances.

---

## Phase 6: User Story 4 — Resolve an Item: Delegate (Priority: P4)

**Goal**: User types a custom prompt (or accepts the pre-populated question) and presses Accept. The answer is written to the HQ item file. Accept button is disabled when the textarea is empty.

**Independent Test**: With a selected HQ item, verify the textarea is pre-populated with `item.question`. Type a custom prompt and press Accept. Verify the HQ item file has `answer: <typed text>`, `status: resolved`, `resolvedAt` set. Verify Accept is disabled when textarea is cleared.

- [x] T021 [US4] Implement `handleDelegate(systemDir, item, answer)` in `src/auth-server/triage-router.ts` — validate `answer` is non-empty (return `400` if not), call `resolveHQItem` with `{ answer, status: 'resolved', resolvedAt: new Date().toISOString() }`, return `{ ok: true, resolution: 'delegate' }`
- [x] T022 [US4] Add Delegate controls behaviour in `src/auth-server/triage/public/app.js` — on item select: pre-populate textarea with `item.question` and enable Accept button; add `input` event listener to disable Accept when textarea is empty or whitespace-only; on Accept click: POST `{ resolution: 'delegate', answer: textarea.value }`, on `200` clear textarea, remove item from list, auto-advance

**Checkpoint**: Delegate fully functional. Answer written, Accept disabled when empty, pre-populated from question.

---

## Phase 7: User Story 5 — Automatic List Refresh (Priority: P5)

**Goal**: The item list stays in sync with `system/human/` automatically. New items appear within 10 seconds. Externally resolved items disappear without a reload.

**Independent Test**: Open the UI. Manually create a new `hq_*.md` file with `status: pending` in `system/human/`. Verify it appears in the UI within 10 seconds without reloading. Then set its `status` to `resolved` in the file and verify it disappears within 10 seconds.

- [x] T023 [US5] Implement auto-refresh poll loop in `src/auth-server/triage/public/app.js` — read poll interval from `new URLSearchParams(location.search).get('poll')` (default 10 s); call `fetchItems()` on interval; reconcile new server list with local state: add items not yet in DOM, remove items no longer pending, preserve the currently-selected item's detail panel if item still exists (do not disrupt in-progress Defer loading)

**Checkpoint**: List auto-refreshes. New items appear, resolved items disappear, selected item preserved across polls.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Tests, edge case handling, documentation, and final build validation.

- [x] T024 Handle edge cases in `src/auth-server/triage-router.ts` — malformed/missing frontmatter: include item in list with `title: 'Malformed item'` and `source: 'other'`; `system/human/` directory unreachable: return `500` with `{ ok: false, error: 'Queue directory unreachable' }`; unknown id on resolve: `404`; already-resolved item: `409`
- [x] T025 Handle edge cases in `src/auth-server/triage/public/app.js` — display inline error banner (dismissible) when any API call returns non-`2xx`; handle `409` on resolve (item already resolved externally) by removing it from the list silently; ensure resolution buttons are disabled when no item is selected
- [x] T026 [P] Write unit tests for `TriageRouter` API handlers in `tests/unit/triage/triage-router.test.ts` — mock `gray-matter`, `fs/promises`, and `proper-lockfile`; cover: empty directory returns `[]`, pending items parsed correctly, `source`/`title` fallback values, resolve returns `404` for unknown id, `409` for already-resolved, Done path calls `resolveHQItem` with correct args
- [x] T027 [P] Write unit tests for `DeferEnrichmentService` in `tests/unit/triage/defer-enrichment.test.ts` — mock `@anthropic-ai/sdk` and `fs/promises`; cover: context loading caps at 12,000 chars, LLM response parsed correctly, malformed LLM response falls back to minimal task file, filename collision appends `-YYYYMMDD` suffix
- [x] T028 [P] Write unit tests for `appendArchiveAction` in `tests/unit/triage/archive-action.test.ts` — cover: MOVE action appended correctly, duplicate MOVE not added on second call, no-op when decision file missing
- [x] T029 Add `ANTHROPIC_API_KEY=sk-ant-...` entry with description to `.env.example` (required for Defer resolution)
- [x] T030 Update `README.md` — add a "Triage Review UI" section: URL (`http://localhost:3333/triage`), three resolution paths summary, `ANTHROPIC_API_KEY` requirement for Defer
- [x] T031 Run `npm test && npm run lint` from repo root and fix any TypeScript compilation errors, lint violations, or test failures introduced by this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — the MVP; can demo after this phase
- **Phase 4 (US2)**: Depends on Phase 2 (uses `resolveHQItem`); US1 recommended first for UI context
- **Phase 5 (US3)**: Depends on Phase 2; independent of US2 and US4
- **Phase 6 (US4)**: Depends on Phase 2; independent of US2 and US3
- **Phase 7 (US5)**: Depends on Phase 3 (extends `app.js` poll behaviour)
- **Phase 8 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Requires Foundational complete — no story dependencies
- **US2 (P2)**: Requires Foundational complete — no story dependencies
- **US3 (P3)**: Requires Foundational complete — no story dependencies
- **US4 (P4)**: Requires Foundational complete — no story dependencies
- **US5 (P5)**: Requires US1 complete (extends `app.js`)

### Within Each User Story

- Services / file helpers before route handlers
- Route handlers before client-side JS integration
- Core write path before error handling

---

## Parallel Execution Examples

### Phase 3 (US1) — T010 and T011 can start immediately in parallel:

```
Task: "Write styles.css dark theme in src/auth-server/triage/public/styles.css"
Task: "Write index.html two-panel shell in src/auth-server/triage/public/index.html"
```

### Phases 4–6 can start in parallel once Phase 2 is complete:

```
Task: "Write archive-action.ts and handleDone (US2)"
Task: "Write DeferEnrichmentService skeleton (US3)"
Task: "Implement handleDelegate (US4)"
```

### Phase 8 test tasks can all run in parallel:

```
Task: "Unit tests for TriageRouter in tests/unit/triage/triage-router.test.ts"
Task: "Unit tests for DeferEnrichmentService in tests/unit/triage/defer-enrichment.test.ts"
Task: "Unit tests for archive-action.ts in tests/unit/triage/archive-action.test.ts"
```

---

## Implementation Strategy

### MVP (User Story 1 only — Phases 1–3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (browse + select)
4. **STOP and validate**: Open `http://localhost:3333/triage`, confirm items load with badges, detail panel works, empty state shows
5. Demo to user — all subsequent stories layer on this base

### Incremental Delivery

1. Setup + Foundational → skeleton wired
2. US1 → **MVP: readable inbox** — demo-able
3. US2 → **+Done: one-click resolution**
4. US3 → **+Defer: LLM task creation**
5. US4 → **+Delegate: pipeline hand-off**
6. US5 → **+Auto-refresh: live queue**
7. Polish → tests, docs, edge cases

---

## Notes

- `[P]` tasks touch different files — safe to run concurrently
- Static files (`index.html`, `app.js`, `styles.css`) are served from `src/auth-server/triage/public/` relative to `process.cwd()` — no build copy step needed
- `ANTHROPIC_API_KEY` must be in `.env` before testing Defer (US3)
- All HQ item writes use `proper-lockfile` to avoid races with the pipeline
- Pre-022 HQ items lacking `source`/`title` in frontmatter are shown with fallback values — full backwards compatibility required
