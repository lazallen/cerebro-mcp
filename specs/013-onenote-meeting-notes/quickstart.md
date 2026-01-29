# Quick Start: OneNote Meeting Notes Management

**Feature**: 013-onenote-meeting-notes
**Purpose**: Get started with OneNote meeting notes integration in under 5 minutes

---

## Prerequisites

1. **Microsoft 365 Account** with OneNote access
2. **OAuth Authentication** configured for Microsoft service
3. **MCP Server** running (`npm start` or `npm run dev`)
4. **OneNote Scopes** added (see Configuration below)
5. **Native Dependencies** for ink-to-text conversion (see Installation below)

---

## Installation

### Native Dependencies for Ink-to-Text

The ink-to-text conversion feature requires native libraries for image rendering. Install platform-specific dependencies:

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

#### macOS
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

#### Windows
Pre-built binaries are included with npm packages - no additional installation needed.

### Node.js Dependencies

Install required packages:
```bash
npm install tesseract.js canvas fast-xml-parser marked
```

### Tesseract Language Data

Tesseract.js automatically downloads language data on first use. To pre-cache:

```bash
# Language data cached in node_modules/.cache/tesseract/
# No manual download needed - happens automatically
```

**Supported Languages**: eng, fra, deu, spa, ita, por, rus, chi_sim, jpn, kor, ara, and 90+ more.

---

## Configuration

### Step 1: Add OneNote Scopes

Edit your Microsoft service registration to include OneNote permissions:

**File**: `src/mcp-server/service-registration.ts`

```typescript
{
  name: 'microsoft',
  config: {
    // ... existing config ...
    scopes: [
      'offline_access',
      'Mail.Read',
      'Mail.Send',
      'User.Read',
      'Calendars.Read',
      'Calendars.ReadWrite',
      'Notes.ReadWrite',          // Add this line
      'Notes.ReadWrite.All'       // Add this line
    ]
  }
}
```

### Step 2: Re-authenticate

If you've previously authenticated, you'll need to re-authenticate to get the new scopes:

1. Delete existing tokens: `rm .tokens/microsoft_tokens.json`
2. Restart MCP server: `npm start`
3. Authenticate again through the OAuth flow

---

## Common Usage Patterns

### Pattern 1: Daily Morning Setup

Create a section for today's meetings with pre-brief notes.

**Tool**: `microsoft.onenote-create-section`

```json
{
  "sectionName": "2026-01-28 Meetings",
  "meetings": [
    {
      "title": "Team Standup",
      "date": "2026-01-28",
      "time": "2026-01-28T09:00:00Z",
      "preBriefNotes": "## Agenda\n- Sprint progress\n- Blockers\n- Planning for next sprint"
    },
    {
      "title": "Client Review",
      "date": "2026-01-28",
      "time": "2026-01-28T14:00:00Z",
      "preBriefNotes": "## Topics\n- Demo new features\n- Gather feedback\n- Discuss timeline\n\n## Questions\n- Budget approval status?\n- Resource availability?"
    }
  ]
}
```

**Response**:
```json
{
  "sectionId": "1-abc123...",
  "sectionName": "2026-01-28 Meetings",
  "createdPages": [
    {
      "pageId": "1-def456...",
      "title": "Team Standup",
      "webUrl": "https://www.onenote.com/...",
      "createdDateTime": "2026-01-28T08:00:00Z"
    },
    {
      "pageId": "1-ghi789...",
      "title": "Client Review",
      "webUrl": "https://www.onenote.com/...",
      "createdDateTime": "2026-01-28T08:00:15Z"
    }
  ],
  "skippedPages": [],
  "totalMeetings": 2,
  "totalCreated": 2,
  "totalSkipped": 0
}
```

**What Happens**:
- Section "2026-01-28 Meetings" created (or reused if exists)
- Two pages created with markdown converted to formatted HTML
- Pages ordered by meeting time

---

### Pattern 2: Update Pre-Brief Notes

Update preparation notes before a meeting.

**Tool**: `microsoft.onenote-update-page`

```json
{
  "sectionName": "2026-01-28 Meetings",
  "meetingTitle": "Client Review",
  "content": "## Topics\n- Demo new features\n- Gather feedback\n- Discuss timeline\n\n## Questions\n- Budget approval status? ✓ Approved\n- Resource availability? ✓ Team available\n\n## Key Points\n- Emphasize ROI\n- Show performance improvements"
}
```

**Response**:
```json
{
  "pageId": "1-ghi789...",
  "title": "Client Review",
  "updated": true,
  "lastModifiedDateTime": "2026-01-28T13:45:00Z",
  "webUrl": "https://www.onenote.com/..."
}
```

**What Happens**:
- Finds page "Client Review" in section "2026-01-28 Meetings"
- Replaces content with updated markdown
- Preserves handwritten notes added in OneNote app

---

### Pattern 3: Add Meeting Later in Day

If you schedule an additional meeting, run the same `create-section` command again.

```json
{
  "sectionName": "2026-01-28 Meetings",
  "meetings": [
    {
      "title": "Emergency Sync",
      "date": "2026-01-28",
      "time": "2026-01-28T16:30:00Z",
      "preBriefNotes": "## Issue\n- Production incident\n- Need to coordinate fix"
    }
  ]
}
```

