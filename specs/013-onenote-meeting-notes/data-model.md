# Data Model: OneNote Meeting Notes Management

**Feature**: 013-onenote-meeting-notes
**Date**: 2026-01-28
**Purpose**: Domain entities and their relationships

## Domain Entities

### 1. InkData

Represents handwritten ink strokes extracted from OneNote pages via InkML XML.

**Attributes**:
- `strokes`: Array<Stroke> - Collection of pen strokes
- `bounds`: BoundingBox - Min/max coordinates of all strokes
- `hasInk`: boolean - Whether page contains ink data

**Validation Rules**:
- Strokes array can be empty (no ink on page)
- Coordinates must be positive integers (himetric units)

**Example**:
```json
{
  "hasInk": true,
  "bounds": {
    "minX": 2109,
    "maxX": 15234,
    "minY": 3975,
    "maxY": 12450
  },
  "strokes": [...]
}
```

---

### 2. Stroke

Represents a single pen stroke (sequence of connected points).

**Attributes**:
- `id`: string - Unique identifier for stroke
- `points`: Array<Point> - Ordered sequence of coordinates
- `brush`: BrushProperties - Pen/brush settings
- `contextRef`: string - Reference to coordinate context

**Validation Rules**:
- Must have at least 2 points (start and end)
- Points must be ordered temporally

**Example**:
```json
{
  "id": "stroke-1",
  "points": [
    { "x": 2113, "y": 3975, "pressure": 4128 },
    { "x": 2111, "y": 3975, "pressure": 4368 }
  ],
  "brush": {
    "width": 47,
    "height": 47,
    "color": "#000000"
  }
}
```

---

### 3. Point

Represents a single coordinate point in a stroke.

**Attributes**:
- `x`: number - X coordinate in himetric units
- `y`: number - Y coordinate in himetric units
- `pressure`: number - Pen pressure (normalized 0-8191)

**Coordinate System**:
- Units: himetric (1 himetric = 0.01mm)
- Origin: Top-left corner of writing surface
- Conversion: `pixels = himetric * 0.0393701 * dpi`

---

### 4. BrushProperties

Represents pen/brush settings for rendering ink strokes.

**Attributes**:
- `width`: number - Brush width in himetric units
- `height`: number - Brush height in himetric units
- `color`: string - Hex color code (e.g., "#000000")
- `transparency`: number (optional) - 0-1 alpha value

