# cerebro-mcp Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-22

## Active Technologies
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.0.0, dotenv ^16.4.1, pino ^8.19.0 (logging), ws ^8.19.0 (011-localfoundry-integration)
- File-based token storage (not required for LocalFoundry - no OAuth) (011-localfoundry-integration)
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0 (012-email-folder-filter)
- File-based OAuth token storage (existing: .tokens/ directory) (012-email-folder-filter)
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0, Tesseract.js ^5.0.0 (OCR), node-canvas ^2.11.2 (ink rendering), fast-xml-parser ^4.3.2, marked ^12.0.0 (013-onenote-meeting-notes)
- Microsoft OneNote via Graph API v1.0 + InkML parsing + Local OCR (Tesseract.js primary, LocalFoundry fallback) (013-onenote-meeting-notes)
- Cloud storage only, no local DB (013-onenote-meeting-notes)
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0 (existing) (014-move-email-folder)
- File-based OAuth token storage (existing .tokens/ directory) (014-move-email-folder)
- TypeScript 5.3.3 with Node.js 18+ + `@modelcontextprotocol/sdk ^1.25.3`, Microsoft Graph API v1.0 (015-meeting-response)
- File-based OAuth token storage (existing `.tokens/` directory) (015-meeting-response)
- TypeScript 5.3.3 with Node.js 18+ + node-cron ^3.0.3, chokidar ^4.0.3, proper-lockfile ^4.1.2, @modelcontextprotocol/sdk ^1.25.3 (017-task-heartbeat)
- File-based (event files in markdown, execution logs, counter persistence) (017-task-heartbeat)

- TypeScript 5.x with Node.js 18+ + @modelcontextprotocol/sdk, Node.js crypto (HMAC-SHA256), uuid (010-slack-message-actions)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x with Node.js 18+: Follow standard conventions

## Recent Changes
- 017-task-heartbeat: Added TypeScript 5.3.3 with Node.js 18+ + node-cron ^3.0.3, chokidar ^4.0.3, proper-lockfile ^4.1.2, @modelcontextprotocol/sdk ^1.25.3
- 015-meeting-response: Added TypeScript 5.3.3 with Node.js 18+ + `@modelcontextprotocol/sdk ^1.25.3`, Microsoft Graph API v1.0
- 014-move-email-folder: Added TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0 (existing)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
