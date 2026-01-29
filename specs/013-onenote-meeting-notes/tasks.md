# Tasks: OneNote Meeting Notes Management

**Input**: Design documents from `/specs/013-onenote-meeting-notes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tool-schemas.json

**Tests**: No test tasks included - tests not explicitly requested in specification

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths below follow cerebro-mcp structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependency installation

- [x] T001 Install Node.js dependencies: `npm install tesseract.js canvas fast-xml-parser marked`
- [x] T002 [P] Add TESSERACT_LANG environment variable to .env.example
- [x] T003 [P] Update CLAUDE.md with OneNote feature tech stack (TypeScript 5.3.3, Tesseract.js, node-canvas)
- [x] T004 [P] Create debug directory for PNG output: `mkdir -p debug`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core type definitions and shared utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Create OneNote type definitions in src/types/onenote.ts (Section, Page, OneNotePageContent interfaces)
- [x] T006 [P] Create InkML type definitions in src/types/inkml.ts (InkData, Stroke, Point, BrushProperties, BoundingBox interfaces)
- [x] T007 [P] Implement multipart MIME parser in src/common/mime-parser.ts (parsemultipartResponse, extractBoundary functions)
- [x] T008 [P] Create markdown converter utility in src/services/microsoft/markdown-converter.ts (markdownToOneNoteHtml, escapeHtml functions)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Daily Meeting Section Creation (Priority: P1) 🎯 MVP

**Goal**: Enable users to create daily sections with pre-populated meeting pages containing markdown-formatted pre-brief notes

**Independent Test**: Create section "2026-01-29 Meetings" with 3 meetings, verify section exists in OneNote with correct pages and pre-brief content. Test duplicate detection by running same command twice.

### Implementation for User Story 1

- [x] T009 [P] [US1] Implement OneNote client base in src/services/microsoft/onenote-client.ts (constructor, getDefaultNotebook, listSections)
- [x] T010 [P] [US1] Add section operations to OneNote client: createSection, findSectionByName, ensureSectionExists methods
- [x] T011 [US1] Add page operations to OneNote client: listPagesInSection, createPage methods (depends on T009)
- [x] T012 [US1] Implement duplicate page detection: isDuplicatePage method in onenote-client.ts
- [x] T013 [US1] Implement page ordering logic: sortPagesByTime helper in onenote-client.ts
- [x] T014 [US1] Create microsoft.onenote-create-section MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [x] T015 [US1] Implement createSectionWithPages workflow: validate inputs, convert markdown, create section, create pages, handle duplicates
- [x] T016 [US1] Add error handling for section creation failures (404, 401, 507 responses)
- [x] T017 [US1] Add structured logging for section creation operations (start, completion, errors)
- [x] T018 [US1] Register microsoft.onenote-create-section tool in src/mcp-server/service-registration.ts getTools() method

**Checkpoint**: At this point, User Story 1 should be fully functional - users can create daily sections with meeting pages

---

## Phase 4: User Story 2 - Pre-Brief Notes Updates (Priority: P2)

**Goal**: Enable users to update pre-brief notes on existing meeting pages throughout the day

**Independent Test**: Create a page with initial content, update it with new markdown content, verify changes persist in OneNote. Test error handling by updating non-existent page.

### Implementation for User Story 2

- [x] T019 [P] [US2] Add page update operation to OneNote client: updatePageContent method in src/services/microsoft/onenote-client.ts
- [x] T020 [P] [US2] Implement findPageByTitle method in onenote-client.ts (search within section)
- [x] T021 [US2] Create microsoft.onenote-update-page MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [x] T022 [US2] Implement updatePageWorkflow: find section, find page, convert markdown, PATCH content (depends on T019, T020)
- [x] T023 [US2] Add error handling for page update failures (404 page not found, 400 bad HTML)
- [x] T024 [US2] Add structured logging for page update operations (start, page found, update success/failure)
- [x] T025 [US2] Register microsoft.onenote-update-page tool in src/mcp-server/service-registration.ts getTools() method

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can create sections and update pages

---

## Phase 5: User Story 3 - Ink-to-Text Conversion (Priority: P3)

**Goal**: Enable users to convert handwritten ink strokes on OneNote pages to searchable text using Tesseract.js with LocalFoundry fallback

**Independent Test**: Create a page with ink strokes (using OneNote app), request conversion with `microsoft.onenote-get-ink-text`, verify recognized text is returned. Test with page containing no ink.

### Implementation for User Story 3

- [x] T026 [P] [US3] Implement InkML parser in src/services/microsoft/inkml-parser.ts (parseInkML, extractStrokes, parseBrushProperties functions)
- [x] T027 [P] [US3] Implement coordinate system converter: himetricToPixels function in inkml-parser.ts
- [x] T028 [P] [US3] Implement bounding box calculator: calculateBounds function in inkml-parser.ts
- [x] T029 [P] [US3] Implement ink renderer in src/services/microsoft/ink-renderer.ts (renderStrokesToPNG, createCanvas, drawStrokes functions using node-canvas)
- [x] T030 [P] [US3] Implement Tesseract.js recognizer in src/ocr/tesseract-recognizer.ts (recognizeHandwriting, createWorker, optimizeForHandwriting functions)
- [x] T031 [P] [US3] Implement LocalFoundry recognizer in src/ocr/localfoundry-recognizer.ts (recognizeWithVision, sendToLocalFoundry functions)
- [x] T032 [US3] Add getPageContentWithInk method to OneNote client in onenote-client.ts (GET with includeInkML=true parameter)
- [x] T033 [US3] Implement OCR orchestrator: chooseOCRMethod, processWithTesseract, fallbackToLocalFoundry in tesseract-recognizer.ts (depends on T030, T031)
- [x] T034 [US3] Create microsoft.onenote-get-ink-text MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [x] T035 [US3] Implement ink-to-text workflow: fetch page with InkML, parse MIME, extract InkML, render PNG, run OCR, return text (depends on T026-T033)
- [x] T036 [US3] Add PNG saving logic for debugging: savePngIfRequested function (optional based on savePng parameter)
- [x] T037 [US3] Add error handling for ink conversion failures (no ink found, OCR timeout, LocalFoundry unavailable)
- [x] T038 [US3] Add structured logging for ink-to-text operations (InkML extraction, PNG rendering, OCR method, confidence scores)
- [x] T039 [US3] Register microsoft.onenote-get-ink-text tool in src/mcp-server/service-registration.ts getTools() method

**Checkpoint**: All core user stories (1, 2, 3) should now be independently functional - full OneNote workflow operational

---

## Phase 6: User Story 4 - Section Cleanup (Priority: P4)

**Goal**: Enable users to delete old sections to maintain a clean OneNote workspace

**Independent Test**: Create a test section, delete it by name, verify section no longer appears in OneNote. Test error handling by deleting non-existent section.

### Implementation for User Story 4

- [ ] T040 [P] [US4] Add section deletion operation to OneNote client: deleteSection method in src/services/microsoft/onenote-client.ts
- [ ] T041 [P] [US4] Add page count utility: countPagesInSection method in onenote-client.ts
- [ ] T042 [US4] Create microsoft.onenote-delete-section MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [ ] T043 [US4] Implement deleteSectionWorkflow: find section, get page count, confirm deletion, DELETE section (depends on T040, T041)
- [ ] T044 [US4] Add error handling for section deletion failures (404 not found, 403 permission denied)
- [ ] T045 [US4] Add structured logging for section deletion operations (section found, page count, deletion confirmation)
- [ ] T046 [US4] Register microsoft.onenote-delete-section tool in src/mcp-server/service-registration.ts getTools() method

**Checkpoint**: All user stories (1-4) complete - full feature set operational

---

## Phase 7: Utility Tools (Supporting Features)

**Purpose**: Additional tools for listing and finding content (referenced in quickstart.md)

- [ ] T047 [P] Create microsoft.onenote-list-sections MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [ ] T048 [P] Implement listSectionsWorkflow: fetch sections, optionally get page counts, format response
- [ ] T049 [P] Create microsoft.onenote-find-page MCP tool handler in src/mcp-server/handlers/onenote-tools.ts
- [ ] T050 [P] Implement findPageWorkflow: find section, find page by title, optionally fetch content, convert HTML to markdown
- [ ] T051 [P] Implement HTML-to-markdown converter using turndown in src/services/microsoft/markdown-converter.ts (htmlToMarkdown function)
- [ ] T052 Register microsoft.onenote-list-sections tool in src/mcp-server/service-registration.ts getTools() method
- [ ] T053 Register microsoft.onenote-find-page tool in src/mcp-server/service-registration.ts getTools() method

**Checkpoint**: All 6 MCP tools registered and functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and final touches

- [ ] T054 [P] Update README.md with OneNote integration section: prerequisites, installation, usage examples
- [ ] T055 [P] Add OneNote tool examples to README.md: create-section, update-page, get-ink-text, delete-section
- [ ] T056 [P] Document native dependency installation in README.md (Cairo, Pango, libjpeg for node-canvas)
- [ ] T057 [P] Add OCR accuracy tips to README.md: writing style recommendations, DPI settings, language configuration
- [ ] T058 Validate quickstart.md examples: test Pattern 1-7 against actual implementation
- [ ] T059 [P] Add error message constants in src/common/errors.ts: SECTION_NOT_FOUND, PAGE_NOT_FOUND, NO_INK_FOUND
- [ ] T060 [P] Add configuration validation: verify Notes.ReadWrite scope in service-registration.ts
- [ ] T061 Create sample .env.example entries: TESSERACT_LANG=eng, ONENOTE_DEBUG_IMAGES=false
- [ ] T062 Run TypeScript build: `npm run build` and fix any type errors
- [ ] T063 Run linter: `npm run lint` and fix any issues
- [ ] T064 Verify all 6 tools are discoverable via MCP: test tool listing with MCP client

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Utility Tools (Phase 7)**: Depends on foundational OneNote client (Phase 2)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on US1, but typically used together
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Requires pages created by US1 for practical testing
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - Requires sections created by US1 for practical testing

### Within Each User Story

- Type definitions before implementations
- OneNote client methods before MCP tool handlers
- Core workflow before error handling and logging
- Tool handler before tool registration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks (T001-T004) marked [P] can run in parallel
- All Foundational tasks (T005-T008) marked [P] can run in parallel within Phase 2
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Within each user story, tasks marked [P] can run in parallel:
  - US1: T009-T010 (OneNote client methods)
  - US2: T019-T020 (update and find methods)
  - US3: T026-T031 (InkML parser, renderer, OCR recognizers - all independent files)
  - US4: T040-T041 (delete and count methods)
- All Utility tools (T047-T051) can be developed in parallel
- All Polish tasks (T054-T061) can run in parallel

---

## Parallel Example: User Story 3 (Ink-to-Text)

```bash
# Launch all parallel tasks for User Story 3 together:
Task T026: "Implement InkML parser in src/services/microsoft/inkml-parser.ts"
Task T027: "Implement coordinate system converter in inkml-parser.ts"
Task T028: "Implement bounding box calculator in inkml-parser.ts"
Task T029: "Implement ink renderer in src/services/microsoft/ink-renderer.ts"
Task T030: "Implement Tesseract.js recognizer in src/ocr/tesseract-recognizer.ts"
Task T031: "Implement LocalFoundry recognizer in src/ocr/localfoundry-recognizer.ts"

