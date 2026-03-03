# Implementation Plan: Triage Review UI

**Branch**: `022-triage-review-ui` | **Date**: 2026-02-24 | **Spec**: [spec.md](spec.md)

## Summary

A browser-based triage inbox served at `http://localhost:3333/triage`. The UI reads `system/human/` for pending HQ items and renders them in a two-panel dark-themed layout. Three resolution paths write exclusively to the file system: Done (marks resolved + queues email archive MOVE action), Defer (LLM-enriches context into a task file in `./context/tasks/`), Delegate (writes user prompt as answer; pipeline re-evaluates on the next cycle). The UI is vanilla HTML/CSS/JS served as static files — no build step, no new framework dependency. It is hosted inside the existing auth server process on port 3333.

## Technical Context

**Language/Version**: TypeScript 5.3.3 + Node.js 18+
**Primary Dependencies**: Existing — `@anthropic-ai/sdk` (Defer enrichment), `gray-matter` (frontmatter parse/write), `proper-lockfile` (atomic file writes); no new npm packages
**Storage**: File system — `system/human/` (HQ items), `system/decisions/` (archive actions), `./context/tasks/` (deferred tasks)
**Testing**: `npm test && npm run lint` (Jest + ESLint + TypeScript strict)
**Target Platform**: Node.js local server (existing auth server process, port 3333)
**Project Type**: Single project — extends existing `src/` monorepo
**Performance Goals**: Page load < 2 s; poll interval 10 s (configurable); resolution write < 500 ms
**Constraints**: No new npm dependencies (prefer existing); all file writes atomic; no live API calls from UI (FR-014)
**Scale/Scope**: Single user, local instance; handful of pending items at any time

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Documentation-First | PASS | quickstart.md + inline JSDoc; README update tracked in tasks |
| II. Service Architecture | PASS | New `TriageRouter` follows handler pattern; pino logger used throughout |
| III. Testing Standards | PASS | Unit tests for API handlers + enrichment; integration test for poll cycle |
| IV. MCP Tool Design | N/A | No new MCP tools in this feature |
| V. Dashboard Integration | PASS | `/triage` route added to existing auth server; no new OAuth service |

**Gate result: PASS** — no violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/022-triage-review-ui/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── api.md           ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks — not created here)
```

### Source Code

```text
src/
├── auth-server/
│   ├── oauth-server.ts          (existing — add /triage delegation)
│   ├── triage-router.ts         (new — handles all /triage/* requests)
│   └── triage/
│       └── public/
│           ├── index.html       (two-panel dark UI shell)
│           ├── app.js           (poll loop, item list, resolution handlers)
│           └── styles.css       (dark theme + layout)
└── lib/
    └── triage/
        ├── human-queue-store.ts (existing — add source/title fields to HumanQueueItem)
        ├── defer-enrichment.ts  (new — Claude enrichment for Defer resolution)
        └── archive-action.ts    (new — append MOVE-to-archive to decision file)

tests/
├── unit/
│   └── triage/
│       ├── triage-router.test.ts
│       └── defer-enrichment.test.ts
└── integration/
    └── triage/
        └── triage-api.test.ts
```

**Structure Decision**: Single project, extending existing `src/auth-server/` and `src/lib/triage/` directories. No new top-level directories. Static UI assets live under `src/auth-server/triage/public/` and are copied to `dist/` at build time.

## Phase 0 — Research

_See [research.md](research.md) for all decisions with rationale._

Key decisions resolved:
1. **Frontend**: Vanilla HTML/CSS/JS — no build step, no framework dependency; justified by single-user local tool with small interaction surface
2. **Static file serving**: `fs.readFile` + content-type mapping in `TriageRouter`; no static-file npm package needed
3. **Dark theme**: CSS custom properties color system; no external design library
4. **Defer LLM**: `claude-haiku-4-5-20251001` via existing `@anthropic-ai/sdk`; reads up to 10 files from `./context/` for enrichment context
5. **Archive action**: Append a `MOVE` action to the existing decision file in `system/decisions/`; executor already handles MOVE for email/meeting-invite sources
6. **Realtime updates**: Client-side polling every 10 s (FR-012); no WebSocket complexity needed

## Phase 1 — Design

_See [data-model.md](data-model.md) and [contracts/api.md](contracts/api.md)._

### Pipeline Change (SC-007 permitted change)

`HumanQueueItem` gains two optional frontmatter fields: `source` and `title`. These are written by `createItem()` in `human-queue-store.ts` and populated at call site in `policy-pipeline-task.ts` from the parent `TriageEvent`.

**Files changed for pipeline change only:**
- `src/lib/triage/human-queue-store.ts` — add `source?` and `title?` to interface + YAML write
- `src/services/heartbeat/tasks/policy-pipeline-task.ts` — pass `source` and `title` from event to `createHumanQueueItem`

### Triage Router

`TriageRouter` is a new class registered with `OAuthServer` at startup. `handleRequest()` delegates to it for paths starting with `/triage`.

Routes:
- `GET /triage` — serve `index.html`
- `GET /triage/static/:file` — serve CSS/JS assets
- `GET /triage/api/items` — return pending HQ items as `TriageItemView[]` (JSON)
- `POST /triage/api/items/:id/resolve` — accept `{ resolution, answer? }` and dispatch to Done / Defer / Delegate handlers

### Resolution Handlers

| Resolution | Handler | File Writes |
|------------|---------|-------------|
| Done | `handleDone(item)` | HQ item: `answer:done`, `status:resolved`, `resolvedAt`. Archive: append MOVE action to `system/decisions/{eventRef}.md` (email/meeting-invite events only) |
| Defer | `handleDefer(item)` | Call `deferEnrichment(item, contextDir)` → write task to `./context/tasks/{slug}.md`. HQ item: `status:resolved`, `resolvedAt`, `answer:deferred` |
| Delegate | `handleDelegate(item, answer)` | HQ item: `answer:<user text>`, `status:resolved`, `resolvedAt` |

All writes use `proper-lockfile` for atomic update. Pattern: read frontmatter with `gray-matter`, mutate, write to temp file, rename.

### Defer Enrichment

`DeferEnrichmentService` in `src/lib/triage/defer-enrichment.ts`:

1. Reads `./context/` directory — collects goals, projects, and up to 10 most-recent tasks as context
2. Builds a system prompt explaining the task template (from `./context/templates/` if present, else uses the schema discovered in Phase 0 research)
3. Calls `claude-haiku-4-5-20251001` with: system prompt + HQ item content + context digest
4. Parses YAML frontmatter from the response
5. Writes atomic task file to `./context/tasks/{kebab-slug-from-title}.md`

### UI Layout

Two-column CSS Grid (`320px` list | `1fr` detail panel). Fixed viewport height — panels scroll independently. Resolution controls pinned to bottom of detail panel with `position: sticky`.

Dark theme: near-black background (`#0d1117`), surface cards (`#161b22`), muted borders (`#30363d`), primary text (`#e6edf3`), accent blue (`#58a6ff`). Source badges are colour-coded chips.

## Complexity Tracking

No constitution violations requiring justification.
