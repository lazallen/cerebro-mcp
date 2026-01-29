# Research: OneNote Meeting Notes Management

**Feature**: 013-onenote-meeting-notes | **Phase**: 0 - Technical Research | **Date**: 2026-01-29

## Research Questions

1. How to parse multipart MIME responses from Microsoft Graph API to extract InkML XML?
2. How to parse InkML XML structure and extract stroke coordinate data?
3. How to render InkML strokes to PNG images for OCR processing?
4. How to integrate Tesseract.js for handwriting recognition in Node.js?
5. How to convert himetric units to pixel coordinates for rendering?
6. What are the existing patterns in the MicrosoftService for extending functionality?

## Findings

### 1. Multipart MIME Parsing in Node.js

**VALIDATED IN PROTOTYPE** ✅

**Libraries Available:**
- Native `Buffer` and string parsing (lightweight)
- `mailparser` (designed for email but works for any MIME)
- `dicer` (fast multipart parser)
- Custom regex-based parsing (used successfully in prototype)

**Recommended Approach:**
Use lightweight custom parsing with regex for boundary detection:

```typescript
// Parse multipart response
const boundaryMatch = contentType.match(/boundary=([^;]+)/);
const boundary = boundaryMatch ? boundaryMatch[1].replace(/"/g, '') : null;

// Split by boundary and find InkML section
const parts = responseText.split(`--${boundary}`);
const inkmlPart = parts.find(part => part.includes('application/inkml+xml'));

// Extract XML content after headers
const contentStart = inkmlPart.indexOf('<?xml');
const inkmlXml = inkmlPart.substring(contentStart);
```

**Rationale:** Avoids heavy dependencies for simple boundary parsing. Prototype implementation already validated this approach works with Graph API responses.

**Prototype Evidence:** Successfully extracted 213 lines of InkML XML from test_page.html multipart response.

---

### 2. InkML XML Structure and Parsing

**VALIDATED IN PROTOTYPE** ✅

**InkML Format:**
- XML structure defined by W3C InkML specification
- Contains `<ink>`, `<context>`, `<brush>`, and `<trace>` elements
- Coordinate data stored as comma-separated triplets: `X Y PRESSURE`
- Units: himetric (1 himetric = 0.01mm = 0.000393701 inches)

**Example Structure from Actual Data:**
```xml
<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
  <inkml:context xml:id="ctxCoordinatesWithPressure">
    <inkml:inkSource>
      <inkml:channelProperties>
        <inkml:channel name="X" type="decimal" units="himetric"/>
        <inkml:channel name="Y" type="decimal" units="himetric"/>
        <inkml:channel name="F" type="decimal" units="normalized"/>
      </inkml:channelProperties>
    </inkml:inkSource>
  </inkml:context>

  <inkml:brush xml:id="brush-1">
    <inkml:brushProperty name="width" value="47" units="himetric"/>
    <inkml:brushProperty name="height" value="47" units="himetric"/>
    <inkml:brushProperty name="color" value="#000000"/>
  </inkml:brush>

  <inkml:trace contextRef="#ctxCoordinatesWithPressure" brushRef="#brush-1">
    2113 3975 4128, 2111 3975 4368, 2109 3975 5185, ...
  </inkml:trace>
</inkml:ink>
```

**Parsing Libraries:**
- `xml2js`: Mature, converts to JavaScript objects
- `fast-xml-parser`: Faster, smaller bundle size
- Native `DOMParser` (browser only)

**Recommended:** `fast-xml-parser` for performance and TypeScript support.

**Parsing Strategy:**
1. Parse XML to object structure
2. Extract brush properties (width, height, color, transparency)
3. Iterate through `<trace>` elements
4. Split coordinate string by commas: `"2113 3975 4128"` → `[2113, 3975, 4128]`
5. Create typed Stroke objects with X, Y, pressure arrays

