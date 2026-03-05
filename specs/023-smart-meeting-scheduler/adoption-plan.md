# Adoption Plan: Smart Meeting Scheduler (Feature 023)

**Purpose**: Ops guide for validating, piloting, and cutting over from Reclaim.ai to cerebro-mcp smart scheduling for 34 recurring meetings.

**Timeline summary**: ~5 weeks total (1 day validation + 2 weeks pilot + 1 week cutover + 2 weeks monitoring)

---

## Phase 0 — Post-Implementation Validation

**Gate before enabling any heartbeat tasks. Estimated: 1 day.**

All items below must pass before `enabled: true` is set on any task.

### Build and Tests

- [ ] `npm run build` exits 0 with no TypeScript errors
- [ ] `npm test` exits 0 — all T018–T024 test suites pass (cadence debt brackets, portfolio calculator, tool response shape, forward-scheduling idempotency, 48h protection, rebalance)
- [ ] No pre-existing tests broken by the new code (T024 gate)

### Config Validation

- [ ] `smart-meetings-config.json` loads without error from `SMART_MEETINGS_CONFIG_FILE` path
- [ ] All 34 meetings have: non-empty `attendees` array, valid `cadence` (weekly/biweekly/monthly/quarterly), valid `window` (days array + time range)
- [ ] `heartbeat-config.json` has both entries: `smart-meeting-forward` (cron `0 7 * * 1-5`, `enabled: false`) and `smart-meeting-rebalance` (cron `0 8 * * 1`, `enabled: false`)
- [ ] Config-loader accepts `type: 'smart-meeting-scheduler'` without throwing (T003)

### Dashboard

- [ ] Server starts without error; `https://localhost:3333/smart-meetings` loads
- [ ] Dashboard renders all 34 meetings in the table (none missing, none duplicated)
- [ ] Portfolio summary section renders (even if all zero for new config)
- [ ] No JS console errors on page load
- [ ] Nav link from `/triage` to `/smart-meetings` works (T025)

### MCP Tool

- [ ] `smart_meetings_status` appears in `/mcp` tool list in Claude Code
- [ ] Tool called with no args returns: `meetingCount: 34`, all `history: []`, cadence debt calculated (all meetings at `targetHorizonDays: 21` with empty history), `isError: false`
- [ ] Tool called with a valid `meetingId` returns only that meeting
- [ ] Tool called with an invalid `meetingId` returns `isError: true`

**Success criteria (SC-001)**: All 34 meetings visible in dashboard and tool response with correct cadence metadata before any scheduling begins.

---

## Phase 1 — Pilot (2 Weeks)

**Run cerebro alongside Reclaim. Reclaim remains active as safety net.**

### Pilot Meeting Selection

Pick 3 simple weekly 1:1s. Criteria: weekly cadence (easiest to verify), single external attendee (minimal blast radius if something goes wrong), meetings that Reclaim currently manages without issues (baseline to compare against).

Suggested selection process: on dashboard, filter for `cadence: weekly`, pick the 3 with the fewest attendees and no complex window constraints.

### Enabling Pilot Meetings

- [ ] In `smart-meetings-config.json`, confirm the 3 pilot meetings have correct `attendees`, `window`, and `cadence`
- [ ] In `heartbeat-config.json`, set `enabled: true` on `smart-meeting-forward` only (leave `smart-meeting-rebalance` disabled for week 1)
- [ ] Server restarts and picks up the config change (no server restart needed for `enabled` flag — heartbeat reads config each run)
- [ ] Verify first forward-scheduling pass runs at 07:00 on next weekday; check logs at `~/Library/Logs/cerebro-mcp.log`

### What to Watch For (Week 1)

**Duplicates**: After cerebro runs, check Graph calendarView for each pilot meeting. If Reclaim and cerebro both scheduled the same slot, a duplicate will appear. Duplicates are the highest-risk issue.

- [ ] Each pilot meeting has at most one scheduled instance per occurrence slot in the 3-week window
- [ ] Attendee emails in scheduled events match `smart-meetings-config.json` exactly (no typos, no wrong domain)
- [ ] Scheduled times fall within the configured `window` (correct days, correct time range)
- [ ] Meetings are scheduled ~21 days out (SC-002: 3-week horizon)

**Comparison with Reclaim**:

For each pilot meeting, run the `reclaim-api-smart-meetings` skill to fetch Reclaim's scheduled instances. Compare:

| Check | Expected |
|---|---|
| Same occurrence dates | Cerebro and Reclaim agree on the next 1–3 dates |
| No duplicate calendar events | Only one event per date slot on Graph calendarView |
| Correct organiser | Event created by the service account, not a stale Reclaim event |

### Week 2: Enable Rebalance

- [ ] Enable `smart-meeting-rebalance` in `heartbeat-config.json`
- [ ] Manually create a test conflict on one pilot meeting (move it 1h earlier) and verify rebalance moves it — confirm the new slot is still within window
- [ ] Verify a meeting within 48h is NOT moved (SC-003: 48h protection)
- [ ] Check history entries: past `scheduled` entries should flip to `occurred` or `skipped` after the retroactive update runs (SC-006 / T006 history logic)

### Pilot Pass/Fail Criteria

**Pass** (proceed to full rollout):
- Zero duplicate events across all 3 pilot meetings over 2 weeks
- All scheduled times within configured windows
- Retroactive history correctly shows `occurred` for meetings that happened
- Rebalance respects 48h protection (SC-003)
- No Graph API errors in logs that weren't present before