**Response**:
```json
{
  "sectionId": "1-abc123...",
  "sectionName": "2026-01-28 Meetings",
  "createdPages": [
    {
      "pageId": "1-jkl012...",
      "title": "Emergency Sync",
      "webUrl": "https://www.onenote.com/...",
      "createdDateTime": "2026-01-28T16:15:00Z"
    }
  ],
  "skippedPages": [
    {
      "title": "Team Standup",
      "reason": "Page already exists"
    },
    {
      "title": "Client Review",
      "reason": "Page already exists"
    }
  ],
  "totalMeetings": 1,
  "totalCreated": 1,
  "totalSkipped": 0
}
```

**What Happens**:
- Reuses existing section
- Skips duplicate pages (Team Standup, Client Review)
- Creates only the new page (Emergency Sync)

---

### Pattern 4: Weekly Cleanup

Delete old sections you no longer need.

**Tool**: `microsoft.onenote-delete-section`

```json
{
  "sectionName": "2026-01-20 Meetings"
}
```

**Response**:
```json
{
  "sectionId": "1-xyz789...",
  "sectionName": "2026-01-20 Meetings",
  "deleted": true,
  "pageCount": 8
}
```

**What Happens**:
- Section and all 8 pages permanently deleted from OneNote
- Cannot be undone (OneNote doesn't have a recycle bin via API)

---

### Pattern 5: List Sections

View all sections in your notebook.

**Tool**: `microsoft.onenote-list-sections`

```json
{
  "includePageCount": true
}
```

**Response**:
```json
{
  "sections": [
    {
      "id": "1-abc123...",
      "displayName": "2026-01-28 Meetings",
      "createdDateTime": "2026-01-28T08:00:00Z",
      "lastModifiedDateTime": "2026-01-28T16:15:00Z",
      "pageCount": 3
    },
    {
      "id": "1-def456...",
      "displayName": "2026-01-27 Meetings",
      "createdDateTime": "2026-01-27T08:00:00Z",
      "lastModifiedDateTime": "2026-01-27T17:30:00Z",
      "pageCount": 5
    }
  ],
  "totalSections": 2
}
```

---

### Pattern 6: Find Specific Page

Retrieve page metadata and content.

**Tool**: `microsoft.onenote-find-page`

```json
{
  "sectionName": "2026-01-28 Meetings",
  "meetingTitle": "Client Review",
  "includeContent": true
}
```

**Response**:
```json
{
  "found": true,
  "page": {
    "id": "1-ghi789...",
    "title": "Client Review",
    "createdDateTime": "2026-01-28T08:00:15Z",
    "lastModifiedDateTime": "2026-01-28T13:45:00Z",
    "webUrl": "https://www.onenote.com/...",
    "htmlContent": "<!DOCTYPE html><html>...",
    "markdownContent": "## Topics\n- Demo new features\n..."
  }
}
```

---

### Pattern 7: Convert Handwritten Notes to Text

After writing notes with S-Pen during a meeting, convert the ink to searchable text.

**Tool**: `microsoft.onenote-get-ink-text`

```json
{
  "sectionName": "2026-01-28 Meetings",
  "meetingTitle": "Client Review",
  "language": "eng",
  "dpi": 150
}
```

**Response**:
```json
{
  "pageId": "1-ghi789...",
  "title": "Client Review",
  "hasInk": true,
  "recognizedText": "## Key Points\n- Client approved budget\n- Timeline extended 2 weeks\n- Need additional resources\n\n## Action Items\n- Schedule follow-up\n- Send proposal update",
  "ocrMethod": "tesseract",
  "confidence": 0.87,
  "processingTime": 4235,
  "strokeCount": 142,
  "imageDimensions": {
    "width": 1200,
    "height": 800
  }
}
```

**What Happens**:
1. Page content retrieved with `includeInkML=true` parameter
2. Multipart MIME response parsed to extract InkML XML
3. Ink strokes rendered to PNG image (150 DPI)
4. Tesseract.js processes handwriting to text
5. Recognized text returned in markdown format

**OCR Options**:

- **language**: OCR language (default: 'eng')
  - Supported: 'eng', 'fra', 'deu', 'spa', 'ita', 'por', etc.
  - Tesseract supports 100+ languages

- **dpi**: Rendering resolution (default: 150)
  - 96 DPI: Fast, lower accuracy
  - 150 DPI: Balanced (recommended)
  - 300 DPI: Slow, better for poor handwriting

- **useLocalFoundry**: Force LocalFoundry vision model (default: false)
  - Requires LocalFoundry service configured
  - Better accuracy for difficult handwriting
  - Falls back to LocalFoundry if Tesseract fails

- **savePng**: Save rendered PNG for debugging (default: false)
  - Saves to `./debug/ink-{pageId}.png`
  - Useful for troubleshooting OCR issues

---

## Markdown Formatting Guide

All pre-brief notes and content use **markdown format**, which is converted to formatted HTML in OneNote.

### Supported Markdown Elements

| Markdown | OneNote Display |
|----------|-----------------|
| `# Heading 1` | Large heading |
| `## Heading 2` | Medium heading |
| `### Heading 3` | Small heading |
| `**bold text**` | **Bold text** |
| `*italic text*` | *Italic text* |
| `- List item` | Bulleted list |
| `1. Numbered item` | Numbered list |
| `[Link text](url)` | Clickable link |
| `` `code` `` | Inline code |
| ```` ```code block``` ```` | Code block |

### Example Markdown Template

```markdown
## Meeting Objective
Brief statement of what we want to achieve

## Agenda
- Topic 1: Description
- Topic 2: Description
- Topic 3: Description

## Key Questions
1. Question one?
2. Question two?
3. Question three?

## Notes
*Space for additional notes during the meeting*

## Action Items
- [ ] Action 1
- [ ] Action 2
```

---

## Error Handling

### Common Errors

**Error**: `Section not found`
- **Cause**: Section name doesn't exist or has typo
- **Solution**: List sections first to verify exact name

**Error**: `Page not found`
- **Cause**: No page with matching title in section
- **Solution**: Check meeting title spelling, list pages in section

**Error**: `Authentication required`
- **Cause**: Not authenticated or tokens expired
- **Solution**: Re-run Microsoft OAuth authentication

**Error**: `Invalid markdown`
- **Cause**: Markdown syntax error
- **Solution**: Validate markdown syntax before submission

**Error**: `Title contains invalid characters`
- **Cause**: Meeting title has forbidden characters: `? * / : < > | & # ' " % ~`
- **Solution**: Remove special characters from title

---

## Limitations

### Current Limitations

1. **OCR Accuracy Varies**: Handwriting recognition quality depends on:
   - Writing style (print vs cursive)
   - Pen pressure and stroke consistency
   - Language complexity
   - Typical accuracy: 70-95% for clear print writing

2. **Default Notebook Only**: All operations use the default OneNote notebook. Multi-notebook support is out of scope.

3. **No Offline Mode**: All operations require active internet connection to Microsoft Graph API.

4. **Delegated Permissions Only**: User context required - no app-only operations.

5. **Native Dependencies Required**: Canvas and Tesseract require native libraries (Cairo, Pango) for ink rendering.

### Performance Characteristics

| Operation | Typical Time | API Calls |
|-----------|--------------|-----------|
| Create section + 5 pages | 3-5 seconds | 2-6 |
| Update single page | 1-2 seconds | 2 |
| Delete section | 1-2 seconds | 2 |
| List sections | <1 second | 1 |
| Find page | 1-2 seconds | 2 |
| Ink-to-text conversion | 5-10 seconds | 2 |

**Ink-to-Text Performance Breakdown**:
- InkML extraction: ~1 second
- PNG rendering: ~1-2 seconds
- OCR processing: ~3-7 seconds (depends on stroke count)
- Total: ~5-10 seconds for typical meeting page

---

## Best Practices

### Section Naming

**Recommended Format**: `YYYY-MM-DD [descriptor]`

**Good Examples**:
- `2026-01-28 Meetings`
- `2026-01-28 Client Calls`
- `2026-01-28 Team Sync`

**Avoid**:
- `Meeting Notes` (no date)
- `01-28-2026` (wrong date format)
- `Meetings!` (special characters)

### Meeting Titles

**Do**:
- Use descriptive, unique titles
- Keep under 50 characters
- Avoid special characters
- Be consistent with naming

**Don't**:
- Use generic titles like "Meeting" or "Call"
- Include dates in title (use time field instead)
- Duplicate titles on same day (causes confusion)

### Pre-Brief Notes

**Effective Structure**:
```markdown
## Context
Brief background for attendees not familiar with topic

## Objective
What we want to accomplish in this meeting

## Agenda
1. Item 1 (5 min)
2. Item 2 (15 min)
3. Item 3 (10 min)

## Discussion Points
- Point A
- Point B

## Decisions Needed
- [ ] Decision 1
- [ ] Decision 2

## Preparation
- Read: [Document](link)
- Review: Previous notes
```

---

## Troubleshooting

### Check Authentication Status

```bash
# Check Microsoft service status
curl http://localhost:3000/status

# Should show microsoft service as "connected"
```

### Verify Scopes

Look for `Notes.ReadWrite` in your OAuth consent screen when authenticating.

### Test Basic Operation

Try listing sections first to verify connectivity:

```json
{
  "tool": "microsoft.onenote-list-sections",
  "arguments": {}
}
```

If this works, OneNote integration is configured correctly.

---

## Next Steps

1. **Daily Workflow**: Set up morning section creation as a routine
2. **Templates**: Create standard pre-brief templates for different meeting types
3. **Cleanup Schedule**: Delete old sections weekly or monthly
4. **Integration**: Combine with calendar tools to automate meeting extraction

---

## Support

**Feature Spec**: [specs/013-onenote-meeting-notes/spec.md](./spec.md)
**Implementation Plan**: [specs/013-onenote-meeting-notes/plan.md](./plan.md)
**API Contracts**: [specs/013-onenote-meeting-notes/contracts/](./contracts/)
