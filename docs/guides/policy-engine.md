# Policy Engine — Operational Guide

The policy engine evaluates triage events (emails, calendar entries, journal notes) against a YAML rule set and automatically classifies, routes, and actions them each heartbeat cycle.

## Table of Contents

- [Setup](#setup)
- [How a Cycle Works](#how-a-cycle-works)
- [Human Queue](#human-queue)
- [Reading Packs](#reading-packs)
- [Run Logs](#run-logs)
- [Troubleshooting](#troubleshooting)

---

## Setup

### 1. Add the tasks to `heartbeat-config.json`

The pipeline runs in two stages: ingestion writes events; the policy pipeline evaluates them.
Schedule the pipeline a few minutes after ingestion so all new events are on disk before evaluation starts.

```json
{
  "rootDir": "./data",
  "policyDir": "./data/policies",
  "tasks": [
    {
      "id": "email-ingestion-hourly",
      "name": "Email Ingestion",
      "type": "email-ingestion",
      "schedule": "5 * * * *",
      "enabled": true,
      "config": {
        "maxEmails": 50,
        "markAsRead": false
      }
    },
    {
      "id": "policy-pipeline-hourly",
      "name": "Policy Pipeline",
      "type": "policy-pipeline",
      "schedule": "10 * * * *",
      "enabled": true,
      "config": {}
    }
  ]
}
```

### 2. Install a policy file

Copy the shipped default policy into your vault's `policies/` directory:

```bash
mkdir -p ./data/policies
cp specs/019-policy-engine/contracts/default-policy.yaml ./data/policies/default-triage.yaml
```

The default policy handles newsletters, receipts, spam, scheduling, approval requests, action items, and FYI emails out of the box. See [policy-rules.md](policy-rules.md) to understand and customise it.

### 3. Set environment variables

```bash
# .env — add if not already present
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json

# Optional — enables Claude (cloud LLM) enrichment for low-confidence events
ANTHROPIC_API_KEY=sk-ant-...
```

LocalFoundry (local LLM) enrichment works automatically if the LocalFoundry server is running. No additional config needed.

### 4. Personalise the policy

At minimum, add your key senders to the allowlist so their mail is never auto-archived:

```yaml
# ./data/policies/default-triage.yaml
defaults:
  senderAllowlist:
    - "boss@company.com"
    - "important-client@example.com"
```

Senders in the allowlist have `signals.prioritySender: true` injected into their events, which bypasses bulk/automated detection rules.

---

## How a Cycle Works

Each time the `policy-pipeline` task fires, it runs these stages in order:

| Stage | What happens |
|-------|--------------|
| **1. Scan** | Reads all `status: pending` and `status: enriched` events from `system/triage/` |
| **2. Local enrichment** | Sends pending events to LocalFoundry (phi-4-mini) for intent classification; updates events to `status: enriched` |
| **3. Cloud enrichment** | For any `claude_approval` items in `system/human/` with `status: approved`, calls Claude haiku for deeper analysis |
| **4. Human queue** | Processes `ask_human` items in `system/human/` with `status: resolved`; injects answers into re-evaluation |
| **5. Re-read** | Re-reads the triage directory so enriched state is fresh before evaluation |
| **6. Evaluate** | Runs every event through the policy YAML; applies safety gates and conflict resolution |
| **7. Write decisions** | Saves `PolicyDecision` artifacts to `system/decisions/` |
| **8. Execute actions** | Creates tasks, appends reading-pack entries, files human queue items; marks decisions `applied` |

After execution the run log is written to `system/runs/`.

### Event status lifecycle

```
pending → enriched → evaluated → actioned
```

Events stay in `system/triage/` throughout. Each evaluation pass is appended to the file body (pass history is append-only). The frontmatter `latest_decision_*` keys are updated on each pass for quick querying.

---

## Human Queue

When the engine cannot confidently decide what to do with an event, it creates a file in `system/human/`. There are two item types.

### `ask_human` — needs a decision

```
system/human/hq_20260219_001.md
```

```yaml
---
type: human-queue-item
id: <uuid>
itemType: ask_human
status: pending
eventRef: 20260219-email-a1b2
question: "Unclear what to do with this item. Options: keep, archive, create task, add to reading pack, draft reply?"
createdAt: 2026-02-19T10:15:00Z
---

## Human Review Required

- **Event ref**: 20260219-email-a1b2
- **Created**: 2026-02-19T10:15:00Z

### Question

Unclear what to do with this item. Options: keep, archive, create task, add to reading pack, draft reply?
```

**To resolve:** Open the file in Obsidian (or any editor), change `status: pending` to `status: resolved`, and add an `answer` field:

```yaml
status: resolved
answer: "Create a task — this needs follow-up by end of week."
```

On the **next pipeline cycle**, the parent event is re-evaluated with your answer injected as context. The item advances to `status: complete` automatically.

### `claude_approval` — approve cloud LLM enrichment

When local enrichment confidence is below `claudeRecommendThreshold` (default 0.60), the engine creates an approval item:

```yaml
---
type: human-queue-item
id: <uuid>
itemType: claude_approval
status: pending
eventRef: 20260219-email-b3c4
localConfidence: 0.48
reason: "Local LLM confidence (0.48) below recommendation threshold (0.60)."
---
```

**To approve:** Change `status: pending` to `status: approved`.
**To skip:** Change to `status: declined`.

On the next cycle, Claude haiku runs enrichment automatically if approved. No further action needed.

---

## Reading Packs

FYI events are consolidated into daily Obsidian notes:

```
system/artifacts/reading-packs/2026-02-19.md
```

Multiple events from the same cycle are appended to the same note. Open during your scheduled review session to catch up on informational content that didn't need immediate action.

---

## Run Logs

Every cycle writes a run log to `system/runs/`. These are useful for understanding what happened and diagnosing unexpected classifications:

```
system/runs/run_20260219_a1b2.md
```

The frontmatter contains cycle summary counts:

```yaml
---
type: run-log
runId: run_20260219_a1b2
policyVersion: 1.0.0
startedAt: 2026-02-19T10:10:00Z
eventsProcessed: 14
eventsActioned: 11
humanItemsCreated: 2
claudeApprovalsRequested: 1
---
```

The body includes a full decision table and detailed predicate trace for any `ASK_HUMAN` or HIGH-risk events.

---

## Troubleshooting

### Event stuck in `pending`

LocalFoundry may not be running, or the enrichment timed out. Check:

1. Is LocalFoundry running? (`curl http://localhost:1234/v1/models`)
2. Check `system/runs/` for errors in the last cycle's log
3. The event will be re-attempted on the next cycle

### Unexpected classification

1. Find the event in `system/triage/` — the body shows the full pass history with predicate trace
2. Find the decision in `system/decisions/` — the body shows which rule fired and why
3. Adjust the rule in your policy YAML (raise/lower priority, tighten the predicate)

### Human queue items not being picked up

The item must have `status: resolved` (for `ask_human`) or `status: approved` (for `claude_approval`) in the frontmatter. Confirm the YAML frontmatter is valid — gray-matter will silently skip malformed files.

### See the policy-rules guide

For customising rules, adding new event sources, or understanding the predicate DSL, see [policy-rules.md](policy-rules.md).
