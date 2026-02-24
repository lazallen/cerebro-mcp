# Feature Specification: Slack Save for Later Integration

**Feature Branch**: `020-slack-saved-items`
**Created**: 2026-02-20
**Status**: Draft
**Input**: User description: "Let's work on 020."

## Background & Relationship to Existing Slack Integration

cerebro-mcp currently contains two distinct Slack sub-systems:

### 1. OAuth-Based Integration (Feature 006 — candidate for removal)

The existing integration authenticates using official Slack OAuth tokens and exposes tools for reading channel and group history, fetching thread replies, reading canvases, and managing user reminders. This system is considered a candidate for removal: it requires an OAuth app registration, token refresh management, and scopes that may not be justified by actual usage.

This feature (020) does **not** build on, extend, or require the OAuth-based integration. It must function correctly whether that integration is present or has been removed.

### 2. Message Shortcuts (Feature 010 — separate and unrelated)

The message shortcuts system captures items via a Slack message action (right-click shortcut), stores them locally, and exposes `list-message-actions`, `get-message-action`, and `delete-message-action`. This system uses a WebSocket connection and local file storage — it has no OAuth dependency and is architecturally independent.

Feature 020 does not replace or depend on message shortcuts, though the triage workflow (P4) will surface both sources together.

### 3. Session-Credential-Based Integration (this feature — new)

This feature introduces a third, self-contained Slack integration that uses browser session credentials to access Slack's native "Save for Later" feature. It has no dependency on the OAuth integration and should be implemented so it continues to work cleanly if the OAuth integration is removed.

---

## Clarifications

### Session 2026-02-20

- Q: Does `list-saved-items` return message text/preview or identifiers only? → A: Full message text plus all available item metadata (item type, creation date, due date, completion date, last-updated date, archived flag, snoozed-until date, state).
- Q: Should snoozed items be excluded from `list-saved-items` results, or returned with their state and left to the caller to filter? → A: Return all states; the caller is responsible for filtering. Snoozed items appear alongside active ones, with their snoozed-until date and state included so the caller can decide what to present.
- Q: Should session credentials support loading from environment variables as a fallback? → A: No. Session credentials expire every few hours, making env vars impractical. The auth dashboard is the sole management mechanism; no env var support is needed or provided.
- Q: How should session credentials be protected at rest? → A: File-permission-level protection only, consistent with existing token storage in `.tokens/`. No encryption at rest required given the short credential lifetime and personal/local tool context.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Slack Saved Items (Priority: P1)

As a user who saves messages in Slack using the native "Save for later" bookmark button, I want to retrieve my saved items list via cerebro-mcp so that I can triage them as part of my regular inbox workflow — without switching to the Slack app.

**Why this priority**: This is the core value of the feature. Without the ability to list saved items, nothing else is useful. It directly extends the triage workflow to cover a third inbox that currently requires manual Slack access.

**Independent Test**: Can be fully tested by calling `list-saved-items` after bookmarking one or more messages in Slack and verifying the saved messages appear in the response.

**Acceptance Scenarios**:

1. **Given** the user has configured session credentials and has at least one saved item in Slack, **When** they call `list-saved-items`, **Then** the tool returns a list containing that item with its channel, message timestamp, and completion state.
2. **Given** the user has no saved items in Slack, **When** they call `list-saved-items`, **Then** the tool returns an empty list and a count of zero.
3. **Given** the user has more saved items than fit in one page, **When** they call `list-saved-items` with a pagination cursor, **Then** the tool returns the next page of items.
4. **Given** session credentials are not configured, **When** they call `list-saved-items`, **Then** the tool returns a clear error message explaining that session credentials must be set up, and no other Slack tools are affected.

---

### User Story 2 - Mark Saved Item as Complete (Priority: P2)

As a user who has actioned a saved Slack message (read it, replied to it, or delegated it), I want to mark it as complete so that my Slack saved items list stays clean and only shows items still needing attention.

