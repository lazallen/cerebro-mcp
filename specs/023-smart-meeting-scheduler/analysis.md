# Consistency Analysis: Smart Meeting Scheduler (Feature 023)

**Artifacts reviewed**:
- `spec.md` — functional requirements, user stories, success criteria
- `plan.md` — implementation plan and build sequence
- `data-model.md` — TypeScript interfaces
- `contracts/smart-meetings-status.md` — MCP tool contract and example responses
- `tasks.md` — task breakdown (this document set)

---

## 1. FR Coverage Check

Every functional requirement in `spec.md` mapped to at least one task.

| FR | Description | Covered by |
|---|---|---|
| FR-001 | Read from `smart-meetings-config.json` | T005 (config-io.ts) |
| FR-002 | Forward-scheduling pass checks lookAheadDays window | T006 |
| FR-003 | Matching by title substring AND attendee | T006 |
| FR-004 | Call `findMeetingTimes` when no match | T006 |
| FR-005 | Create calendar event when slot found | T006 |
| FR-006 | Do not reschedule within `minNoticePeriodHours` (48h) | T006, T022 |
| FR-007 | Detect conflicts via attendee calendar overlap | T006 |
| FR-008 | Record history entries, prune to `historyRetentionCount` | T006 |
| FR-009 | History entry fields: date, dayOfWeek, startTime, status | T001 (type), T006 (write) |
| FR-010 | Use history to derive day-of-week preference | T006 |
| FR-010a | Calculate cadence debt | T005 (cadence-debt.ts) |
| FR-010b | Overdue meetings scheduled sooner by debt bracket | T005, T006 |
| FR-010c | Sort meetings by debt DESC before scheduling | T005, T006 |
| FR-011 | Expose `smart_meetings_status` MCP tool | T007, T009 |
| FR-012 | Forward pass daily; rebalance configurable (Mon 08:00) | T004 |
| FR-013 | Do not modify events where Laz is not organiser | T006 |
| FR-014 | Target ~`lookAheadDays` for new events | T006 |
| FR-015 | Rebalance: max 1 reschedule per meeting per run | T006, T022 |
| FR-016 | Categorise events: recurring / ad-hoc / focus | T005 (portfolio-calculator.ts) |
| FR-017 | Balance from 4-week `calendarView` lookback; no persistent state | T005 |
| FR-018 | Detect sustained imbalance over `imbalanceWindowWeeks` | T005 |
| FR-019 | Surface warning in status tool; do NOT cancel meetings | T007 |
| FR-020 | Balance thresholds / focus keywords / window configurable | T001 (TimePortfolioSettings type) |
| FR-021 | `timePortfolio` summary in status response (this-week, last-week, trend, warnings) | T007 |
| FR-022 | Dashboard at `GET /smart-meetings` on port 3333 | T011, T015, T016 |
| FR-023 | Dashboard columns per meeting | T012, T014 |
| FR-024 | Amber (1–13 days) / red (14+) debt colouring | T013, T014 |
| FR-025 | Portfolio balance summary + warning banner at top | T012, T014 |
| FR-026 | Dashboard is read-only | T011, T012 |

**Result**: All 26 functional requirements (including sub-items) are covered. ✅

---

## 2. Type Consistency: contracts vs data-model

### SmartMeetingsStatusResponse

| Field | contract (smart-meetings-status.md) | data-model.md | Match? |
|---|---|---|---|
| `generatedAt` | `string` (date-time) | `string` | ✅ |
| `meetings` | array of `MeetingStatus` items | `MeetingStatus[]` | ✅ |
| `timePortfolio` | `object \| null` | `TimePortfolioSummary \| null` | ✅ |

### MeetingStatus (contract vs data-model)

| Field | contract required? | data-model field | Match? |
|---|---|---|---|
| `meetingId` | yes | `meetingId: string` | ✅ |
| `title` | yes | `title: string` | ✅ |
| `enabled` | yes | `enabled: boolean` | ✅ |
| `cadence` | yes | `cadence: MeetingCadence` | ✅ |
| `lastOccurrence` | yes | `lastOccurrence: string \| null` | ✅ |
| `nextScheduled` | yes | `nextScheduled: string \| null` | ✅ |
| `cadenceDebt` | yes | `cadenceDebt: CadenceDebt` | ✅ |
| `attendees` | yes | `attendees: string[]` | ✅ |

### CadenceDebt (contract vs data-model)

| Field | contract required? | data-model field | Match? |
|---|---|---|---|
| `meetingId` | yes | `meetingId: string` | ✅ |
| `daysSinceLastOccurrence` | yes | `number \| null` | ✅ |
| `expectedCadenceDays` | yes | `number` | ✅ |
| `debtDays` | yes | `number \| null` | ✅ |
| `targetHorizonDays` | yes | `number` | ✅ |
| `lastOccurrenceDate` | yes | `string \| null` | ✅ |

