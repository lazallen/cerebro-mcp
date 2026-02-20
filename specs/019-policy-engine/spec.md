# Feature Specification: Cerebro Policy Engine

**Feature Branch**: `019-policy-engine`
**Created**: 2026-02-19
**Status**: Draft

---

## 0. Context

The Cerebro heartbeat captures signals from multiple external sources — email, calendar, Slack, journal — and writes each as a structured artifact into a **triage directory** within a `system/` workspace in the Obsidian vault. The **policy engine** reads from that directory and produces decisions about what to do with each event. It never touches source systems directly; that is the executor's job.

Events can be **re-evaluated multiple times** as context is layered on (e.g., an email arrives, then a related calendar invite is linked, then a reply comes in — the policy re-evaluates with richer context each time).

The policy engine is:
- **deterministic** — same input → same output
- **config-driven** — rules in YAML/JSON, no code changes to tune behaviour
- **auditable** — trace which rules fired and why
- **safe-by-default** — approval gates; no destructive ops; humans decide on ambiguity

### System Directory Layout

All Cerebro-managed artifacts live under `{vaultRoot}/system/`:

```
system/
  triage/           # TriageEvent artifacts — written by ingestion, read by policy engine
  decisions/        # PolicyDecision artifacts — written by policy engine, read by executor
  human/            # Items requiring user input (see §Human Escalation)
  runs/             # Per-heartbeat run logs
  artifacts/
    tasks/          # Created task notes
    reading-packs/  # Daily reading pack notes (one per day, appended)
    drafts/         # Draft replies awaiting user approval
```

### Processing Pipeline

Each heartbeat cycle runs these stages in order:

1. **Ingestion** — fetch raw events from source systems; compute deterministic heuristic signals; write `TriageEvent` artifacts to `system/triage/`
2. **Local LLM enrichment** *(automatic)* — run phi-4-mini against each new triage event; populate `extracted` fields (intent, confidence, summary, entities) within its context and capability constraints
3. **Policy evaluation** — read enriched `TriageEvent` artifacts; evaluate rules; write `PolicyDecision` artifacts to `system/decisions/`; queue any human items to `system/human/`
4. **Executor** — read pending `PolicyDecision` artifacts; apply actions idempotently to source systems; write outcomes back to the run log
5. **Human queue processing** *(async)* — user resolves items in `system/human/`; resolved items trigger re-evaluation of their parent event on the next cycle

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Auto-triage Low-Signal Events (Priority: P1)

A user receives newsletters, receipts, automated notifications, and other low-signal events throughout the day. The policy engine classifies and resolves these automatically — applying labels, moving emails to the right folder, or archiving — so the triage directory stays actionable without any manual intervention.

**Why this priority**: Highest volume, lowest risk. Proving the core evaluation loop on clear-cut cases builds confidence before tackling ambiguous ones.

**Independent Test**: Can be fully tested by running the engine against a fixture set of newsletter and receipt events and verifying all are classified, labelled, and produce a complete audit trace — no human review step required.

**Acceptance Scenarios**:

1. **Given** a triage event from an email with bulk/automated signals and an unsubscribe cue, **When** the engine evaluates it, **Then** it is classified as NEWSLETTER, a label action and archive action are produced, and the decision is terminal with confidence ≥ 0.9.
2. **Given** a receipt-pattern email event, **When** evaluated, **Then** it is classified as RECEIPT, labelled and archived, terminal.
3. **Given** the same event evaluated twice with identical policy and config, **When** both outputs are compared, **Then** they are bitwise identical including action ordering and trace entries.

---

### User Story 2 — Safety Gates Block Risky Automation (Priority: P1)

When an event is ambiguous, high-risk, or low confidence, the engine flags it for the user rather than acting. Archive and other destructive-adjacent actions are suppressed until the human resolves the flag.

**Why this priority**: Trust depends entirely on the system never taking a harmful automated action. One wrong archive destroys confidence.

**Independent Test**: Can be fully tested by running the engine against low-confidence or high-risk fixture events and confirming ASK_HUMAN is always present and MOVE/ARCHIVE is always suppressed.

**Acceptance Scenarios**:

1. **Given** an event where no rule matches and confidence is below the approval threshold, **When** evaluated, **Then** ASK_HUMAN is present and no archive/move action is included.
2. **Given** an event classified HIGH risk, **When** evaluated, **Then** ASK_HUMAN is always present unless the sender is on the priority allowlist and a rule explicitly grants override.
3. **Given** a decision containing both MOVE and ASK_HUMAN, **When** the conflict resolver runs, **Then** MOVE is suppressed until the human flag is resolved.
4. **Given** any DRAFT_REPLY action, **When** produced, **Then** it is always marked as requiring explicit user approval — there is no configuration that removes this requirement.

---

### User Story 3 — Multi-Source Events Are Handled Uniformly (Priority: P1)

Events originate from email, calendar, Slack, and journal sources. The policy engine evaluates all of them through the same rule engine using the same intent taxonomy and safety gates — only the signals differ per source, not the evaluation logic.

**Why this priority**: The policy engine's value as a unified triage layer depends on it being genuinely source-agnostic. A per-source engine would fragment the system.

**Independent Test**: Can be fully tested by running the engine against one fixture per source type (email, calendar, Slack, journal) and verifying all produce valid PolicyDecisions with correct trace entries.

**Acceptance Scenarios**:

1. **Given** a calendar event artifact in the triage directory, **When** evaluated, **Then** the engine produces a PolicyDecision using the same intent/risk/urgency taxonomy as for email events.
2. **Given** a Slack message artifact, **When** evaluated, **Then** source-specific signals (e.g., channel, mention type) feed into predicates, but the output format is identical to other sources.
3. **Given** a journal entry artifact, **When** evaluated, **Then** the engine identifies action items or FYI content and produces appropriate decisions without failing due to missing email-specific fields.

---

### User Story 4 — Multi-Pass Enrichment and Re-evaluation (Priority: P2)

An event is written to the triage directory with partial context. The engine evaluates it and produces a decision. Later, more context is added (a reply arrives, a related calendar invite is linked, an LLM extracts intent). The engine re-evaluates the enriched event and may produce a different decision. Both decisions are traceable.

**Why this priority**: Multi-pass is what makes the triage directory a living workspace rather than a one-shot queue. Essential for handling events that unfold over time.

**Independent Test**: Can be fully tested by running the engine against a fixture event twice — once with sparse context, once with enriched context — and verifying the second decision reflects the enrichment and the trace shows the re-evaluation.

**Acceptance Scenarios**:

1. **Given** an event first evaluated with no extracted intent, **When** re-evaluated after extracted intent and confidence are added, **Then** the new decision reflects the enriched context.
2. **Given** two evaluations of the same event, **When** the trace is inspected, **Then** each pass is recorded with its own timestamp and policy version, and neither overwrites the other.
3. **Given** an event where the first pass produced ASK_HUMAN and a human answer was recorded, **When** re-evaluated, **Then** the human answer is treated as context and the decision no longer produces ASK_HUMAN for the same question.

---

### User Story 5 — Action-Required Events Create Tasks (Priority: P2)

An event signals that the user needs to do something. The engine creates a task artifact in Obsidian with the event subject, source, date, and a link back to the original item. The event is not archived.

**Why this priority**: Task capture converts passive signals into tracked work. Builds directly on the classification accuracy established in P1.

**Independent Test**: Can be fully tested by running the engine against action-required fixture events and verifying a task artifact is generated with correct metadata and no archive action is present.

**Acceptance Scenarios**:

1. **Given** an event with action-request signals, **When** evaluated, **Then** CREATE_TASK is produced with subject, source, date, and origin link.
2. **Given** the same event, **When** evaluated, **Then** no MOVE/ARCHIVE action is present.
3. **Given** a HIGH-risk action-required event from an unknown sender, **When** evaluated, **Then** ASK_HUMAN is added and task creation is gated behind approval.

---

### User Story 6 — FYI Events Build a Reading Pack (Priority: P2)

Informational events — project updates, newsletters the user wants to read, FYI messages — are added to a dated reading pack note. Low-risk FYI events from non-priority senders are archived; priority sender FYI events remain in the inbox.

