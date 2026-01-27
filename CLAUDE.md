# cerebro-mcp Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-22

## Active Technologies
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.0.0, dotenv ^16.4.1, pino ^8.19.0 (logging), ws ^8.19.0 (011-localfoundry-integration)
- File-based token storage (not required for LocalFoundry - no OAuth) (011-localfoundry-integration)
- TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0 (012-email-folder-filter)
- File-based OAuth token storage (existing: .tokens/ directory) (012-email-folder-filter)

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
- 012-email-folder-filter: Added TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0
- 011-localfoundry-integration: Added TypeScript 5.3.3 with Node.js 18+ + @modelcontextprotocol/sdk ^1.0.0, dotenv ^16.4.1, pino ^8.19.0 (logging), ws ^8.19.0

- 010-slack-message-actions: Added TypeScript 5.x with Node.js 18+ + @modelcontextprotocol/sdk, Node.js crypto (HMAC-SHA256), uuid

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