**Defaults**:
- Width/Height: 47 himetric (~0.47mm)
- Color: Black (#000000)
- Transparency: 1.0 (opaque)

---

### 5. BoundingBox

Represents the rectangular bounds of ink content.

**Attributes**:
- `minX`: number - Minimum X coordinate
- `maxX`: number - Maximum X coordinate
- `minY`: number - Minimum Y coordinate
- `maxY`: number - Maximum Y coordinate

**Usage**: Determines canvas size for rendering

---

### 6. Meeting

Represents a scheduled meeting requiring preparation and note-taking.

**Attributes**:
- `title`: string (required) - Meeting name/subject
- `date`: ISO 8601 date string (required) - Meeting date (YYYY-MM-DD)
- `time`: ISO 8601 datetime string (optional) - Meeting start time for ordering
- `preBriefNotes`: string (optional) - Markdown-formatted preparation notes

**Validation Rules**:
- Title: 1-50 characters (One Note page title limit)
- Title cannot contain: `? * / : < > | & # ' " % ~`
- Date: Valid ISO 8601 format
- PreBriefNotes: Valid markdown, converted to HTML internally

**Example**:
```json
{
  "title": "Q1 Planning Review",
  "date": "2026-01-28",
  "time": "2026-01-28T10:00:00Z",
  "preBriefNotes": "## Agenda\n- Review Q1 goals\n- Discuss resource allocation"
}
```

---

### 2. Section

A OneNote container for related pages, organized by date.

**Attributes**:
- `id`: string (Graph API GUID) - Unique identifier
- `displayName`: string - Section name (format: "YYYY-MM-DD [descriptor]")
- `createdDateTime`: ISO 8601 timestamp
- `pagesUrl`: string - API endpoint for pages in this section

**Validation Rules**:
- DisplayName must start with ISO 8601 date (YYYY-MM-DD)
- Maximum 50 characters
- Cannot contain special characters: `? * / : < > | & # ' " % ~`

**Identity**:
- Primary key: `id` (Graph API GUID)
- Business key: `displayName` within notebook

**State Transitions**:
```
[Does Not Exist] --create--> [Exists]
[Exists] --delete--> [Deleted]
```

**Relationships**:
- Belongs to exactly one Notebook (default notebook)
- Contains zero or more Pages

**Example**:
```json
{
  "id": "1-7a0e8e94-75be-4d8a-9ca1-7e58f8c8b3e2",
  "displayName": "2026-01-28 Meetings",
  "createdDateTime": "2026-01-28T08:00:00Z",
  "pagesUrl": "https://graph.microsoft.com/v1.0/me/onenote/sections/1-7a0e8e94/pages"
}
```

---

### 3. Page

An individual note-taking surface within a section.

**Attributes**:
- `id`: string (Graph API GUID) - Unique identifier
- `title`: string - Page title (matches meeting title)
- `htmlContent`: string - HTML representation of page content
- `markdownContent`: string (user-facing) - Markdown representation
- `createdDateTime`: ISO 8601 timestamp
- `lastModifiedDateTime`: ISO 8601 timestamp
- `contentUrl`: string - API endpoint for page content
- `webUrl`: string - Browser URL for viewing in OneNote

**Validation Rules**:
- Title: 1-50 characters
- Title must match a meeting title for identification
- Content: Valid XHTML format for OneNote API

**Identity**:
- Primary key: `id` (Graph API GUID)
- Composite business key: `(sectionName, meetingTitle)`

**State Transitions**:
```
[Does Not Exist] --create--> [Created]
[Created] --update--> [Modified]
[Created/Modified] --delete (via section deletion)--> [Deleted]
```

**Relationships**:
- Belongs to exactly one Section
- Created for exactly one Meeting

**Example**:
```json
{
  "id": "1-f3d8a4b2-9c5e-4a1b-8f6d-2e9a7c3b5d1f",
  "title": "Q1 Planning Review",
  "htmlContent": "<!DOCTYPE html><html>...",
  "markdownContent": "## Agenda\n- Review Q1 goals...",
  "createdDateTime": "2026-01-28T08:15:00Z",
  "lastModifiedDateTime": "2026-01-28T09:30:00Z",
  "contentUrl": "https://graph.microsoft.com/v1.0/me/onenote/pages/1-f3d8a4b2/content",
  "webUrl": "https://www.onenote.com/..."
}
```

---

### 4. Notebook

The top-level OneNote container. **Not directly managed by this feature** (uses default).

**Attributes**:
- `id`: string (Graph API GUID)
- `displayName`: string
- `isDefault`: boolean

**Relationship**:
- Contains zero or more Sections
- Exactly one default notebook used for all operations

**Query**:
```
GET /me/onenote/notebooks?$top=1&$orderby=lastModifiedDateTime desc
```

---

## Entity Relationships

```
Notebook (1) ----< Section (many)
Section (1) ----< Page (many)
Meeting (1) ----< Page (1)
```

**Cardinality Rules**:
- Each Section belongs to exactly 1 Notebook
- Each Page belongs to exactly 1 Section
- Each Meeting creates exactly 1 Page
- Each Page represents exactly 1 Meeting

---

## Data Flow

### Create Daily Section

```
User Input:
  - sectionName: "2026-01-28 Meetings"
  - meetings: Array<Meeting>

Process:
  1. Query sections by displayName
  2. If exists: reuse section
  3. If not exists: create section
  4. For each meeting:
     a. Check if page exists (by title)
     b. If not exists: create page
     c. Convert markdown to HTML
     d. POST to OneNote API
  5. Return section + created pages

Output:
  - sectionId: string
  - createdPages: Array<{pageId, title, webUrl}>
  - skippedPages: Array<{title, reason}>
```

### Update Page Content

```
User Input:
  - sectionName: string
  - meetingTitle: string
  - newContent: string (markdown)

Process:
  1. Find section by displayName
  2. List pages in section
  3. Find page by title
  4. Convert markdown to HTML
  5. PATCH page content
  6. Return updated page

Output:
  - pageId: string
  - updated: boolean
  - lastModifiedDateTime: string
```

### Delete Section

```
User Input:
  - sectionName: string

Process:
  1. Find section by displayName
  2. DELETE section (cascades to pages)
  3. Return success

Output:
  - deleted: boolean
  - sectionId: string
```

### Ink-to-Text Conversion

```
User Input:
  - sectionName: string
  - meetingTitle: string
  - ocrOptions: { language?, useLocalFoundry?, savePng? }

Process:
  1. Find section by displayName
  2. Find page by title
  3. GET page content with includeInkML=true
  4. Parse multipart MIME response
  5. Extract InkML XML from application/inkml+xml section
  6. Parse InkML XML to extract strokes
    a. Parse <brush> elements for properties
    b. Parse <trace> elements for coordinates
    c. Split coordinate strings into Point arrays
    d. Build Stroke objects with brush references
  7. Calculate bounding box from all points
  8. Render strokes to PNG:
    a. Convert himetric to pixels (150 DPI default)
    b. Create canvas with bounds dimensions
    c. Draw each stroke with brush properties
    d. Export to PNG buffer
  9. OCR Recognition:
    a. Primary: Send PNG to Tesseract.js
    b. Fallback: Send PNG to LocalFoundry vision (if enabled)
    c. Parse response to extract text
  10. Return recognized text (markdown format)

Output:
  - pageId: string
  - title: string
  - recognizedText: string (markdown)
  - ocrDetails: { method, confidence, processingTime }
  - hasInk: boolean
```

---

## Type Definitions (TypeScript)

```typescript
// Ink/OCR types
export interface InkData {
  hasInk: boolean;
  strokes: Stroke[];
  bounds?: BoundingBox;
}

export interface Stroke {
  id: string;
  points: Point[];
  brush: BrushProperties;
  contextRef?: string;
}

export interface Point {
  x: number;              // himetric units
  y: number;              // himetric units
  pressure: number;       // normalized 0-8191
}

export interface BrushProperties {
  width: number;          // himetric units
  height: number;         // himetric units
  color: string;          // hex color (#RRGGBB)
  transparency?: number;  // 0-1 alpha
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface OCRResult {
  text: string;           // Recognized text (markdown format)
  confidence?: number;    // 0-1 confidence score
  method: 'tesseract' | 'localfoundry';
  processingTime: number; // milliseconds
}

export interface InkToTextInput {
  sectionName: string;
  meetingTitle: string;
  ocrOptions?: {
    language?: string;    // ISO 639-1 code (default: 'eng')
    useLocalFoundry?: boolean;
    savePng?: boolean;    // Debug: save rendered image
  };
}

export interface InkToTextResult {
  pageId: string;
  title: string;
  recognizedText: string; // Markdown format
  ocrDetails: OCRResult;
  hasInk: boolean;
}

// Input types (user-facing)
export interface MeetingInput {
  title: string;
  date: string;              // ISO 8601 date
  time?: string;             // ISO 8601 datetime (optional)
  preBriefNotes?: string;    // Markdown format
}

export interface SectionInput {
  name: string;              // "YYYY-MM-DD [descriptor]"
  meetings: MeetingInput[];
}

export interface PageUpdateInput {
  sectionName: string;
  meetingTitle: string;
  content: string;           // Markdown format
}

// Internal types (OneNote API)
export interface OneNoteSection {
  id: string;
  displayName: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  pagesUrl: string;
  parentNotebook?: {
    id: string;
    displayName: string;
  };
}

export interface OneNotePage {
  id: string;
  title: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  contentUrl: string;
  links?: {
    oneNoteClientUrl?: { href: string };
    oneNoteWebUrl?: { href: string };
  };
  parentSection?: {
    id: string;
    displayName: string;
  };
}

export interface OneNotePageContent {
  id: string;
  title: string;
  htmlContent: string;
}

// Response types
export interface SectionCreationResult {
  sectionId: string;
  sectionName: string;
  createdPages: PageCreationResult[];
  skippedPages: {
    title: string;
    reason: string;
  }[];
  totalMeetings: number;
  totalCreated: number;
  totalSkipped: number;
}

export interface PageCreationResult {
  pageId: string;
  title: string;
  webUrl?: string;
  createdDateTime: string;
}

export interface PageUpdateResult {
  pageId: string;
  title: string;
  updated: boolean;
  lastModifiedDateTime: string;
}

export interface SectionDeletionResult {
  sectionId: string;
  sectionName: string;
  deleted: boolean;
}
```

---

## Validation Rules Summary

### Meeting Validation
```typescript
function validateMeeting(meeting: MeetingInput): ValidationResult {
  const errors: string[] = [];

  // Title validation
  if (!meeting.title || meeting.title.length === 0) {
    errors.push('Meeting title is required');
  }
  if (meeting.title.length > 50) {
    errors.push('Meeting title must be 50 characters or less');
  }
  if (/[?*/:;<>|&#'"%~]/.test(meeting.title)) {
    errors.push('Meeting title contains invalid characters');
  }

  // Date validation
  if (!meeting.date || !/^\d{4}-\d{2}-\d{2}$/.test(meeting.date)) {
    errors.push('Meeting date must be in YYYY-MM-DD format');
  }

  // Time validation (optional)
  if (meeting.time && !isValidISO8601(meeting.time)) {
    errors.push('Meeting time must be valid ISO 8601 datetime');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

### Section Name Validation
```typescript
function validateSectionName(name: string): ValidationResult {
  const errors: string[] = [];

  // Format validation
  if (!/^\d{4}-\d{2}-\d{2}/.test(name)) {
    errors.push('Section name must start with date in YYYY-MM-DD format');
  }

  // Length validation
  if (name.length > 50) {
    errors.push('Section name must be 50 characters or less');
  }

  // Character validation
  if (/[?*/:;<>|&#'"%~]/.test(name)) {
    errors.push('Section name contains invalid characters');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

---

## Database/Storage

**Note**: This feature does **not use local storage**. All data is stored in Microsoft OneNote via Graph API.

**Token Storage**:
- OAuth tokens stored in `.tokens/microsoft_tokens.json`
- Follows existing MicrosoftTokenStorage pattern
- No local caching of OneNote content

**Stateless Design**:
- All queries go to Graph API
- No local database required
- Real-time consistency with OneNote

---

## Duplicate Detection Logic

### Page Duplicate Detection

```typescript
async function isDuplicatePage(
  sectionId: string,
  meetingTitle: string
): Promise<boolean> {
  // List all pages in section
  const pages = await oneNoteClient.listPages(sectionId);

  // Check for exact title match
  return pages.some(page => page.title === meetingTitle);
}
```

**Collision Strategy**: Skip creation, log as "already exists"

### Section Collision Handling

```typescript
async function findOrCreateSection(
  notebookId: string,
  sectionName: string
): Promise<OneNoteSection> {
  // Try to find existing section
  const sections = await oneNoteClient.listSections(notebookId);
  const existingSection = sections.find(
    s => s.displayName === sectionName
  );

  if (existingSection) {
    logger.info({ sectionId: existingSection.id }, 'Reusing existing section');
    return existingSection;
  }

  // Create new section
  logger.info({ sectionName }, 'Creating new section');
  return await oneNoteClient.createSection(notebookId, sectionName);
}
```

**Collision Strategy**: Reuse existing, append new pages

---

## Content Transformation

### Markdown to HTML

```typescript
import { marked } from 'marked';

function markdownToOneNoteHtml(
  title: string,
  markdown: string
): string {
  // Configure marked for safe HTML
  marked.setOptions({
    gfm: true,
    breaks: true,
    sanitize: false,  // OneNote requires well-formed HTML
  });

  // Convert markdown body to HTML
  const bodyHtml = marked.parse(markdown);

  // Wrap in OneNote HTML template
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### HTML to Markdown (for display)

```typescript
import TurndownService from 'turndown';

function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  return turndownService.turndown(html);
}
```

---

## Error States

### Entity-Specific Errors

**Section Errors**:
- `SECTION_NOT_FOUND`: Section with given name doesn't exist
- `SECTION_CREATE_FAILED`: Failed to create section in OneNote
- `SECTION_FULL`: Section exceeds OneNote size limits (507)

**Page Errors**:
- `PAGE_NOT_FOUND`: No page found with (section, title) combination
- `PAGE_CREATE_FAILED`: Failed to create page in OneNote
- `PAGE_UPDATE_FAILED`: Failed to update page content
- `INVALID_HTML`: Generated HTML doesn't meet OneNote requirements

**Content Errors**:
- `INVALID_MARKDOWN`: Markdown parsing failed
- `CONTENT_TOO_LARGE`: Content exceeds 4 MB request limit
- `INVALID_TITLE`: Title contains forbidden characters

---

## Performance Considerations

### Query Optimization

**Always query by section**:
```typescript
// ✅ Good: Scoped query
GET /me/onenote/sections/{sectionId}/pages?$top=100

// ❌ Bad: Global query (can fail on large notebooks)
GET /me/onenote/pages?$filter=title eq 'Meeting'
```

**Use field selection**:
```typescript
GET /me/onenote/sections/{id}/pages?$select=id,title,createdDateTime
```

**Pagination for large sections**:
```typescript
async function* paginatePages(sectionId: string) {
  let nextLink: string | undefined = undefined;

  do {
    const response = await oneNoteClient.getPages(
      sectionId,
      nextLink
    );

    yield response.pages;
    nextLink = response['@odata.nextLink'];
  } while (nextLink);
}
```

### Caching Strategy

**No local caching** - always fetch from OneNote for real-time accuracy

**Rationale**:
- OneNote may be modified from multiple clients (web, mobile, desktop)
- Caching would create stale data issues
- Meeting notes are not high-frequency access patterns

---

## Scale Limits

| Resource | Limit | Source |
|----------|-------|--------|
| Pages per section | ~1000 (practical) | OneNote best practices |
| Page size | 4 MB per request | Graph API limit |
| Section name length | 50 characters | OneNote constraint |
| Images per page | 150 | OneNote constraint |
| Daily API calls | 10,000 (typical) | Graph API throttling |

**Expected Usage**:
- Daily sections: 1 per day (365/year)
- Pages per day: 5-20 meetings typical
- Updates per day: 5-10 edits
- Deletions: 1-2 sections per week (cleanup)

**Total API calls per day**: ~30-50 (well below limits)