**Why this priority**: Reading pack creation turns passive overload into a curated, time-boxed reading list.

**Acceptance Scenarios**:

1. **Given** a FYI event from a non-priority sender with LOW risk, **When** evaluated, **Then** CREATE_READING_PACK and MOVE/ARCHIVE are both produced.
2. **Given** a FYI event from a priority sender, **When** evaluated, **Then** CREATE_READING_PACK is produced but MOVE/ARCHIVE is not.
3. **Given** multiple FYI events in one run, **When** evaluated, **Then** all are appended to the same dated reading pack note.

---

### User Story 7 — Human Queue for Approvals and Decisions (Priority: P2)

When an event needs a human decision — because it is ambiguous, high-risk, or because the local LLM recommends Claude enrichment — the system writes a structured item to `system/human/`. The user can review and respond at their own pace in Obsidian (or via a future tool). On the next heartbeat cycle, resolved items automatically trigger re-evaluation of their parent event.

**Why this priority**: Without a defined escalation contract, the system has no way to handle ambiguity safely. Everything that can't be automated must have a clear resting place.

**Independent Test**: Can be fully tested by running the engine against ambiguous fixture events and verifying human queue items are created with correct type, question, and event reference; then simulating a resolution and verifying re-evaluation occurs.

**Acceptance Scenarios**:

1. **Given** an event that the policy engine cannot confidently classify, **When** evaluated, **Then** an `ask_human` item is written to `system/human/` with a unique ID, the question, and a link to the source event.
2. **Given** an event where local LLM confidence is below the Claude-recommendation threshold, **When** evaluated, **Then** a `claude_approval` item is written to `system/human/` explaining why Claude enrichment is suggested.
3. **Given** a human queue item with `status: resolved` and an `answer` field, **When** the next heartbeat runs, **Then** the parent event is re-evaluated with the answer treated as context, and the queue item is marked `status: complete`.
4. **Given** a `claude_approval` item that the user approves, **When** the next heartbeat runs, **Then** Claude enrichment runs programmatically against the event and writes back to the `extracted` fields; the event is then re-evaluated by the policy engine.

---

### User Story 8 — LLM-Assisted Enrichment with Cost Control (Priority: P2)

The local LLM (phi-4-mini) enriches every new event automatically — extracting intent, confidence, and a brief summary within its capability constraints. When the local LLM is not sufficient (low confidence, complex reasoning required, cross-event synthesis needed), the system recommends Claude enrichment but waits for explicit user approval before incurring any cost. Once approved, Claude runs programmatically and the event is re-evaluated.

**Why this priority**: LLM enrichment is what elevates heuristic signals into semantic understanding. The local/cloud split is essential for keeping the system usable without unpredictable cost.

**Independent Test**: Can be fully tested by running ingestion + enrichment against fixture events: verifying local LLM populates `extracted` fields for all events; verifying a `claude_approval` item appears for low-confidence events; verifying Claude enrichment runs and updates the event after simulated approval.

**Acceptance Scenarios**:

1. **Given** a new event in `system/triage/`, **When** the enrichment stage runs, **Then** phi-4-mini populates `extracted.intent`, `extracted.confidence`, `extracted.summary` and these are written back to the event artifact.
2. **Given** an event where `extracted.confidence` is below the configured Claude-recommendation threshold, **When** enrichment completes, **Then** a `claude_approval` item appears in `system/human/` with the event reference and the reason for the recommendation. Claude is NOT invoked yet.
3. **Given** a `claude_approval` item that is approved by the user, **When** the next heartbeat runs, **Then** Claude is invoked programmatically, its output is written to the event's `extracted` fields (potentially including cross-event context), and the event proceeds to policy evaluation.
4. **Given** a `claude_approval` item that the user declines, **When** the next heartbeat runs, **Then** the event proceeds to policy evaluation using only the local LLM extracted fields, with `extracted.claudeEnriched: false` noted in the trace.

---

### User Story 9 — Full Audit Trail for Every Decision (Priority: P3)

Every decision includes a complete trace: which rules evaluated, which predicates matched, what safety gate outcomes occurred, whether evaluation was terminal, and which LLM tier (if any) contributed to enrichment. The user can understand exactly why any event was handled as it was and what it cost.

