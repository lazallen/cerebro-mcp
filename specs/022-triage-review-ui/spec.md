# Feature Specification: Triage Review UI

**Feature Branch**: `022-triage-review-ui`
**Created**: 2026-02-24
**Status**: Draft
**Input**: User description: "I need to interact with these tasks and human questions and I think I'd prefer to do that via a UI rather than through Claude Code. The UI should contain a list of the items on the right hand side with a badge/icon for where the item has come from (slack, email, calendar etc) and a small title. On the left hand side there should be a viewing port where the details of the message and the ask from the system can be shared. Under that there should be a series of small shortcut buttons for obvious tasks like archive. Under that, there is a text box which already has a placeholder prompt that I can accept, or I can type in the box for a new prompt and hit accept. Once I have entered the prompt, the task will go back into the queue for my prompt to be analysed by the local LLM for intent to enhance the task for the next step"

## Purpose

This is a **triage inbox** — not a task manager. The pipeline handles everything it can automatically. When it cannot bring an event to completion without human input, it surfaces an item to this UI. The user's only job is to make a fast decision and move on. The three possible responses to any item are:

- **Done** — I've handled this myself. Marks the item resolved and queues an archive action for the executor.
- **Defer** — This needs proper focused attention. Creates an entry in the external task system and resolves the HQ item out of the queue.
- **Delegate** — I want the pipeline to handle this. Type a prompt, press Accept, and the pipeline re-evaluates the item using the LLM to determine and execute the next action.

Items that can be fully automated never appear here. Items that are completed leave immediately. The queue should stay as short as possible.

## Clarifications

### Session 2026-02-24

