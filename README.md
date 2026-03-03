# Cerebro MCP TypeScript

Give Claude access to your entire work context — email, calendar, Slack, meeting rooms, and a local LLM — all from a single MCP server. Cerebro connects Claude Code to Microsoft 365 and Slack via OAuth, runs a policy-driven triage pipeline to automatically classify and action your inbox, and keeps everything local-first with LocalFoundry for on-device AI processing.

## Features

- **Email & Calendar** — Read, send, move, and folder-filter Microsoft 365 email; manage calendar events; find meeting times; book and release meeting rooms
- **Slack** — Browse channels, read threads, search canvases, manage reminders, triage your Save for Later queue
- **Automated Triage** — Policy-driven pipeline classifies your inbox every hour via YAML rules; uncertain items surface in a human review queue; FYI content lands in a daily reading pack
- **Local AI** — On-device text processing via LocalFoundry (summarize, clarify, extract) — no data leaves your machine
- **Scheduled Automation** — Heartbeat tasks for email ingestion, calendar-to-journal sync, and Slack saved items on configurable cron schedules
- **Always-On** — OAuth token refresh, health check endpoints, and a management script for reliable background operation

## Quick Start

```bash
# Install dependencies
npm install

# Generate SSL certificates (required for OAuth dashboard)
mkcert -install && mkcert localhost 127.0.0.1 ::1

# Configure credentials
cp .env.example .env
# Edit .env with your Microsoft/Slack credentials

# Start the server
npm start
```

Then add Cerebro to Claude Code:

```bash
claude mcp add --transport http cerebro http://localhost:3334/mcp
```

Visit `https://localhost:3333/` to authenticate services via the OAuth dashboard.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 3333 | HTTPS | OAuth dashboard + authentication flows |
| 3334 | HTTP | MCP endpoint for Claude Code |

Port 3333 uses HTTPS for secure OAuth callbacks. Port 3334 uses plain HTTP to avoid SSL certificate trust issues with MCP clients.

## Architecture

```
Port 3333 (HTTPS) — OAuthServer
  ├─ GET  /                      → Dashboard
  ├─ GET  /auth/:service/login   → OAuth flows
  ├─ GET  /auth/:service/callback → OAuth callbacks
  └─ GET/POST /mcp               → MCP (backward compat)

Port 3334 (HTTP) — MCPServer
  └─ GET/POST /mcp               → MCP protocol (primary)

ServiceRegistry (shared) → Microsoft, Slack, LocalFoundry
```

Claude Code connects to `http://localhost:3334/mcp`. The browser dashboard runs at `https://localhost:3333/`.

See [docs/architecture/http-transport.md](docs/architecture/http-transport.md) for full architecture details.

## Development

```bash
npm run build         # Compile TypeScript
npm test              # Run tests
npm run lint          # Lint
npm run start:pretty  # Run with formatted logs
```

## Documentation

### Guides

| Guide | Description |
|-------|-------------|
| [claude-code-setup.md](docs/guides/claude-code-setup.md) | Connecting Claude Code — configuration, SSL, troubleshooting |
| [troubleshooting.md](docs/guides/troubleshooting.md) | MCP connection issues and diagnostics |
| [microsoft-tools.md](docs/guides/microsoft-tools.md) | Email, calendar, and room booking tools reference |
| [slack-saved-items.md](docs/guides/slack-saved-items.md) | Slack Save for Later — credentials, tools, heartbeat ingestion |
| [localfoundry.md](docs/guides/localfoundry.md) | Local LLM integration — setup and tools |
| [heartbeat.md](docs/guides/heartbeat.md) | Scheduled task system — configuration, task types, monitoring |
| [journal-triage.md](docs/guides/journal-triage.md) | Calendar-to-journal sync with OneNote integration |
| [policy-engine.md](docs/guides/policy-engine.md) | Triage pipeline — setup, human queue, reading packs |
| [policy-rules.md](docs/guides/policy-rules.md) | Policy YAML DSL reference — predicates, actions, examples |
| [onenote-windows-ink.md](docs/guides/onenote-windows-ink.md) | Windows Ink handwriting recognition pipeline |

### Architecture

| Doc | Description |
|-----|-------------|
| [http-transport.md](docs/architecture/http-transport.md) | Dual-port HTTP architecture, SSE transport, session management |
| [triage-pipeline.md](docs/architecture/triage-pipeline.md) | Pipeline stages, file formats, safety gates, idempotency |

### Research

| Doc | Description |
|-----|-------------|
| [microsoft-graph-places-api.md](docs/research/microsoft-graph-places-api.md) | Microsoft Graph Places API — room discovery and booking |
| [meeting-response-api.md](docs/research/meeting-response-api.md) | Microsoft Graph calendar event response API |

## Available Tools Summary

**Microsoft 365** (16 tools): `authenticate`, `check-auth-status`, `list-mail-folders`, `list-emails`, `read-email`, `send-email`, `move-email`, `list-events`, `get-event`, `create-event`, `update-event`, `delete-event`, `find-meeting-times`, `list-meeting-rooms`, `check-room-availability`, `book-meeting-room`, `remove-meeting-room`

**Slack** (16 tools): `authenticate`, `check-auth-status`, `list-channels`, `get-channel-history`, `list-groups`, `get-group-history`, `get-thread-replies`, `read-canvas`, `search-canvases`, `get-user-identity`, `list-reminders`, `create-reminder`, `complete-reminder`, `list-message-actions`, `get-message-action`, `delete-message-action`

**Slack Saved Items** (2 tools): `list-saved-items`, `mark-saved-item-complete`

**LocalFoundry** (3 tools): `local.summarize`, `local.clarify`, `local.extract`

## Configuration

Key environment variables (see [.env.example](.env.example) for full list):

```bash
# Server
AUTH_SERVER_PORT=3333       # OAuth dashboard (HTTPS)
MCP_SERVER_PORT=3334        # MCP endpoint (HTTP)

# Microsoft 365 (optional)
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=common

# Slack (optional)
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_APP_TOKEN=xapp-...    # For Socket Mode message shortcuts

# LocalFoundry (optional)
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4

# Triage pipeline (optional)
HEARTBEAT_ROOT_DIR=./data
HEARTBEAT_CONFIG_FILE=./heartbeat-config.json
ANTHROPIC_API_KEY=sk-ant-...  # For Claude enrichment in triage pipeline
```

**OAuth redirect URIs** (register in your app portal):
- Microsoft: `https://localhost:3333/auth/microsoft/callback`
- Slack: `https://localhost:3333/auth/slack/callback`
