# Feature Specification: Vault Context Distiller

**Feature Branch**: `021-context-distiller`
**Created**: 2026-02-19
**Status**: Draft
**Depends on**: 019-policy-engine (context bundle consumed by enrichment stage)

---

## 0. Context

The local LLM (phi-4-mini) used in the 019 policy engine enrichment stage has a very small context window (~1–2k tokens usable for content). To make that window as useful as possible, the system needs a compact, pre-compiled representation of what matters to the user — their people, projects, responsibilities, and learned triage patterns — that can be injected alongside the event being analysed.

This feature defines two things:
1. A **weekly heartbeat task** (the distiller) that reads the Obsidian vault and compiles a structured context bundle, stored in `system/context/`
2. A **context injection layer** used at enrichment time to select and inject the most relevant slices of that bundle into each LLM prompt, respecting a strict token budget

The distiller runs on a schedule (weekly by default, or on-demand). The context bundle it produces is the single source of truth about "who the user is and what they care about" for all LLM calls in the system — both local and Claude.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Weekly Context Compilation (Priority: P1)

Once a week, the heartbeat runs the distiller task. It reads the vault's people notes, project index, areas of responsibility, and triage history, and writes a compact, structured context bundle to `system/context/`. The bundle is versioned so the enrichment stage always knows what context was available when a decision was made.

**Why this priority**: Without this, the LLM enrichment stage has no personalised context. Every event is analysed in isolation, making classification generic and less accurate. This is the foundation everything else builds on.

**Independent Test**: Can be fully tested by running the distiller against the real vault and verifying a well-formed context bundle is written to `system/context/` with all required sections populated and within the defined size limits.

**Acceptance Scenarios**:

1. **Given** the vault contains people notes, project files, and a triage history file, **When** the distiller runs, **Then** a context bundle is written to `system/context/context-bundle.json` containing: sender index, project summary, triage patterns, and a role summary.
2. **Given** the distiller has run previously, **When** it runs again, **Then** the bundle is replaced with an updated version; the previous version is archived with a timestamp so decisions made against it remain traceable.
3. **Given** a vault section is empty or missing (e.g. no project files), **When** the distiller runs, **Then** it completes successfully with that section omitted from the bundle rather than failing.
4. **Given** the distiller has never run, **When** the enrichment stage starts, **Then** it degrades gracefully — enrichment runs without vault context rather than failing.

---

### User Story 2 — Sender Relationship Context (Priority: P1)

When enriching a triage event from an email or Slack message, the system looks up the sender in the compiled sender index and injects their relationship type and a brief note into the LLM prompt. The LLM can then make a more informed classification — treating a direct report's request differently from an unknown sender's cold outreach.

**Why this priority**: Sender context is the highest-value, lowest-token-cost enrichment. A single line ("sender is a direct report") dramatically changes the correct classification of many emails.

**Independent Test**: Can be fully tested by enriching a fixture email from a known person (present in the vault) and verifying the enrichment result reflects the relationship context; then enriching one from an unknown sender and verifying the context is absent.

**Acceptance Scenarios**:

1. **Given** a triage event whose sender email matches a person in the sender index, **When** enrichment runs, **Then** the LLM prompt includes the sender's relationship type and any triage notes from their person record.
2. **Given** a triage event from an unknown sender (not in the index), **When** enrichment runs, **Then** the prompt notes the sender is unknown; no error is thrown.
3. **Given** a sender who appears in multiple relationship categories (e.g. a colleague who is also on a specific project), **When** enrichment runs, **Then** the most specific relationship (direct-report > colleague > network) is used.

---

### User Story 3 — Project Relevance Context (Priority: P2)

The context bundle includes a compact index of active projects with their key keywords. At enrichment time, the context injection layer scans the event's subject and snippet for keyword matches and injects the matching project name(s) into the prompt. This helps the LLM understand whether an event is related to current work and how urgent it might be.

**Why this priority**: Project matching significantly improves urgency and risk classification. An email about a project that's currently in a critical phase deserves a different urgency rating than one about a dormant project.

**Independent Test**: Can be fully tested by enriching fixture events whose subject lines contain project keywords, verifying the matched project is injected into the prompt, and comparing classification against fixtures where no project keyword matches.

