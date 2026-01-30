# Implementation Plan: Move Email to Folder

**Branch**: `014-move-email-folder` | **Date**: 2026-01-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/014-move-email-folder/spec.md`

## Summary

Add MCP tool for moving Outlook emails between folders via Microsoft Graph API, with optional read status control (default: mark as read). Supports single email moves (P1), nested folder paths (P2), and atomic batch operations (P3). Idempotent behavior ensures moving an email to its current folder succeeds without error.

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0 (existing)
**Storage**: File-based OAuth token storage (existing .tokens/ directory)
**Testing**: Jest with 80% coverage threshold (jest.config.js)
**Target Platform**: Node.js MCP server (cerebro-mcp)
**Project Type**: Single project (MCP server with service architecture)
**Performance Goals**: <3s per move operation, <2s confirmation feedback (SC-001, SC-006)
**Constraints**: Atomic batch operations (all-or-nothing), idempotent moves, balanced error messages
**Scale/Scope**: Extends existing Microsoft service with 2 new tools (move-email, move-emails-batch)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Documentation-First ✅
- **README Updates**: Add move-email and move-emails-batch to Microsoft tools section
- **API Documentation**: Tool schemas with input/output examples
- **Configuration**: No new environment variables required (reuses existing Microsoft Graph OAuth)
- **Integration Guide**: Add to quickstart.md with common move scenarios

### II. Service Architecture ✅
- **BaseService**: Extends existing MicrosoftService (already implements BaseService)
- **Configuration**: Reuses existing MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI
- **Logging**: Structured pino logging (operation, service, context) for move operations
- **Error Handling**: Clear distinction between folder-not-found, email-not-found, permission-denied, Graph API errors
- **Type Safety**: TypeScript strict mode, no `any` types except Graph API response typing

### III. Testing Standards ✅
- **Unit Tests**: Test email move handler, folder resolution, batch validation, error cases
- **Integration Tests**: Test with Microsoft Graph API (mocked responses for CI)
- **Coverage**: Target 80% threshold for new code
- **Error Path Testing**: Invalid email IDs, missing folders, permission errors, batch failures, idempotent cases
- **Type Validation**: Test input schema validation for tool parameters

### IV. MCP Tool Design ✅
- **Tool Naming**: `microsoft.move-email` (single), `microsoft.move-emails-batch` (batch)
- **Input Schemas**: JSON Schema with descriptions for emailId, folderPath, markAsRead, emailIds[]
- **Error Messages**: Balanced detail (email ID + subject, folder path) per FR-018
- **Timeouts**: Use existing Microsoft Graph API timeout configuration
- **Independence**: Tools are independently testable, reuse existing folder resolution from 012-email-folder-filter

### V. Dashboard Integration ✅
- **No Changes Required**: Reuses existing Microsoft service OAuth dashboard integration
- **Status**: Move tools available when Microsoft service is authenticated
- **Config Display**: No additional configuration to display

### Summary
✅ **All constitution gates pass** - No violations or complexity justifications needed. Feature extends existing Microsoft service following established patterns.

## Project Structure

### Documentation (this feature)

```text
specs/014-move-email-folder/
├── spec.md              # Feature specification (completed)
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output (generated below)
├── data-model.md        # Phase 1 output (generated below)
├── quickstart.md        # Phase 1 output (generated below)
├── contracts/           # Phase 1 output (generated below)
│   └── move-email-tools.md
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created by this command)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── microsoft/
│       ├── microsoft-service.ts     # Add move-email, move-emails-batch tools
│       ├── api-client.ts            # No changes (reuse existing methods)
│       ├── token-storage.ts         # No changes (reuse existing)
│       └── __tests__/
│           └── microsoft-service.test.ts  # Add move operation tests
├── mcp-server/
│   └── handlers/
│       └── email-move-tools.ts      # NEW: Move operation handlers
├── types/
│   └── email.ts                     # Add MoveEmailInput, MoveEmailsInput, MoveResult types
└── index.ts                          # No changes (service already registered)

tests/
├── integration/
│   └── microsoft-email-move.test.ts # NEW: Integration tests for move operations
└── unit/
    └── email-move-handlers.test.ts  # NEW: Unit tests for move handlers

README.md                              # Add move-email tools documentation
.env.example                           # No changes (reuses existing Microsoft config)
```

**Structure Decision**: Single project structure (Option 1). Cerebro-mcp uses a service-based architecture where all integrations live under `src/services/`. Microsoft email move functionality extends the existing `MicrosoftService` class by adding new MCP tools. Handlers are organized in `src/mcp-server/handlers/` following the pattern established by OneNote tools (013-onenote-meeting-notes). No new services or major architectural changes required.

## Complexity Tracking

> **No violations - table not needed**

All constitution principles are satisfied:
- Reuses existing Microsoft OAuth, service architecture, and error handling patterns
- No new dependencies beyond what's already in package.json
- Follows established MCP tool naming and schema conventions
- Meets documentation, testing, and type safety standards