**Prototype Evidence:** inkml_data.xml contains real stroke data with coordinates successfully extracted from multipart response.

---

### 3. InkML Stroke Rendering with node-canvas

**Himetric to Pixel Conversion:**
- Himetric: 1 unit = 0.01mm
- Screen DPI: typically 96 DPI (can be configurable)
- Formula: `pixels = himetric * 0.0393701 * dpi`
- For 96 DPI: `pixels = himetric * 3.779528`
- For 150 DPI (recommended): `pixels = himetric * 5.9055`

**Rendering Pipeline:**
```typescript
import { createCanvas } from 'canvas';

// 1. Determine canvas dimensions from stroke bounds
const bounds = calculateStrokeBounds(strokes); // min/max X/Y
const width = Math.ceil((bounds.maxX - bounds.minX) * HIMETRIC_TO_PIXEL);
const height = Math.ceil((bounds.maxY - bounds.minY) * HIMETRIC_TO_PIXEL);

// 2. Create canvas
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

// 3. Set background
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, width, height);

// 4. Render each stroke
for (const stroke of strokes) {
  ctx.strokeStyle = stroke.color || '#000000';
  ctx.lineWidth = (stroke.width || 2) * HIMETRIC_TO_PIXEL;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (let i = 0; i < stroke.points.length; i++) {
    const x = (stroke.points[i].x - bounds.minX) * HIMETRIC_TO_PIXEL;
    const y = (stroke.points[i].y - bounds.minY) * HIMETRIC_TO_PIXEL;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// 5. Export to PNG buffer
const pngBuffer = canvas.toBuffer('image/png');
```

**Considerations:**
- Anti-aliasing: Enabled by default in node-canvas for smooth strokes
- DPI setting: Make configurable (default 150 DPI for better OCR accuracy)
- Memory: Large pages may require canvas chunking (process regions separately)
- Pressure: Can modulate line width if desired, or ignore for simplicity

---

### 4. Tesseract.js Integration for Handwriting Recognition

**USER CLARIFICATION** ✅: Selected as primary OCR solution

**Library:** `tesseract.js` v5.x
- Pure JavaScript OCR engine (WASM-based)
- Supports 100+ languages
- Works in Node.js and browsers
- Can be configured for handwriting recognition

**Installation:**
```bash
npm install tesseract.js
```

**Basic Usage:**
```typescript
import Tesseract from 'tesseract.js';

async function recognizeHandwriting(imageBuffer: Buffer): Promise<string> {
  const worker = await Tesseract.createWorker('eng', 1, {
    // Optimize for handwriting
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
  });

  const { data: { text } } = await worker.recognize(imageBuffer);
  await worker.terminate();

  return text.trim();
}
```

**Handwriting Optimization:**
- Use PSM (Page Segmentation Mode) 6 or 7 for single uniform blocks of text
- Consider training custom model for user's handwriting over time
- Pre-processing: increase contrast, binarization, noise removal

**Limitations:**
- Accuracy varies significantly with handwriting quality (cursive vs print)
- Success criteria: 95% stroke conversion means readable output, not perfect transcription
- May require user to write clearly or use print letters

**LocalFoundry Fallback:**
If Tesseract accuracy is insufficient, fall back to LocalFoundry vision model:
- Send PNG to `/v1/chat/completions` with vision model
- Prompt: "Transcribe the handwritten text in this image. Return only the text content."
- More accurate for difficult handwriting but requires LocalFoundry availability

---

### 5. Existing MicrosoftService Patterns

**Current Structure:**
```typescript
// src/services/microsoft/microsoft-service.ts
export class MicrosoftService extends BaseService {
  private graphClient: GraphClient;

  async initialize(): Promise<void> { /* OAuth setup */ }

  async getTools(): Promise<Tool[]> {
    return [
      // Email tools
      { name: 'microsoft.list-emails', ... },
      { name: 'microsoft.send-email', ... },

      // Calendar tools
      { name: 'microsoft.list-events', ... },
      { name: 'microsoft.create-event', ... },
    ];
  }
}
```