**Acceptance Scenarios**:

1. **Given** a triage event whose subject contains a keyword from the project index, **When** enrichment runs, **Then** the matched project name is injected into the LLM prompt.
2. **Given** no project keywords match the event, **When** enrichment runs, **Then** no project context is injected; the prompt proceeds without it.
3. **Given** multiple projects match, **When** enrichment runs, **Then** all matches are injected, subject to the token budget cap.

---

### User Story 4 — Triage History Patterns (Priority: P2)

The context bundle includes a compact summary of learned triage patterns from `areas/triage-history.md` — sender-level and domain-level patterns the user has established through prior manual triage. At enrichment time, the context injection layer finds patterns matching the current sender or domain and injects them as few-shot hints into the prompt.

**Why this priority**: Triage history is accumulated user preference. Without it, the LLM ignores what the user has already decided about recurring senders. With it, the system learns from history rather than repeating the same questions.

**Independent Test**: Can be fully tested by enriching a fixture event from a sender with an established triage history pattern and verifying the pattern appears in the injected context; then enriching an event with no history and verifying the prompt proceeds cleanly without it.

**Acceptance Scenarios**:

1. **Given** a triage event from a sender with an established pattern in the triage history (e.g. "Confluence notifications from direct reports → always delete"), **When** enrichment runs, **Then** the pattern is injected as a hint in the LLM prompt.
2. **Given** a sender with no prior triage history, **When** enrichment runs, **Then** no pattern hint is injected; the LLM relies on signals only.
3. **Given** a triage history pattern at domain level (e.g. all @confluence.atlassian.net senders), **When** enrichment runs for any sender in that domain, **Then** the domain-level pattern is injected.

---

### User Story 5 — Token-Budget-Aware Context Injection (Priority: P1)

The context injection layer assembles the context bundle slices relevant to each event and trims them to fit within a configured token budget before constructing the LLM prompt. Higher-priority context (sender relationship > triage history > project match > role summary) is included first; lower-priority context is dropped if the budget is exceeded. The token budget is separate for local LLM and Claude.

**Why this priority**: phi-4-mini has a very small context window. Overflowing it silently degrades results or causes errors. The budget must be enforced, not aspirational.

**Independent Test**: Can be fully tested by configuring a very small token budget and verifying that only the highest-priority context slices are included, lower-priority ones are dropped, and the final prompt never exceeds the configured limit.

**Acceptance Scenarios**:

1. **Given** a local LLM token budget is configured, **When** the context injection layer assembles the prompt, **Then** the total token count of injected context never exceeds the budget.
2. **Given** all four context types (sender, project, triage history, role) are available and their combined size exceeds the budget, **When** the prompt is assembled, **Then** they are included in priority order (sender first) until the budget is exhausted.
3. **Given** a Claude enrichment call (larger context budget), **When** the prompt is assembled, **Then** more context is included — potentially including fuller project notes and recent journal summaries — up to the Claude budget limit.
4. **Given** any prompt construction, **When** complete, **Then** the enrichment result records exactly which context slices were included and which were dropped due to budget constraints.

---

### User Story 6 — On-Demand Refresh (Priority: P3)

The user can trigger the distiller to run outside of its weekly schedule — for example, after adding a new person to the vault, updating project status, or onboarding a new project. The refreshed bundle is available to the enrichment stage on the next heartbeat cycle.

**Why this priority**: Weekly is usually sufficient, but after significant vault changes the stale context would cause misclassification. The ability to refresh on demand avoids waiting up to a week for the context to catch up.

**Independent Test**: Can be fully tested by triggering an on-demand refresh after adding a new person note, then running enrichment on a fixture event from that person, and verifying the new person appears in the sender index.

**Acceptance Scenarios**:

1. **Given** the user triggers an on-demand distiller run, **When** the task completes, **Then** the context bundle in `system/context/` is updated and the previous version is archived.
2. **Given** an on-demand run is triggered while a weekly run is already in progress, **When** both attempt to write, **Then** a lock prevents concurrent writes; the later run queues and completes after the first.

---