- Q: What is the intended purpose of tasks vs HQ items — should tasks appear in the UI? → A: The UI is a pure triage system. Only HQ items (pending human queue items from `system/human/`) are shown. `CREATE_TASK` has been removed from the pipeline entirely — all items that previously created tasks now route to `ASK_HUMAN` instead. The two resolution modes for any HQ item are Done and Delegate.
- Q: What are the three resolution modes? → A: Done (I've handled it — archive), Defer (needs proper task — create task entry, resolve HQ item), Delegate (pipeline handles it — text prompt re-enters the LLM pipeline). No contextual shortcut buttons; all items use the same three buttons regardless of source.
- Q: Where does Defer write the task entry, and what format? → A: `./context/tasks/` directory. The task entry must be LLM-enriched — Claude gathers context from the repo (goals, projects in `./context/`) and produces a fully formed task file using a template, not a plain dump of the HQ item content.
- Q: How does the list read `source` and `title` per item — parse the markdown body or add to frontmatter? → A: Add `source` and `title` to the HQ item frontmatter in the pipeline writer. SC-007 is relaxed to allow this one targeted pipeline change; all other pipeline code and configuration remain unchanged.
- Q: After a resolution, does the detail panel auto-advance to the next item or clear? → A: Auto-advance — the next pending item in the list is automatically selected and displayed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Browse and Select Pending HQ Items (Priority: P1)

Stuart opens the Triage Review UI in a browser. The right-hand panel shows all items in `system/human/` with `status: pending`. Each item displays a source badge (mail icon for email, speech-bubble icon for Slack, calendar icon for meeting invites) and a short title. Stuart clicks an item and the left-hand detail panel populates with the full message content, received date, author, and the question the pipeline is asking him (e.g., "Meeting invite received. Accept, decline, or tentatively accept?").

**Why this priority**: Without the ability to see and read items, nothing else in the UI is possible. This is the foundational capability.

**Independent Test**: Load the UI against a `system/human/` directory containing pending HQ items and verify they all appear in the list with correct source badges and titles, and that clicking any item populates the detail panel correctly.

**Acceptance Scenarios**:

1. **Given** `system/human/` contains 3 pending HQ items, **When** Stuart opens the UI, **Then** all 3 appear in the right-hand list with correct source badges and titles
2. **Given** a list of items is visible, **When** Stuart clicks any item, **Then** the detail panel shows the item's full content, metadata (source, received date, author), and the pipeline's question
3. **Given** the list is displayed, **When** no pending HQ items exist, **Then** the list shows a clear empty-state message ("Nothing to review")
4. **Given** the list is displayed, **When** items from `system/artifacts/tasks/` exist, **Then** those items do NOT appear in the list

---

### User Story 2 — Resolve an Item: Done (Priority: P2)

Stuart selects an HQ item: a self-sent note reminding him to follow up on a contract. He has already handled it. He clicks "Done". The item is immediately resolved with `answer: done`, `status: resolved`, an archive action is queued for the executor, and it disappears from the list.

**Why this priority**: Done handles the majority of items and requires a single click with no typing.

**Independent Test**: Click "Done" on a selected HQ item, verify `answer: done`, `status: resolved`, and an archive action are written to the item's markdown file, and confirm the item disappears from the list.

**Acceptance Scenarios**:

1. **Given** any HQ item is selected and more items remain, **When** Stuart clicks "Done", **Then** the item is resolved with `answer: done`, an archive action is queued, and the detail panel advances to the next pending item
2. **Given** the last pending HQ item is selected, **When** Stuart clicks "Done", **Then** the item is resolved, the list empties, and the empty-state message ("Nothing to review") is displayed
3. **Given** any item type (email, meeting invite, slack), **When** the detail panel is shown, **Then** "Done", "Defer", and "Delegate" (via text input) are the only resolution options present

---

### User Story 3 — Resolve an Item: Defer (Priority: P3)

Stuart selects an HQ item: a Slack message asking him to review a lengthy proposal document. He decides this needs focused time. He clicks "Defer". The system reads context from `./context/` (his goals, current projects) and uses the LLM to produce a properly formed task file in `./context/tasks/`. The HQ item is marked resolved and removed from the queue.

**Why this priority**: Defer keeps the triage queue clean for items that need sustained personal attention, and the LLM enrichment means the created task is immediately useful — not just a raw copy of the notification.

**Independent Test**: Click "Defer" on a selected HQ item, verify a new task file appears in `./context/tasks/` that contains a well-formed task (not raw HQ content), and the HQ item is marked `status: resolved` and removed from the list.

**Acceptance Scenarios**:

1. **Given** any HQ item is selected, **When** Stuart clicks "Defer", **Then** a new task file is created in `./context/tasks/` using the task template enriched with repo context, and the HQ item is resolved and removed from the list
2. **Given** a Defer task file is created, **When** Stuart opens `./context/tasks/`, **Then** the file follows the task template and references relevant goals or projects from `./context/`

---

### User Story 4 — Resolve an Item: Delegate (Priority: P4)

Stuart selects an HQ item: a Fleet Assist email asking him to confirm a booking date. The text box is pre-populated with a suggested prompt (e.g., "Confirm the booking date"). Stuart clears it and types "Decline — I'll be on holiday. Suggest the 12th instead." He presses Accept. The item is marked resolved and the prompt re-enters the pipeline where the local LLM enriches it (determining intent: DRAFT_REPLY), and the executor sends a reply email on Stuart's behalf.

**Why this priority**: Delegate offloads follow-up work back to the pipeline rather than Stuart having to action it manually.

**Independent Test**: Submit a custom prompt on an HQ item, verify the `answer` is written to the file and `status: resolved`, then verify the pipeline creates a follow-up action (e.g., a `DRAFT_REPLY` decision) on its next cycle.

**Acceptance Scenarios**:

1. **Given** an HQ item is selected, **When** Stuart types a custom response and presses Accept, **Then** `answer` is saved, `status: resolved`, and the item leaves the list
2. **Given** an HQ item is selected with a pre-populated placeholder, **When** Stuart presses Accept without changing the text, **Then** the placeholder text is used as the answer
3. **Given** a resolved item's answer is in the file, **When** the pipeline's next policy-pipeline cycle runs, **Then** the item is re-evaluated and a follow-up action is created based on LLM enrichment of the answer

---

### User Story 5 — Automatic List Refresh (Priority: P5)

While Stuart is reviewing items in the UI, the heartbeat pipeline adds new HQ items in the background. The list updates automatically without a page reload. Items resolved via other means (e.g., directly via MCP tools) also disappear without a refresh.

**Why this priority**: The pipeline runs continuously. A stale queue is misleading and undermines trust in the UI as the canonical review surface.

**Independent Test**: Manually create a new HQ item file in `system/human/` while the UI is open and verify it appears within 10 seconds without a page reload.

**Acceptance Scenarios**:

1. **Given** the UI is open, **When** a new pending HQ item file is created in `system/human/`, **Then** it appears in the list within 10 seconds
2. **Given** an item is visible, **When** its `status` is updated to `resolved` externally, **Then** it disappears from the list within 10 seconds

---

### Edge Cases

- What happens when an HQ item file has malformed or missing frontmatter? → Item appears in the list with a warning indicator; the detail panel shows the raw file content with an error notice rather than crashing
- What happens when `system/human/` is empty or unreachable? → The UI shows the empty-state message; if the directory is unreachable, an error notice is shown
- What happens if the user presses Accept with an empty text box? → The Accept button is disabled until the text box contains at least one non-whitespace character
- What happens when the message content is very long? → The detail panel scrolls independently; the shortcut buttons and text input remain anchored at the bottom and always visible
- What happens if two browser sessions resolve the same item simultaneously? → Last write wins; both sessions reflect the resolved state on the next poll cycle
- What happens when the pipeline re-enters a resolved item (unlikely but possible via re-ingestion)? → The item reappears in the list with a new `pending` status if a new HQ item is created for it

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The UI MUST display all items with `status: pending` from `system/human/` and MUST NOT display items from `system/artifacts/tasks/`
- **FR-002**: Each list item MUST show a source badge (a distinct icon per source: email, slack, calendar, meeting-invite, journal, other) and the item's title
- **FR-003**: Selecting a list item MUST populate a left-hand detail panel with: the full message content or snippet, item metadata (source, received date, author), and the pipeline's question
- **FR-004**: The UI MUST display exactly three resolution controls for every item regardless of source: a "Done" button, a "Defer" button, and a text input with an Accept button (Delegate path); no contextual or source-specific shortcuts
- **FR-005**: Clicking "Done" MUST write `answer: done`, `status: resolved`, and `resolvedAt` to the item's file and queue an archive action for the executor
- **FR-006**: Clicking "Defer" MUST invoke LLM enrichment (using the HQ item content and repo context from `./context/`) to produce a fully formed task file written to `./context/tasks/`, then write `status: resolved` and `resolvedAt` to the HQ item's file
- **FR-007**: The text input (Delegate path) MUST be pre-populated with the item's `question` field as the suggested prompt
- **FR-008**: The UI MUST allow the user to clear the pre-populated text and type a custom response
- **FR-009**: The Accept button MUST be disabled when the text input is empty or contains only whitespace
- **FR-010**: On pressing Accept (Delegate path), the UI MUST write `answer`, `status: resolved`, and `resolvedAt` to the item's markdown file
- **FR-011**: After any resolution (Done, Defer, or Delegate), the item MUST be removed from the pending list and the detail panel MUST automatically advance to the next pending item; if the queue is now empty, the detail panel MUST clear and show the empty-state message
- **FR-012**: The list MUST refresh automatically at a configurable poll interval (default: 10 seconds) without requiring a full page reload
- **FR-013**: The UI MUST be accessible via a browser at a dedicated path on the existing auth server (port 3333), served as a new route added to that process (e.g., `http://localhost:3333/triage`)
- **FR-014**: All resolutions MUST only write to the local file system; the UI MUST NOT make live API calls — all API actions are deferred to the executor on its next scheduled cycle
- **FR-015**: The UI MUST use a modern dark colour theme throughout: dark background surfaces, light text, muted borders, and high-contrast interactive elements (buttons, badges, focus states)

### Key Entities

- **HumanQueueItem**: The only item type shown in the UI. From `system/human/` with `status: pending`. Key attributes in frontmatter: id, itemType (ask_human or claude_approval), source, title, question, eventRef, createdAt. Note: `source` and `title` must be written to frontmatter by the pipeline's HQ item writer (currently they only appear in the markdown body); this is the one permitted pipeline change for this feature.
- **UserResolution**: The outcome of the user's decision. Written back to the HQ item file. Contains: answer (text), resolvedAt (timestamp), resolution mode (done/defer/delegate)
- **DeferredTask**: A task file written to `./context/tasks/` when the user clicks Defer. Produced by LLM enrichment using the HQ item content plus repo context (goals, projects from `./context/`). Follows a task template; not a raw dump of the HQ item.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can open the UI, select an item, and resolve it (via any path) in under 30 seconds from a cold start
- **SC-002**: All pending HQ items present in `system/human/` are visible in the list within 10 seconds of the UI loading
- **SC-003**: Newly created HQ items appear in the list within 10 seconds without a page reload
- **SC-004**: Items resolved through the UI disappear from the list within 10 seconds of submission
- **SC-005**: The placeholder prompt is the item's own `question` field for 100% of ask_human HQ items
- **SC-006**: Exactly three resolution controls (Done, Defer, Delegate) are present for every item regardless of source type
- **SC-007**: The only permitted pipeline change is adding `source` and `title` to HQ item frontmatter in the human-queue-store writer; all other pipeline code, policy files, and heartbeat configuration are unchanged
- **SC-008**: The UI presents a visually consistent dark theme with no light-coloured surfaces or flash of unstyled content on load

## Assumptions

1. The `system/human/` directory and HQ item frontmatter schema will include `id`, `source`, `title`, `question`, `status`, `createdAt` — `source` and `title` are being added by this feature's pipeline change
2. The system directory path is read from `heartbeat-config.json` in the project root
3. File writes use atomic operations (write to temp, then rename) to avoid race conditions with the pipeline
4. The local LLM enrichment for Delegate responses already runs via the existing policy pipeline — the UI only writes the `answer` field; pipeline re-evaluation happens on the next scheduled cycle
5. `CREATE_TASK` has been removed from the pipeline entirely; all items previously creating tasks now route to `ASK_HUMAN` and appear here. The Defer button routes items to `./context/tasks/` via LLM enrichment.
6. `./context/` contains the user's goals, projects, and existing tasks; these are read by the LLM during Defer enrichment to produce contextually appropriate task files.
7. A task file template exists (or will be defined) in `./context/`; planning will determine its exact schema.
8. The UI is for single-user local use — no authentication or multi-user access control is required
