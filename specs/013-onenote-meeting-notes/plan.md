# Implementation Plan: OneNote Meeting Notes Management

**Branch**: `013-onenote-meeting-notes` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-onenote-meeting-notes/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable users to manage OneNote meeting notes through MCP server, including creating daily sections with pre-populated meeting pages, updating pre-brief notes, converting handwritten ink to text via local OCR (Tesseract.js primary, LocalFoundry fallback), and cleaning up old sections. The system parses multipart MIME responses from Graph API to extract InkML XML, renders strokes to PNG images, and processes them through local OCR without data exfiltration.

## Technical Context

**Language/Version**: TypeScript 5.3.3 with Node.js 18+
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.25.3, Microsoft Graph API v1.0, Tesseract.js (OCR), node-canvas (rendering), xml2js or fast-xml-parser (XML parsing)
**Storage**: Cloud-based (Microsoft OneNote via Graph API) - no local database required
**Testing**: Node.js standard testing framework (Jest or similar)
**Target Platform**: Cross-platform Node.js server (Linux, macOS, Windows via WSL)
**Project Type**: Single project (MCP server extension)
**Performance Goals**: Ink-to-text conversion completes within 10 seconds for typical meeting notes (1-5 pages handwriting), page updates within 5 seconds
**Constraints**: Local OCR processing only (no data exfiltration to external services), multipart MIME parsing required, himetric to pixel coordinate conversion
**Scale/Scope**: Personal use (single user), typical daily usage of 1-10 meetings per day, sections retained for days not weeks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Documentation-First**: Plan includes comprehensive documentation phase (README, .env.example updates, quickstart guide)
✅ **II. Service Architecture**: OneNote integration follows existing MicrosoftService pattern with BaseService interface
✅ **III. Testing Standards**: Plan includes unit and integration test requirements for OCR pipeline and Graph API interactions
✅ **IV. MCP Tool Design**: Tools will use `microsoft.` namespace prefix following established conventions
✅ **V. Dashboard Integration**: Extends existing Microsoft service status card (OAuth already configured)
✅ **Security & Privacy**: Local OCR processing ensures no data exfiltration, tokens stored in .tokens/ directory
✅ **Type Safety**: TypeScript strict mode with comprehensive typing for InkML parsing and OCR pipeline

**Result**: PASS - All constitution principles satisfied. No violations to justify.

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
│   └── microsoft/
│       ├── onenote-client.ts        # OneNote Graph API client (sections, pages, content)
│       ├── inkml-parser.ts          # Multipart MIME & InkML XML parsing
│       └── ink-renderer.ts          # Stroke rendering to PNG (node-canvas)
├── ocr/
│   ├── tesseract-recognizer.ts      # Primary OCR with Tesseract.js
│   └── localfoundry-recognizer.ts   # Fallback OCR via LocalFoundry vision
├── mcp-server/
│   ├── handlers/
│   │   └── onenote-tools.ts         # MCP tool handlers (create-section, update-page, etc.)
│   └── service-registration.ts      # Updated with OneNote tools registration
├── types/
│   ├── onenote.ts                   # OneNote types (Section, Page, InkData)
│   └── inkml.ts                     # InkML structure types (Trace, Stroke, Coordinates)
└── common/
    └── mime-parser.ts               # Generic multipart MIME parser

tests/
├── unit/
│   ├── inkml-parser.test.ts
│   ├── ink-renderer.test.ts
│   └── tesseract-recognizer.test.ts
└── integration/
    └── onenote-workflow.test.ts     # End-to-end section creation to OCR

