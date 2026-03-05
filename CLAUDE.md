# cerebro-mcp

The MCP server that powers Stuart Davidson's Cerebro productivity system. It exposes Microsoft Graph, Slack, and local processing tools to Claude Code via the MCP protocol, and runs an autonomous heartbeat process that keeps the Obsidian vault in sync.

## Relationship to the Cerebro Project

- **Cerebro project** (commands, skills, CLAUDE.md): `/home/stuartdavidson/cerebro` — also accessible as `./cerebro-project/`
- **Obsidian vault** (tasks, journal, people, projects): `/home/stuartdavidson/cerebro/context` — also accessible as `./context/`
- **Obsidian plugin**: `/home/stuartdavidson/code/obsidian-cerebro`

When investigating how a tool is called or why something behaves a certain way, check the commands and skills in `./cerebro-project/.claude/` — that's where the business logic lives that drives how Claude Code invokes these MCP tools.

## Architecture

```
src/
├── tools/          # MCP tool implementations (microsoft, slack, local, triage)
├── heartbeat/      # Autonomous background process (journal-triage, task sync)
├── policy/         # Policy engine for triage decisions
└── server.ts       # MCP server entry point

specs/              # Feature specs (numbered, e.g. 017-task-heartbeat.md)
```

## Key Subsystems

### Heartbeat (`src/heartbeat/`)
Runs on a cron schedule. Key tasks:
- **journal-triage**: Syncs Outlook calendar events into daily journal markdown files, creates missing journal entries. Runs every 15 minutes.
- Reads/writes directly to the Obsidian vault via the `context` symlink.

**Known issue (2026-03-02):** The journal-triage process is pre-populating the Morning Check-In energy level field with a default value ("7/10 - Ready to start the day") before the boot sequence runs. This is incorrect — energy level should only be written by the user via boot sequence.

### Policy Engine (`src/policy/`)
Evaluates triage items against rules defined in `system/` directory. Drives the `triage_*` MCP tools.

### Smart Meeting Scheduler (`src/services/smart-meetings/`)
Config-driven recurring meeting manager (Feature 023). Replaces Reclaim.ai. Two heartbeat phases:
- **forward-scheduling** (daily 07:00 Mon–Fri): ensures each enabled meeting has an event scheduled ~21 days out; skips if already scheduled; processes overdue meetings first (by cadence debt).
- **rebalance** (Monday 08:00): detects conflicts, reschedules affected meetings (48h protection — never moves a meeting within 48h).

Key files:
- `smart-meetings-config.json` — runtime config (gitignored); see `specs/023-smart-meeting-scheduler/`
- `src/services/smart-meetings/smart-meetings-service.ts` — MCP tool `smart_meetings_status`
- `src/auth-server/smart-meeting-router.ts` — dashboard at `https://localhost:3333/smart-meetings`
- `src/services/smart-meetings/portfolio-ref.ts` — shared in-process ref for time portfolio (written by heartbeat, read by MCP tool)

### Microsoft Tools (`src/tools/microsoft/`)
Wraps Microsoft Graph API v1.0. Covers: calendar events, email, OneNote, meeting rooms, meeting responses.

### Slack Tools (`src/tools/slack/`)
Covers: channels, groups, canvases, reminders, saved items, message actions.

## Commands

```bash
npm test          # Run tests
npm run lint      # Lint
npm run build     # Production build to dist/
npm run dev       # Watch mode
```

## Configuration

- `heartbeat-config.json` — runtime config (gitignored). See `heartbeat-config.example.json`.
- `smart-meetings-config.json` — smart meeting definitions (gitignored). See `specs/023-smart-meeting-scheduler/`.
- `.tokens/` — OAuth token storage (gitignored)
- `system/` — Policy rules and system config (gitignored from repo, lives in vault)

## Active Technologies

- TypeScript 5.3.3 / Node.js 18+
- `@modelcontextprotocol/sdk ^1.25.3`
- Microsoft Graph API v1.0
- `gray-matter` (frontmatter parsing)
- `pino` (logging)
- `node-cron` + `chokidar` + `proper-lockfile` (heartbeat)
- `@anthropic-ai/sdk` (policy engine enrichment)