**Why this priority**: Without the ability to mark items complete, the list grows unbounded and becomes useless as a triage inbox. This is the essential companion to listing items.

**Independent Test**: Can be fully tested by saving a message in Slack, calling `list-saved-items` to get its identifiers, calling `mark-saved-item-complete`, then verifying in Slack that the item no longer appears in the active saved list.

**Acceptance Scenarios**:

1. **Given** a saved item exists with a known channel and message timestamp, **When** the user calls `mark-saved-item-complete` with those identifiers, **Then** the item is marked complete in Slack and the tool returns a success response.
2. **Given** an invalid channel or timestamp is provided, **When** the user calls `mark-saved-item-complete`, **Then** the tool returns a descriptive error message without crashing.
3. **Given** session credentials are expired, **When** the user calls `mark-saved-item-complete`, **Then** the tool returns an error indicating credential refresh is needed.

---

### User Story 3 - Manage Session Credentials via Dashboard (Priority: P3)

As a user who needs to set up or refresh Slack session credentials (which expire roughly every 24 hours), I want the auth dashboard to make both the initial setup and daily credential rotation fast and self-contained, so that maintaining access to saved items is not a friction point in my workflow.

**Why this priority**: Session credentials expire frequently — this is not a one-time setup task but a daily operation. If refresh is cumbersome, users will abandon the feature rather than keep it running. The dashboard must treat refresh as the primary use case, not a secondary one.

**Independent Test**: Can be fully tested by: (a) completing initial setup via the dashboard with no file editing, and (b) simulating an expiry, then refreshing credentials via the dashboard in a single browser interaction, and verifying `list-saved-items` succeeds again.

**Acceptance Scenarios**:

1. **Given** the auth dashboard is running and the user is logged into Slack in their browser, **When** they navigate to the Slack session credentials section and paste their extracted credentials into the form, **Then** the credentials are saved and `list-saved-items` succeeds on the next call — with no file editing required.
2. **Given** session credentials are already configured, **When** the user visits the dashboard, **Then** it displays the credential status, the date and time they were last saved, and an estimated expiry time.
3. **Given** session credentials are approaching expiry (within 2 hours) or have already expired, **When** the user visits the dashboard, **Then** the status is highlighted prominently with a clear call to action to refresh.
4. **Given** the user wants to refresh credentials, **When** they follow the in-page extraction instructions and paste the new values, **Then** the new credentials replace the old ones immediately and the success state is confirmed without a page reload.
5. **Given** the dashboard is showing expired credentials, **When** the user submits new credentials, **Then** any prior expiry error state is cleared and `list-saved-items` succeeds without restarting cerebro-mcp.

---

### User Story 4 - Automated Heartbeat Ingestion (Priority: P4)

As a user who has the heartbeat system running, I want saved Slack messages to be automatically pulled into the triage pipeline on a schedule — and removed from my Slack saved list once ingested — so that my saved-items list in Slack stays clean and items flow into the same policy-driven workflow as email.

**Why this priority**: This is the automation payoff of the feature. Without it, users must manually call `list-saved-items` and `mark-saved-item-complete`. The heartbeat task makes the integration passive and continuous, matching the behaviour of email ingestion (Feature 019).

**Independent Test**: Can be fully tested by: (a) saving a message in Slack, (b) triggering the `slack-saved-items-ingestion` heartbeat task, (c) verifying a `TriageEvent` was written to the system directory, and (d) verifying the item no longer appears in Slack's active saved list.

**Acceptance Scenarios**:

1. **Given** the heartbeat task is configured and credentials are valid, **When** the task runs, **Then** it fetches all items with state `uncompleted`, writes a `TriageEvent` for each, and marks each item as complete in Slack.
2. **Given** an item cannot be marked complete after ingestion (transient API error), **When** the task runs, **Then** it logs a warning and continues to the next item — it does not abort the run or re-process items already ingested.
3. **Given** an item was already ingested in a previous run (idempotency), **When** the task runs again, **Then** it does not create a duplicate `TriageEvent` for that item.
4. **Given** session credentials are expired when the task fires, **When** the task runs, **Then** it logs a clear error with a message directing the user to refresh credentials, and exits without processing any items.
5. **Given** the task is configured with `markAsComplete: false`, **When** the task runs, **Then** it ingests items into the pipeline but does not remove them from the Slack saved list.

---

### User Story 5 - Unified Triage View (Priority: P5)

As a user running the triage skill, I want Slack saved items to appear alongside email and Slack message shortcuts in a single combined view so that I can process all my inboxes in one pass without manually managing multiple lists.

**Why this priority**: Now that the heartbeat task (P4) handles automated ingestion, this story covers the manual triage skill path and depends on P1–P3. It also requires changes outside the cerebro-mcp codebase (the triage skill in the cerebro repository).

**Independent Test**: Can be fully tested by running the triage skill with saved items present and verifying both message shortcuts and saved items appear, and that choosing "Done" on a saved item calls `mark-saved-item-complete`.

**Acceptance Scenarios**:

1. **Given** the user has both message shortcuts and saved items, **When** they run the triage skill, **Then** both appear in the consolidated triage list with their source labelled.
2. **Given** session credentials are not configured, **When** the triage skill runs, **Then** it still processes email and Slack message shortcuts normally, and includes a note that saved items are unavailable.
3. **Given** the user selects "Done" on a saved item during triage, **When** the action executes, **Then** `mark-saved-item-complete` is called and the item is removed from the active saved list in Slack.

---

### Edge Cases

- What happens when session tokens expire mid-session (e.g. during a long triage run)? The tool should return a clear expiry error pointing to the dashboard, rather than a cryptic API failure. Partially-completed actions should not leave data in an inconsistent state.
- What if the user submits credentials that look valid but are from the wrong workspace? The system should detect the mismatch and return a helpful error rather than silently failing on subsequent calls.
- How does the system handle Slack silently changing the undocumented API? Errors must be surfaced clearly so the user knows to check for a cerebro-mcp update.
- What if the user has hundreds of saved items? Pagination must work correctly; the list tool must not silently truncate results.
- What if the same message appears as both a message shortcut and a saved item? The triage skill should present both with their distinct sources clearly labelled.
- `list-saved-items` returns items in all states. The triage skill SHOULD filter to active items only by default, respecting the user's intent when they snoozed an item.
- What if the user's Slack workspace subdomain cannot be inferred automatically? Credential setup must prompt for it explicitly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `list-saved-items` tool that returns all saved items regardless of their state (active, snoozed, completed, archived). Each result MUST include: channel identifier, message timestamp, full message text, item type, creation date, due date, completion date, last-updated date, archived flag, snoozed-until date, and current state. No server-side filtering is applied; state-based filtering is the caller's responsibility.
- **FR-002**: System MUST provide a `mark-saved-item-complete` tool that accepts a channel identifier and message timestamp and marks the corresponding saved item as complete in Slack.
- **FR-003**: Both saved-items tools MUST use Slack session credentials as their sole authentication mechanism. They MUST NOT require or depend on the OAuth-based Slack integration.
- **FR-004**: When session credentials are not configured, the saved-items tools MUST return a descriptive error and MUST NOT impair the message shortcuts system (Feature 010) or any other cerebro-mcp tool.
- **FR-005**: `list-saved-items` MUST support pagination so all saved items can be retrieved regardless of list size.
- **FR-006**: The auth dashboard is the sole mechanism for storing and managing session credentials. No environment variable or alternative fallback is provided. Credentials are persisted to the existing token storage directory with file-permission-level protection, consistent with other stored tokens.
- **FR-007**: The auth dashboard MUST provide a credential entry form with step-by-step in-page instructions for extracting session credentials from a browser, so users can complete setup and refresh without leaving the dashboard or editing files.
- **FR-008**: The auth dashboard MUST display the session credential status (configured / not configured / expired), the date and time the credentials were last saved, and an estimated expiry time derived from that timestamp.
- **FR-009**: System MUST detect and report expired or invalid session credentials with a message directing the user to refresh them via the dashboard.
- **FR-010**: The auth dashboard MUST visually highlight when credentials are expired or within 2 hours of expiry, with a prominent call to action to refresh.
- **FR-011**: Submitting new credentials via the dashboard MUST take effect immediately without requiring cerebro-mcp to be restarted.
- **FR-012**: The auth dashboard MUST confirm successful credential save with an inline success message, without navigating away from the credentials page.
- **FR-013**: System MUST provide a heartbeat task type `slack-saved-items-ingestion` that, on each run, fetches all `uncompleted` saved items and writes a `TriageEvent` for each into the triage pipeline — following the same ingestion pattern as the `email-ingestion` task (Feature 019).
- **FR-014**: The `slack-saved-items-ingestion` task MUST call `mark-saved-item-complete` on each item after it has been successfully ingested, unless the task is configured with `markAsComplete: false`.
- **FR-015**: The `slack-saved-items-ingestion` task MUST be idempotent: if an item was already ingested in a previous run, it MUST NOT create a duplicate `TriageEvent`.
- **FR-016**: The `slack-saved-items-ingestion` task MUST be configurable via `heartbeat-config.json` with at minimum: `schedule` (cron expression) and `markAsComplete` (boolean, default `true`). A failure to mark one item as complete MUST NOT abort ingestion of remaining items.