.env.example                          # Add TESSERACT_LANG config
README.md                             # OneNote usage documentation
```

**Structure Decision**: Single project structure (Option 1) following existing MCP server architecture. OneNote functionality extends the existing MicrosoftService with new client, parsers, and OCR components. All code lives under `src/` with separation between Graph API client, InkML processing, OCR recognition, and MCP tool handlers.

## Complexity Tracking

No constitution violations - this section intentionally left empty.

---

## Planning Phase Completion

### Phase 0: Technical Research ✅

**Completed**: 2026-01-29

**Deliverables**:
- [research.md](./research.md) - 435 lines documenting:
  - Multipart MIME parsing approach (validated in prototype)
  - InkML XML structure and coordinate system
  - Himetric to pixel conversion formulas
  - node-canvas rendering pipeline
  - Tesseract.js integration patterns
  - LocalFoundry fallback strategy
  - Technical decisions with rationale
  - Prototype validation summary

**Key Findings**:
- ✅ InkML data successfully extracted from Graph API multipart response
- ✅ Custom regex-based MIME parser validated
- ✅ Tesseract.js selected as primary OCR (user clarification)
- ✅ LocalFoundry fallback for difficult handwriting
- ✅ Section naming format: "YYYY-MM-DD Meetings"

---

### Phase 1: Design Artifacts ✅

**Completed**: 2026-01-29

**Deliverables**:

1. **[data-model.md](./data-model.md)** - 600+ lines defining:
   - Domain entities: InkData, Stroke, Point, BrushProperties, Section, Page, Meeting
   - TypeScript interfaces for all entities
   - InkToTextInput/Result types with OCR options
   - Validation rules and error states
   - Data flow diagrams for all operations including ink-to-text
   - Content transformation (Markdown ↔ HTML)

2. **[contracts/tool-schemas.json](./contracts/tool-schemas.json)** - JSON Schema for 6 MCP tools:
   - `microsoft.onenote-create-section` - Create/reuse section with meeting pages
   - `microsoft.onenote-update-page` - Update page content
   - `microsoft.onenote-delete-section` - Delete section and pages
   - `microsoft.onenote-list-sections` - List all sections
   - `microsoft.onenote-find-page` - Find page by section + title
   - `microsoft.onenote-get-ink-text` - **NEW** Convert handwritten ink to text with OCR

3. **[quickstart.md](./quickstart.md)** - 500+ lines user guide:
   - Installation instructions (native dependencies for node-canvas)
   - 7 usage patterns with examples
   - Pattern 7: Ink-to-text conversion with Tesseract.js/LocalFoundry
   - Markdown formatting guide
   - Error handling and troubleshooting
   - Performance characteristics
   - Best practices

**Key Design Decisions**:
- OCR pipeline: InkML → PNG rendering (150 DPI) → Tesseract.js → LocalFoundry fallback
- Configurable OCR parameters: language, DPI, save PNG for debugging
- Stateless design: no local caching, always query Graph API
- Markdown-to-HTML conversion for user-facing simplicity

---

### Phase 2: Task Generation (Next Step)

**Command**: `/speckit.tasks`

**Expected Output**: [tasks.md](./tasks.md) with:
- Dependency-ordered implementation tasks
- File-by-file breakdown
- Unit and integration test tasks
- Documentation update tasks

**Ready to Proceed**: Yes - all research and design complete.

---

## Implementation Readiness

### Prerequisites Met ✅
- Constitution check passed
- Technical research validated with prototype
- Data model fully specified
- API contracts defined
- User documentation complete

### Dependencies Required
```json
{
  "dependencies": {
    "tesseract.js": "^5.0.0",
    "canvas": "^2.11.2",
    "fast-xml-parser": "^4.3.2",
    "marked": "^12.0.0"
  }
}
```

### Native Dependencies
- **Ubuntu/Debian**: `libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev`
- **macOS**: `cairo pango libpng jpeg giflib` (via Homebrew)
- **Windows**: Pre-built binaries included

### Estimated Implementation Effort
- **InkML parsing & rendering**: 1-2 days
- **OCR integration (Tesseract + LocalFoundry)**: 1 day
- **OneNote client & MCP tools**: 2-3 days
- **Testing & documentation**: 2 days
- **Total**: 6-8 days

### Next Command
```bash
/speckit.tasks
```