**Acceptance Scenarios**:

1. **Given** any event, **When** evaluated, **Then** the trace lists every rule evaluated, whether it matched, and which predicates contributed.
2. **Given** a safety gate that overrides a rule action, **When** the trace is inspected, **Then** the gate outcome is recorded with a reason.
3. **Given** a terminal rule, **When** the trace is inspected, **Then** the terminal flag is present and subsequent rules are not listed as evaluated.
4. **Given** an event enriched by the local LLM, **When** the trace is inspected, **Then** it records which LLM tier ran, the confidence score returned, and whether Claude enrichment was recommended.
5. **Given** an event enriched by Claude (after approval), **When** the trace is inspected, **Then** it records that Claude ran, the approval item ID that authorised it, and what fields were updated.

---

### Edge Cases

- **No rule matches**: Engine falls back to UNKNOWN classification, assigns `unknownIntentRisk` from config, and produces ASK_HUMAN if confidence is below threshold.
- **Conflicting actions** (e.g., MOVE + ASK_HUMAN): Conflict resolver suppresses MOVE; ASK_HUMAN takes precedence. Deterministic — no ordering ambiguity.
- **Missing source-specific fields**: Missing predicate paths evaluate to false; engine never throws on absent fields.
- **Malformed or missing policy config**: Engine refuses to run and surfaces a configuration error; does not silently default.
- **Re-evaluation with unchanged context**: Idempotency keys are stable — executor detects previously-applied actions and skips re-execution.
- **Priority sender on bulk-signal event**: Priority sender status overrides bulk/automated signals; event is not archived without explicit acknowledgement.
- **Event from an unsupported source type**: Engine classifies as UNKNOWN and produces ASK_HUMAN; does not fail.

---

## Requirements *(mandatory)*

### Functional Requirements

**Triage Directory & Event Ingestion**

- **FR-001**: The engine MUST read structured event artifacts from a configured triage directory; it MUST NOT fetch from source systems directly.
- **FR-002**: Each artifact MUST carry a `source` field identifying its origin (email, calendar, slack, journal, or other). The engine MUST use this to select applicable signal fields; missing fields for a given source MUST evaluate to false in predicates, not throw.
- **FR-003**: Artifact format MUST be structured (JSON or frontmatter-enriched markdown); the engine MUST be able to parse it without LLM assistance.

**Core Evaluation**

- **FR-004**: The engine MUST expose an `evaluate(policy, events) → PolicyDecision[]` interface accepting a batch of events and a versioned policy.
- **FR-005**: Given identical event input, policy version, and auxiliary config, the engine MUST produce bitwise-identical output on repeated runs.
- **FR-006**: Rules MUST be evaluated in descending priority order; ties broken by policy file order (stable sort).
- **FR-007**: A rule MUST stop further evaluation for that event when marked terminal.
- **FR-008**: The engine MUST produce a complete trace for every decision: each rule evaluated, whether it matched, predicate outcomes, and safety gate results.
- **FR-009**: The engine MUST behave correctly when the optional `extracted` fields (intent, urgency, confidence, entities) are absent.

**Intent & Classification**

- **FR-010**: Every decision MUST include a classification: one intent from the fixed taxonomy, one urgency level, one risk level, and a confidence score (0–1).
- **FR-011**: Intent taxonomy (v1): ACTION_REQUIRED, APPROVAL_REQUEST, SCHEDULING, DELEGATABLE, FYI, NEWSLETTER, RECEIPT, SPAM, UNKNOWN.
- **FR-012**: Urgency levels: NOW, THIS_WEEK, SOMEDAY. Risk levels: LOW, MEDIUM, HIGH.

**Safety Gates**

- **FR-013**: If confidence is below the configured approval threshold, the engine MUST append ASK_HUMAN unless the policy explicitly permits auto-action for that intent + risk combination.
- **FR-014**: Any DRAFT_REPLY MUST be marked as requiring explicit user approval; no configuration path may remove this requirement.
- **FR-015**: HIGH-risk events MUST include ASK_HUMAN unless the sender/author is on the priority allowlist AND a rule explicitly grants override.
- **FR-016**: When a decision contains both a MOVE/ARCHIVE action and ASK_HUMAN, the conflict resolver MUST suppress MOVE/ARCHIVE until the human flag is resolved.
- **FR-017**: All safety gate applications MUST be recorded in the trace.