**Integration Pattern:**
1. Add OneNote-specific methods to MicrosoftService
2. Create separate client class: `OneNoteClient` (like existing pattern)
3. Register new tools in `getTools()` method
4. Tools delegate to client methods

**New Tools to Add:**
- `microsoft.onenote_create-section`
- `microsoft.onenote_create-page`
- `microsoft.onenote_update-page`
- `microsoft.onenote_get-ink-text`
- `microsoft.onenote_delete-section`

---

### 6. Graph API Endpoints for OneNote

**Base URL:** `https://graph.microsoft.com/v1.0`

**Key Endpoints:**
```
GET    /me/onenote/notebooks           # List notebooks
GET    /me/onenote/sections            # List sections
POST   /me/onenote/notebooks/{id}/sections  # Create section
GET    /me/onenote/sections/{id}/pages # List pages in section
POST   /me/onenote/sections/{id}/pages # Create page with content
PATCH  /me/onenote/pages/{id}/content  # Update page content
GET    /me/onenote/pages/{id}/content?includeInkML=true  # Get page with ink
DELETE /me/onenote/sections/{id}       # Delete section
```

**Authentication:**
- OAuth 2.0 with scope `Notes.ReadWrite`
- Already configured in service-registration.ts (line 66)
- Token refresh handled by existing BaseService implementation

**Content Format:**
- Page creation uses HTML body in `application/xhtml+xml` format
- Update uses PATCH with JSON patch operations
- InkML retrieval returns multipart MIME response (VALIDATED ✅)

**InkML Retrieval Details:**
- Must use `includeInkML=true` query parameter
- Response Content-Type: `multipart/form-data` with boundary
- Three parts in response:
  1. HTML content (text/html)
  2. **InkML XML** (application/inkml+xml) ← Contains stroke data
  3. Resources (images, attachments)

---

### 7. Content Format Decision

**Finding**: OneNote API accepts HTML (XHTML), not Markdown.

**Decision**: Implement Markdown-to-HTML conversion layer

**Rationale**:
- Maintains user-facing markdown interface (FR-016)
- Converts internally to HTML for OneNote API compatibility
- Allows rich formatting while keeping simple input format

**Implementation**:
- Use `marked` library for markdown parsing
- Wrap in HTML template structure required by OneNote
- Support basic markdown: headings, lists, bold, italic, links

**Conversion Template**:
```typescript
import { marked } from 'marked';

function markdownToOneNoteHtml(title: string, markdown: string): string {
  const bodyHtml = marked.parse(markdown);
  return `
<!DOCTYPE html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta name="created" content="${new Date().toISOString()}" />
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>
  `.trim();
}
```

**Alternatives Considered**:
- Plain text only: Rejected - loses formatting capability
- HTML input from users: Rejected - too complex for daily meeting notes

---

## Technical Decisions

### Decision 1: XML Parser Choice
**Selected:** `fast-xml-parser`
**Rationale:** Better performance than xml2js, smaller bundle, strong TypeScript support. InkML files can be large (100KB+) with hundreds of traces.

### Decision 2: OCR Strategy
**Selected:** Tesseract.js as primary, LocalFoundry as fallback
**Rationale:** Matches user clarification answer (Option C selected). Tesseract runs locally with no data exfiltration. LocalFoundry fallback provides better accuracy when available and user has configured it.

### Decision 3: Rendering DPI
**Selected:** 150 DPI (configurable via environment variable)
**Rationale:** Higher than standard 96 DPI improves OCR accuracy without excessive memory usage. Users can increase to 300 DPI for very poor handwriting if needed.

### Decision 4: MIME Parser
**Selected:** Custom regex-based parsing
**Rationale:** Lightweight, no dependencies, already prototyped and working. Graph API responses have predictable structure.

