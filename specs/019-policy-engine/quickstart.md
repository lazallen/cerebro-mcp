# Quickstart: Policy Engine Integration (Feature 019)

This guide covers how the policy engine fits into the Cerebro heartbeat system
and how to configure and extend it.

---

## 1. Prerequisites

- Feature 017 (heartbeat system) running
- `rootDir` configured in `heartbeat-config.json` pointing to your Obsidian vault
- LocalFoundry running locally with phi-4-mini loaded (for LLM enrichment)
- `ANTHROPIC_API_KEY` set in `.env` (for Claude enrichment — optional)

---

## 2. System Directory Layout

The policy engine reads and writes under `{rootDir}/system/`. This directory is
**created automatically** on first run. Do not create it manually.

```
{rootDir}/system/
  triage/           ← TriageEvent artifacts written by ingestion tasks
  decisions/        ← PolicyDecision artifacts written by the policy engine
  human/            ← HumanQueueItem artifacts requiring user input
  runs/             ← Per-cycle run logs
  artifacts/
    tasks/          ← Created Obsidian task notes
    reading-packs/  ← Daily reading pack notes (appended)
    drafts/         ← Draft replies awaiting approval
  context/          ← (Feature 021) Context bundles for LLM injection
```

**Breaking change from Feature 017**: The legacy `{rootDir}/events/` path is
no longer used. Update your `heartbeat-config.json` `rootDir` if needed. All
ingestion tasks now write to `system/triage/`.

---

## 3. Add the Policy Pipeline Task

Add a `policy-pipeline` task to your `heartbeat-config.json`:

```json
{
  "rootDir": "./data",
  "tasks": [
    {
      "id": "email-ingestion-hourly",
      "name": "Email Ingestion",
      "type": "email-ingestion",
      "schedule": "0 * * * *",
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
      "schedule": "5 * * * *",
      "enabled": true,
      "config": {
        "policyFile": "system/policies/default-triage.yaml",
        "maxEvents": 50,
        "enableClaudeEnrichment": true,
        "localLlmTimeout": 30000,
        "claudeLlmTimeout": 60000
      }
    }
  ]
}
```

The policy pipeline runs 5 minutes after ingestion to ensure new events are
written before evaluation starts.

---

## 4. Install Your Policy File

Copy the default policy to your vault:

```bash
cp specs/019-policy-engine/contracts/default-policy.yaml \
   {your-vault}/system/policies/default-triage.yaml
```

Edit `default-triage.yaml` to customise your rules:

```yaml
defaults:
  senderAllowlist:
    - "boss@company.com"      # These senders bypass bulk/automated rules
  senderBlocklistDomains:
    - "cheap-deals.example"   # These domains auto-classify as SPAM

  folders:
    archive: "Archive"        # Human-readable folder name; executor resolves to ID
```

No code changes required to add, remove, or modify rules.

---

## 5. Environment Variables

Add to your `.env` (see `.env.example` for full reference):

```env
# Required for Claude enrichment (optional — system works without it)
ANTHROPIC_API_KEY=sk-ant-...

# LocalFoundry (already configured for Feature 017)
LOCALFOUNDRY_HOST=http://localhost:1234
```

---

## 6. Understanding the Triage Pipeline

Each heartbeat cycle (when `policy-pipeline` fires):

```
system/triage/          system/human/        system/decisions/
  (pending events)          (resolved items)      (pending decisions)
       │                         │                       │
       ▼                         ▼                       │
  [1] Local LLM enrichment   [3] Human queue scan        │
       │                         │                       │
       ▼                         ▼                       │
  [2] Policy evaluation ─────────┘                       │
       │                                                 │
       ▼                                                 │
  [4] Write decisions ─────────────────────────────────▶ │
                                                         ▼
                                                   [5] Executor
                                                  (applies actions
                                                   to source systems)
```

**Stage detail**:

| Stage | Input | Output |
|-------|-------|--------|
| 1. Local enrichment | `status: pending` events | Events updated to `status: enriched`; `extracted.*` fields populated |
| 2. Policy evaluation | `status: enriched` events | `PolicyDecision` artifacts in `system/decisions/` |
| 3. Human queue scan | Resolved items in `system/human/` | Parent events re-queued for re-evaluation |
| 4. Decisions written | Policy decisions | Decision artifacts with idempotency keys |
| 5. Executor | Pending decisions | Actions applied to source systems; decisions marked `applied` |

---

## 7. Handling Human Queue Items