**Actions**

- **FR-018**: The engine MUST support these action types: LABEL, MOVE, FLAG, CREATE_TASK, CREATE_READING_PACK, DRAFT_REPLY, ASK_HUMAN.
- **FR-019**: Every action MUST carry a stable idempotency key: `event:<eventId>:action:<type>:policy:<version>:v1`. Keys MUST be identical on repeated runs for identical input.
- **FR-020**: The executor MUST skip re-applying any action whose idempotency key is already recorded as applied.

**Multi-Pass Re-evaluation**

- **FR-021**: The engine MUST support re-evaluating an event that has been enriched with additional context since its last evaluation.
- **FR-022**: Each evaluation pass MUST be recorded with its own timestamp and policy version in the event artifact; prior passes MUST NOT be overwritten.
- **FR-023**: A recorded human answer to an ASK_HUMAN question MUST be treated as context in subsequent evaluations and MUST prevent the same question from being re-asked.

**Policy Configuration**

- **FR-024**: Policy MUST be loadable from a human-readable config file (YAML or JSON); tuning rules and thresholds MUST require no code changes.
- **FR-025**: Policy MUST carry a semantic version; version MUST be recorded in every decision and run log.
- **FR-026**: Policy MUST support configurable global defaults: approval threshold, unknown-intent risk, label/folder mappings (name + optional fallback ID), allowlists/blocklists, conflict resolution flags.
- **FR-027**: Predicate DSL MUST support: boolean logic (all/any/not), comparisons (eq, neq, contains, matches/regex, in, domain_in), and numeric comparisons (gte, lte). Paths reference fields on the event artifact using dot notation.
- **FR-028**: Rule actions MUST be declarative; string templates for tasks, reading pack entries, and reply drafts MUST NOT require LLM assistance.
- **FR-029**: The shipped default policy MUST include rules for: NEWSLETTER, RECEIPT, SPAM, SCHEDULING, ACTION_REQUIRED, FYI, and APPROVAL_REQUEST.

**System Directory Layout**

- **FR-030**: All Cerebro-managed artifacts MUST be written under `{vaultRoot}/system/` using the defined subdirectory structure: `triage/`, `decisions/`, `human/`, `runs/`, `artifacts/tasks/`, `artifacts/reading-packs/`, `artifacts/drafts/`.
- **FR-031**: The `eventsDir` / `rootDir` configuration MUST be updated to point to `system/triage/` as the primary ingestion target; no artifacts MUST be written to the legacy `events/` path.

**Human Escalation Queue**

- **FR-032**: When the policy engine produces an ASK_HUMAN action, it MUST write a structured item to `system/human/` with: a unique stable ID, `type: ask_human`, the question text, a reference to the source event, `status: pending`, and a `createdAt` timestamp.
- **FR-033**: When local LLM confidence falls below the configured Claude-recommendation threshold, the enrichment stage MUST write a `type: claude_approval` item to `system/human/` with: the event reference, the local LLM confidence score, and a brief reason why Claude enrichment is recommended. Claude MUST NOT be invoked at this point.
- **FR-034**: Human queue items MUST support two resolution paths: `status: resolved` with an `answer` field (for ask_human), and `status: approved` or `status: declined` (for claude_approval).
- **FR-035**: On each heartbeat cycle, the engine MUST check `system/human/` for items with a resolved/approved/declined status and re-evaluate the parent event using the recorded response as additional context.
- **FR-036**: A resolved human queue item MUST be moved to `status: complete` after the parent event has been successfully re-evaluated; it MUST NOT be deleted so the audit trail is preserved.

**LLM Enrichment**