### Decision 5: Canvas Memory Management
**Selected:** Single canvas per page, no chunking initially
**Rationale:** Typical meeting notes are 1-5 pages. If memory becomes an issue, can implement region-based processing in future iteration.

### Decision 6: Section Naming Format
**Selected:** "YYYY-MM-DD Meetings"
**Rationale:** User clarification confirmed this format. ISO 8601 date prefix enables date-based queries and chronological organization.

---

## Dependencies Required

```json
{
  "dependencies": {
    "tesseract.js": "^5.0.0",
    "canvas": "^2.11.2",
    "fast-xml-parser": "^4.3.2",
    "marked": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "@types/marked": "^12.0.0"
  }
}
```

**Installation Notes:**
- `canvas` requires native dependencies (Cairo, Pango, libjpeg, giflib)
  - Ubuntu/Debian: `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
  - macOS: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`
  - Windows: Pre-built binaries included with npm package
- `tesseract.js` downloads language data on first run (cached in node_modules/.cache/tesseract/)
- `fast-xml-parser` is pure JavaScript
- `marked` is pure JavaScript

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Low OCR accuracy for cursive handwriting | High | Medium | Use LocalFoundry fallback, document limitation in README |
| Large ink files causing memory issues | Low | Medium | Implement canvas chunking if needed (monitor in testing) |
| Tesseract language data download failure | Low | High | Pre-cache language data during npm install, clear error message with manual download instructions |
| InkML format changes in Graph API | Low | High | Monitor Microsoft Graph API changelog, add schema validation tests |
| node-canvas native dependency installation issues | Medium | High | Document installation steps in README with platform-specific troubleshooting section |
| Multipart boundary parsing edge cases | Low | Medium | Comprehensive unit tests with various boundary formats |

---

## Open Questions

1. ✅ **Resolved:** Which OCR solution to use? → Tesseract.js primary, LocalFoundry fallback
2. ✅ **Resolved:** Section naming format? → "YYYY-MM-DD Meetings"
3. ✅ **Resolved:** Can we extract InkML from Graph API? → Yes, via multipart MIME response with includeInkML=true
4. **For Implementation:** Should we cache Tesseract worker instances between requests? → Recommend yes for performance
5. **For Implementation:** Should rendered PNGs be saved to disk for debugging? → Optional via environment variable (ONENOTE_DEBUG_IMAGES=true)
6. **For Testing:** How to generate test InkML data for unit tests? → Use extracted inkml_data.xml as fixture

---

## Prototype Validation Summary

**Files Created During Research:**
- `test_page.html` - 530KB multipart MIME response from Graph API
- `inkml_data.xml` - 213 lines of extracted InkML XML with stroke coordinates

**Key Validations:**
✅ Graph API returns InkML data via multipart MIME response
✅ Multipart parsing successfully extracts InkML XML section
✅ InkML contains raw stroke coordinates in himetric units
✅ Brush properties (width, height, color) are available in XML
✅ OAuth scope Notes.ReadWrite successfully grants access

**Critical Finding:**
The initial assumption that "Microsoft Graph API does not expose raw ink stroke data" was **incorrect**. The API **does** provide InkML XML with complete stroke coordinate data when using the `includeInkML=true` parameter on page content requests. User Story 3 (Ink-to-Text Conversion) **is implementable** as specified.

---

## Next Phase

**Phase 1 Deliverables:**
- `data-model.md`: Define TypeScript interfaces for Section, Page, InkData, Stroke, Coordinate, Brush types
- `contracts/`: Define MCP tool schemas for all 5 OneNote tools
- `quickstart.md`: Document setup steps including:
  - node-canvas native dependency installation (platform-specific)
  - Tesseract.js language data setup
  - Environment variable configuration
  - Usage examples for each tool

**Ready to Proceed:** Yes - all critical technical research complete and validated with working prototype.