### Key Entities

- **Saved Item**: A message the user has bookmarked using Slack's native "Save for Later" button. Identified by a channel identifier and a message timestamp. Carries the full message text and the following metadata: item type, creation date, due date, completion date, last-updated date, archived flag, snoozed-until date, and current state (active / snoozed / completed / archived).
- **Session Credentials**: A pair of Slack browser-session values (extracted from an active Slack web session) required to call the saved-items API. They are the sole authentication mechanism for this feature, have no dependency on the OAuth-based integration, and are managed exclusively through the auth dashboard. They expire every few hours, must be refreshed regularly, and are stored at rest with file-permission-level protection consistent with other project tokens.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can retrieve their full list of Slack saved items with a single tool call, with no items silently omitted due to pagination limits.
- **SC-002**: Marking a saved item complete is reflected in Slack within 5 seconds of the tool call succeeding.
- **SC-003**: The message shortcuts system (Feature 010) continues to function without any degradation when session credentials are absent or expired. The feature introduces no regression to any other cerebro-mcp tool.
- **SC-004**: A user with no prior knowledge of browser token extraction can complete initial session credential setup in under 5 minutes using only the auth dashboard. A returning user performing a routine credential refresh (as required every few hours) can complete it in under 2 minutes.
- **SC-005**: The triage skill presents email, Slack message shortcuts, and Slack saved items in a single unified view with no duplication.
- **SC-006**: An expired or invalid session credential produces a user-readable error message that identifies the problem and directs the user to the resolution path, within 2 seconds of the failed call.

## Assumptions

- The undocumented Slack Webclient API is used because no official API exists for this functionality. The implementation carries the accepted risk of API changes without notice.
- The user's Slack workspace subdomain can be reliably determined from the session credentials alone, without relying on the OAuth integration.
- Session credentials expire every few hours; periodic re-extraction via the auth dashboard is a known and accepted part of the workflow. No environment variable fallback is provided or needed.
- The auth dashboard running on `http://localhost:3333` is already operational (Feature 008) and can be extended without structural changes.
- The triage skill (in the cerebro repository, not cerebro-mcp) is in scope for updates as part of this feature's P4 story.
