# Feature Specification: OneNote Meeting Notes Management

**Feature Branch**: `013-onenote-meeting-notes`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "I want to engage with Microsoft OneNote through this MCP server. Each morning, I want to create a new section with a page for each meeting I have - pre-populated with my pre-brief notes. Throughout the day, I may want to update those pre-brief notes on a page by updating it. During the meeting, I will use the S-Pen on my tablet to make notes and I would like to be able to ask my localfoundry endpoint to convert the ink-notes into text and return. Over time, I will want to delete the sections as they are only useful for a few days."

## Clarifications

### Session 2026-01-28

- Q: When updating pre-brief notes or retrieving ink data from a specific meeting page, how should users identify which page to operate on? → A: User provides section name + meeting title together to identify the page (handles recurring meetings with same title)
- Q: What happens when a section already exists with the same name (e.g., re-running morning setup)? → A: Append to existing section with new pages (skip duplicates based on meeting title)
- Q: Should the system support selecting different notebooks, or always use the default? → A: Always use default notebook (no notebook selection)
- Q: What logging or telemetry should the system provide for OneNote and LocalFoundry operations? → A: Log operation start/completion with errors only (operation type, timestamp, success/failure, error details if failed)
- Q: Should the converted text from ink-to-text conversion return plain text only or support markdown? → A: Markdown format for all content types (pre-brief notes and converted text)

### Session 2026-01-29

- Q: Which local OCR/handwriting recognition solution should be the primary implementation? → A: Tesseract.js as primary with LocalFoundry vision fallback
- Q: What should the exact section name format be for daily meeting sections? → A: YYYY-MM-DD Meetings

### Session 2026-01-31

- Q: How to improve handwriting recognition accuracy beyond Tesseract's 60-70% accuracy? → A: Implement Windows Ink API integration (100% accuracy) with LocalFoundry text cleanup pipeline for Windows/WSL environments

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Daily Meeting Section Creation (Priority: P1)

Each morning, the user creates a new OneNote section for the day's meetings, with individual pages pre-populated with pre-brief notes for each scheduled meeting.

**Why this priority**: This is the foundational workflow that enables all other use cases. Without the ability to create sections and pages with pre-brief content, none of the subsequent features (updating, ink conversion, deletion) have a context to operate in.

**Independent Test**: Can be fully tested by triggering section creation with a list of meetings and verifying that a new section appears in OneNote with correctly titled pages containing the provided pre-brief content. Delivers immediate value by automating meeting preparation.

**Acceptance Scenarios**:

1. **Given** the user has a manually provided list of meetings for the day, **When** the user requests morning setup, **Then** a OneNote section is created with the format "YYYY-MM-DD Meetings" (or existing section is used if present)
2. **Given** a daily section exists, **When** the section is populated, **Then** one page is created for each meeting with the meeting title as the page title, skipping any meetings that already have pages in that section
3. **Given** pre-brief notes are manually provided by the user for each meeting, **When** pages are created, **Then** each page is pre-populated with the corresponding pre-brief notes
4. **Given** multiple meetings exist for the day, **When** section creation completes, **Then** pages are ordered chronologically by meeting start time

---

### User Story 2 - Pre-Brief Notes Updates (Priority: P2)

Throughout the day, the user updates pre-brief notes on meeting pages as new information becomes available or preparation evolves.

**Why this priority**: After initial setup, users need to refine their preparation materials. This is the second most common workflow and directly supports meeting effectiveness.

**Independent Test**: Can be tested independently by creating a page with initial content, updating it with new content, and verifying the changes persist in OneNote. Delivers value by allowing users to keep their preparation materials current.

**Acceptance Scenarios**:

1. **Given** a meeting page exists with pre-brief notes, **When** the user submits updated content by specifying section name and meeting title, **Then** the page content is replaced with the new content
2. **Given** a meeting page is being updated, **When** the update is in progress, **Then** any existing content is preserved until the update completes successfully
3. **Given** multiple pages exist in a section, **When** one page is updated, **Then** other pages remain unchanged
4. **Given** an update fails, **When** the error occurs, **Then** the user receives a clear error message and the original content remains intact

---

### User Story 3 - Ink-to-Text Conversion (Priority: P3)

During or after a meeting, the user converts handwritten notes (ink) on a OneNote page to text using the LocalFoundry integration.

**Why this priority**: This enhances the value of digital notes but depends on the prior workflows. It's a quality-of-life feature rather than a core requirement for meeting preparation.

**Independent Test**: Can be tested independently by creating a page with ink strokes, requesting conversion via LocalFoundry, and verifying that readable text is returned. Delivers value by making handwritten notes searchable and portable.

