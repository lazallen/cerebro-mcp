# Implementation Plan: Scheduled Task Heartbeat System

**Branch**: `017-task-heartbeat` | **Date**: 2026-02-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/017-task-heartbeat/spec.md`

## Summary

Implement a cron-based heartbeat system that executes scheduled tasks on configurable cadences with file-based event bus architecture. Initial tasks include email triage (convert emails to markdown with AI-identified action items) and calendar review (auto-create OneNote pages for upcoming meetings).

**Technical Approach**:
- **Scheduler**: node-cron for lightweight task scheduling with hot-reload support
- **Event Bus**: File-based event sourcing with markdown files (YYYYMMDD-{type}-{4char}.md naming)
- **LLM Integration**: LocalFoundry (Feature 011) for email action item extraction
- **Integrations**: Microsoft Graph API (email/calendar) + OneNote API (Feature 013)

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: node-cron ^3.0.3, chokidar ^4.0.3, proper-lockfile ^4.1.2, @modelcontextprotocol/sdk ^1.25.3
**Storage**: File-based (event files in markdown, execution logs, counter persistence)
**Testing**: Jest with 80% coverage threshold
**Target Platform**: Node.js server (Linux/macOS/Windows compatible)
**Project Type**: Single (MCP server extension)
**Performance Goals**: Tasks execute within 30s of schedule; email triage processes 50 emails in < 5 minutes
**Constraints**: Single-threaded execution per task, skip missed executions, prevent concurrent task instances
**Scale/Scope**: Support 10-20 scheduled tasks, process 50+ emails per batch, 7-day calendar lookahead

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Documentation-First ✅
- README updates: YES - New heartbeat system tools and configuration will be documented
- API Documentation: YES - Task configuration schema and event file format
- Configuration Documentation: YES - HEARTBEAT_ROOT_DIR, HEARTBEAT_CONFIG_FILE added to .env.example
- Integration Guides: YES - quickstart.md will show email triage and calendar review setup
- Breaking Changes: NO - This is additive functionality

### Service Architecture ✅
- BaseService Interface: N/A - Not creating a new external service, extending MCP server
- Configuration via Environment: YES - HEARTBEAT_ROOT_DIR, HEARTBEAT_CONFIG_FILE
- Structured Logging: YES - Using pino logger with operation, context fields
- Error Handling: YES - Clear distinction between timeout, file system, LLM, and API errors
- Type Safety: YES - TypeScript strict mode, no `any` types

### Testing Standards ✅
- Unit Tests: YES - Scheduler, config loader, event bus, email triage, calendar review
- Integration Tests: YES - End-to-end email triage, config hot-reload, concurrent execution
- Coverage: YES - 80% threshold maintained
- Error Path Testing: YES - Timeout, connection failures, invalid JSON, file locking conflicts
- Type Validation: YES - JSON schema validation for config and event files

### MCP Tool Design ⚠️
- Tool Naming: N/A - No new MCP tools exposed to users (internal automation)
- Input Schemas: N/A - Configuration via JSON file, not MCP tool interface
- Error Messages: YES - User-friendly logs for troubleshooting
- Timeouts: YES - Configurable per-task timeouts
- Independence: N/A - Heartbeat runs independently, not invoked via tools

**Note**: This feature is an internal automation system, not user-facing MCP tools. It enhances existing tools (email, calendar, OneNote) with scheduled automation.

### Dashboard Integration ⚠️
- Status Cards: FUTURE - Could add heartbeat status to dashboard (out of scope for MVP)
- State Indicators: FUTURE - Show task execution status
- Configuration Display: FUTURE - Show active tasks and schedules
- No Auth Services: N/A
- Real Health Checks: FUTURE

**Note**: Dashboard integration deferred to future iteration. MVP focuses on core scheduling functionality.

### Overall Assessment: ✅ PASS

All mandatory gates passed. Dashboard integration deferred as acceptable for internal automation feature.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── heartbeat/
│       ├── heartbeat-service.ts          # Main service class
│       ├── scheduler.ts                  # Cron-based task scheduler
│       ├── config-loader.ts              # Load/validate JSON config
│       ├── event-bus/
│       │   ├── event-writer.ts           # Write event files with locking
│       │   ├── event-reader.ts           # Read/parse event files
│       │   ├── event-consumer.ts         # Watch and consume events
│       │   └── id-generator.ts           # Generate unique 4-char IDs
│       ├── tasks/
│       │   ├── task-registry.ts          # Register available task types
│       │   ├── email-triage-task.ts      # Email processing with LLM
│       │   └── calendar-review-task.ts   # OneNote page creation
│       └── types.ts                      # Heartbeat-specific types
│
├── types/
│   └── heartbeat.ts                      # Shared type definitions
│
└── common/
    └── event-archiver.ts                 # Archive old event files

tests/
├── unit/
│   └── services/
│       └── heartbeat/
│           ├── scheduler.test.ts
│           ├── config-loader.test.ts
│           ├── event-bus/
│           │   ├── event-writer.test.ts
│           │   ├── event-reader.test.ts
│           │   └── id-generator.test.ts
│           └── tasks/
│               ├── email-triage-task.test.ts
│               └── calendar-review-task.test.ts
│
└── integration/
    └── heartbeat-integration.test.ts     # End-to-end scenarios

.env.example                              # Add HEARTBEAT_* variables
README.md                                 # Document heartbeat system
```

