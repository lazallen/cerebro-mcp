# Task Breakdown: Smart Meeting Scheduler (Feature 023)

**Spec**: `specs/023-smart-meeting-scheduler/spec.md`
**Plan**: `specs/023-smart-meeting-scheduler/plan.md`
**Total tasks**: 27

---

## Phase 1 — Setup (all parallel)

---

## T001 — Add smart-meetings TypeScript types

**Phase**: 1
**Depends on**: none
**Parallelisable with**: T002, T003, T004
**Files**:
- CREATE `src/types/smart-meetings.ts`

**Acceptance**: File compiles without errors and exports all interfaces specified in `data-model.md`: `DayOfWeek`, `MeetingFrequency`, `MeetingWindow`, `MeetingCadence`, `MeetingDefinition`, `MeetingHistory`, `CadenceDebt`, `TimePortfolioSettings`, `SmartMeetingsConfig`, `WeeklyPortfolioSlice`, `PortfolioImbalanceWarning`, `TimePortfolioSummary`, `MeetingStatus`, `SmartMeetingsStatusResponse`, `SmartMeetingTaskConfig`

---

## T002 — Extend TaskType union

**Phase**: 1
**Depends on**: none
**Parallelisable with**: T001, T003, T004
**Files**:
- MODIFY `src/types/heartbeat.ts` — append `'smart-meeting-scheduler'` to `TaskType` union

**Acceptance**: `TaskType` includes `'smart-meeting-scheduler'` and `npm run build` passes

---

## T003 — Add smart-meeting-scheduler to config-loader supportedTypes

**Phase**: 1
**Depends on**: none
**Parallelisable with**: T001, T002, T004
**Files**:
- MODIFY `src/services/heartbeat/config-loader.ts` — add `'smart-meeting-scheduler'` to `supportedTypes` array and its error message description

**Acceptance**: A `heartbeat-config.json` task entry with `type: 'smart-meeting-scheduler'` passes validation without throwing

---

## T004 — Add heartbeat-config.json entries

**Phase**: 1
**Depends on**: none
**Parallelisable with**: T001, T002, T003
**Files**:
- MODIFY `heartbeat-config.json` — add `smart-meeting-forward` (cron `0 7 * * 1-5`) and `smart-meeting-rebalance` (cron `0 8 * * 1`) task entries

**Acceptance**: Both entries are present with correct `type`, `schedule`, `enabled: false` (safe default until implementation is complete), and `config.phase` / `config.configPath` fields

---

## Phase 2 — Core Task (sequential)

---

## T005 — Implement smart-meetings service utilities

**Phase**: 2
**Depends on**: T001
**Parallelisable with**: T006 (T006 depends on T005, but within phase T005 is a prerequisite)
**Files**:
- CREATE `src/services/smart-meetings/config-io.ts` — `loadSmartMeetingsConfig`, `saveSmartMeetingsConfig`
- CREATE `src/services/smart-meetings/portfolio-ref.ts` — `PortfolioRef` interface, `createPortfolioRef()`
- CREATE `src/services/smart-meetings/cadence-debt.ts` — `calculateCadenceDebt(meeting)`, `sortByDebtDesc(meetings)`
- CREATE `src/services/smart-meetings/portfolio-calculator.ts` — `calcTimePortfolio(events, meetings, settings)` returning `TimePortfolioSummary`

**Acceptance**: `npm run build` compiles all four files with no errors; `calculateCadenceDebt` returns correct `targetHorizonDays` for all four debt brackets

---

## T006 — Implement SmartMeetingSchedulerTask and register it

**Phase**: 2
**Depends on**: T005, T002
**Parallelisable with**: none in phase (must follow T005)
**Files**:
- CREATE `src/services/heartbeat/tasks/smart-meeting-scheduler-task.ts` — `SmartMeetingSchedulerTask implements TaskHandler`, with `runForwardScheduling` and `runRebalance` methods
- MODIFY `src/services/heartbeat/tasks/task-registry.ts` — add `portfolioRef` to `createTaskRegistry` dependencies parameter; register `smart-meeting-scheduler` handler when `microsoftService && portfolioRef` are present

