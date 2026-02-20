# Triage Pipeline — Architecture Reference

This document describes the internal structure of the policy engine pipeline: how events flow through stages, what files are written at each step, and how the multi-pass enrichment loop works.

## Table of Contents

- [Overview](#overview)
- [System Directory Layout](#system-directory-layout)
- [Pipeline Stages](#pipeline-stages)
- [Event Lifecycle](#event-lifecycle)
- [File Formats](#file-formats)
- [Safety Gates](#safety-gates)
- [Conflict Resolution](#conflict-resolution)
- [Idempotency](#idempotency)
- [Adding an Event Source](#adding-an-event-source)

---

## Overview

```
Ingestion tasks          Policy pipeline task
(email-ingestion,   →    (policy-pipeline)
 journal-triage,
 calendar-review)

system/triage/       →   evaluate()   →   system/decisions/
  TriageEvent files        ↑                PolicyDecision files
  (pending/enriched)       │                       │
                     LocalFoundry                  │ actions
                     Claude (gated)           system/human/
                                              system/artifacts/tasks/
                                              system/artifacts/reading-packs/
                                              system/runs/
```

All data flows through flat files in `{rootDir}/system/`. There is no database. Files use YAML frontmatter + markdown body format.

---

## System Directory Layout

```
{rootDir}/system/
  triage/                      ← TriageEvent files
  decisions/                   ← PolicyDecision files (one per event per pass)
  human/                       ← HumanQueueItem files (ask_human, claude_approval)
  runs/                        ← RunLog files (one per pipeline cycle)
  artifacts/
    tasks/                     ← Obsidian task notes (CREATE_TASK action output)
    reading-packs/             ← Daily reading-pack notes (CREATE_READING_PACK output)
    drafts/                    ← Draft reply files (DRAFT_REPLY output)
  policies/                    ← Policy YAML files (user-managed)
```

All directories are created on first heartbeat startup via `fs.mkdir(..., { recursive: true })`.

---

## Pipeline Stages

`PolicyPipelineTask.execute()` runs these stages sequentially each cycle:

### Stage 1 — Scan

Reads all `TriageEvent` files from `system/triage/` where `status` is `pending` or `enriched`. Events at `evaluated` or `actioned` are skipped (already processed).

### Stage 2 — Local enrichment

For each `pending` event, calls `LocalEnrichmentService.enrich(event)`:

- Sends a structured prompt to LocalFoundry (phi-4-mini or equivalent)
- The LLM response is expected as JSON: `{ intent, confidence, summary?, entities? }`
- Strips markdown code fences if present
- Validates `intent` against the known `IntentType` set; unknown values → `UNKNOWN`
- Clamps `confidence` to [0.0, 1.0]
- Updates the event's `extracted` fields in-place and writes back to disk
- On any failure (timeout, malformed JSON, etc.) — returns `confidence: 0, intent: UNKNOWN`; does not throw
- If body exceeds ~1500 tokens (2000 chars), sends a truncated version and sets `extracted.truncated: true`

### Stage 3 — Cloud enrichment

For each `claude_approval` item in `system/human/` with `status: approved`:

- Calls `ClaudeEnrichmentService.enrich(event, approvalItemId, systemDir)`
- Uses `claude-haiku-4-5-20251001` (Anthropic SDK)
- Requires `ANTHROPIC_API_KEY` in environment
- Throws `UnauthorizedEnrichmentError` if the approval item is not found or not approved
- On success, advances the approval item to `status: complete`

### Stage 4 — Human queue processing

For each `ask_human` item in `system/human/` with `status: resolved`:

- Reads the parent `TriageEvent` from `system/triage/`
- Builds `humanAnswers: Map<eventId, answer>` from the resolved item
- Re-evaluates the event with `evaluate(policy, [event], humanAnswers)`
- Appends a new `EvaluationPass` to the event and saves it
- Writes a new `PolicyDecision` to `system/decisions/`
- Advances the `ask_human` item to `status: complete`

### Stage 5 — Re-read

Re-reads `system/triage/` fresh after enrichment writes. This ensures the evaluator sees enriched `extracted.*` fields rather than the pre-enrichment snapshot.

### Stage 6 — Evaluate

Calls `evaluate(policy, events)`:

1. **Sort rules** by priority (descending)
2. For each event:
   a. Walk rules in priority order
   b. Evaluate each rule's `when` predicate against the event object
   c. If matched: merge `setClassification`, collect actions, record trace entry
   d. If `terminal: true`: stop evaluating further rules
   e. Apply **safety gates** (see below)
   f. Apply **conflict resolution** (see below)
3. Build `PolicyDecision` with actions enriched with idempotency keys

### Stage 7 — Write decisions

Writes each `PolicyDecision` to `system/decisions/YYYYMMDD-decision-<eventId>.md`. Also appends a new `EvaluationPass` to the parent `TriageEvent` file in `system/triage/`.

### Stage 8 — Execute actions

For each decision, executes pending actions:

| Action | Executor |
|--------|----------|
| `CREATE_TASK` | Writes `system/artifacts/tasks/YYYYMMDD-task-NNN.md` |
| `CREATE_READING_PACK` | Appends to `system/artifacts/reading-packs/YYYY-MM-DD.md` (atomic lock) |
| `ASK_HUMAN` | Writes `system/human/hq_YYYYMMDD_NNN.md` with `itemType: ask_human` |
| `MOVE` | Stub — not yet connected to source system |
| `LABEL` | Stub |
| `DRAFT_REPLY` | Stub |
| `CATEGORY` | Stub |
| `FLAG` | Stub |

After execution, writes the run log to `system/runs/`.

---

## Event Lifecycle

```
            ┌─────────────────────────────────────────────┐
            │           system/triage/                     │
            │                                             │
            │  status: pending  ──► status: enriched      │
            │        │                     │               │
            │        │ (local enrichment)  │               │
            │        │                     │               │
            │        └─────────────────────┤               │
            │                              │               │
            │                     status: evaluated        │
            │                              │               │
            │                     status: actioned         │
            └─────────────────────────────────────────────┘
```

Events are **never deleted** from `system/triage/`. Each pass appends to the file body. The frontmatter `latest_decision_*` keys are overwritten with the most recent pass result for fast querying:

```yaml
latest_decision_intent: ACTION_REQUIRED
latest_decision_confidence: 0.88
latest_decision_risk: MEDIUM
latest_decision_urgency: THIS_WEEK
latest_decision_actions: CREATE_TASK,CATEGORY
latest_decision_terminal: true
latestPassTimestamp: 2026-02-19T10:10:00Z
```

---

## File Formats

### TriageEvent (`system/triage/`)

Filename: `YYYYMMDD-<source>-<id>.md`

```yaml
---
type: triage-event
eventId: 20260219-email-a1b2
source: email
status: enriched
title: "Q1 Budget Review"
author: finance@company.example
receivedAt: 2026-02-19T08:00:00Z
snippet: "Please review the attached Q1 budget..."
# Signal fields
signals.isAutomated: false
signals.isBulk: false
signals.hasUnsubscribe: false
signals.hasAttachments: true
signals.mentionsMoney: true
signals.mentionsMeeting: false
signals.asksForAction: true
signals.prioritySender: false
# Extracted fields (populated after enrichment)
extracted.intent: ACTION_REQUIRED
extracted.confidence: 0.88
extracted.llmTier: local
# Latest decision summary
latest_decision_intent: ACTION_REQUIRED
latest_decision_confidence: 0.88
latest_decision_risk: MEDIUM
latest_decision_urgency: THIS_WEEK
latest_decision_actions: "CREATE_TASK,CATEGORY"
latest_decision_terminal: true
latestPassTimestamp: 2026-02-19T10:10:00Z
passCount: 1
---

### Pass 1 — 2026-02-19T10:10:00Z

**Policy**: default-triage@1.0.0 | **LLM**: local (confidence: 0.88)
**Decision**: ACTION_REQUIRED / THIS_WEEK / MEDIUM

| Rule | Matched | Terminal |
|------|---------|----------|
| action-required-create-task | ✓ | yes |

**Actions**: CREATE_TASK, CATEGORY
```

### PolicyDecision (`system/decisions/`)

Filename: `YYYYMMDD-decision-<eventId>.md`

```yaml
---
type: policy-decision
eventId: 20260219-email-a1b2
policyId: default-triage
policyVersion: 1.0.0
timestamp: 2026-02-19T10:10:05Z
intent: ACTION_REQUIRED
urgency: THIS_WEEK
risk: MEDIUM
confidence: 0.88
terminal: true
actions: "CREATE_TASK,CATEGORY"
---
```

### HumanQueueItem (`system/human/`)

Filename: `hq_YYYYMMDD_NNN.md`

```yaml
---
type: human-queue-item
id: <uuid>
itemType: ask_human        # or: claude_approval
status: pending            # pending | resolved | approved | declined | complete
eventRef: 20260219-email-a1b2
question: "Unclear — options: keep, archive, task, reading pack?"
createdAt: 2026-02-19T10:10:00Z
# resolvedAt: set automatically when status changes to resolved/approved/declined/complete
# answer: set by user when resolving ask_human items
---
```

### RunLog (`system/runs/`)

Filename: `run_YYYYMMDD_<shortid>.md`

```yaml
---
type: run-log
runId: run_20260219_a1b2c3
policyVersion: 1.0.0
startedAt: 2026-02-19T10:10:00Z
completedAt: 2026-02-19T10:10:08Z
eventsProcessed: 14
eventsActioned: 11
humanItemsCreated: 2
claudeApprovalsRequested: 1
claudeApprovalsGranted: 0
errors: 0
---
```

---

## Safety Gates

After a rule fires, the evaluator applies safety gates that may add or modify actions regardless of what the rule specified.

| Gate | Trigger | Effect |
|------|---------|--------|
| `low_confidence` | `classification.confidence < defaults.approvalThreshold` | Adds `ASK_HUMAN` action if not already present |
| `high_risk` | `classification.risk === 'HIGH'` | Adds `ASK_HUMAN` action if not already present |
| `draft_reply_approval` | Action has `requiresApproval: true` | Marks action as requiring approval; creates `claude_approval` queue item |

Safety gate outcomes are recorded in `RuleTraceEntry.gateOutcomes` and appear in run logs.

---

## Conflict Resolution

After safety gates, the conflict resolver may suppress certain actions to prevent contradictory behaviour.

| Conflict | Condition | Resolution |
|----------|-----------|------------|
| `ask_human_blocks_move` | `ASK_HUMAN` in actions AND `defaults.conflictResolution.askHumanBlocksMoveToArchive: true` | Suppresses `MOVE` and `LABEL` actions |

This prevents an event from being archived before a human has reviewed it. The `MOVE` action is suppressed and logged with `actionSuppressed: 'MOVE'` in the trace.

---

## Idempotency

Every action in a `PolicyDecision` has a stable idempotency key:

```
event:<eventId>:action:<type>:policy:<policyId>@<policyVersion>:v1
```

Running the pipeline twice on the same event with the same policy produces identical keys. The executor uses these keys to detect and skip duplicate actions. If the key appears in an `applied: true` decision, the action is not re-executed.

---

## Adding an Event Source

The pipeline is source-agnostic. To add a new source (e.g., Slack):

1. **Create an ingestion task** (e.g., `src/services/heartbeat/tasks/slack-ingestion-task.ts`):
   - Fetch messages from the source
   - Compute `EventSignals` deterministically from message properties
   - Write a `TriageEvent` to `system/triage/` with `source: 'slack'`

2. **Register the task** in `src/services/heartbeat/tasks/task-registry.ts`

3. **Add `TaskType`** to `src/types/heartbeat.ts` if needed

4. **Add the task to `heartbeat-config.json`** with a schedule before the `policy-pipeline` task

5. **Optionally add source-specific rules** to your policy YAML using `source eq 'slack'` predicates

No changes to the policy engine, evaluator, or pipeline task are required.
