# Quickstart: Triage Review UI

**Feature**: 022-triage-review-ui

The Triage Review UI is a browser-based inbox for reviewing pending human-queue items produced by the pipeline. It is served by the existing auth server process — no separate server to start.

---

## Prerequisites

- Auth server running (`npm run start:auth` or the main server process)
- `system/human/` directory exists with at least one `hq_*.md` file with `status: pending`
- `ANTHROPIC_API_KEY` set in `.env` (required for Defer resolution)

---

## Open the UI

Navigate to:

```
http://localhost:3333/triage
```

(or `https://localhost:3333/triage` if SSL certificates are present)

---

## Workflow

### Reviewing Items

- The right-hand panel lists all pending items with a source badge and title
- Click any item to load its full content in the left-hand detail panel
- Items are sorted oldest-first

### Resolving: Done

> "I've handled this myself."

1. Select an item
2. Click **Done**
3. The item is marked `status: resolved`, `answer: done` in the HQ item file
4. For email and meeting-invite items, a MOVE-to-Archive action is queued for the next executor cycle
5. The panel auto-advances to the next pending item

### Resolving: Defer

> "This needs proper focused attention."

1. Select an item
2. Click **Defer** (button shows a spinner while the LLM enriches the task — typically 2–5 s)
3. A task file is written to `./context/tasks/` using your goals and project context
4. The HQ item is marked `status: resolved`
5. Review the created task file in `./context/tasks/`

**What gets read for context:**
- `./context/methodology.md` (if present)
- Up to 3 files from `./context/projects/`
- Up to 3 markdown files from `./context/` root
- Up to 5 recent task files from `./context/tasks/` (as format examples)

### Resolving: Delegate

> "I want the pipeline to handle this — with my guidance."

1. Select an item
2. The text box is pre-populated with the pipeline's question
3. Edit or replace the prompt with your instructions (e.g., "Decline — I'll be on holiday. Suggest the 12th instead.")
4. Click **Accept**
5. Your prompt is written as `answer` in the HQ item file with `status: resolved`
6. On the next pipeline cycle, the policy engine re-evaluates the event using your answer and determines the follow-up action (e.g., `DRAFT_REPLY`)

**Note**: Accept is disabled when the text box is empty.

---

## Configuration

The poll interval defaults to 10 seconds. To change it, append `?poll=N` (seconds) to the URL:

```
http://localhost:3333/triage?poll=30
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Nothing to review" but items exist | Items have `status: resolved` or `complete` | Check frontmatter — only `pending` items appear |
| Source badge shows "?" | `source` field missing from item frontmatter | Pre-022 item; pipeline will populate for new items |
| Defer returns error | `ANTHROPIC_API_KEY` not set or expired | Set `ANTHROPIC_API_KEY` in `.env` and restart the server |
| Items don't refresh | Browser tab backgrounded (timer throttled) | Bring tab to foreground or reload |
| Archive not happening | Decision file missing for event | Check `system/decisions/` — executor will retry on next cycle |

---

## File Locations

| Purpose | Path |
|---------|------|
| HQ item files | `system/human/hq_YYYYMMDD_NNN.md` |
| Archived HQ items | `system/human/done/` |
| Decision files (archive actions) | `system/decisions/{eventId}.md` |
| Deferred task files | `context/tasks/{slug}.md` |
| UI source files | `src/auth-server/triage/public/` |
