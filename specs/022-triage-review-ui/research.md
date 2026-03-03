# Research: Triage Review UI

**Feature**: 022-triage-review-ui | **Date**: 2026-02-24

---

## Decision 1 — Frontend Technology

**Decision**: Vanilla HTML + CSS + JavaScript (no framework, no build step)

**Rationale**: This is a single-user local dev tool with a well-bounded interaction surface — two panels, three buttons, a text box, and a poll loop. The complexity does not justify a build pipeline. Vanilla JS is zero-dependency, instantly deployable as static files served by Node.js `fs.readFile`, and fully compatible with the existing auth server's raw HTTP architecture.

**Alternatives considered**:
- *React/Vite*: Overkill; introduces a build step and ~200 KB of dependencies for ~200 lines of logic
- *Svelte*: Elegant but still requires a build step and unfamiliar to contributors
- *Lit / Web Components*: Reasonable middle ground, but the CDN dependency and custom-element boilerplate add friction

---

## Decision 2 — Static File Serving

**Decision**: `fs.readFile` + manual `Content-Type` mapping inside `TriageRouter`; no static-file middleware

**Rationale**: Three files to serve (`index.html`, `app.js`, `styles.css`). A tiny lookup map is simpler than adding `serve-static`, `sirv`, or similar. The auth server already uses raw `http.IncomingMessage` / `ServerResponse` — adding `serve-static` would require wiring it into that model.

**Alternatives considered**:
- *serve-static npm package*: Works, but adds a runtime dependency for three files
- *Inline HTML in TypeScript template literals*: Used elsewhere in the auth server for dashboard pages, but for a complex UI with hundreds of lines of CSS/JS this becomes unreadable

---

## Decision 3 — Dark Theme System

**Decision**: CSS custom properties (variables) color system. No external design library.

**Color tokens**:
```css
--bg-canvas:   #0d1117   /* page background */
--bg-surface:  #161b22   /* card / panel background */
--bg-overlay:  #21262d   /* hover states, selected item */
--border:      #30363d   /* subtle borders */
--text-primary:#e6edf3   /* main text */
--text-muted:  #8b949e   /* secondary text, timestamps */
--accent:      #58a6ff   /* links, focus rings, active state */
--success:     #3fb950   /* Done button */
--warning:     #d29922   /* Defer button */
--info:        #58a6ff   /* Delegate / Accept button */
--danger:      #f85149   /* error states */
```

**Source badge colours**:
```
email:          #58a6ff  (blue)
slack:          #e01e5a  (Slack purple-red)
meeting-invite: #3fb950  (green)
calendar:       #f78166  (orange)
journal:        #d2a8ff  (purple)
other:          #8b949e  (muted grey)
```

**Rationale**: CSS variables allow consistent theming with no runtime overhead. Palette is based on GitHub's dark theme (well-tested, accessible contrast ratios for WCAG AA on dark surfaces).

**Alternatives considered**:
- *Tailwind CDN*: Clean utility classes but large CDN payload; overkill for one page
- *Bootstrap dark*: Too generic; introduces override battles
- *Custom design system*: Overly ambitious for a local tool

---

## Decision 4 — Defer LLM Model and Prompt Strategy

**Decision**: `claude-haiku-4-5-20251001` via existing `@anthropic-ai/sdk`

**Context loading strategy**:
1. Read `./context/methodology.md` (if present) — user's working methodology
2. Read up to 3 files from `./context/projects/` (project definitions)
3. Read up to 3 files from `./context/` root that look like goal/area files (non-directory markdown)
4. Read up to 5 most-recent files from `./context/tasks/` for format examples
5. Total context cap: 12,000 tokens (fits comfortably in Haiku context window alongside the task)

**Prompt structure**:
- System prompt: Explains the task file schema, instructs model to output valid YAML frontmatter followed by markdown body. Provides field descriptions and constraints.
- User prompt: HQ item content (question + event context table) + collected context files
- Output parsing: Extract YAML frontmatter block with gray-matter; validate required fields; fall back to a minimal task file if parsing fails