**History status retroactive update** (must run at the start of `runForwardScheduling` before debt calculation):
1. For each meeting, find any `history[]` entries with `status: 'scheduled'` and a `date` in the past
2. For each such entry, query `calendarView` for a ±1h window around the scheduled time
3. If a matching event is found (title substring match AND attendee match) → set `status: 'occurred'`
4. If no matching event is found (meeting was cancelled) → set `status: 'skipped'`
5. Persist updated history to `smart-meetings-config.json`
This ensures cadence debt is calculated from confirmed occurrences, not stale scheduled entries.

**Acceptance**: `npm run build` passes; task registry registers the handler without error when dependencies are supplied; forward-scheduling and rebalance branches are reachable via `cfg.phase` discriminator

---

## Phase 3 — MCP Tool (depends on T003; parallel with Phase 4)

---

## T007 — Implement SmartMeetingsService

**Phase**: 3
**Depends on**: T001
**Parallelisable with**: T011, T012, T013, T014, T015, T016 (all Phase 4 tasks)
**Files**:
- CREATE `src/services/smart-meetings/smart-meetings-service.ts` — `SmartMeetingsService` class with `getToolDefinitions()` and `executeTool(name, args)` implementing `smart_meetings_status` per the contract in `contracts/smart-meetings-status.md`; reads config, calculates cadence debt, returns `SmartMeetingsStatusResponse`; falls back to `portfolioRef.current` when Graph is unavailable; handles `meetingId` filter; returns `isError: true` for config-not-found and meetingId-not-found cases

**Acceptance**: Class compiles; calling `executeTool('smart_meetings_status', {})` with a mocked config returns a correctly structured `SmartMeetingsStatusResponse`

---

## T008 — Create smart-meetings service barrel

**Phase**: 3
**Depends on**: T007
**Parallelisable with**: none (depends on T007)
**Files**:
- CREATE `src/services/smart-meetings/index.ts` — export `SmartMeetingsService`, `createPortfolioRef`, `PortfolioRef`

**Acceptance**: Other modules can `import { SmartMeetingsService } from '../services/smart-meetings'` and build succeeds

---

## T009 — Register SmartMeetingsService in service-registration

**Phase**: 3
**Depends on**: T008
**Parallelisable with**: none in this chain
**Files**:
- MODIFY `src/mcp-server/service-registration.ts` — import `SmartMeetingsService` and `createPortfolioRef`; create `portfolioRef` at startup; instantiate and register `SmartMeetingsService` when Microsoft credentials are present; export or attach `portfolioRef` so it can be passed to `HeartbeatService`
- MODIFY `src/index.ts` — pass `portfolioRef` into `HeartbeatService` constructor call (alongside existing `microsoftService`)

**Acceptance**: `npm run build` passes; the `smart_meetings_status` tool appears in the MCP server tool list when the server starts

---

## T010 — Add smart_meetings_status to Claude Code allowedTools

**Phase**: 3
**Depends on**: T009
**Parallelisable with**: none (final step of tool registration chain)
**Files**:
- MODIFY `~/.claude.json` — add `smart_meetings_status` to the `allowedTools` list for the cerebro-mcp MCP server entry

**Acceptance**: Claude Code can invoke `smart_meetings_status` without a permission prompt; tool appears in `/mcp` tool list

---

## Phase 4 — Dashboard (depends on T001; parallel with Phase 3)

---

## T011 — Implement SmartMeetingRouter

**Phase**: 4
**Depends on**: T001
**Parallelisable with**: T007, T008, T009, T010
**Files**:
- CREATE `src/auth-server/smart-meeting-router.ts` — `SmartMeetingRouter` class and `registerSmartMeetingRouter(server, deps)` export; serves `GET /smart-meetings` (HTML) and `GET /smart-meetings/api/status` (JSON `SmartMeetingsStatusResponse`); follows the same structural pattern as `TriageRouter`

**Acceptance**: `npm run build` passes; `GET /smart-meetings/api/status` returns valid JSON when config file exists

---

## T012 — Create dashboard HTML

**Phase**: 4
**Depends on**: T011
**Parallelisable with**: T013, T014 (can be drafted while T011 is reviewed, merged after)
**Files**:
- CREATE `src/auth-server/smart-meetings/index.html` — self-contained single-page dashboard; fetches `/smart-meetings/api/status` on load and on manual refresh; renders meeting table with columns: title, attendees, cadence, last occurrence, next scheduled, cadence debt (days); colours debt rows amber (1–13 days) and red (14+ days); disabled meetings greyed out and sorted to bottom; portfolio balance summary and imbalance warning banner at top

**Acceptance**: Page renders in browser without JS errors; all columns populate from live API data; amber/red/grey styling is applied correctly

