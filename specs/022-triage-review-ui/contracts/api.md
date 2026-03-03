# API Contracts: Triage Review UI

**Feature**: 022-triage-review-ui | **Date**: 2026-02-24
**Base URL**: `http://localhost:3333/triage`

All API endpoints return JSON. All write operations write exclusively to the local file system (FR-014).

---

## Static Assets

### `GET /triage`

Serves `index.html` — the main UI shell.

**Response**: `200 OK`, `Content-Type: text/html`

---

### `GET /triage/static/:filename`

Serves static assets. Supported filenames: `app.js`, `styles.css`.

**Response**: `200 OK`, `Content-Type: text/javascript | text/css`
**Error**: `404 Not Found` if filename not in allowed list

---

## Data API

### `GET /triage/api/items`

Returns all pending HQ items as a list of `TriageItemView` objects, sorted ascending by `createdAt`.

**Request**: No parameters

**Response**:
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "items": [
    {
      "id": "cfa3dee7-99bc-48eb-a546-419fe1c45c99",
      "source": "meeting-invite",
      "title": "Travel Platform ILD",
      "question": "Meeting invite received. Accept, decline, or tentatively accept?",
      "createdAt": "2026-02-24T20:18:01.700Z",
      "itemType": "ask_human",
      "eventRef": "20260224-email-AGZ1AAA=",
      "bodyMarkdown": "## Human Review Required\n\n..."
    }
  ]
}
```

**Fallback values**: If `source` or `title` are absent from frontmatter (pre-022 items), `source` defaults to `"other"` and `title` defaults to `"Untitled"`.

**Errors**:

| Status | Condition |
|--------|-----------|
| `500 Internal Server Error` | `system/human/` directory unreadable |

---

### `POST /triage/api/items/:id/resolve`

Resolves a pending HQ item. Writes result to disk. For Done (email/meeting-invite): also appends archive MOVE action to the decision file. For Defer: triggers LLM enrichment and writes a task file. For Delegate: writes the answer for pipeline re-evaluation.

**Request**:
```
POST /triage/api/items/cfa3dee7-99bc-48eb-a546-419fe1c45c99/resolve
Content-Type: application/json

{
  "resolution": "done" | "defer" | "delegate",
  "answer": "<user text>"    // required when resolution === "delegate"
}
```

**Success response**:
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true,
  "id": "cfa3dee7-99bc-48eb-a546-419fe1c45c99",
  "resolution": "done"
}
```

**Defer success response** (additional field):
```json
{
  "ok": true,
  "id": "cfa3dee7-99bc-48eb-a546-419fe1c45c99",
  "resolution": "defer",
  "taskFile": "context/tasks/review-fleet-assist-booking-proposal.md"
}
```

**Error responses**:

| Status | Body | Condition |
|--------|------|-----------|
| `400 Bad Request` | `{ "ok": false, "error": "Invalid resolution" }` | `resolution` not one of allowed values |
| `400 Bad Request` | `{ "ok": false, "error": "answer required for delegate" }` | `resolution === "delegate"` with empty/missing answer |
| `404 Not Found` | `{ "ok": false, "error": "Item not found" }` | No pending HQ item with given id |
| `409 Conflict` | `{ "ok": false, "error": "Item already resolved" }` | Item status is not `pending` |
| `500 Internal Server Error` | `{ "ok": false, "error": "<message>" }` | File write failure or LLM error |

**Idempotency**: A second POST to resolve an already-resolved item returns `409 Conflict`. The client should remove the item from its local list on receipt of `409` (item was resolved externally) or `200`.

---

## Error Format

All error responses use the same shape:

```json
{
  "ok": false,
  "error": "<human-readable message>"
}
```

---

## Sequence: Poll Cycle (client-side)

```
Client                              Server
  │                                   │
  │── GET /triage/api/items ─────────▶│
  │◀─ 200 { items: [...] } ──────────│
  │                                   │
  │  (user selects item, clicks Done) │
  │── POST /triage/api/items/:id/resolve ──▶│
  │     { resolution: "done" }        │
  │◀─ 200 { ok: true } ─────────────│
  │                                   │
  │  (auto-advance; next poll at T+10s)│
  │── GET /triage/api/items ─────────▶│
  │◀─ 200 { items: [...] (item gone) }│
```

## Sequence: Defer Resolution

```
Client                              Server                         Anthropic API
  │                                   │                                │
  │── POST .../resolve ──────────────▶│                                │
  │     { resolution: "defer" }       │── read ./context/ ────────────│
  │                                   │── buildPrompt() ──────────────│
  │                                   │── claude-haiku-4-5... ────────▶│
  │                                   │◀─ task YAML + markdown ────────│
  │                                   │── write ./context/tasks/*.md  │
  │                                   │── write HQ item resolved      │
  │◀─ 200 { ok: true, taskFile: ...} │                                │
```

Defer is synchronous from the client's perspective — the browser waits for the `200`. Typical latency: 2–5 s (Haiku). The UI should show a loading state on the Defer button while the request is in flight.
