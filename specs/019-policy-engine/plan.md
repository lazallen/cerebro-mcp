# Implementation Plan: Policy Engine

**Branch**: `019-policy-engine` | **Date**: 2026-02-19 | **Spec**: [spec.md](spec.md)

---

## Summary

Build a source-agnostic, deterministic policy engine that reads structured `TriageEvent` artifacts from `system/triage/` (written by heartbeat ingestion tasks), evaluates them against a versioned YAML policy, and produces `PolicyDecision` artifacts to `system/decisions/`. An executor applies decisions idempotently to source systems. A two-tier LLM design runs phi-4-mini automatically for enrichment and gates Claude behind explicit user approval in `system/human/`. The engine is config-driven — all tuning (rules, thresholds, labels, folders) is done in the policy YAML with no code changes.

---

## Technical Context

**Language/Version**: TypeScript 5.3.3, Node.js ≥18
**Primary Dependencies**: gray-matter ^4.0.3, chokidar ^4.0.3, proper-lockfile ^4.1.2, @anthropic-ai/sdk (to add), js-yaml (bundled with gray-matter), zod (validate policy at load)
**Storage**: Frontmatter-enriched markdown files under `{rootDir}/system/`; no database
**Testing**: jest (existing); 80% coverage gate per constitution
**Target Platform**: Linux/WSL2 server (Node.js process within existing heartbeat service)
**Project Type**: Single project — extends `src/` of existing Cerebro MCP
**Performance Goals**: Evaluate 50 events per cycle in <10s total; individual predicate evaluation <1ms
**Constraints**: phi-4-mini context ~2k tokens; Claude enrichment only with approved `claude_approval` item; no destructive ops without human gate; policy load fails hard on invalid YAML
**Scale/Scope**: Single-user Obsidian vault; ~50 events/cycle; ~200 events/day at steady state

---

## Constitution Check

*Re-check: Initial pass — no violations.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Documentation-First | ✅ Pass | README, .env.example, quickstart.md, inline JSDoc planned |
| II. Service Architecture | ✅ Pass | Follows TaskHandler interface; pino logger throughout; strict TypeScript |
| III. Testing Standards | ✅ Pass | Unit tests for pure evaluator; integration tests for pipeline; 80% coverage target |
| IV. MCP Tool Design | ✅ Pass | No new MCP tools in this feature; policy pipeline is internal heartbeat task |
| V. Dashboard Integration | ✅ N/A | No auth/dashboard changes in this feature |

**Complexity Note**: The `src/lib/policy/` split (pure library separate from I/O) adds a layer but is justified: it enables deterministic unit testing of evaluation logic without file system mocking, and mirrors the spec's "deterministic, auditable" principle.

---

## Project Structure

### Documentation (this feature)

```text
specs/019-policy-engine/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions and rationale
├── data-model.md        # Phase 1 output — all TypeScript types
├── quickstart.md        # Phase 1 output — integration guide
├── contracts/           # Phase 1 output
│   ├── types.ts         # All type definitions (authoritative)
│   ├── interfaces.ts    # Service interfaces
│   └── default-policy.yaml  # Shipped default policy
├── policies/
│   └── email-triage.v1.yaml  # Pre-existing email-specific policy example
├── fixtures/            # Test fixture events
│   └── emails/
│       ├── newsletter_1.json
│       ├── receipt_1.json
│       ├── spam_1.json
│       ├── scheduling_1.json
│       ├── action_required_1.json
│       └── fyi_1.json
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── policy/
│   │   ├── index.ts              # Public API exports
│   │   ├── evaluator.ts          # PolicyEvaluator — pure, no I/O
│   │   ├── predicate.ts          # Predicate DSL interpreter
│   │   ├── safety-gates.ts       # Safety gate logic (post-evaluation)
│   │   ├── conflict-resolver.ts  # Action conflict resolution
│   │   ├── idempotency.ts        # Idempotency key generation
│   │   └── policy-loader.ts      # YAML parser + Zod validation
│   └── triage/
│       ├── index.ts              # Public API exports
│       ├── triage-event-store.ts  # TriageEvent artifact I/O
│       ├── decision-store.ts      # PolicyDecision artifact I/O
│       ├── human-queue-store.ts   # HumanQueueItem artifact I/O
│       ├── run-log-writer.ts      # RunLog artifact writer
│       └── artifact-writer.ts    # Shared atomic write utilities (wraps EventWriter)
│
├── services/
│   ├── heartbeat/
│   │   ├── tasks/
│   │   │   ├── email-ingestion-task.ts   # Refactored from email-triage-task.ts
│   │   │   │                              # (signals only; remove moveEmail call)
│   │   │   ├── policy-pipeline-task.ts   # New: orchestrator task
│   │   │   ├── email-triage-task.ts      # EXISTING — to be replaced/refactored
│   │   │   ├── journal-triage-task.ts    # EXISTING — update to write to system/triage/
│   │   │   └── task-registry.ts          # Updated: register policy-pipeline
│   │   ├── heartbeat-service.ts          # Updated: eventsDir → system/triage/
│   │   └── ... (existing files unchanged)
│   │
│   └── enrichment/
│       ├── local-enrichment-service.ts   # phi-4-mini via LocalFoundryClient
│       └── claude-enrichment-service.ts  # Claude via @anthropic-ai/sdk
│
└── types/
    └── heartbeat.ts  # Updated: add PolicyPipelineConfig to task config union

tests/
├── unit/
│   ├── policy/
│   │   ├── evaluator.test.ts        # Pure evaluation — newsletter/receipt/spam/etc
│   │   ├── predicate.test.ts        # DSL operators — all/any/not, eq/neq/contains/etc
│   │   ├── safety-gates.test.ts     # Gate logic — low confidence, high risk, DRAFT_REPLY
│   │   ├── conflict-resolver.test.ts # ASK_HUMAN blocks MOVE
│   │   └── idempotency.test.ts      # Key generation stability
│   └── triage/
│       ├── triage-event-store.test.ts
│       ├── human-queue-store.test.ts
│       └── run-log-writer.test.ts
└── integration/
    └── policy-pipeline.test.ts      # End-to-end pipeline against fixture events

# Test fixtures (symlinked from specs/):
tests/fixtures/ → specs/019-policy-engine/fixtures/
```

**Structure Decision**: Single project (`src/`) extending the existing Cerebro MCP server. New code lives under `src/lib/` (pure libraries) and `src/services/enrichment/` (LLM services). The heartbeat task layer in `src/services/heartbeat/tasks/` is extended with two new task types: `email-ingestion` (refactored) and `policy-pipeline` (new).

---

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| `src/lib/policy/` pure library split | Enables deterministic unit testing without file system; spec requires "same input → same output" property | Mixing I/O and evaluation logic makes determinism impossible to verify in tests |
| Two-tier LLM (local + Claude) | Spec requirement: cost control with programmatic execution post-approval | Single tier: either always-expensive (Claude) or always-limited (local only) |
| Custom predicate DSL | Must be YAML-serialisable, deterministic, missing-field-safe | json-rules-engine: callback-based, not YAML-serialisable; CEL: too complex |
| Append-only EvaluationPass history | Multi-pass enrichment requires all prior passes to remain readable | Overwrite pattern destroys audit trail required by FR-022 |