### WeeklyPortfolioSlice (contract $defs vs data-model)

| Field | contract | data-model | Match? |
|---|---|---|---|
| `weekStart` | `string` (date) | `string` | ✅ |
| `focusPct` | `number` | `number` | ✅ |
| `recurringPct` | `number` | `number` | ✅ |
| `adHocPct` | `number` | `number` | ✅ |
| `focusMins` | `number` | `number` | ✅ |
| `recurringMins` | `number` | `number` | ✅ |
| `adHocMins` | `number` | `number` | ✅ |
| `workingMins` | `number` | `number` | ✅ |

### PortfolioImbalanceWarning (contract vs data-model)

| Field | contract | data-model | Match? |
|---|---|---|---|
| `category` | `"focus" \| "recurring" \| "adHoc"` | `'focus' \| 'recurring' \| 'adHoc'` | ✅ |
| `consecutiveWeeks` | `number` | `number` | ✅ |
| `thresholdPct` | `number` | `number` | ✅ |
| `message` | `string` | `string` | ✅ |

### Stale-data warning sentinel (contract only)

The contract documents a stale-data warning with `consecutiveWeeks: 0` and `category: 'focus'` as a sentinel value distinguishing it from a real imbalance warning. This sentinel pattern is not represented in the `PortfolioImbalanceWarning` type in `data-model.md`.

⚠️ **Minor gap**: The data model has no way to distinguish a stale-data warning from a genuine imbalance warning at the type level. The contract relies on the `consecutiveWeeks: 0` sentinel, but this is an undocumented convention. A `type: 'imbalance' | 'stale-data'` discriminator field, or a separate `staleness` field on `SmartMeetingsStatusResponse`, would make this explicit.

### `_meta` field on SmartMeetingsStatusResponse (contract only)

The contract documents a `_meta.portfolioUnavailable` field on the response when Graph is unavailable and `portfolioRef.current` is null. This field does not appear in the `SmartMeetingsStatusResponse` interface in `data-model.md`.

⚠️ **Gap**: `_meta` is untyped in the data model. If left as an ad-hoc addition at runtime, it will either require a type assertion or cause a TypeScript compile error. The interface should include `_meta?: { portfolioUnavailable?: boolean; reason?: string }`.

**Overall type consistency**: All primary fields match across contract and data model. Two minor gaps in sentinel/meta fields. ✅ with caveats above.

---

## 3. Build Sequence Coverage

Every file in `plan.md` Phase A–F mapped to a task.

| plan.md step | File / action | Task |
|---|---|---|
| Phase A, step 1 | CREATE `src/types/smart-meetings.ts` | T001 |
| Phase A, step 2 | MODIFY `src/types/heartbeat.ts` TaskType | T002 |
| Phase A, step 3 | Build verify | implicit in T001/T002 acceptance |
| Phase B, step 4 | CREATE `config-io.ts` | T005 |
| Phase B, step 5 | CREATE `portfolio-ref.ts` | T005 |
| Phase B, step 6 | CREATE `cadence-debt.ts` | T005 |
| Phase B, step 7 | CREATE `portfolio-calculator.ts` | T005 |
| Phase B, step 8 | CREATE `smart-meeting-scheduler-task.ts` | T006 |
| Phase B, step 9 | MODIFY `task-registry.ts` | T006 |
| Phase B, step 10 | MODIFY `config-loader.ts` supportedTypes | T003 |
| Phase B, step 11 | Build verify | implicit in T006 acceptance |
| Phase C, step 12 | CREATE `smart-meetings-service.ts` | T007 |
| Phase C, step 13 | Register SmartMeetingsService in MCP server | T009 |
| Phase C, step 14 | Build verify | implicit in T009 acceptance |
| Phase D, step 15 | CREATE `smart-meeting-router.ts` | T011 |
| Phase D, step 16 | CREATE dashboard HTML | T012 |
| Phase D, step 17 | MODIFY `oauth-server.ts` | T015 |
| Phase D, step 18 | Build + smoke test | implicit in T015/T016 acceptance |
| Phase E, step 19 | MODIFY `heartbeat-config.json` | T004 |
| Phase E, step 20 | CREATE `smart-meetings-config.json` | not covered — see Gap G1 below |
| Phase F, step 21 | Unit tests: calculateCadenceDebt | T018 |
| Phase F, step 22 | Unit tests: calcTimePortfolio | T019 |
| Phase F, step 23 | Unit tests: SmartMeetingSchedulerTask | T021, T022 |
| Phase F, step 24 | Integration smoke test | T023 |
| Phase F, step 25 | Run full test suite | T024 |