**Acceptance Scenarios**:

1. **Given** a meeting page contains ink notes (handwritten content), **When** the user requests ink-to-text conversion by specifying section name and meeting title, **Then** the ink data is retrieved from the OneNote page
2. **Given** ink data has been retrieved, **When** the conversion request is made, **Then** the data is sent to the LocalFoundry endpoint
3. **Given** LocalFoundry processes the ink data, **When** conversion completes, **Then** the converted text is returned to the user
4. **Given** a page contains no ink notes, **When** conversion is requested, **Then** the user receives a clear message indicating no ink content was found
5. **Given** the LocalFoundry endpoint is unavailable, **When** conversion is attempted, **Then** the user receives a clear error message

---

### User Story 4 - Section Cleanup (Priority: P4)

After meetings are completed and notes are no longer needed, the user deletes old sections to maintain a clean OneNote workspace.

**Why this priority**: This is a maintenance task that improves organization but isn't critical to the core meeting preparation workflow.

**Independent Test**: Can be tested independently by creating a section, requesting its deletion, and verifying it no longer appears in OneNote. Delivers value by preventing clutter.

**Acceptance Scenarios**:

1. **Given** a section exists in OneNote, **When** the user manually selects a specific section for deletion, **Then** the section is permanently removed from OneNote
2. **Given** multiple sections exist, **When** deletion criteria are specified, **Then** only matching sections are deleted
3. **Given** a section deletion is requested, **When** the operation fails, **Then** the user receives a clear error message and the section remains unchanged
4. **Given** a section contains multiple pages, **When** the section is deleted, **Then** all pages within the section are also deleted

---

### Edge Cases

- What happens when OneNote is not authenticated or the connection fails?
- How does the system handle concurrent updates to the same page?
- What happens when a meeting has no pre-brief notes available?
- How does the system handle very large ink note data (performance implications)?
- What happens when attempting to delete a section that doesn't exist?
- How does the system handle OneNote API rate limits?
- What happens when LocalFoundry endpoint times out during conversion?
- How does the system handle meetings with duplicate titles within the same section?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create a new OneNote section with a specified name
- **FR-002**: System MUST create pages within a specified OneNote section
- **FR-003**: System MUST set the title and initial content for newly created pages
- **FR-004**: System MUST update the content of an existing OneNote page identified by section name and meeting title
- **FR-005**: System MUST parse multipart MIME response from OneNote Graph API to extract InkML XML data containing stroke coordinates
- **FR-006**: System MUST use Windows Ink API for handwriting recognition (requires Windows/WSL environment)
- **FR-007**: System MUST send InkML data to Windows Ink recognizer, returning per-word confidence scores and alternative candidates
- **FR-008**: System MUST send Windows Ink recognition results to LocalFoundry for intelligent text cleanup using confidence-aware prompts
- **FR-009**: System MUST return converted text from OCR processing to the user
- **FR-010**: System MUST delete a specified OneNote section and all its pages
- **FR-011**: System MUST authenticate with Microsoft Graph API to access OneNote
- **FR-012**: System MUST handle errors from OneNote API and provide clear error messages
- **FR-013**: System MUST handle errors from LocalFoundry API and provide clear error messages
- **FR-014**: System MUST support organizing pages within sections in a specified order
- **FR-015**: System MUST detect duplicate page titles within a section and skip creating duplicate pages during section setup
- **FR-016**: System MUST log the start and completion of all OneNote and LocalFoundry operations including operation type, timestamp, and success/failure status
- **FR-017**: System MUST log detailed error information (error type, message, context) when operations fail
- **FR-018**: System MUST accept and preserve markdown format for pre-brief notes and converted text
- **FR-019**: System MUST parse InkML XML to extract stroke coordinate data (X, Y, pressure)
- **FR-021**: System MUST flag low-confidence words (below configurable threshold) from Windows Ink recognition for LocalFoundry review
- **FR-022**: System MUST gracefully fall back to original Windows Ink text if LocalFoundry cleanup is unavailable

### Key Entities

