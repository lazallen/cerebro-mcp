# Research: Cerebro Policy Engine (019)

**Date**: 2026-02-19 | **Branch**: `019-policy-engine`

---

## 1. Predicate DSL Design

**Decision**: Custom recursive TypeScript discriminated union tree — no external rules library.

**Rationale**: The predicate language needs to be:
- Serialisable directly to YAML (human editable in Obsidian)
- Evaluatable against arbitrary dot-path fields on a TriageEvent
- Deterministic with well-defined missing-field behaviour (`false`, not throw)
- Small enough to fully test in isolation

**Alternatives considered**:
| Option | Reason rejected |
|--------|----------------|
| `json-rules-engine` | Callback-based API, not YAML-serialisable, mutable side-effects during evaluation |
| `jsonata` | Expression language not readable in YAML config; adds 100k+ bundle |
| `cel-go` / `cel-js` | JS port incomplete; CEL complexity exceeds requirements |
| Durable Rules / Drools | JVM or cloud-dependency; far beyond scope |

**DSL structure** (TypeScript discriminated union):

```typescript
type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: string; op: 'eq' | 'neq' | 'contains' | 'matches' | 'in' | 'domain_in' | 'gte' | 'lte'; value: unknown };
```

Evaluation rules:
- `all` — short-circuits on first false
- `any` — short-circuits on first true
- `not` — negates inner
- `field` — resolves dot-path on event object (undefined → `false` for boolean ops; `false` for numeric; no throw)
- `matches` — JavaScript `RegExp` from string value
- `domain_in` — extracts domain from email address field and checks array membership
- `in` — checks if field value is in provided array

---

## 2. Artifact Format

**Decision**: Frontmatter-enriched markdown (`.md`) using `gray-matter` for all system/ artifacts.

**Rationale**:
- `gray-matter` v4.0.3 already in `package.json`; proven in `journal-parser.ts` and `journal-writer.ts`
- Artifacts live in Obsidian vault → must be human-readable Markdown
- Machine-readable fields (intent, status, idempotency keys) in YAML frontmatter
- Narrative/history/trace in Markdown body
- Matches existing `event-writer.ts` pattern with atomic temp+rename writes

**Scalars in frontmatter** (machine-readable):
```yaml
---
type: triage-event            # artifact discriminator
eventId: 20260219-email-a1b2  # stable unique ID
source: email
status: pending               # pending | enriched | evaluated | actioned
pass_count: 1
latest_pass_timestamp: 2026-02-19T08:00:00Z
extracted_intent: NEWSLETTER
extracted_confidence: 0.92
---
```

**History sections in body** (human-readable, append-only):
```markdown
## Evaluation History

### Pass 1 — 2026-02-19T08:00:00Z (policy: email-triage@1.0.0)
- Rule matched: newsletter-auto-archive (priority 900)
- Intent: NEWSLETTER | Confidence: 0.92 | Risk: LOW
- Actions: CATEGORY → ReadLater/Newsletter, MOVE → Archive
- Terminal: true
```

**Rejected**: Pure JSON — not readable in Obsidian; doesn't match established `event-writer` pattern.

---

## 3. LLM Tiers

### Tier 1: phi-4-mini (automatic, LocalFoundry)

- **Client**: `LocalFoundryClient` — already integrated in `src/services/localfoundry/`
- **Context limit**: ~2,048 tokens usable input; truncation required for emails > ~1,500 words
- **Use case**: Every new triage event; extract `intent`, `confidence` (0–1), `summary`, `entities[]`
- **Prompt pattern**: Structured JSON-output prompt; system role defines taxonomy; event body + signals as user role
- **Truncation**: If body > 1,500 tokens, use `bodyPreview` + signals only; record `extracted.truncated: true`

### Tier 2: Claude (gated, Anthropic API)

- **Package**: `@anthropic-ai/sdk` — **needs adding** to `package.json`
- **Model**: `claude-haiku-4-5-20251001` for enrichment (cost-effective; ~8k context)
- **Trigger**: Only when `claude_approval` item in `system/human/` has `status: approved`
- **Use case**: Complex intent resolution, cross-event synthesis, nuanced risk assessment
- **Cost guard**: `ClaudeEnrichmentService` checks for valid `claude_approval` item before every invocation; throws if missing

### Claude recommendation threshold

**Decision**: `claudeRecommendThreshold: 0.6` (configurable in policy defaults).

- Below 0.6 → local LLM uncertain → write `claude_approval` item to `system/human/`
- 0.6–0.74 → policy evaluates but may still escalate via safety gates
- ≥ 0.75 → confident; proceed to policy evaluation (configurable via `approvalThreshold`)

---

## 4. Human Queue Contract

**Decision**: Chokidar `change` event on `system/human/` with `awaitWriteFinish: { stabilityThreshold: 500 }`.

