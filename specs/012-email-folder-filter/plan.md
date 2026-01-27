# Implementation Plan: Email Folder Filtering for List-Emails

**Branch**: `012-email-folder-filter` | **Date**: 2026-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-email-folder-filter/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add optional folder filtering to the `list-emails` MCP tool in Microsoft service. Currently, `list-emails` returns emails from all folders (inbox, spam, junk, etc.) using the `/me/messages` endpoint, which mixes spam with legitimate emails during triage. The feature will add an optional `folder` parameter that defaults to "inbox", allowing users to filter emails by folder. This uses Microsoft Graph API's `/me/mailFolders/{folderId}/messages` endpoint for folder-specific retrieval and maintains the existing `/me/messages` endpoint for "all" folders.

**Key Changes**:
- Add optional `folder` parameter to list-emails tool schema (default: "inbox")
- Resolve folder names to Microsoft Graph folder IDs (wellKnownName or custom folder lookup)
- Switch between `/me/mailFolders/{folderId}/messages` (specific folder) and `/me/messages` (all folders)
- Handle folder name resolution errors with clear user feedback
- Preserve existing pagination, sorting, and response format
- Maintain backward compatibility (existing callers get inbox-only by default, not breaking change since it improves default behavior)

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0
**Storage**: File-based OAuth token storage (existing: .tokens/ directory)
**Testing**: Jest with ts-jest, 80% coverage threshold
**Target Platform**: Node.js 18+ server (MCP server runtime)
**Project Type**: Single project (TypeScript server application)
**Performance Goals**: <2 seconds for email retrieval (existing constraint from spec SC-002)
**Constraints**:
- Must maintain existing API response format (FR-007)
- Must preserve pagination and sorting behavior (FR-009)
- Error messages must be user-friendly for invalid folders (FR-005)
- Case-insensitive folder name handling (FR-008)
**Scale/Scope**: Single MCP tool modification affecting ~15 lines of code + tests, no new files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Constitution Check

| Principle | Requirement | Status | Notes |
|-----------|-------------|--------|-------|
| **I. Documentation-First** | README, .env.example, API docs updates | ✅ PASS | Plan includes README update with folder parameter documentation |
| **II. Service Architecture** | BaseService interface, env config, structured logging, error handling | ✅ PASS | No new service, modifying existing MicrosoftService. Uses existing error handling patterns |
| **III. Testing Standards** | Unit tests, integration tests, 80% coverage, error path testing | ✅ PASS | Plan includes comprehensive test cases for folder filtering, edge cases, and error scenarios |
| **IV. MCP Tool Design** | Namespace prefix, JSON Schema, error messages, timeouts, independence | ✅ PASS | Modifying existing `list-emails` tool. Schema updated with folder parameter, clear error messages planned |
| **V. Dashboard Integration** | Status cards, state indicators, config display | ✅ N/A | No dashboard changes needed (email functionality change, not service status) |
| **Development Workflow** | Spec → Plan → Research → Design → Implementation → Docs → Testing → Validation | ✅ PASS | Following workflow: Spec complete, Plan in progress |
| **Code Quality Gates** | TypeScript compilation, ESLint, Prettier, test coverage, build success | ✅ PASS | All gates will be validated in implementation phase |
| **Documentation Requirements** | README, .env.example, inline docs, quickstart (if complex), breaking changes | ✅ PASS | Not breaking (default improves behavior), README update planned, inline JSDoc planned |
| **Security & Privacy** | No hardcoded secrets, token storage, localhost only, no logging secrets | ✅ PASS | No new secrets, uses existing token storage, no sensitive data exposure |

**Gate Status**: ✅ ALL PASS - Proceed to Phase 0 Research

### Complexity Justification

No complexity violations to justify. This feature:
- Modifies existing tool (no new tools/services)
- Uses established patterns (Microsoft Graph API calls, existing error handling)
- Minimal code changes (~15-20 lines modified + tests)
- No new dependencies or infrastructure

## Project Structure

### Documentation (this feature)

