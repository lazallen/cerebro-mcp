# Data Model: Triage Review UI

**Feature**: 022-triage-review-ui | **Date**: 2026-02-24

---

## 1. HumanQueueItem (extended)

Existing entity in `src/lib/triage/human-queue-store.ts`. Two new fields added as part of the permitted pipeline change (SC-007).

### TypeScript Interface

```typescript
export interface HumanQueueItem {
  id: string;                        // UUID — primary key
  itemType: HumanQueueItemType;      // 'ask_human' | 'claude_approval'
  eventRef: string;                  // Foreign key → TriageEvent.eventId
  status: HumanQueueItemStatus;      // see lifecycle below
  createdAt: string;                 // ISO 8601
  resolvedAt?: string;               // ISO 8601 — set on any terminal resolution
  question?: string;                 // Human-facing question from the pipeline
  reason?: string;                   // Why this item was queued
  localConfidence?: number;          // 0–1 score from local LLM enrichment
  answer?: string;                   // Human's answer (set on resolution)
  approvalRef?: string;              // Reference to approval record

  // NEW — added by this feature (SC-007 permitted pipeline change)
  source?: string;                   // 'email' | 'slack' | 'meeting-invite' | 'calendar' | 'journal' | string
  title?: string;                    // Display title for the list panel (event subject / thread title)
}
```

### Status Lifecycle

```
pending ──── (Done / Defer / Delegate via UI) ──▶ resolved
                                                      │
                                                      ▼
                                                 (processResolved on next pipeline cycle)
                                                      │
                                                      ▼
                                                  complete ──▶ archived to system/human/done/
```

`approved` and `declined` statuses are used only by `claude_approval` items (not shown in the triage UI).

### Frontmatter Schema (on disk)

```yaml
type: human-queue-item
id: <uuid>
itemType: ask_human             # ask_human | claude_approval
eventRef: <event-id>            # e.g., 20260224-email-AGZ1AAA=
status: pending                 # pending | resolved | complete
createdAt: '2026-02-24T20:18:01.700Z'
resolvedAt: ~                   # ISO 8601 when resolved, ~ until then
question: 'Meeting invite received. Accept, decline, or tentatively accept?'
reason: ~
localConfidence: ~
answer: ~                       # Set on resolution: 'done' | 'deferred' | <user text>
approvalRef: ~
source: meeting-invite          # NEW — populated by pipeline from TriageEvent
title: Travel Platform ILD      # NEW — populated by pipeline from TriageEvent
```

### Validation Rules
- `id`: must be a valid UUID v4
- `itemType`: must be exactly `ask_human` or `claude_approval`
- `status`: must be one of `pending`, `resolved`, `approved`, `declined`, `complete`
- `createdAt`, `resolvedAt`: ISO 8601 format
- `source`, `title`: optional strings; UI shows fallback values if absent (backward compat with pre-022 items)

---

## 2. TriageItemView (UI view model)

A flattened read model produced by `TriageRouter.buildItemView()`. Never persisted — assembled per poll request.

```typescript
interface TriageItemView {
  id: string;                    // HumanQueueItem.id
  source: string;                // HumanQueueItem.source ?? 'other'
  title: string;                 // HumanQueueItem.title ?? 'Untitled'
  question: string;              // HumanQueueItem.question ?? ''
  createdAt: string;             // HumanQueueItem.createdAt
  itemType: string;              // HumanQueueItem.itemType
  eventRef: string;              // HumanQueueItem.eventRef

  // Enriched from the HQ item body (markdown content stripped of frontmatter)
  bodyMarkdown: string;          // Full markdown body of the HQ item file
}
```

The UI's detail panel renders `bodyMarkdown` as formatted text, and `question` pre-populates the Delegate text input.

---

## 3. ResolutionPayload

Sent by the browser to `POST /triage/api/items/:id/resolve`.

```typescript
interface ResolutionPayload {
  resolution: 'done' | 'defer' | 'delegate';
  answer?: string;               // Required when resolution === 'delegate'
}
```

**Validation**:
- `resolution` must be exactly one of the three values
- When `resolution === 'delegate'`: `answer` must be present and non-empty
- When `resolution === 'done'` or `'defer'`: `answer` is ignored

---

## 4. DeferredTask (new file in `./context/tasks/`)

Written by `DeferEnrichmentService`. Follows the schema discovered in existing `./context/tasks/` files.

```typescript
interface DeferredTask {
  // Frontmatter fields (YAML)
  status: 'todo';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  checkBackDate: string | null;
  delegatedTo: string | null;
  title: string;                 // LLM-generated short title
  category: string;              // 'project' | 'area' | 'resource' | 'other'
  project: string | null;        // "[[projects/name]]" if linked
  area: string | null;           // "[[area/name]]" if linked
  tags: string[];

  // Markdown body sections
  // ## Context — LLM description of the task
  // ## Success Criteria — checkbox list
  // ## Notes — includes "Deferred from: HQ item {id} on {date}"
}
```

**File naming**: `{kebab-slug-of-title}.md` — e.g., `review-fleet-assist-booking-proposal.md`. If a file with that name already exists, append `-{YYYYMMDD}` suffix.

**Atomicity**: Written to a `.tmp` file first, then renamed.

---

## 5. ArchiveAction (appended to system/decisions/)

When the user clicks Done on an email or meeting-invite item, a MOVE-to-Archive action is appended to `system/decisions/{eventRef}.md`.

```typescript
// Shape appended to the actionsJson array in the existing decision file
interface ArchiveAction {
  type: 'MOVE';
  folder: 'Archive';
  applied: false;
  requiresApproval: false;
}
```

The existing `ExecutorTask` processes this on its next cycle via the `MOVE` handler, calling `microsoftService.moveEmail(messageId, 'Archive', true)`.

**Conditions**: Only appended if:
- The HQ item's `source` is `email` or `meeting-invite`
- The decision file for `eventRef` exists in `system/decisions/`
- The MOVE action is not already present (guard against duplicate Done clicks)

---

## Entity Relationships

```
TriageEvent (system/triage/)
    │
    │ eventRef
    ▼
HumanQueueItem (system/human/)
    │
    │ on resolution
    ├── [done]     → ArchiveAction appended to system/decisions/{eventRef}.md
    ├── [defer]    → DeferredTask written to ./context/tasks/{slug}.md
    └── [delegate] → answer written to HumanQueueItem; processResolved re-evaluates
                     TriageEvent on next pipeline cycle
```