- **FR-037**: The enrichment stage MUST run the local LLM (phi-4-mini) automatically against every new `TriageEvent` artifact and write the results back to the event's `extracted` fields before policy evaluation runs.
- **FR-038**: The local LLM MUST NOT be given more content than its context window supports; the enrichment stage MUST truncate or summarise input as needed and record any truncation in the event artifact.
- **FR-039**: Claude MUST NEVER be invoked without a resolved `claude_approval` item in `system/human/` for that event. This constraint MUST be enforced in the enrichment stage, not just by convention.
- **FR-040**: When a `claude_approval` item is approved, Claude MUST be invoked programmatically on the next heartbeat cycle; the user MUST NOT need to trigger it manually after giving approval.
- **FR-041**: Claude enrichment output MUST be written to the event's `extracted` fields and MUST include `extracted.claudeEnriched: true` and the approval item ID as a reference.
- **FR-042**: The LLM tier used for enrichment (local / Claude / none) and the confidence score MUST be recorded in the `EvaluationPass` trace for every policy run.
- **FR-043**: Policy rules MUST be able to reference `extracted.claudeEnriched` as a predicate field, enabling rules that behave differently depending on whether Claude enrichment has run.

**Run Logging**

- **FR-044**: For every heartbeat run the engine MUST write a run log to `system/runs/<run_id>.md` including: policy id/version, query/time window, events processed summary, all decisions, full trace for any ASK_HUMAN or HIGH-risk decisions, and a count of Claude approvals requested vs granted in this cycle.
- **FR-045**: Reading pack entries MUST be appended to `system/artifacts/reading-packs/YYYY-MM-DD.md`, with multiple FYI events from the same run consolidated into a single note.

---

### Key Entities

- **TriageEvent**: A structured artifact in the triage directory representing one external signal. Contains a unique event ID, source type, normalized common fields (subject/title, author/sender, received timestamp, snippet/body), source-specific signals (derived deterministically), and optional extracted fields (intent, urgency, confidence, entities) from prior enrichment passes. Also carries the history of prior evaluation passes.

- **EventSignals**: Derived boolean/scalar values computed from the raw event data without LLM assistance. Common signals: `isAutomated`, `isBulk`, `hasAttachments`, `mentionsMoney`, `mentionsMeeting`, `asksForAction`, `prioritySender`. Source-specific signals extend this set.

- **Policy**: A versioned, human-readable config containing global defaults and an ordered list of rules. Each rule has a priority, a predicate, a set of declarative actions, an optional classification override, and a terminal flag.

- **Predicate**: A composable, declarative condition tree evaluated against a TriageEvent. Leaf nodes test individual fields via the DSL operators; branch nodes apply boolean logic. All evaluation is deterministic and side-effect free. Missing paths evaluate to false.

- **PolicyDecision**: The output for one event. Contains the classification (intent, urgency, confidence, risk, rationale), an ordered list of actions (each with type, parameters, idempotency key, and approval flags), and a full trace of rule evaluations and gate outcomes.

- **Action**: A planned operation. Types: LABEL, MOVE, FLAG, CREATE_TASK, CREATE_READING_PACK, DRAFT_REPLY, ASK_HUMAN. Each carries its parameters, an idempotency key, a `requiresApproval` flag, and (for MOVE) a resolved folder reference (name + optional fallback ID).

- **EvaluationPass**: A record of one engine run against a TriageEvent. Contains the policy version used, the timestamp, the resulting PolicyDecision, and the trace. Stored within the event artifact to support multi-pass enrichment.

- **HumanQueueItem**: A structured artifact in `system/human/` representing a pending human interaction. Has a unique stable ID, a `type` (either `ask_human` or `claude_approval`), a reference to the parent event, a question or reason, a `status` field (`pending` → `resolved`/`approved`/`declined` → `complete`), and an optional `answer` field. Never deleted — preserved for audit.

- **EnrichmentResult**: The output of an LLM enrichment pass. Records which tier ran (local / Claude), the confidence score, the populated `extracted` fields, any truncation applied, and (for Claude) the approval item ID that authorised the run.

- **RunLog**: A per-heartbeat record written to `system/runs/`. Captures policy version, query, events processed, decisions summary, detailed trace for flagged/high-risk items, and a count of Claude approvals requested vs granted in the cycle.