---

## T013 — Create dashboard CSS

**Phase**: 4
**Depends on**: T011
**Parallelisable with**: T012, T014
**Files**:
- CREATE `src/auth-server/smart-meetings/styles.css` — OR inline in `index.html` (match `/triage` approach); defines colour classes for `debt-amber` (`#f59e0b`), `debt-red` (`#ef4444`), `disabled-meeting` (grey + opacity), `portfolio-warning-banner`

**Acceptance**: All colour classes are applied correctly by the HTML; visual output matches FR-024 and FR-025

---

## T014 — Create dashboard JavaScript

**Phase**: 4
**Depends on**: T011
**Parallelisable with**: T012, T013
**Files**:
- CREATE `src/auth-server/smart-meetings/app.js` — OR inline in `index.html`; `fetchStatus()` calls `/smart-meetings/api/status`; `renderMeetings(data)` sorts enabled meetings by `cadenceDebt.debtDays` DESC, appends disabled meetings; `renderPortfolio(data.timePortfolio)` renders balance summary and warning banner; auto-refresh on page load; manual refresh button

**Acceptance**: Data renders correctly from live API; page auto-refreshes without requiring server restart (FR-026 / User Story 5 acceptance 5)

---

## T015 — Wire SmartMeetingRouter into oauth-server.ts

**Phase**: 4
**Depends on**: T011
**Parallelisable with**: none within this chain (must follow T011)
**Files**:
- MODIFY `src/auth-server/oauth-server.ts` — add `private smartMeetingRouter?: SmartMeetingRouter`; add `registerSmartMeetingRouter(configPath: string, portfolioRef: PortfolioRef): void` method mirroring `registerTriageRouter`; route `GET /smart-meetings` and `GET /smart-meetings/api/status` to the router in the request handler

**Acceptance**: `GET https://localhost:3333/smart-meetings` returns the HTML dashboard; `GET https://localhost:3333/smart-meetings/api/status` returns JSON

---

## T016 — Wire SmartMeetingRouter into index.ts

**Phase**: 4
**Depends on**: T015, T009
**Parallelisable with**: none (depends on both T015 and T009)
**Files**:
- MODIFY `src/index.ts` — call `oauthServer.registerSmartMeetingRouter(configPath, portfolioRef)` after the existing `registerTriageRouter` call; derive `configPath` from `process.env['SMART_MEETINGS_CONFIG_FILE'] ?? './smart-meetings-config.json'`

**Acceptance**: Server starts without error; `https://localhost:3333/smart-meetings` is reachable and renders the dashboard

---

## Phase 5 — Portfolio Cache Wiring

---

## T017 — Pass portfolioRef through HeartbeatService to task registry

**Phase**: 5
**Depends on**: T006, T009
**Parallelisable with**: none (bridges Phase 2 task and Phase 3 service)
**Files**:
- MODIFY `src/services/heartbeat/heartbeat-service.ts` — add `portfolioRef` to the dependencies type accepted by `HeartbeatService`; pass it through to `createTaskRegistry`
- MODIFY `src/index.ts` — pass the `portfolioRef` instance (created in T009) into the `HeartbeatService` constructor

**Acceptance**: `SmartMeetingSchedulerTask` receives the same `portfolioRef` instance that `SmartMeetingsService` reads; rebalance pass writes to `portfolioRef.current`; `smart_meetings_status` tool returns the updated portfolio data on next call

---

## Phase 6 — Tests

---

## T018 — Unit tests: calculateCadenceDebt

**Phase**: 6
**Depends on**: T005
**Parallelisable with**: T019, T020, T021, T022, T023, T024
**Files**:
- CREATE `src/services/smart-meetings/__tests__/cadence-debt.test.ts`

**Acceptance**: All four debt brackets (≤0, 1–6, 7–13, ≥14) return correct `targetHorizonDays`; null history case returns `targetHorizonDays: 21`; `sortByDebtDesc` places highest debt first; `npm test` passes

---

## T019 — Unit tests: calcTimePortfolio

**Phase**: 6
**Depends on**: T005
**Parallelisable with**: T018, T020, T021, T022, T023, T024
**Files**:
- CREATE `src/services/smart-meetings/__tests__/portfolio-calculator.test.ts`