### Edge Cases

- **Vault section missing entirely**: Distiller skips that section and records its absence in the bundle metadata rather than failing.
- **People note has no email address**: Person is included in the bundle by name only; cannot be matched to incoming events by email.
- **Token budget too small for even minimum context**: Distiller logs a warning and enrichment proceeds with zero injected context rather than erroring.
- **Context bundle is stale** (not refreshed in more than the configured staleness threshold): Enrichment stage logs a warning and proceeds; it does not block on a fresh bundle.
- **Triage history file has no entries**: Pattern section of the bundle is empty; context injection simply skips pattern injection.
- **Same sender email maps to multiple person notes**: Most specific relationship category wins; ambiguity is logged for the user to resolve.

---

## Requirements *(mandatory)*

### Functional Requirements

**Distiller Task**

- **FR-001**: The distiller MUST run as a heartbeat task on a configurable schedule (default: weekly).
- **FR-002**: The distiller MUST read the following vault sources: people notes (all subdirectories of `areas/people/`), active project files (`projects/`), triage history (`areas/triage-history.md`), and the user's role/responsibility note (`areas/me/`).
- **FR-003**: The distiller MUST write a versioned context bundle to `system/context/context-bundle.json`. Each bundle MUST include a `compiledAt` timestamp and a `schemaVersion` field.
- **FR-004**: When the distiller runs and a prior bundle exists, it MUST archive the previous bundle (e.g. `system/context/archive/context-bundle-<timestamp>.json`) before writing the new one.
- **FR-005**: The distiller MUST complete successfully even when one or more vault source sections are empty or missing; absent sections MUST be noted in the bundle's metadata rather than causing a failure.
- **FR-006**: The distiller MUST be triggerable on demand (outside its scheduled run) via the heartbeat task system.
- **FR-007**: Concurrent distiller runs MUST be prevented; if a run is already in progress, a subsequent trigger MUST queue or skip gracefully.

**Sender Index**

- **FR-008**: The distiller MUST build a sender index mapping email addresses to: person name, relationship category (direct-report / colleague / mentee / network / other), vault note path, and any triage notes extracted from the person's note.
- **FR-009**: The sender index MUST cover all email addresses found in people notes across all relationship subdirectories.
- **FR-010**: The Slack user mapping (`areas/slack-user-mapping.md`) MUST be incorporated into the sender index so Slack events can also benefit from relationship context.
- **FR-011**: When a sender email maps to multiple person notes, the entry with the most specific relationship category MUST win; the ambiguity MUST be recorded in the bundle metadata.

**Project Index**

- **FR-012**: The distiller MUST build a project summary containing: project name, status (active/paused/complete), and up to 10 keywords per project extracted from the project note's title, headings, and frontmatter tags.
- **FR-013**: Only active projects MUST be included in the context bundle by default; completed or archived projects MUST be excluded.

**Triage History Patterns**

- **FR-014**: The distiller MUST extract triage patterns from `areas/triage-history.md` including: sender-level patterns (email address or name → action), domain-level patterns (email domain → action), and keyword patterns (subject/content keyword → action).
- **FR-015**: Each pattern MUST include: the match key, the observed action, and the confidence/sample count where available.

**Role Summary**

- **FR-016**: The distiller MUST extract a compact role summary from `areas/me/` capturing: the user's job title or role, their primary areas of responsibility, and any stated priorities or focus areas. This summary MUST fit within 200 tokens.

**Context Injection Layer**

- **FR-017**: The context injection layer MUST be invoked by the enrichment stage before constructing each LLM prompt.
- **FR-018**: The injection layer MUST accept the current `TriageEvent` and the loaded context bundle, and return an ordered list of context slices selected for inclusion.
- **FR-019**: Context slice priority order (highest first): sender relationship, triage history pattern, project match, role summary.
- **FR-020**: The injection layer MUST enforce a configurable token budget per LLM tier: one budget for local LLM calls, a separate (larger) budget for Claude calls.
- **FR-021**: When the combined size of selected slices exceeds the budget, lower-priority slices MUST be dropped in reverse priority order until the budget is satisfied.
- **FR-022**: The injection layer MUST record in the `EnrichmentResult`: which slices were included, which were dropped, and the final token count of injected context.
- **FR-023**: If no context bundle exists, the injection layer MUST return an empty slice list and log a warning; it MUST NOT block enrichment.
- **FR-024**: If the context bundle is older than the configured staleness threshold (default: 14 days), the injection layer MUST log a warning but MUST NOT block enrichment.

