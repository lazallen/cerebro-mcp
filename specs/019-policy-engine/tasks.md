# Tasks: Policy Engine

**Input**: Design documents from `/specs/019-policy-engine/`
**Branch**: `019-policy-engine` | **Date**: 2026-02-19

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.
No tests were requested in the specification, so test tasks are included only at key checkpoints to verify story acceptance criteria.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on concurrent tasks)
- **[Story]**: User story this task belongs to (US1–US9 from spec.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies, create directory scaffolding, establish shared type contracts.

- [x] T001 Add `@anthropic-ai/sdk` and `zod` to package.json dependencies (run `npm install @anthropic-ai/sdk zod`)
- [x] T002 Create directory `src/lib/policy/` with empty `index.ts` placeholder
- [x] T003 [P] Create directory `src/lib/triage/` with empty `index.ts` placeholder
- [x] T004 [P] Create directory `src/services/enrichment/` with empty placeholder files `local-enrichment-service.ts` and `claude-enrichment-service.ts`
- [x] T005 Copy `specs/019-policy-engine/contracts/types.ts` to `src/lib/policy/types.ts` as the authoritative type source

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user story can start.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Implement Predicate DSL interpreter in `src/lib/policy/predicate.ts` — evaluates `Predicate` trees against a `TriageEvent` using dot-path resolution; missing paths → `false`; supports all operators from `LeafOp` (eq, neq, contains, matches, in, domain_in, gte, lte)
- [x] T007 Implement Policy YAML loader with Zod validation in `src/lib/policy/policy-loader.ts` — loads YAML from file path, parses with `js-yaml`, validates against `Policy` Zod schema, throws `ConfigurationError` on invalid config; never silently defaults
- [x] T008 [P] Implement shared atomic artifact writer in `src/lib/triage/artifact-writer.ts` — wraps existing `EventWriter` pattern (temp file + atomic rename + proper-lockfile); builds frontmatter markdown from typed interfaces using `gray-matter`; exposes `writeArtifact(dir, filename, frontmatter, body)` and `readArtifact(filepath)` helpers
- [x] T009 [P] Implement idempotency key generator in `src/lib/policy/idempotency.ts` — generates stable string `event:<eventId>:action:<type>:policy:<version>:v1` for each `ResolvedAction`; keys must be identical on repeated calls for identical input
- [x] T010 Update `src/services/heartbeat/heartbeat-service.ts` `start()` method: change `eventsDir = \`\${config.rootDir}/events\`` to `eventsDir = \`\${config.rootDir}/system/triage\``; ensure `system/triage/`, `system/decisions/`, `system/human/`, `system/runs/`, `system/artifacts/tasks/`, `system/artifacts/reading-packs/`, `system/artifacts/drafts/` directories are all created on startup via `fs.mkdir(..., { recursive: true })`
- [x] T011 Update `src/services/heartbeat/heartbeat-service.ts` `handleConfigReload()` method: apply the same `system/triage/` path change to the second `eventsDir` assignment
- [x] T012 Export public API from `src/lib/policy/index.ts` — re-export from `types.ts`, `predicate.ts`, `policy-loader.ts`, `idempotency.ts`, `evaluator.ts` (stub), `safety-gates.ts` (stub), `conflict-resolver.ts` (stub)
- [x] T013 [P] Export public API from `src/lib/triage/index.ts` — re-export from `types.ts` (via policy), `artifact-writer.ts`, `triage-event-store.ts` (stub), `decision-store.ts` (stub), `human-queue-store.ts` (stub), `run-log-writer.ts` (stub)

**Checkpoint**: Foundation complete. All type definitions, predicate evaluation, and shared I/O utilities are ready.

---

## Phase 3: User Story 1 — Auto-triage Low-Signal Events (Priority: P1) 🎯 MVP

**Goal**: Newsletter, receipt, and spam events are automatically classified and actioned in one heartbeat cycle with no manual intervention.

**Independent Test**: Run the engine against fixture events in `specs/019-policy-engine/fixtures/emails/` using the default policy. Verify newsletter_1 → NEWSLETTER, receipt_1 → RECEIPT, spam_1 → SPAM; all produce terminal decisions with confidence ≥ 0.9 and correct action types.

### Implementation

- [x] T014 [US1] Implement `PolicyEvaluator` in `src/lib/policy/evaluator.ts` — `evaluate(policy, events)` method; sorts rules by priority descending (stable on ties by index); evaluates each rule's `when` predicate via `predicate.ts`; applies `setClassification` on match; collects actions with `idempotencyKey` from `idempotency.ts`; stops further rule evaluation when `terminal: true`; returns `PolicyDecision[]`
- [x] T015 [P] [US1] Implement `TriageEventStore` in `src/lib/triage/triage-event-store.ts` — `listEvents(statuses)` reads all `.md` files from `system/triage/`, parses frontmatter via `artifact-writer.ts`, filters by status, returns sorted by `receivedAt`; `getEvent(eventId)` reads one file; `saveEvent(event)` writes/overwrites frontmatter scalars while appending pass history to body (never overwrites existing `## Evaluation History` sections)
- [x] T016 [P] [US1] Implement `DecisionStore` in `src/lib/triage/decision-store.ts` — `saveDecision(decision)` writes `PolicyDecision` as frontmatter markdown to `system/decisions/<eventId>-<timestamp>.md`; `listPendingDecisions()` reads all decisions where `actionsApplied: false`; `markActionApplied(eventId, idempotencyKey, appliedAt)` updates the specific action's `applied` flag and `appliedAt` in the file
- [x] T017 [US1] Write unit tests for core evaluator in `tests/unit/policy/evaluator.test.ts` — test newsletter fixture → NEWSLETTER intent (terminal), receipt fixture → RECEIPT intent (terminal), spam fixture → SPAM intent (terminal); test priority ordering (higher priority rule evaluated first); test terminal flag stops further evaluation; test identical-input determinism (run twice, compare JSON)
- [x] T018 [US1] Write unit tests for predicate DSL in `tests/unit/policy/predicate.test.ts` — test each operator: `eq`, `neq`, `contains`, `matches` (regex), `in`, `domain_in`, `gte`, `lte`; test `all`/`any`/`not` composition; test missing path → `false` (no throw); test short-circuit (all stops on first false; any stops on first true)

**Checkpoint**: User Story 1 is independently functional. Core classification loop proven on high-confidence fixture events.

---

## Phase 4: User Story 2 — Safety Gates Block Risky Automation (Priority: P1)

**Goal**: Low-confidence or high-risk events always produce `ASK_HUMAN`; `MOVE`/`ARCHIVE` is always suppressed when `ASK_HUMAN` is present; `DRAFT_REPLY` always carries `requiresApproval: true`.

**Independent Test**: Run engine against a fixture with `extracted.confidence: 0.5` (below `approvalThreshold: 0.75`). Verify `ASK_HUMAN` appears and no `MOVE`/`ARCHIVE` action is present. Run against a fixture classified `HIGH` risk from an unknown sender — verify same result.

### Implementation

- [x] T019 [US2] Implement safety gates in `src/lib/policy/safety-gates.ts` — post-evaluation pass over `PolicyDecision.actions`; applies four gates: (1) low-confidence gate: if `classification.confidence < policy.defaults.approvalThreshold` and no explicit rule override, append `ASK_HUMAN`; (2) high-risk gate: if `risk === HIGH` and sender not in `senderAllowlist`, ensure `ASK_HUMAN` present; (3) draft-reply gate: unconditionally set `requiresApproval: true` on every `DRAFT_REPLY` action; (4) no-config path may remove requirement — enforced in code; records each gate application as a `GateOutcome` in the trace
- [x] T020 [US2] Implement conflict resolver in `src/lib/policy/conflict-resolver.ts` — if `policy.defaults.conflictResolution.askHumanBlocksMoveToArchive` is true and `ASK_HUMAN` is present in actions, remove all `MOVE` and `LABEL`-to-archive actions; records suppressed actions as `GateOutcome` entries with `actionSuppressed` field set
- [x] T021 [US2] Wire safety gates and conflict resolver into `evaluator.ts` — after all rules evaluated for an event, call `applySafetyGates(decision, policy)` then `resolveConflicts(decision, policy)` before returning; gates and resolver are pure functions (no I/O)
- [x] T022 [P] [US2] Write unit tests for safety gates in `tests/unit/policy/safety-gates.test.ts` — test low-confidence → ASK_HUMAN appended; test high-risk unknown sender → ASK_HUMAN present; test DRAFT_REPLY always gets requiresApproval; test allowlisted sender + explicit rule override suppresses ASK_HUMAN on high-risk
- [x] T023 [P] [US2] Write unit tests for conflict resolver in `tests/unit/policy/conflict-resolver.test.ts` — test ASK_HUMAN + MOVE → MOVE suppressed; test ASK_HUMAN alone → no suppression; test no ASK_HUMAN + MOVE → MOVE preserved; test gate outcome recorded with actionSuppressed field

**Checkpoint**: User Stories 1 and 2 complete. Engine classifies events AND enforces safety gates correctly.

---

## Phase 5: User Story 3 — Multi-Source Events Handled Uniformly (Priority: P1)

**Goal**: Email, calendar, Slack, and journal events all flow through the same rule evaluator and produce valid `PolicyDecision` artifacts using the same taxonomy. No source requires special-case evaluation logic.

**Independent Test**: Run engine against one fixture per source type (email, calendar, Slack, journal) using the default policy. Verify all four produce a `PolicyDecision` with a valid `intent`, `urgency`, `risk`, and at least one action — without throwing on missing source-specific fields.

### Implementation

- [x] T024 [US3] Create `email-ingestion-task.ts` in `src/services/heartbeat/tasks/` — refactored from `email-triage-task.ts`; removes `moveEmail` call; retains signal computation (`isAutomated`, `isBulk`, `hasUnsubscribe`, `hasAttachments`, `mentionsMoney`, `mentionsMeeting`, `asksForAction`, `prioritySender`); writes `TriageEvent` artifact to `system/triage/` via `TriageEventStore`; sets `status: pending` and `extracted: {}` — no LLM calls in ingestion
- [x] T025 [P] [US3] Update `journal-triage-task.ts` in `src/services/heartbeat/tasks/` to write `TriageEvent` artifacts to `system/triage/` using `TriageEventStore` instead of writing directly to `eventsDir`; map journal entry fields to `TriageEventCommon` fields (`title` = entry date, `author` = system, `source: 'journal'`)
- [x] T026 [US3] Register `email-ingestion` task type in `src/services/heartbeat/tasks/task-registry.ts` — add registration block alongside existing `email-triage` and `journal-triage` entries; `email-ingestion` uses same `graphClient` and new `TriageEventStore` dependency
- [x] T027 [P] [US3] Define signal extension points in `src/lib/triage/signal-definitions.ts` — export `computeCalendarSignals(sourceData)` and `computeSlackSignals(sourceData)` stub functions returning partial `EventSignals`; these are stubs (return all `false`) to be implemented when those ingestion tasks are built; document expected `sourceData` shape for each source type

**Checkpoint**: All three P1 user stories complete. The evaluation core (US1), safety gates (US2), and multi-source normalisation (US3) are all functional.

---

## Phase 6: User Story 4 — Multi-Pass Enrichment and Re-evaluation (Priority: P2)

**Goal**: An event evaluated twice (sparse context, then enriched) produces a traceable second decision that reflects the enrichment; prior passes are preserved, never overwritten.

**Independent Test**: Call `TriageEventStore.saveEvent()` twice for the same event — once with `extracted: {}`, once with `extracted.intent: ACTION_REQUIRED, confidence: 0.88`. Verify: (a) second call appends a new `### Pass N` section without modifying the first; (b) `passCount` increments; (c) engine evaluation on the enriched event produces `ACTION_REQUIRED` intent.

### Implementation

- [x] T028 [US4] Update `TriageEventStore.saveEvent()` in `src/lib/triage/triage-event-store.ts` to implement append-only `EvaluationPass` history — on update, read existing file body; find or create `## Evaluation History` section; append new `### Pass N — {timestamp} (policy: {id}@{version})` subsection with decision summary; overwrite only frontmatter scalars (`passCount`, `latestPassTimestamp`, `status`, `extracted_*`, `latest_decision_*`); never remove existing pass sections
- [x] T029 [US4] Update `PolicyEvaluator.evaluate()` in `src/lib/policy/evaluator.ts` to accept optional `humanAnswers: Map<string, string>` parameter — when evaluating predicates against an event that has a resolved `ASK_HUMAN` answer recorded in its passes, include the answer in the evaluation context so the fallback rule does not re-trigger for the same question
- [x] T030 [US4] Write unit tests for multi-pass re-evaluation in `tests/unit/policy/evaluator.test.ts` — test sparse event (no extracted fields) → UNKNOWN; same event enriched with ACTION_REQUIRED confidence 0.88 → ACTION_REQUIRED; verify both passes recorded in event; verify determinism of second pass

**Checkpoint**: Multi-pass evaluation proven. Events can be re-evaluated as context arrives without losing history.

---

## Phase 7: User Story 5 — Action-Required Events Create Tasks (Priority: P2)

**Goal**: Events with `ACTION_REQUIRED` intent produce a task artifact in `system/artifacts/tasks/` with subject, source, date, and a link to the origin event. No `MOVE`/`ARCHIVE` action is present.

**Independent Test**: Run engine against `action_required_1.json` fixture. Verify `CREATE_TASK` action in decision; verify a `.md` file written to `system/artifacts/tasks/` with correct title and `eventRef` link; verify no MOVE action present.

### Implementation

- [x] T031 [US5] Implement task artifact writer in `src/lib/triage/task-writer.ts` — `createTask(event, action, systemDir)` writes a Markdown note to `system/artifacts/tasks/YYYYMMDD-task-<counter>.md` with frontmatter (`source`, `eventRef`, `createdAt`) and body (title from event `title`, source system link, received date); uses `artifact-writer.ts` for atomic write
- [x] T032 [US5] Implement `CREATE_TASK` executor handler in the executor stage of `src/services/heartbeat/tasks/policy-pipeline-task.ts` (skeleton executor loop) — when action type is `CREATE_TASK`, call `TaskWriter.createTask()`; record idempotency key as applied in `DecisionStore`; log creation via pino

**Checkpoint**: Task creation from ACTION_REQUIRED events is functional end-to-end.

---

## Phase 8: User Story 6 — FYI Events Build a Reading Pack (Priority: P2)

**Goal**: FYI events from non-priority senders are added to a dated reading pack note and archived. FYI events from priority senders are added to the reading pack but not archived. Multiple FYI events in one run are consolidated into a single dated note.

**Independent Test**: Run engine against `fyi_1.json` fixture (non-priority sender). Verify `CREATE_READING_PACK` + `MOVE` actions in decision; verify reading pack note at `system/artifacts/reading-packs/YYYY-MM-DD.md` has an entry; run a second FYI event in the same cycle — verify both entries in the same note (not two separate files).

### Implementation

- [x] T033 [US6] Implement reading pack writer in `src/lib/triage/reading-pack-writer.ts` — `appendEntry(event, action, systemDir)` appends a formatted entry to `system/artifacts/reading-packs/YYYY-MM-DD.md`; creates file if absent, appends if present; entry format: `## {title} — {author}`, received date, source, summary snippet; uses `artifact-writer.ts` pattern (read → append → write atomically via lockfile)
- [x] T034 [US6] Implement `CREATE_READING_PACK` executor handler in `src/services/heartbeat/tasks/policy-pipeline-task.ts` executor loop — call `ReadingPackWriter.appendEntry()`; record idempotency key as applied

**Checkpoint**: FYI events routed to reading pack notes. Multi-event consolidation into single daily note confirmed.

---

## Phase 9: User Story 7 — Human Queue for Approvals and Decisions (Priority: P2)

**Goal**: Ambiguous or high-risk events generate `ask_human` items in `system/human/`; low-confidence events generate `claude_approval` items. Resolved items automatically trigger re-evaluation on the next heartbeat cycle.

**Independent Test**: (a) Run engine against a fixture with `extracted.confidence: 0.5` — verify `ask_human` item written to `system/human/`. (b) Manually set that item's `status: resolved` with an `answer`. (c) Run pipeline again — verify parent event re-evaluated using the answer as context and `ask_human` item advanced to `status: complete`.

### Implementation

- [x] T035 [US7] Implement `HumanQueueStore` in `src/lib/triage/human-queue-store.ts` — `createItem(item)` writes `HumanQueueItem` as frontmatter markdown to `system/human/hq_YYYYMMDD_<counter>.md` via `artifact-writer.ts`; `listByStatus(statuses)` reads all `.md` files from `system/human/` and filters by frontmatter `status`; `updateItemStatus(id, status, answer?)` reads file, updates frontmatter scalars, writes atomically (preserves body)
- [x] T036 [US7] Implement `ASK_HUMAN` action writer in evaluator post-processing — when `PolicyDecision` contains `ASK_HUMAN` action, write a `HumanQueueItem` with `itemType: ask_human`, `question` from action params, `eventRef`, `status: pending`, `createdAt` via `HumanQueueStore`
- [x] T037 [US7] Implement `HumanQueueProcessor` in `src/lib/triage/human-queue-processor.ts` — `processResolved(systemDir, evaluator, policy)` scans `system/human/` for items with `status: resolved | approved | declined`; for `resolved` items (ask_human): re-read parent event, add answer to evaluation context, call `evaluator.evaluate()`, update event passes, advance queue item to `status: complete`; for `approved`/`declined` items (claude_approval): handled by enrichment stage — set `status: complete` after enrichment runs or declines
- [x] T038 [P] [US7] Write unit tests for `HumanQueueStore` in `tests/unit/triage/human-queue-store.test.ts` — test create item → file written with correct frontmatter; test listByStatus filters correctly; test updateItemStatus preserves body; test status lifecycle transitions

**Checkpoint**: Human escalation queue fully functional. Resolved items re-trigger evaluation automatically.

---

## Phase 10: User Story 8 — LLM-Assisted Enrichment with Cost Control (Priority: P2)

**Goal**: Every new triage event is enriched by phi-4-mini before policy evaluation. Events with confidence < `claudeRecommendThreshold` get a `claude_approval` item. Once approved, Claude enriches the event programmatically on the next cycle — no further user action needed.

**Independent Test**: (a) Create a pending triage event; run enrichment stage — verify `extracted.intent`, `extracted.confidence`, `extracted.llmTier: local` written back to event. (b) Set confidence to 0.4 (below threshold) — verify `claude_approval` item appears in `system/human/`. (c) Set that item `status: approved` — run next cycle — verify Claude enrichment runs and writes `extracted.claudeEnriched: true`. (d) Create `claude_approval` item without prior `status: approved` — verify Claude is NOT invoked.

### Implementation

- [x] T039 [US8] Implement `LocalEnrichmentService` in `src/services/enrichment/local-enrichment-service.ts` — uses existing `LocalFoundryClient`; sends structured JSON-output prompt to phi-4-mini with event `title`, `snippet`, and `signals`; truncates to 1,500 tokens if body exceeds limit and sets `truncated: true`; returns `EnrichmentResult` with `intent`, `confidence`, `summary`, `entities`; never throws — returns `confidence: 0` with error logged on failure
- [x] T040 [US8] Implement `ClaudeEnrichmentService` in `src/services/enrichment/claude-enrichment-service.ts` — uses `@anthropic-ai/sdk`; `enrich(event, approvalItemId)` first calls `HumanQueueStore.listByStatus(['approved'])` and verifies `approvalItemId` corresponds to an approved item — **throws `UnauthorizedEnrichmentError` if not found**; invokes `claude-haiku-4-5-20251001` with richer prompt including cross-event context field; writes `extracted.claudeEnriched: true`, `extracted.claudeApprovalRef: approvalItemId`; configured from `ANTHROPIC_API_KEY` env var
- [x] T041 [US8] Implement full `PolicyPipelineTask` orchestrator in `src/services/heartbeat/tasks/policy-pipeline-task.ts` — implements `TaskHandler` interface; `execute(taskConfig)` runs all 7 pipeline stages in order: (1) scan `system/triage/` for pending/enriched events; (2) run local enrichment on `status: pending` events; (3) check `system/human/` for `claude_approval` items with `status: approved`, run Claude enrichment; (4) call `HumanQueueProcessor.processResolved()` to handle ask_human resolutions; (5) call `PolicyEvaluator.evaluate()` on all enriched events; (6) write decisions via `DecisionStore`; (7) execute pending decisions (LABEL, MOVE, CREATE_TASK, CREATE_READING_PACK, ASK_HUMAN, DRAFT_REPLY); (8) write `RunLog` via `RunLogWriter`
- [x] T042 [US8] Register `policy-pipeline` task type in `src/services/heartbeat/tasks/task-registry.ts` — add registration block using `microsoftService`, `rootDir`, `localFoundryClient`, and optional `anthropicApiKey` from env
- [x] T043 [US8] Add `PolicyPipelineConfig` to `src/types/heartbeat.ts` — extend task config union to include `PolicyPipelineConfig` from `contracts/types.ts`; add `'policy-pipeline'` to the task type discriminator
- [x] T044 [P] [US8] Add `policy-pipeline` example task to `heartbeat-config.example.json` with schedule `"5 * * * *"`, enabled `false`, and representative config values
- [x] T045 [P] [US8] Write unit tests for local enrichment in `tests/unit/enrichment/local-enrichment.test.ts` — mock LocalFoundryClient; test truncation at 1,500 tokens; test failure returns confidence 0 without throwing; test `extracted.llmTier: local` set correctly

**Checkpoint**: Full pipeline functional end-to-end. LLM enrichment, policy evaluation, execution, and human queue are all wired together.

---

## Phase 11: User Story 9 — Full Audit Trail for Every Decision (Priority: P3)

**Goal**: Every decision has a trace listing every rule evaluated, predicate outcomes, gate results, and LLM tier used. A run log is written to `system/runs/` for every heartbeat cycle.

**Independent Test**: Run the full pipeline; open `system/runs/<run_id>.md` — verify frontmatter has correct `eventsProcessed`, `claudeApprovalsRequested` counts; verify body lists all decisions; verify an ASK_HUMAN event has a detailed trace section. Open a `system/decisions/<event>.md` — verify trace includes rule evaluations with matched/not-matched entries.

### Implementation

- [x] T046 [US9] Implement `RunLogWriter` in `src/lib/triage/run-log-writer.ts` — `writeRunLog(entry, systemDir)` writes `RunLogEntry` as frontmatter markdown to `system/runs/run_YYYYMMDD_<counter>.md`; body includes: policy version, summary table (eventsProcessed, actioned, humanItems, claudeApprovals), and a `## Decision Details` section with intent + action types per event; for `hasHumanItem: true` or HIGH risk events: include full trace in a `### Trace` subsection
- [x] T047 [US9] Add detailed `RuleTraceEntry` recording to `evaluator.ts` — for each rule evaluated, record: `ruleId`, `priority`, `matched`, full `predicateResult` tree (from `predicate.ts` evaluation), `terminal`; include in `PolicyDecision.trace`
- [x] T048 [US9] Add `GateOutcome` recording to `safety-gates.ts` — for each gate that fires, push a `GateOutcome` entry with `gate`, `applied`, `reason`, and `actionSuppressed` (if applicable); store in `RuleTraceEntry.gateOutcomes` for the relevant rule (or append as a top-level trace entry if no matching rule)
- [x] T049 [P] [US9] Write unit tests for `RunLogWriter` in `tests/unit/triage/run-log-writer.test.ts` — test run log file created with correct frontmatter; test HIGH-risk decision includes full trace; test LLM tier and confidence recorded in trace

**Checkpoint**: All 9 user stories complete. Full audit trail proven across all event types and actions.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, integration validation, and quality gates.

- [x] T050 [P] Add `ANTHROPIC_API_KEY` to `.env.example` with description: `# Anthropic API key for Claude enrichment (optional — system works without it)`
- [x] T051 [P] Update `README.md` — add Policy Engine section with: overview, system/ directory layout, heartbeat-config.json example, policy YAML location, human queue workflow summary, link to `specs/019-policy-engine/quickstart.md`
- [x] T052 [P] Add JSDoc comments to all public interfaces in `src/lib/policy/index.ts` and `src/lib/triage/index.ts` — document `evaluate()`, `TriageEventStore`, `HumanQueueStore`, `DecisionStore` methods
- [x] T053 Write integration test in `tests/integration/policy-pipeline.test.ts` — mounts a temporary `system/` directory; runs the full `PolicyPipelineTask.execute()` against all 6 fixture events from `specs/019-policy-engine/fixtures/emails/`; asserts: correct intent per fixture, no MOVE actions when ASK_HUMAN present, run log created in `system/runs/`, idempotency (second run produces 0 new actions)
- [x] T054 Run `npm test && npm run lint`; fix any TypeScript errors, lint failures, or coverage gaps below 80% for `src/lib/policy/` and `src/lib/triage/`
- [x] T055 Validate `quickstart.md` — follow the guide end-to-end against a local `heartbeat-config.json` instance; confirm all paths and task configurations match the implemented system

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user story phases**
- **Phase 3 (US1 — P1)**: Depends on Phase 2; no story dependencies
- **Phase 4 (US2 — P1)**: Depends on Phase 3 (extends evaluator.ts)
- **Phase 5 (US3 — P1)**: Depends on Phase 2; parallel with Phase 3/4
- **Phase 6 (US4 — P2)**: Depends on Phase 3 (extends TriageEventStore + evaluator)
- **Phase 7 (US5 — P2)**: Depends on Phase 3; parallel with Phase 6
- **Phase 8 (US6 — P2)**: Depends on Phase 3; parallel with Phases 6/7
- **Phase 9 (US7 — P2)**: Depends on Phase 4 (ASK_HUMAN gate must exist)
- **Phase 10 (US8 — P2)**: Depends on Phases 3, 4, 6, 7, 8, 9 (orchestrates all stages)
- **Phase 11 (US9 — P3)**: Depends on Phase 10 (needs full pipeline to verify audit trail)
- **Phase 12 (Polish)**: Depends on Phase 11

### User Story Dependencies

| Story | Priority | Depends On | Can Parallelise With |
|-------|----------|------------|---------------------|
| US1 — Auto-triage | P1 | Foundation | US3 (after Foundation) |
| US2 — Safety Gates | P1 | US1 (extends evaluator) | — |
| US3 — Multi-source | P1 | Foundation | US1 |
| US4 — Multi-pass | P2 | US1 | US5, US6 |
| US5 — Task creation | P2 | US1 | US4, US6 |
| US6 — Reading pack | P2 | US1 | US4, US5 |
| US7 — Human queue | P2 | US2 | after US2 |
| US8 — LLM enrichment | P2 | US1–US7 all | — |
| US9 — Audit trail | P3 | US8 | — |

### Parallel Opportunities

```bash
# Phase 1: All setup tasks in parallel
T002, T003, T004 can run simultaneously (different dirs, no deps)

# Phase 2: Some foundational tasks in parallel
T006 predicate.ts + T007 policy-loader.ts + T008 artifact-writer.ts + T009 idempotency.ts

# After Phase 2 completes: P1 stories can interleave
T014 evaluator.ts + T015 TriageEventStore + T016 DecisionStore (US1, all parallel)
T024 email-ingestion-task + T025 journal-triage-task + T027 signal-definitions (US3, parallel)

# P2 stories after US1: US4/US5/US6 all parallel (different files)
T028 EvaluationPass history + T031 task-writer + T033 reading-pack-writer

# Test tasks within a story: all [P] tests parallel
T017 + T018 (US1 unit tests, parallel)
T022 + T023 (US2 unit tests, parallel)
```

---

## Implementation Strategy

### MVP: User Stories 1–3 (All P1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical gate)
3. Complete Phase 3: US1 — evaluator + stores + newsletter/receipt/spam working
4. Complete Phase 4: US2 — safety gates + conflict resolver
5. Complete Phase 5: US3 — email-ingestion-task refactored; multi-source signal normalisation
6. **STOP and VALIDATE**: Run against all 6 email fixtures; confirm all produce correct decisions; confirm no MOVE when ASK_HUMAN present

### Full System (P2 + P3 stories)

7. US4 multi-pass + US5 task creation + US6 reading pack (can interleave)
8. US7 human queue
9. US8 full pipeline orchestrator (wires all prior work)
10. US9 audit trail + run logs
11. Phase 12: Polish, docs, integration tests, lint/type check

### Parallel Team Strategy

With two developers:
- **Dev A**: Phase 1 + 2 together, then US1 + US2 (core evaluation)
- **Dev B**: Phase 1 + 2 together, then US3 (ingestion refactor) + US4 (multi-pass)
- Both converge on US7 (human queue) and US8 (orchestrator)

---

## Task Summary

| Phase | Tasks | Notes |
|-------|-------|-------|
| Phase 1: Setup | T001–T005 | 5 tasks; T003/T004 parallel |
| Phase 2: Foundation | T006–T013 | 8 tasks; T008/T009/T013 parallel |
| Phase 3: US1 (P1) | T014–T018 | 5 tasks; T015/T016/T017/T018 parallel |
| Phase 4: US2 (P1) | T019–T023 | 5 tasks; T022/T023 parallel |
| Phase 5: US3 (P1) | T024–T027 | 4 tasks; T025/T027 parallel |
| Phase 6: US4 (P2) | T028–T030 | 3 tasks |
| Phase 7: US5 (P2) | T031–T032 | 2 tasks |
| Phase 8: US6 (P2) | T033–T034 | 2 tasks |
| Phase 9: US7 (P2) | T035–T038 | 4 tasks; T038 parallel |
| Phase 10: US8 (P2) | T039–T045 | 7 tasks; T044/T045 parallel |
| Phase 11: US9 (P3) | T046–T049 | 4 tasks; T049 parallel |
| Phase 12: Polish | T050–T055 | 6 tasks; T050/T051/T052 parallel |
| **Total** | **T001–T055** | **55 tasks** |

---

## Notes

- `[P]` tasks operate on different files with no in-flight dependencies — safe to run simultaneously
- `[Story]` label enables traceability from task → user story → acceptance criteria in spec.md
- Each phase checkpoint is independently verifiable without completing later phases
- The MVP (P1 stories, Phases 1–5) delivers a working policy engine that classifies and gates events — valuable without LLM enrichment
- Phase 10 (US8, orchestrator) wires everything together — complete all prior phases before starting it
- The existing `email-triage-task.ts` is superseded by `email-ingestion-task.ts` (T024); keep the old file until T026 (registry update) is complete to avoid breaking the heartbeat service