**Acceptance**: Categorisation correctly classifies recurring (recurrence flag), ad-hoc (attendees, no recurrence), and focus (no attendees / focus keyword) events; imbalance warning is raised when a category exceeds `imbalanceThresholdPct` for `imbalanceWindowWeeks` consecutive weeks; no warning when imbalance is only 1 week; `npm test` passes

---

## T020 — Unit tests: SmartMeetingsService tool response

**Phase**: 6
**Depends on**: T007
**Parallelisable with**: T018, T019, T021, T022, T023, T024
**Files**:
- CREATE `src/services/smart-meetings/__tests__/smart-meetings-service.test.ts`

**Acceptance**: `executeTool('smart_meetings_status', {})` returns `isError: false` with correct shape; `meetingId` filter returns only the matching meeting; config-not-found returns `isError: true`; stale-portfolio fallback returns `portfolioRef.current` value with sentinel warning; `npm test` passes

---

## T021 — Unit tests: SmartMeetingSchedulerTask forward-scheduling

**Phase**: 6
**Depends on**: T006
**Parallelisable with**: T018, T019, T020, T022, T023, T024
**Files**:
- CREATE `src/services/heartbeat/tasks/__tests__/smart-meeting-scheduler-task.test.ts`

**Acceptance**: Forward-scheduling phase creates an event when no matching event exists in the window; does NOT create a duplicate when a matching event already exists (idempotency — SC-005); overdue meetings are processed before on-schedule meetings (FR-010c); `npm test` passes

---

## T022 — Unit tests: SmartMeetingSchedulerTask rebalance

**Phase**: 6
**Depends on**: T006
**Parallelisable with**: T018, T019, T020, T021, T023, T024
**Files**:
- MODIFY `src/services/heartbeat/tasks/__tests__/smart-meeting-scheduler-task.test.ts` — add rebalance-phase test cases

**Acceptance**: Rebalance moves a conflicting meeting when >48h away; does NOT move a meeting within 48h (FR-006 / SC-003); does not produce cascading reschedules within one run (FR-015); `npm test` passes

---

## T023 — Integration smoke test: forward scheduling creates event

**Phase**: 6
**Depends on**: T006, T005
**Parallelisable with**: T018, T019, T020, T021, T022, T024
**Files**:
- CREATE `src/services/smart-meetings/__tests__/forward-scheduling.integration.test.ts` — uses a mock `MicrosoftService` to simulate a Graph response with no matching event in the window; asserts that `createCalendarEvent` is called exactly once with a date ~21 days out

**Acceptance**: Test passes with `npm test`; verifies SC-002 (at least one meeting scheduled correctly in first automated test)

---

## T024 — Run full test suite

**Phase**: 6
**Depends on**: T018, T019, T020, T021, T022, T023
**Parallelisable with**: none (gate task)
**Files**: none

**Acceptance**: `npm test` exits 0 with no failures; no pre-existing tests are broken by the new code

---

## Phase 7 — Polish

---

## T025 — Add /smart-meetings nav link to existing dashboard

**Phase**: 7
**Depends on**: T015
**Parallelisable with**: T026, T027
**Files**:
- MODIFY `src/auth-server/triage-router.ts` (or the triage dashboard HTML) — add a nav link `Smart Meetings → /smart-meetings` in the header/nav bar, mirroring the existing pattern

**Acceptance**: The triage dashboard at `https://localhost:3333/triage` shows a working link to `https://localhost:3333/smart-meetings`

---

## T026 — Update CLAUDE.md

**Phase**: 7
**Depends on**: none
**Parallelisable with**: T025, T027
**Files**:
- MODIFY `CLAUDE.md` — document `smart-meetings-config.json` (purpose, location, format reference); document the two heartbeat tasks and their cron schedules; add `smart_meetings_status` to the list of available MCP tools; note that `https://localhost:3333/smart-meetings` is the dashboard URL

**Acceptance**: CLAUDE.md accurately describes the feature; no factual errors relative to the implementation

---

## T027 — Update .gitignore

**Phase**: 7
**Depends on**: none
**Parallelisable with**: T025, T026
**Files**:
- MODIFY `.gitignore` — ensure `smart-meetings-config.json` is NOT gitignored (it should be checked in, like `heartbeat-config.json` is not gitignored but `.tokens/` is); verify `smart-meetings-config.json` does not accidentally match any existing ignore pattern

**Acceptance**: `git status` shows `smart-meetings-config.json` as a tracked file (or untracked-but-trackable) rather than ignored; no secrets or token data would be exposed by checking it in
