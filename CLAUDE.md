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