---

### Key Entities

- **ContextBundle**: The compiled, versioned output of the distiller. A structured file containing: `compiledAt` timestamp, `schemaVersion`, `senderIndex`, `projectIndex`, `triagePatterns`, `roleSummary`, and `metadata` (missing sections, ambiguities, token counts per section). Stored at `system/context/context-bundle.json`.

- **SenderIndexEntry**: One entry in the sender index. Contains: email address, display name, relationship category, vault note path, extracted triage notes (≤3 lines), and optionally the Slack user ID from the user mapping.

- **ProjectIndexEntry**: One entry in the project index. Contains: project name, status, folder path, and up to 10 extracted keywords.

- **TriagePattern**: One learned pattern from triage history. Contains: match type (sender / domain / keyword), match key, observed action, sample count, and confidence level.

- **RoleSummary**: Compact representation of the user's professional context. Contains: role/title, primary responsibilities (≤5 bullet points), and stated priorities or focus areas (≤3 items). Hard limit: 200 tokens.

- **ContextSlice**: A single unit of context passed to the injection layer. Has a type (sender / project / pattern / role), a priority rank, content (the text to inject), and an estimated token count.

- **InjectionResult**: The output of the context injection layer for one enrichment call. Lists included slices, dropped slices (with reason), total injected token count, and the LLM tier the budget was applied for.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The distiller completes a full vault compilation run in under 30 seconds on the current vault size.
- **SC-002**: The compiled context bundle covers 100% of email addresses present in the vault's people notes within the sender index.
- **SC-003**: Context injection never produces a prompt that exceeds the configured token budget — verified across 100% of fixture enrichment runs.
- **SC-004**: Enrichment of a fixture event from a known person produces a classification result that references the sender's relationship type, compared to 0% without context injection.
- **SC-005**: Enrichment of a fixture event from a sender with a triage history pattern produces a decision consistent with that pattern in at least 80% of test cases.
- **SC-006**: The distiller completes without error when any single vault source section is absent.
- **SC-007**: The context bundle is versioned and archived on each run; at least 4 weeks of prior bundles are retained in `system/context/archive/`.
- **SC-008**: The `InjectionResult` records dropped slices in 100% of cases where the token budget was exceeded.
- **SC-009**: An on-demand distiller run triggered after vault changes is reflected in the next heartbeat enrichment cycle.

---

## Assumptions

- The vault structure follows the conventions observed at design time: `areas/people/` with relationship subdirectories, `projects/` with one note per project, `areas/triage-history.md` as a single consolidated file, and `areas/me/` containing the user's personal/professional context.
- People notes contain email addresses in a consistent location (frontmatter `email:` field or a clearly identifiable line in the note body); the distiller will use frontmatter as the primary source and fall back to body parsing.
- Project notes contain frontmatter `status:` fields (active / paused / complete / archived) to allow filtering; notes without a status field are treated as active.
- Token counting is approximate (character-based heuristic is acceptable for budget enforcement; exact tokeniser not required).
- The context bundle schema will evolve; `schemaVersion` allows the enrichment stage to detect and handle version mismatches gracefully.
- The distiller does not need to understand the semantic content of notes deeply — keyword extraction from titles, headings, and frontmatter tags is sufficient for the project index.
- The Slack user mapping file (`areas/slack-user-mapping.md`) format remains stable; if it changes structure, the distiller logs a warning and skips Slack ID enrichment rather than failing.
- Triage history patterns are maintained manually by the user (or by a future automated compaction task); the distiller reads them as-is without attempting to infer new patterns.
- The weekly schedule is configurable in the heartbeat config alongside other task schedules; the default of weekly is a starting point and expected to be tuned.
- Archive retention (how many prior bundles to keep) is configurable; default of 4 weeks is a reasonable starting point.
