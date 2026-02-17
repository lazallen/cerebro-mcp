# Implementation Plan: Meeting Room Booking for Calendar Triage

**Branch**: `016-meeting-room-booking` | **Date**: 2026-02-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-meeting-room-booking/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add meeting room booking functionality to the Cerebro MCP server, enabling automatic room discovery, availability checking, and booking through Microsoft Graph API. The feature integrates with the calendar-triage command to detect office location and automatically suggest/book meeting rooms for categorized in-person meetings. Implements opt-in category-based detection ("Office", "In-Person", "Room Needed") to distinguish meetings requiring physical rooms from virtual-only meetings.

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: `@modelcontextprotocol/sdk ^1.25.3`, Microsoft Graph API v1.0
**Storage**: File-based OAuth token storage (existing: `.tokens/` directory)
**Testing**: Jest with ts-jest, 80% coverage threshold
**Target Platform**: Node.js server (MCP stdio/HTTP transport)
**Project Type**: Single project (existing MCP server extension)
**Performance Goals**: <30s room booking completion time (SC-001), 95% office detection accuracy (SC-002), 90% successful first-attempt bookings (SC-003)
**Constraints**: Must gracefully handle missing Graph API permissions, zero double-bookings (SC-006), category-based opt-in detection
**Scale/Scope**: 4 new MCP tools, integration with existing Microsoft service, calendar-triage command enhancement

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Documentation-First ✓
- **README Updates**: New room booking tools will be documented with usage examples
- **API Documentation**: All 4 new tools will have input/output schemas documented
- **Configuration Documentation**: New Graph API permissions (Place.Read.All) will be added to .env.example
- **Integration Guides**: Calendar-triage integration will be documented with workflow examples
- **Breaking Changes**: No breaking changes - purely additive feature

### Service Architecture ✓
- **BaseService Interface**: Extending existing MicrosoftService (already implements BaseService)
- **Configuration via Environment**: Existing Microsoft OAuth config, new permission scope only
- **Structured Logging**: Will use existing pino logger with operation/service/context fields
- **Error Handling**: Clear error messages for permission failures, room conflicts, API errors (FR-007a, FR-007b, FR-014a)
- **Type Safety**: TypeScript strict mode, new types for Room, RoomAvailability entities

### Testing Standards ✓
- **Unit Tests**: Test room filtering, capacity calculations, conflict detection in isolation
- **Integration Tests**: Test Graph API room endpoints, booking flows end-to-end
- **Coverage**: Maintain 80% threshold for new handlers and clients
- **Error Path Testing**: Permission failures, room conflicts, API timeouts
- **Type Validation**: Test input schemas for all 4 new tools

### MCP Tool Design ✓
- **Tool Naming**: `microsoft_list-meeting-rooms`, `microsoft_check-room-availability`, `microsoft_book-meeting-room`, `microsoft_remove-meeting-room`
- **Input Schemas**: JSON Schema with descriptions (building, capacity, roomEmail, eventId parameters)
- **Error Messages**: User-friendly messages for permission issues, conflicts, unavailability
- **Timeouts**: Inherit existing Microsoft service timeout configuration
- **Independence**: Each tool independently testable, can be used outside calendar-triage

### Dashboard Integration ✓
- **Status Cards**: Existing Microsoft service card shows authentication status
- **State Indicators**: No changes needed - uses existing Connected/Available states
- **Configuration Display**: Shows Graph API endpoint, no new config display needed
- **No Auth Services**: N/A - extends existing OAuth service
- **Real Health Checks**: Will verify Place.Read.All permission in health check

### Quality Gates
- **TypeScript Compilation**: Zero type errors required ✓
- **ESLint**: Must pass with project rules ✓
- **Prettier**: Consistent formatting enforced ✓
- **Test Coverage**: 80% minimum for new code ✓
- **Build Success**: Clean dist/ build ✓

**Result**: ✅ All constitution gates passed - no violations requiring justification

## Project Structure

### Documentation (this feature)

```text
specs/016-meeting-room-booking/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output (technical decisions)
├── data-model.md        # Phase 1 output (entities/types)
├── quickstart.md        # Phase 1 output (usage guide)
├── contracts/           # Phase 1 output (tool schemas)
│   ├── list-meeting-rooms.json
│   ├── check-room-availability.json
│   ├── book-meeting-room.json
│   └── remove-meeting-room.json
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── microsoft/
│       ├── microsoft-service.ts         # [EXTEND] Add 4 new tool registrations
│       ├── api-client.ts                # [EXTEND] Add room discovery methods
│       ├── room-booking-client.ts       # [NEW] Room booking operations
│       └── __tests__/
│           └── room-booking-client.test.ts  # [NEW] Unit tests
├── types/
│   ├── room.ts                          # [NEW] Room, RoomAvailability types
│   └── index.ts                         # [EXTEND] Export new room types
├── mcp-server/
│   └── handlers/
│       └── room-booking-tools.ts        # [NEW] 4 tool handler implementations
└── common/
    └── capacity-calculator.ts           # [NEW] Buffer calculation logic (FR-027)

tests/
└── integration/
    └── room-booking-integration.test.ts # [NEW] End-to-end flow tests
```

**Structure Decision**: Extending existing single-project structure. Room booking functionality naturally extends the Microsoft service with new Graph API capabilities. Following established pattern: api-client for low-level HTTP calls, specialized client (room-booking-client) for business logic, handlers for MCP tool wrappers, types for domain models.

## Complexity Tracking

> **No violations - this section intentionally left empty**

All constitution checks passed. Feature complexity is justified:
- 4 new tools align with MCP Tool Design principle (each independently testable)
- New client class (room-booking-client) follows existing pattern (onenote-client, event-response-client)
- Category-based detection adds business logic but reduces false positives (explicit opt-in vs implicit detection)
- Capacity buffer calculation extracted to utility (testable, reusable)