```text
specs/012-email-folder-filter/
├── plan.md              # This file
├── research.md          # Phase 0: Microsoft Graph folder API research
├── data-model.md        # Phase 1: Folder and email message entities
├── quickstart.md        # Phase 1: Usage examples for folder filtering
└── contracts/           # Phase 1: Updated list-emails tool schema
    └── list-emails-tool-schema.json
```

### Source Code (repository root)

```text
src/
├── services/
│   └── microsoft/
│       ├── microsoft-service.ts         # MODIFY: Update listEmails method
│       ├── api-client.ts                # NO CHANGE: Existing Graph API client
│       ├── token-storage.ts             # NO CHANGE: Existing token management
│       └── __tests__/
│           └── microsoft-service.test.ts # MODIFY: Add folder filtering tests
│
├── types/
│   └── tool.ts                          # NO CHANGE: Existing tool type definitions
│
└── mcp-server/
    └── mcp-server.ts                    # NO CHANGE: Tool registration unchanged

tests/
└── integration/
    └── microsoft-email-folder.test.ts   # NEW: Integration tests for folder filtering

README.md                                # MODIFY: Add folder parameter documentation
```

**Structure Decision**: Single project structure maintained. Changes are localized to the Microsoft service implementation (`microsoft-service.ts`) with corresponding test additions. No new services, clients, or architectural components required. Integration tests will be added to verify folder filtering behavior with Microsoft Graph API.

**Files to Modify**:
1. `src/services/microsoft/microsoft-service.ts` - Add folder resolution and endpoint switching logic
2. `src/services/microsoft/__tests__/microsoft-service.test.ts` - Add unit tests for folder parameter
3. `README.md` - Document the folder parameter in list-emails tool section

**Files to Create**:
1. `specs/012-email-folder-filter/research.md` - Microsoft Graph folder API documentation
2. `specs/012-email-folder-filter/data-model.md` - Folder and email entities
3. `specs/012-email-folder-filter/quickstart.md` - Usage examples
4. `specs/012-email-folder-filter/contracts/list-emails-tool-schema.json` - Updated tool schema
5. `tests/integration/microsoft-email-folder.test.ts` - Integration tests (optional, depends on test infrastructure)

### Post-Design Constitution Check

*Re-evaluation after Phase 1 design completion*

| Principle | Requirement | Status | Notes |
|-----------|-------------|--------|-------|
| **I. Documentation-First** | README, .env.example, API docs updates | ✅ PASS | quickstart.md created with comprehensive usage examples. README update planned. Tool schema documented in contracts/. |
| **II. Service Architecture** | BaseService interface, env config, structured logging, error handling | ✅ PASS | No changes to service architecture. Uses existing error handling. Clear user-friendly error messages designed (data-model.md). |
| **III. Testing Standards** | Unit tests, integration tests, 80% coverage, error path testing | ✅ PASS | Test cases designed: folder parameter validation, error scenarios, edge cases (empty folder, case sensitivity, invalid folder). |
| **IV. MCP Tool Design** | Namespace prefix, JSON Schema, error messages, timeouts, independence | ✅ PASS | Tool schema updated (contracts/list-emails-tool-schema.json). Error messages specified. No timeout changes (same API performance). |
| **V. Dashboard Integration** | Status cards, state indicators, config display | ✅ N/A | No dashboard changes (email functionality, not service status). |
| **Documentation Requirements** | README, .env.example, inline docs, quickstart, breaking changes | ✅ PASS | quickstart.md complete. Breaking change documented (default behavior improvement, folder="all" for old behavior). |
| **Security & Privacy** | No hardcoded secrets, token storage, localhost only, no logging secrets | ✅ PASS | No new secrets. Uses existing token storage. No sensitive data in folder names. |

**Post-Design Gate Status**: ✅ ALL PASS

**Design Validation**:
- ✅ Folder resolution strategy validated (well-known names, no extra API calls)
- ✅ Data model defined (Email Folder, Email Message entities)
- ✅ API contracts documented (list-emails schema updated)
- ✅ Error handling patterns specified (client-side + server-side validation)
- ✅ Performance impact assessed (no additional latency)
- ✅ Backward compatibility addressed (folder="all" preserves old behavior)

**Phase 1 Complete**: Ready for Phase 2 (Task Generation via `/speckit.tasks`)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. This section is intentionally left empty.