**Task file schema** (from existing `./context/tasks/` examples):
```yaml
---
status: todo
priority: medium          # low | medium | high
dueDate: null
checkBackDate: null
delegatedTo: null
title: "<LLM-generated title>"
category: project         # project | area | resource | other
project: null             # "[[projects/name]]" if applicable
area: null                # "[[area/name]]" if applicable
tags: []
---
## Context
[LLM-generated description]

## Success Criteria
- [ ] [LLM-generated criteria]

## Notes
- Deferred from: HQ item {id} on {date}
```

**Rationale**: Haiku is fast (< 3 s typical) and cheap — appropriate for a background enrichment step. The `@anthropic-ai/sdk` is already present (Feature 019). Structured system prompts with few-shot examples from existing tasks produce well-formed output.

**Alternatives considered**:
- *Local LLM (LocalFoundry)*: Available in the codebase but not guaranteed to be running; Haiku is a more reliable default for an interactive UI action
- *Claude Sonnet*: Higher quality but noticeably slower; for a task title + description Haiku is sufficient
- *Template-only (no LLM)*: Would produce a raw dump of the HQ item with no enrichment — the spec explicitly requires LLM enrichment (FR-006)

---

## Decision 5 — Archive Action for Done Resolution

**Decision**: Append a `MOVE` action to the existing `system/decisions/{eventRef}.md` file using a lockfile-guarded read-modify-write.

**Implementation**:
1. Read `system/decisions/{eventRef}.md` with `gray-matter`
2. Parse `actionsJson` array from frontmatter
3. Push `{ type: 'MOVE', folder: 'Archive', applied: false }` to the array
4. Rewrite file atomically (temp + rename)
5. The executor's next cycle picks up the unapplied MOVE action and archives the email

**For non-email sources** (slack, calendar, journal): skip the archive action write — no Outlook action is applicable. The HQ item is still marked resolved.

**Fallback**: If the decision file does not exist for the eventRef (e.g., event was already archived or cleaned up), log a warning and proceed without the MOVE action — the Done resolution is still recorded on the HQ item.

**Rationale**: Reusing the existing decision file and executor pipeline avoids introducing a new file format or a new executor code path. The executor's MOVE handler already handles "email no longer exists" gracefully (marks applied and moves on).

**Alternatives considered**:
- *Create a new decision file per archive action*: Cleaner isolation but requires the executor to handle multiple decisions per event, and the current decision store uses eventId as the key
- *Write directly to HQ item and let processResolved handle it*: Would require adding Done-specific logic to processResolved; spec explicitly says the executor should handle the archive

---

## Decision 6 — Real-time Updates: Polling vs WebSocket/SSE

**Decision**: Client-side polling via `setInterval` (default 10 s, configurable via a `?poll=N` query param)

**Rationale**: The spec requires items to appear/disappear within 10 seconds (SC-003, SC-004). Polling at 10 s delivers this with zero server-side complexity. No persistent connection to manage, no reconnect logic, no server-side push infrastructure. For a single-user local tool used intermittently, this is the correct level of complexity.

**Alternatives considered**:
- *Server-Sent Events (SSE)*: Would give instant updates; but requires a persistent connection and `chokidar` watcher on the server side. The pipeline also already runs on a 2-minute cycle — new items don't appear faster than the pipeline, so instant push offers minimal practical advantage
- *WebSocket*: Same as SSE plus bidirectional overhead; unjustified here

---

## Decision 7 — Atomic File Writes for Resolution

**Decision**: Use `proper-lockfile` (already a project dependency) for all HQ item and decision file mutations.

**Pattern**:
```typescript
const releaseFn = await lock(filePath, { retries: { retries: 5, minTimeout: 50 } });
try {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  // mutate parsed.data
  await fs.writeFile(filePath + '.tmp', matter.stringify(parsed.content, parsed.data));
  await fs.rename(filePath + '.tmp', filePath);
} finally {
  await releaseFn();
}
```

**Rationale**: The pipeline reads/writes these files on its own cycle. Lockfile prevents torn reads/writes if a pipeline cycle coincides with a UI resolution.