**Rationale**: `chokidar` v4.0.3 already in `package.json`. On next heartbeat cycle, `HumanQueueProcessor` scans `system/human/` for items with `status: resolved | approved | declined` and re-triggers policy evaluation.

**File format** (frontmatter markdown):

```yaml
---
type: human-queue-item
id: hq_20260219_a1b2
itemType: ask_human            # ask_human | claude_approval
eventRef: 20260219-email-a1b2
status: pending                # pending → resolved/approved/declined → complete
createdAt: 2026-02-19T08:00:00Z
resolvedAt: ~
answer: ~                      # populated by user for ask_human
approvalRef: ~                 # populated by enrichment stage after claude_approval
---

## Question

Unclear what to do with this email. Keep, archive, task, read-pack, or draft?

## Context

Subject: Re: Q1 budget review
From: unknown-sender@external.example
Received: 2026-02-19T07:45:00Z
Local LLM confidence: 0.55
```

**Status lifecycle**:
```
pending → resolved (ask_human: user sets answer)
        → approved | declined (claude_approval: user approves or declines)
        → complete (set by engine after successful re-evaluation)
```

Items are **never deleted** — preserved for audit trail.

---

## 5. Multi-Pass EvaluationPass History

**Decision**: Append-only `### Pass N` sections in markdown body; aggregate scalars in frontmatter.

**Rationale**: Each pass must be inspectable independently. Frontmatter scalars enable quick filtering without parsing body. Append-only body ensures prior passes are never overwritten.

**Frontmatter scalars updated each pass**:
- `pass_count` (increment)
- `latest_pass_timestamp`
- `status` (pending → enriched → evaluated → actioned)
- `extracted_*` fields overwritten with latest enrichment
- `latest_decision_intent`, `latest_decision_confidence`

**Body section** (appended, never modified):
```markdown
### Pass 2 — 2026-02-19T09:30:00Z (policy: email-triage@1.0.0)
- LLM tier: claude (approved: hq_20260219_a1b2)
- Intent: ACTION_REQUIRED | Confidence: 0.88 | Risk: MEDIUM
- Rules evaluated: 6 / Matched: action-required-create-task
- Actions: CATEGORY → Triage/Action, CREATE_TASK, FLAG
- Terminal: true
```

---

## 6. Source Tree Architecture

**Decision**: Split into `src/lib/policy/` (pure evaluation, no I/O) and `src/lib/triage/` (artifact I/O layer).

**Rationale**:
- Pure evaluation library is independently testable without file system
- I/O layer uses existing `EventWriter` / `gray-matter` patterns
- Heartbeat task (`policy-pipeline-task.ts`) wires them together
- Matches project's existing separation: `src/lib/` for reusable utilities, `src/services/` for orchestration

**Ingestion refactor**: `email-triage-task.ts` will be refactored to compute signals only and write TriageEvent to `system/triage/`. The `moveEmail` call will be removed — the executor takes over that responsibility.

---

## 7. Idempotency

**Decision**: Key format `event:<eventId>:action:<type>:policy:<version>:v1`

- Generated deterministically at evaluation time (not execution time)
- Applied-action log stored in `system/runs/<run_id>.md` frontmatter
- On executor startup, applied keys are loaded from the run log for the current cycle
- Across cycles, applied keys are checked against the decision artifact's `actions[].applied` flag (written by executor)

---

## 8. Task Architecture Within Heartbeat

**Decision**: Single `policy-pipeline` orchestrator task type; stages run sequentially within one task execution.

**Stages** (executed in order within one `execute()` call):
1. Scan `system/triage/` for events with `status: pending | enriched`
2. Run phi-4-mini enrichment on events with `status: pending`
3. Check `system/human/` for resolved items → re-queue parent events
4. Run policy evaluation on all enriched events
5. Write decisions to `system/decisions/`
6. Run executor on pending decisions
7. Process approved `claude_approval` items → run Claude → re-evaluate

**Rationale**: Single task avoids complex inter-task state passing. Each stage is independently restartable (idempotent artifact state). If a stage fails, subsequent stages skip that event gracefully.

---

## 9. Policy YAML vs JSON

**Decision**: YAML for policy config; JSON for structured runtime types.

**Rationale**:
- YAML supports inline comments — essential for a human-maintained policy file
- Policy file lives in the vault and is edited in Obsidian
- Runtime TypeScript types use `js-yaml` (bundled with `gray-matter`) for parsing
- Validation: Zod schema validates parsed YAML at load time; hard fail on invalid config

---

## Open Questions Resolved

| Question | Resolution |
|----------|-----------|
| Archive folder resolution | Human-readable folder name primary; optional fallback ID in config (from clarification Q1) |
| Artifact format | Frontmatter markdown (matches codebase, readable in Obsidian) |
| Claude confidence threshold | 0.6 (configurable via `claudeRecommendThreshold`) |
| Human queue detection | Chokidar watch + next heartbeat scan |
| Task architecture | Single `policy-pipeline` orchestrator task |