Items in `system/human/` appear when the engine needs a decision:

### ask_human items

```yaml
---
type: human-queue-item
id: hq_20260219_0001
itemType: ask_human
status: pending
eventRef: 20260219-email-a1b2
---

## Question

Unclear what to do with this email. Options: keep, archive, task, reading pack, or draft reply?

## Context

Subject: Re: Q1 budget discussion
From: unknown@external.example
Local LLM confidence: 0.52
```

To resolve: open in Obsidian, change `status: pending` to `status: resolved`
and add an `answer` field:

```yaml
status: resolved
answer: "Create a task - this needs follow-up."
```

On the next heartbeat cycle, the parent event is re-evaluated with your answer
as context.

### claude_approval items

```yaml
---
type: human-queue-item
id: hq_20260219_0002
itemType: claude_approval
status: pending
eventRef: 20260219-email-b3c4
localConfidence: 0.48
---

## Claude Enrichment Request

Local LLM confidence (0.48) is below the Claude-recommendation threshold (0.60).
Claude enrichment may produce a better classification.

To approve, change status to: approved
To decline, change status to: declined
```

Change `status: pending` to `status: approved` or `status: declined`. On the
next cycle, Claude enrichment runs automatically if approved — no further action
needed.

---

## 8. Tuning the Policy

### Adjust thresholds

```yaml
defaults:
  approvalThreshold: 0.75        # Below this → ASK_HUMAN may fire
  claudeRecommendThreshold: 0.60 # Below this → claude_approval item created
```

### Add a priority sender

```yaml
defaults:
  senderAllowlist:
    - "alice@company.com"
```

Priority senders bypass bulk/automated detection rules. Their emails will not
be auto-archived as newsletters or bulk mail even if signals suggest they are.

### Add a custom rule

```yaml
rules:
  - id: github-notifications-archive
    priority: 850
    when:
      all:
        - field: "author"
          op: domain_in
          value: ["github.com", "notifications.github.com"]
        - field: "signals.isAutomated"
          op: eq
          value: true
    setClassification:
      intent: FYI
      urgency: SOMEDAY
      risk: LOW
      confidence: 0.92
      rationale:
        - "GitHub automated notification."
    actions:
      - type: CATEGORY
        name: "Dev/GitHub"
      - type: MOVE
        folder: "Archive"
    terminal: true
```

Add this rule with a priority above 900 to run before the generic newsletter
rule, or below 900 to run after it.

---

## 9. Reading Pack Notes

FYI events are consolidated into dated notes at
`system/artifacts/reading-packs/YYYY-MM-DD.md`. Multiple events from the same
run are appended to the same note. Open in Obsidian for your scheduled reading
session.

Example entry:

```markdown
## Reading Pack — 2026-02-19

### Project Horizon Update — Alice <alice@company.com>
Received: 2026-02-19 08:45
Source: email

Alice shared the latest project timeline update. Key milestone: March 15 delivery.

---

### Team Slack Digest — #general (2026-02-19)
Source: slack | Channel: general

Summary of 12 messages: mostly social chatter, one announcement about the all-hands next week.
```

---

## 10. Run Logs

Every pipeline cycle writes a run log to `system/runs/<run_id>.md`. Review
these to understand what happened in each cycle:

```yaml
---
type: run-log
runId: run_20260219_0001
policyVersion: 1.0.0
startedAt: 2026-02-19T08:05:00Z
eventsProcessed: 12
eventsActioned: 10
humanItemsCreated: 2
claudeApprovalsRequested: 1
claudeApprovalsGranted: 0
---
```

The body includes a full decision summary and detailed trace for any
ASK_HUMAN or HIGH-risk events.

---

## 11. Adding a New Event Source

The policy engine is source-agnostic. To add a new source (e.g., Slack):

1. Create a new ingestion task (e.g., `slack-ingestion-task.ts`) that:
   - Fetches messages from Slack
   - Computes `EventSignals` deterministically
   - Writes a `TriageEvent` artifact to `system/triage/` with `source: 'slack'`

2. Register the task in `task-registry.ts`

3. Add it to `heartbeat-config.json`

4. Optionally add Slack-specific rules to your policy YAML:
   ```yaml
   - id: slack-dm-action-required
     priority: 550
     when:
       all:
         - field: "source"
           op: eq
           value: slack
         - field: "sourceData.isDirect"
           op: eq
           value: true
         - field: "signals.asksForAction"
           op: eq
           value: true
     ...
   ```

No changes to the policy engine itself are required.