# These 6 tasks touch different files and have no dependencies on each other
# Can be completed simultaneously by multiple developers or agents
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T008) - CRITICAL GATE
3. Complete Phase 3: User Story 1 (T009-T018)
4. **STOP and VALIDATE**: Test section creation workflow independently
5. Deploy/demo basic OneNote section management

**MVP Scope**: 18 tasks (T001-T018)
**Estimated Effort**: 2-3 days for experienced TypeScript developer

### Incremental Delivery

1. **Foundation** (Phase 1-2): Setup + Types + Utilities → ~1 day
2. **MVP** (Phase 3): Add User Story 1 → Test independently → Deploy! (section creation) → ~1 day
3. **Enhancement 1** (Phase 4): Add User Story 2 → Test independently → Deploy (page updates) → ~0.5 day
4. **Enhancement 2** (Phase 5): Add User Story 3 → Test independently → Deploy (ink conversion) → ~2 days
5. **Enhancement 3** (Phase 6): Add User Story 4 → Test independently → Deploy (cleanup) → ~0.5 day
6. **Utilities** (Phase 7): Add list/find tools → ~0.5 day
7. **Polish** (Phase 8): Documentation + validation → ~1 day

**Total Estimated Effort**: 6-7 days

### Parallel Team Strategy

With 3 developers after Foundational phase completes:

1. **Team**: Complete Setup (Phase 1) + Foundational (Phase 2) together → ~1 day
2. **Once Foundational done**:
   - **Developer A**: User Story 1 (T009-T018) → section creation
   - **Developer B**: User Story 2 (T019-T025) → page updates
   - **Developer C**: User Story 4 (T040-T046) → section cleanup
3. **Sequential** (requires US1 context):
   - **Developer A**: After US1 → User Story 3 (T026-T039) → ink conversion (most complex)
4. **All Developers**: Utility tools (Phase 7) + Polish (Phase 8)

**Total Parallel Effort**: 3-4 days with 3 developers

---

## Notes

- **[P] tasks** = different files, no dependencies - can run in parallel
- **[Story] label** maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Native dependencies**: Ensure Cairo, Pango, libjpeg installed before T029 (ink renderer)
- **Tesseract data**: First run downloads ~50MB language data - may appear slow initially
- **LocalFoundry**: Optional fallback - feature works without it (Tesseract only)
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Task Count Summary

- **Phase 1 (Setup)**: 4 tasks
- **Phase 2 (Foundational)**: 4 tasks (CRITICAL GATE)
- **Phase 3 (US1 - MVP)**: 10 tasks
- **Phase 4 (US2)**: 7 tasks
- **Phase 5 (US3)**: 14 tasks (most complex - OCR pipeline)
- **Phase 6 (US4)**: 7 tasks
- **Phase 7 (Utilities)**: 7 tasks
- **Phase 8 (Polish)**: 11 tasks

**Total**: 64 tasks

**Parallelizable**: 33 tasks marked [P] (52% can run in parallel)

**MVP Scope** (Phases 1-3): 18 tasks
**Full Feature** (All phases): 64 tasks