**Fail** (investigate before proceeding):
- Any duplicate calendar event created
- Any meeting scheduled outside its configured window
- Any meeting within 48h rescheduled
- Persistent Graph API auth errors

---

## Phase 2 — Full Rollout and Reclaim Cutover

**Prerequisites**: Pilot phase passed all criteria. Estimated: 1 day (Monday morning).**

**Timing**: Do this on a Monday, immediately after the 08:00 rebalance pass has run and logs confirm a clean run. This gives the full week for monitoring before the next rebalance.

### Enable All 34 Meetings

- [ ] Confirm all 34 meetings in `smart-meetings-config.json` have valid config (re-run the config validation checklist from Phase 0)
- [ ] `smart-meeting-forward` and `smart-meeting-rebalance` are already enabled from pilot — no change needed
- [ ] Verify by 09:00 Monday that the forward-scheduling pass has processed all 34 meetings (check logs and dashboard — all meetings should show a `scheduled` history entry within the 3-week window)
- [ ] Dashboard shows no meetings with `debtDays >= 14` (red) for newly-enabled meetings; all should be at or near `targetHorizonDays: 21` (SC-002)

### Disable Reclaim — One by One

Use the `reclaim-api-smart-meetings` skill to PATCH each Reclaim task to `status: DISABLED`. Do not fire-and-forget.

For each of the 34 Reclaim smart meetings:

- [ ] PATCH `status: DISABLED` via Reclaim API
- [ ] Wait for API 200 response; confirm `status` field in response body is `DISABLED`
- [ ] Check Graph calendarView: verify no new Reclaim-created events appear for that meeting after the PATCH
- [ ] If Reclaim created a duplicate in the window before the PATCH, delete the Reclaim event manually from Graph

Disable in the same order as the pilot — start with the 3 pilot meetings (already validated), then proceed through the remaining 31.

### Full Rollout Success Criteria

- [ ] All 34 Reclaim smart meetings have `status: DISABLED` confirmed via API (SC-004)
- [ ] All 34 meetings have at least one `scheduled` history entry in the 3-week window
- [ ] Zero duplicate events on calendarView across all 34 meetings
- [ ] Dashboard shows 34 meetings, portfolio summary populated, no red-debt meetings (SC-002 / SC-006)
- [ ] `smart_meetings_status` tool returns all 34 meetings with history entries (SC-001 / SC-005)

---

## Phase 3 — Monitoring Window (2 Weeks Post-Cutover)

- [ ] Keep Reclaim account active (do not cancel subscription) for 30 days after cutover — safety window to re-enable if needed
- [ ] Check dashboard daily for the first week; check logs for Graph API errors
- [ ] After first rebalance pass post-cutover (Monday 08:00), verify no conflicts were left unresolved and no 48h-protected meetings were moved
- [ ] After 2 weeks with no issues, Reclaim subscription can be cancelled

---

## Rollback Plan

**If something goes wrong at any phase, rollback takes under 2 minutes.**

### Pause Cerebro (Immediate)

```json
// heartbeat-config.json — flip both task entries:
{ "enabled": false }
```

No server restart required. The heartbeat service reads `enabled` from config on each scheduled tick. Cerebro stops scheduling immediately on the next tick.

- [ ] Set `enabled: false` on `smart-meeting-forward`
- [ ] Set `enabled: false` on `smart-meeting-rebalance`
- [ ] Confirm in logs that no further scheduling runs occur

### Re-enable Reclaim

For each Reclaim smart meeting that was disabled, PATCH `status: ACTIVE` via the `reclaim-api-smart-meetings` skill:

- [ ] PATCH all disabled Reclaim tasks back to `status: ACTIVE`
- [ ] Verify Reclaim resumes scheduling (events appear within 1h on calendarView)

### Data Safety

`smart-meetings-config.json` is local-only. Reverting cerebro state is a no-op — simply re-enable Reclaim and cerebro stops touching the calendar. No calendar events created by cerebro need to be deleted (they are real meetings with correct attendees and times; Reclaim will simply schedule around them or update them).

If cerebro created duplicates during a bad run, delete the cerebro-created events from Graph directly (they will have the service account as organiser, distinguishable from Reclaim events).

---

## Timeline

| Day | Milestone |
|---|---|
| D0 | Implementation complete (T001–T027 done) |
| D1 | Phase 0 validation complete — all checklists green |
| D2–D15 | Phase 1 pilot (3 meetings, 2 weeks) |
| D16 | Pilot pass/fail decision |
| D17 (Monday) | Phase 2: enable all 34, disable Reclaim one by one |
| D17–D31 | Phase 3: monitoring window, Reclaim account kept active |
| D47 | Reclaim account safe to cancel (30-day safety window elapsed) |

---

## Reference

- Success criteria SC-001 to SC-006 are defined in `tasks.md` (T018–T024 acceptance conditions)
- SC-002: meetings scheduled 3 weeks out
- SC-003: 48h protection (T022)
- SC-004: no duplicate events created (T021 idempotency)
- SC-005: tool returns correct shape (T020)
- SC-006: retroactive history update (T006 / T021)
- Reclaim API access: `reclaim-api-smart-meetings` skill
- Logs: `~/Library/Logs/cerebro-mcp.log`
- Dashboard: `https://localhost:3333/smart-meetings`