- **Section**: A container in the default OneNote notebook that represents a collection of related pages, typically organized by date (e.g., "2026-01-28 Meetings")
- **Page**: An individual note-taking surface within a section, representing one meeting with a title and content (pre-brief notes and/or ink). Pages are uniquely identified by the combination of section name and meeting title.
- **Meeting**: An event that requires preparation and note-taking, characterized by a title, date/time, and associated pre-brief content
- **Pre-Brief Notes**: Textual content prepared before a meeting that outlines topics, questions, or context (markdown format)
- **Ink Data**: Handwritten strokes captured on a OneNote page using a digital pen (e.g., S-Pen)
- **Converted Text**: The textual representation of ink data produced by the LocalFoundry OCR service (returned in markdown format)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a daily section with multiple meeting pages in under 2 minutes
- **SC-002**: Pre-brief notes updates complete within 5 seconds per page
- **SC-003**: Ink-to-text conversion completes and returns results within 5 seconds for typical meeting notes (1-5 pages of handwriting)
- **SC-004**: 95-100% of ink strokes are successfully converted to readable text (100% word accuracy with intelligent LocalFoundry cleanup)
- **SC-005**: Section deletion completes within 3 seconds regardless of number of pages
- **SC-006**: Users successfully complete morning setup workflow without errors 98% of the time
- **SC-007**: All OneNote operations provide clear error messages when failures occur, enabling users to resolve issues without technical support

## Assumptions

- The MCP server already has LocalFoundry integration capability (from Feature 011)
- Users have an active Microsoft 365 account with OneNote access
- Users have appropriate permissions to create, update, and delete content in their OneNote notebooks
- The default OneNote notebook will be used for all operations
- Pre-brief notes and converted text are provided in markdown format
- Sections are named using the format "YYYY-MM-DD Meetings" (e.g., "2026-01-29 Meetings")
- OneNote API rate limits are sufficient for typical daily usage patterns (1 morning setup + occasional updates)
- OneNote Graph API returns multipart MIME responses when requesting pages with includeInkML=true parameter
- Multipart response contains 3 parts: HTML content, InkML XML (application/inkml+xml), and resources
- OneNote Graph API does NOT provide pre-recognized text; local OCR/recognition is required
- InkML XML contains raw stroke data (X, Y coordinates and pressure values)
- Windows Ink API (via InkWinRec.exe) with LocalFoundry text cleanup is the only OCR method
- Requires Windows/WSL environment for handwriting recognition
- InkML is sent directly to Windows Ink API (no image rendering required)
- Users manage section cleanup manually rather than automatic retention policies
- Meeting pages are intended for short-term use (days, not weeks or months)

## Technical Implementation Notes

### InkML Data Retrieval

When requesting OneNote page content with the `includeInkML=true` parameter, the Graph API returns a multipart MIME response with three distinct parts:

1. **Part 1**: HTML content (text/html) - Contains typed text and page structure
2. **Part 2**: InkML XML (application/inkml+xml) - Contains raw ink stroke data
3. **Part 3**: Resources - Images and other embedded content

### Multipart MIME Parsing

The system must:
- Parse multipart boundaries to extract each section
- Identify the InkML XML section by Content-Type: application/inkml+xml
- Handle charset encoding properly (typically UTF-8)
- Extract InkML content between boundary markers

### InkML Structure

The InkML XML contains:
- **Stroke definitions**: Brush properties (width, height, color, transparency)
- **Trace elements**: Individual pen strokes with coordinate arrays
- **Coordinate data**: Each trace contains X, Y, and pressure (F) values in himetric units
- **Context information**: Resolution, units, and channel properties

**Important**: OneNote structures traces in two possible ways:
1. Direct traces: `<inkml:ink>` → `<inkml:trace>` (less common)
2. Grouped traces: `<inkml:ink>` → `<inkml:traceGroup>` → `<inkml:trace>` (OneNote standard)

The parser must check for both structures to successfully extract stroke data.

Example trace structure:
```xml
<inkml:traceGroup>
  <inkml:trace contextRef="#ctxCoordinatesWithPressure" brushRef="#{brush-id}">
    2113 3975 4128, 2111 3975 4368, 2109 3975 5185, ...
  </inkml:trace>
</inkml:traceGroup>
```

### OCR Processing Pipeline

Since OneNote Graph API does NOT provide pre-recognized text, the system uses Windows Ink API for handwriting recognition:

1. **Windows Ink Recognition**: Send InkML XML directly to InkWinRec.exe (native Windows 11 Handwriting Recognition API)
   - Executable spawns and receives InkML via stdin
   - Returns rich JSON with per-word results:
     - Recognized text for each word
     - Confidence scores (0-1 scale)
     - Top 5 alternative candidates per word
     - Line structure and ordering information
     - Bounding box coordinates
   - Timeout: 30 seconds with graceful error handling
   - Performance: ~3 seconds for typical page

2. **Confidence Analysis**: Identify low-confidence words
   - Default threshold: 0.7 (70% confidence)
   - Flag words below threshold for LocalFoundry review
   - Preserve line structure from Windows Ink

3. **LocalFoundry Cleanup**: Send to LocalFoundry with confidence-aware prompt
   - Prompt includes:
     - Full recognized text
     - List of low-confidence words with alternatives
     - Context for intelligent correction
   - LocalFoundry reviews and corrects ambiguous words
   - Temperature: 0.3 (low for consistent corrections)
   - Graceful fallback to original text if unavailable
   - Performance: ~1-2 seconds