- **ReadingPack**: A dated note in `system/artifacts/reading-packs/` aggregating FYI event entries for a scheduled reading session. One note per day, appended across runs.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of events classified as NEWSLETTER, RECEIPT, or SPAM are labelled and actioned in the same heartbeat run with no manual intervention.
- **SC-002**: 0 cases where a MOVE/ARCHIVE action is applied when ASK_HUMAN is also present in the same decision.
- **SC-003**: 100% of decisions include a non-empty trace documenting evaluated rules and gate outcomes.
- **SC-004**: Repeated engine runs over the same stored event fixtures produce identical decisions and traces on 100% of runs.
- **SC-005**: 100% of DRAFT_REPLY actions carry a requires-approval flag; no configuration path removes it.
- **SC-006**: 100% of HIGH-risk events include ASK_HUMAN unless sender is allowlisted with explicit rule override.
- **SC-007**: Re-running the engine over already-processed events results in 0 duplicate action executions (idempotency verified).
- **SC-008**: The default policy produces correct decisions for representative fixture events across all 7 required intent categories.
- **SC-009**: A run log is created in `system/runs/` for every heartbeat run within the same cycle.
- **SC-010**: Policy tuning (changing thresholds, labels, rules) requires changes only to the config file — 0 code changes needed.
- **SC-011**: The engine correctly evaluates fixture events from at least 3 distinct source types (email, calendar, Slack) using the same rule set.
- **SC-012**: A re-evaluated enriched event produces a different decision than the sparse-context first pass in at least the fixture scenarios provided.
- **SC-013**: 100% of new triage events receive local LLM enrichment before policy evaluation in the same heartbeat cycle, with truncation recorded when input exceeds the model's context limit.
- **SC-014**: Claude is invoked in 0% of cases without a corresponding approved `claude_approval` item in `system/human/` — verified across all fixture runs.
- **SC-015**: Once a `claude_approval` item is marked approved, Claude enrichment runs automatically on the next heartbeat cycle with no additional user action required.
- **SC-016**: All artifacts (triage events, decisions, human queue items, run logs, reading packs, tasks, drafts) land in the correct `system/` subdirectory — 0 artifacts written to the legacy `events/` path after migration.

---

## Assumptions

- The heartbeat system (Feature 017) is the orchestration layer; the policy engine, enrichment stage, and executor each run as distinct heartbeat tasks in a defined sequence within each cycle.
- Event signals (isAutomated, isBulk, mentionsMeeting, etc.) are computed by the ingestion layer before artifacts reach `system/triage/`; the policy engine does not re-parse raw source data.
- The Obsidian vault is writable by the heartbeat system at all paths under `system/`; the vault root is configured via `rootDir` in the heartbeat config.
- Artifact format will be decided during planning; JSON is preferred for machine parsing but frontmatter-enriched markdown is acceptable if it meets parsing requirements without ambiguity.
- The existing email triage task (Feature 017) will be restructured as part of this feature: the immediate `moveEmail` action will be removed from ingestion; the task will instead compute heuristic signals and write a `TriageEvent` artifact to `system/triage/`. The policy engine + executor take over responsibility for all subsequent actions.
- phi-4-mini is available via the LocalFoundry client already integrated into the heartbeat system; it is the default enrichment model and runs automatically.
- Claude is available via the Anthropic API; it is only invoked when a `claude_approval` item in `system/human/` has `status: approved`. The API key and invocation are managed by the heartbeat system.
- The notification mechanism for `system/human/` items (how the user is alerted that items are waiting) is out of scope for this feature and will be designed separately. The contract (file format, status lifecycle) is in scope.
- "Priority sender" is a boolean signal (`prioritySender: true`) pre-computed from the user's configured allowlist; the engine does not perform contact lookup.
- Folder/label references in the policy config use human-readable names as primary, with optional fallback IDs. Runtime resolution prefers name; falls back to ID if name lookup fails.
- FYI events from non-priority senders are archived after a reading pack entry is created; FYI events from priority senders are kept in the inbox.
- The blocklist for spam detection is part of the policy config, not a separate service.
- Events in the triage directory are processed in the order provided by the caller; ordering of the input is the heartbeat task's responsibility.
- The Claude-recommendation confidence threshold is configurable in the policy defaults; a sensible starting value will be determined during planning.
