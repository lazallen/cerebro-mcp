# Implementation Plan: LocalFoundry LLM Integration

**Branch**: `011-localfoundry-integration` | **Date**: 2026-01-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-localfoundry-integration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Integrate Microsoft LocalFoundry's local LLM capabilities into Cerebro MCP to provide AI-powered text processing tools (summarize, clarify, extract) accessible through the Model Context Protocol. Uses OpenAI-compatible Chat Completions API format with no authentication required. Dashboard displays LocalFoundry availability status.

**Technical Approach**: Implement new LocalFoundryService following existing service patterns (BaseService interface), create simple HTTP client for OpenAI-compatible API calls (no OAuth needed), register three MCP tools with `local.*` namespace, add status card to OAuth dashboard showing endpoint availability and model configuration.

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.0.0, dotenv ^16.4.1, pino ^8.19.0 (logging), ws ^8.19.0
**Storage**: File-based token storage (not required for LocalFoundry - no OAuth)
**Testing**: Jest 29.7.0 + ts-jest 29.1.2 (coverage threshold: 80%)
**Target Platform**: Node.js 18+ server, dual HTTP transport (port 3333 HTTPS OAuth/Dashboard, port 3334 HTTP MCP)
**Project Type**: Single project - MCP server with integrated OAuth dashboard
**Performance Goals**: Tool response <15s total, dashboard status check <5s, concurrent request support
**Constraints**: <60s timeout per tool invocation (configurable), graceful degradation when LocalFoundry unavailable, no authentication overhead
**Scale/Scope**: 3 tools (summarize, clarify, extract), localhost-only endpoint, single model configuration per instance

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution Status**: Project constitution file (`.specify/memory/constitution.md`) contains only template placeholders. No specific principles or gates are defined. Proceeding with implementation following existing codebase patterns and best practices.

**Compliance Assessment**:
- ✓ Following established service architecture patterns (BaseService interface)
- ✓ Using existing testing framework and coverage requirements (Jest, 80% threshold)
- ✓ Maintaining consistency with existing services (Microsoft, Slack)
- ✓ TypeScript strict mode compliance
- ✓ Structured logging with Pino
- ✓ Environment-based configuration
- ✓ Graceful error handling and degradation

**No violations identified** - Implementation aligns with observed project conventions from existing services.

## Project Structure

### Documentation (this feature)

```text
specs/011-localfoundry-integration/
├── spec.md              # Feature specification (existing)
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - Technical decisions and patterns
├── data-model.md        # Phase 1 output - Entity definitions
├── quickstart.md        # Phase 1 output - Integration examples
├── contracts/           # Phase 1 output - API contracts
│   ├── chat-completion-request.json    # LocalFoundry request schema
│   ├── chat-completion-response.json   # LocalFoundry response schema
│   └── tool-schemas.json               # MCP tool input schemas
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── localfoundry/
│       ├── localfoundry-service.ts      # Main service implementing BaseService
│       ├── localfoundry-client.ts       # HTTP client for Chat Completions API
│       ├── localfoundry-token-storage.ts # Minimal token storage (dummy implementation)
│       └── types.ts                     # LocalFoundry-specific TypeScript interfaces
├── auth-server/
│   └── oauth-server.ts                  # Update dashboard with LocalFoundry status card
├── mcp-server/
│   └── service-registration.ts          # Register LocalFoundry service conditionally
├── common/
│   └── config.ts                        # Add LocalFoundry configuration loading
└── types/
    └── service.ts                       # (no changes - uses existing BaseService)

tests/
├── unit/
│   └── services/
│       └── localfoundry/
│           ├── localfoundry-service.test.ts  # Service lifecycle tests
│           ├── localfoundry-client.test.ts   # API client tests
│           └── tools.test.ts                 # Tool handler tests (summarize, clarify, extract)
└── integration/
    └── localfoundry-integration.test.ts      # End-to-end service integration tests

.env.example                             # Add LOCALFOUNDRY_* variables
```

**Structure Decision**: Single project structure maintained. LocalFoundry service follows existing patterns used by Microsoft and Slack services. Each service has dedicated directory under `src/services/` with service class, API client, token storage, and types. Tests mirror source structure under `tests/unit/` and `tests/integration/`.

## Complexity Tracking

**No violations to justify** - Implementation follows existing patterns without introducing additional complexity. LocalFoundry integration is simpler than existing OAuth-based services (Microsoft, Slack) due to no authentication requirement.