4. **Return Text**: Provide cleaned, formatted text in markdown

**Total Performance**: ~3-5 seconds with 95-100% accuracy

### Windows Ink Architecture

The Windows Ink recognition pipeline consists of three main components:

#### 1. Windows Ink Recognizer (`src/ocr/windows-ink-recognizer.ts`)

Executes the native Windows 11 Handwriting Recognition API via InkWinRec.exe:

- **Input**: InkML XML string from OneNote
- **Process**:
  - Spawns `./windows/InkWinRec.exe` subprocess
  - Pipes InkML data to stdin
  - Captures JSON output from stdout
  - Parses rich recognition results
- **Output**: RecognizedText object containing:
  - Full text with preserved line breaks
  - Array of low-confidence words (below threshold)
  - Each low-confidence word includes:
    - Recognized text
    - Confidence score (0-1)
    - Top 5 alternative candidates
  - Metadata (word count, line count)

**Example JSON from InkWinRec.exe**:
```json
{
  "recognizer": "Microsoft English (India) Handwriting Recognizer",
  "items": [
    {
      "text": "This",
      "confidence": 0.62,
      "candidates": ["This", "this", "Theis", "Thins", "•This"],
      "line": 0,
      "orderInLine": 0
    }
  ]
}
```

#### 2. Handwriting Cleanup (`src/ocr/handwriting-cleanup.ts`)

Sends Windows Ink results to LocalFoundry for intelligent text correction:

- **Input**: RecognizedText with confidence data
- **Process**:
  - Builds confidence-aware prompt highlighting problematic words
  - Includes alternative candidates for context
  - Sends to LocalFoundry with low temperature (0.3)
  - Gracefully falls back to original text if unavailable
- **Output**: Cleaned, formatted text

**Example Prompt**:
```
Recognized text: "This is a test"

Low-confidence words that may need correction:
- "is" (55% confidence) - alternatives: is, in, ins, it, s
- "a" (47% confidence) - alternatives: a, "a, o, s, n

Please review and correct any obvious errors...
```

#### 3. Integration in OneNote Tools Handler

The ink-to-text handler ([src/mcp-server/handlers/onenote-tools.ts](../../src/mcp-server/handlers/onenote-tools.ts)) orchestrates the pipeline:

- **Parameters**:
  - `confidenceThreshold: number` - Threshold for flagging words (default: 0.7)
- **Flow**:
  1. Fetch InkML from OneNote page
  2. Call Windows Ink recognizer
  3. Call LocalFoundry cleanup
  4. Return cleaned text with metadata
- **Result**: InkToTextResult with:
  - Recognized text
  - OCR method: 'windows-ink+localfoundry'
  - Confidence score (heuristic based on low-confidence ratio)
  - Processing time
  - Low-confidence word count

#### Configuration

Environment variables for Windows Ink + LocalFoundry:

```bash
# LocalFoundry Configuration (required for cleanup)
LOCALFOUNDRY_ENDPOINT="http://localhost:8080/v1/chat/completions"
LOCALFOUNDRY_MODEL="phi-4"
LOCALFOUNDRY_TIMEOUT="120000"
```

#### Error Handling

- **InkWinRec.exe not found**: Throws error with clear message
- **Process timeout (30s)**: Kills process and throws timeout error
- **Non-zero exit code**: Logs stderr and throws with diagnostic info
- **JSON parse error**: Logs error and throws with sample output
- **LocalFoundry unavailable**: Falls back to Windows Ink raw text (graceful degradation)

## Dependencies

- Existing LocalFoundry MCP integration (Feature 011)
- Microsoft Graph API access with appropriate OAuth2 scopes for OneNote (Notes.ReadWrite)
- Active internet connection for OneNote API calls
- **Windows Ink Recognition**:
  - Windows 11 operating system (or WSL2 with Windows 11 host)
  - InkWinRec.exe executable (custom wrapper for Windows.UI.Input.Inking.Recognition API)
  - LocalFoundry endpoint for text cleanup (graceful fallback if unavailable)

## Out of Scope

- Calendar integration to automatically fetch meeting details (assumed to be provided externally)
- Automatic section cleanup based on age or retention policies
- Real-time collaboration features on OneNote pages
- Version history or rollback capabilities for page content
- Advanced formatting preservation in pre-brief notes
- Batch operations across multiple sections simultaneously
- Offline mode or local caching of OneNote content
- Converting text back to ink
- Audio or video note attachments
- Integration with other note-taking applications beyond OneNote