**Structure Decision**: Single project (Option 1) - Heartbeat system is a new service within the existing MCP server architecture, following established patterns from Features 011-016.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. All gates passed.

---

## Phase 0: Research (✅ Complete)

**Output**: [research.md](research.md)

**Key Decisions**:
- Task Scheduling: node-cron (lightweight, zero dependencies)
- File Watching: chokidar (robust cross-platform)
- File Locking: proper-lockfile (prevents concurrent access)
- Event Bus: File-based with YYYYMMDD-{type}-{4char}.md naming
- LLM Integration: LocalFoundry via existing client (Feature 011)
- Unique IDs: Base36 counter (1.6M IDs/day, deterministic ordering)

---

## Phase 1: Design & Contracts (✅ Complete)

**Outputs**:
- [data-model.md](data-model.md) - Entity schemas and relationships
- [contracts/heartbeat-config.json](contracts/heartbeat-config.json) - JSON schema for task configuration
- [contracts/email-triage-config.json](contracts/email-triage-config.json) - Email task config schema
- [contracts/calendar-review-config.json](contracts/calendar-review-config.json) - Calendar task config schema
- [contracts/event-file-format.md](contracts/event-file-format.md) - Event file specification
- [quickstart.md](quickstart.md) - Integration guide with examples
- CLAUDE.md updated with new dependencies (automated)

**Constitution Re-Check**: ✅ PASS (all gates maintained)

---

## Phase 2: Task Generation (Not Started)

Run `/speckit.tasks` to generate task breakdown from design artifacts.

---

## Summary

**Status**: Planning complete, ready for task generation and implementation.

**Artifacts Generated**:
- ✅ Research document with technology decisions
- ✅ Data model with 7 entity types
- ✅ 4 JSON schemas for configuration validation
- ✅ Event file format specification
- ✅ Quickstart guide with 3 usage scenarios
- ✅ Agent context updated (CLAUDE.md)

**Next Steps**:
1. Run `/speckit.tasks` to generate implementation task list
2. Implement Phase 3: Core scheduler and event bus infrastructure
3. Implement Phase 4: Email triage and calendar review tasks
4. Write comprehensive unit and integration tests
5. Update README with heartbeat system documentation

**Performance Targets**:
- ✅ Email triage: 50 emails in < 5 minutes (parallel processing with batch size 10)
- ✅ Calendar review: 20 meetings in < 3 minutes (OneNote API calls)
- ✅ Task execution: Within 30 seconds of scheduled time
- ✅ 99% system uptime for task execution

**Risk Mitigation**:
- LocalFoundry unavailable → Fall back to rule-based extraction or skip with warning
- File system full → Monitor disk space, retention/archival policy
- Config corruption → Validate JSON on load, keep last-known-good config
- Race conditions → File locking with proper-lockfile, atomic writes