**Result**: All plan steps are covered except one gap. ✅ with Gap G1 noted below.

---

## 4. Spec/Plan Contradictions

### C1 — heartbeat-config.json: enabled field default value

⚠️ `plan.md` specifies both task entries with `"enabled": true`. Task T004 (this document) sets them to `"enabled": false` as a safe default during implementation. These are contradictory. The plan assumes the tasks are immediately live; the tasks.md takes a more cautious approach.

**Recommendation**: Decide once. If `enabled: false` until the full feature is tested, that should be stated explicitly in `plan.md`. If `enabled: true` is intended from the start, T004 should not override it.

### C2 — PortfolioRef creation location

⚠️ `plan.md` says `PortfolioRef` is created "once at server startup (in `oauth-server.ts` or the MCP server entry point)". The data model comment says the same. However, `service-registration.ts` is the natural home for this (it creates all services). Task T009 places it there. This is a minor structural ambiguity — `oauth-server.ts` and `service-registration.ts` are separate files with different lifecycles. If created in `service-registration.ts`, it must be threaded through to both `SmartMeetingsService` (MCP) and `HeartbeatService` (heartbeat). Task T017 handles this threading, but the plan does not mention `service-registration.ts` as the creation point.

**Recommendation**: Confirm that `portfolioRef` is created in `service-registration.ts` (alongside `SmartMeetingsService`) and passed out to `index.ts`, which then passes it into `HeartbeatService`. Document this in `plan.md`.

### C3 — `smartMeetingsConfigPath` on OAuthServer

⚠️ `plan.md` shows `this.smartMeetingsConfigPath` as a field on `OAuthServer`, implying the path is stored at construction time. The actual `OAuthServer` class does not accept a config path in its constructor — it uses `registerTriageRouter(systemDir, rootDir, calendarResponder)` as a post-construction call. Task T015 adds `registerSmartMeetingRouter(configPath, portfolioRef)` following the same pattern, which is consistent with the actual class design but differs from the plan's code snippet.

**No action needed** — the tasks.md approach matches the actual codebase. This is a plan inaccuracy, not a blocking contradiction.

---

## 5. Gaps

### G1 — `smart-meetings-config.json` initial file not in tasks

❌ `plan.md` Phase E step 20 requires: "Create initial `smart-meetings-config.json` with version, settings, and first batch of meetings". No task covers this. The 35 Reclaim meetings (SC-001) need to be transcribed into this file.

**Impact**: Without this file, the heartbeat tasks will fail on their first run (config-not-found error), the `smart_meetings_status` tool will return `isError: true`, and the dashboard will show an error state.

**Recommendation**: Add T028 — Create `smart-meetings-config.json` (Phase 5 or between Phase 2 and 6), covering: `version: 1`, `settings` with defaults, and all 35 active Reclaim meetings transcribed with correct ids, titles, attendees, cadences, and empty `history: []`.

### G2 — History update for occurred meetings not explicitly tasked

⚠️ FR-008 and FR-009 require the scheduler to append history entries and update status to `occurred` retrospectively. The forward-scheduling task (T006) covers appending `scheduled` entries. However, no task explicitly covers the retrospective update pass (scanning past events to flip `scheduled` → `occurred`). This logic likely lives in `runForwardScheduling` or `runRebalance`, but it is not called out.

**Impact**: Without retroactive status updates, cadence debt calculations will use stale `scheduled` entries rather than confirmed `occurred` entries, potentially over-counting debt.

**Recommendation**: Add a note to T006 or T022 specifying that the forward-scheduling pass should scan `history[]` entries with `status: 'scheduled'` whose `date` is in the past and update them to `status: 'occurred'` before calculating debt.

### G3 — `systemDir` parameter missing from HeartbeatService for portfolioRef

⚠️ Task T017 modifies `HeartbeatService` to accept `portfolioRef`. The existing `createTaskRegistry` call in `index.ts` passes `{ graphClient, lfClient, microsoftService, rootDir }`. The `systemDir` parameter (introduced in an earlier feature) is resolved inside `createTaskRegistry`. Adding `portfolioRef` follows the same pattern, but T017 does not confirm whether `HeartbeatService` needs a new constructor parameter or if it should be passed through the existing `dependencies` object that reaches `createTaskRegistry`. This is an implementation detail, but the task should be explicit.

**Recommendation**: Confirm in T017 that `portfolioRef` is added to the existing anonymous `dependencies` object (not a new constructor parameter on `HeartbeatService`), matching the pattern used for `slackSavedItemsApiClient`.

### G4 — CSS/JS file delivery not confirmed for router

⚠️ Tasks T012–T014 create `index.html`, `styles.css`, and `app.js` as separate files under `src/auth-server/smart-meetings/`. However, `SmartMeetingRouter` (T011) must serve these as static files or inline them. The plan says "inline or from static file" but tasks.md creates separate files. The router must either inline the CSS/JS into the HTML at build time, or serve them as additional routes (`GET /smart-meetings/styles.css`, etc.). Task T011 does not specify which approach.

**Recommendation**: Decide approach before implementation. The `triage-router.ts` inlines everything into a single HTML string — the same approach is simpler and avoids adding static file serving to `SmartMeetingRouter`. If separate files are preferred, T011 must add static routes for each asset.

---

## 6. Self-Referential Attendees Flag

❌ The `plan.md` example heartbeat config snippet shows a meeting with:
```json
"attendees": ["Laz.Allen@skyscanner.net"]
```
(The Laz/George Goals meeting referenced in the brief appears to have `attendees=[Laz.Allen@skyscanner.net]` — a single attendee that is the calendar owner themselves.)

**Problem**: A meeting where Laz is the only attendee is not a 1:1 — it is a personal calendar block. The scheduler would call `findMeetingTimes` with only Laz's email, which is valid (Graph will return Laz's free slots), but:

1. The event will not send an invite to any other person — it is effectively a self-reminder, not a scheduled meeting.
2. The `matching` logic (FR-003) checks "at least one attendee match" — a self-only meeting always matches any of Laz's events, creating a risk of false-positive matches against focus blocks or other personal events.
3. The `conflict detection` logic (FR-007) checks attendee availability — with only Laz as attendee, any conflict with Laz's own calendar is automatically a self-conflict and will block scheduling.

**Recommendation**: The Laz/George Goals meeting definition in `smart-meetings-config.json` (when created in G1/T028) MUST include George's email address as the second attendee: `"attendees": ["laz.allen@skyscanner.net", "george.XXXX@skyscanner.net"]`. All meeting definitions should have at least two attendees. Add a validation guard in `loadSmartMeetingsConfig` (T005 / config-io.ts) that warns (but does not hard-fail) when a meeting has only one attendee.

---

## Recommended Fixes Before Implementation

Listed in priority order.

### Fix 1 (blocking) — Create T028: initial smart-meetings-config.json

Without this file, nothing works. Add task T028 in Phase 5 to create the initial config with all 35 Reclaim meetings. Assign the Laz/George Goals meeting a second attendee (see Fix 5).

### Fix 2 (blocking) — Add `_meta` to SmartMeetingsStatusResponse in data-model.md

```typescript
_meta?: {
  portfolioUnavailable?: boolean;
  reason?: string;
}
```
Without this, the TypeScript compiler will reject the `_meta` field that the contract specifies in the Graph-unavailable error path.

### Fix 3 (high) — Fix self-referential Laz/George Goals attendees

Verify the George attendee email and ensure every `MeetingDefinition` in `smart-meetings-config.json` has at least two email addresses. Add a startup validation warning in `config-io.ts` for single-attendee meetings.

### Fix 4 (medium) — Add stale-data warning discriminator to PortfolioImbalanceWarning

Either add a `warningType: 'imbalance' | 'stale-data'` field, or document the `consecutiveWeeks: 0` sentinel explicitly in the type's JSDoc. Currently the contract relies on undocumented convention.

### Fix 5 (medium) — Clarify portfolioRef creation location

Update `plan.md` to explicitly state that `portfolioRef` is created in `service-registration.ts` alongside `SmartMeetingsService`, then passed into `HeartbeatService` via `index.ts`. Remove the ambiguous "in `oauth-server.ts` or the MCP server entry point" phrasing from the plan and data-model comments.

### Fix 6 (medium) — Resolve heartbeat-config.json enabled default

Decide: should the two new task entries start with `enabled: true` or `enabled: false`? Update `plan.md` and T004 to agree. Recommendation: `enabled: false` during feature development, switched to `enabled: true` as part of T028 after initial config validation.

### Fix 7 (low) — Add occurred-status retroactive update to T006 scope

Add a note to T006 (and its test in T021/T022) that `runForwardScheduling` must scan past `scheduled` history entries and update them to `occurred` before calculating cadence debt.

### Fix 8 (low) — Confirm CSS/JS inlining vs separate file approach for dashboard

Before starting T011–T014, decide: inline everything in `index.html` (matches triage pattern, simpler) or serve separate static files (cleaner separation, requires additional router routes). Update T011 task scope accordingly.
