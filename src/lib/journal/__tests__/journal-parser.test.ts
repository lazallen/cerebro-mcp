/**
 * Tests for journal parser
 */

import { parseJournalFile, extractEventId, extractMeetings } from '../journal-parser';
import * as fs from 'fs';
import * as path from 'path';

// TODO: These tests require ESM-only packages (unified, remark-parse) that cannot be
// loaded in Jest's CommonJS environment without babel-jest. Install babel-jest to re-enable.
describe.skip('journal-parser', () => {
  let sampleJournal: string;

  beforeAll(() => {
    // Load sample journal for testing
    const fixturePath = path.join(__dirname, '../../../../tests/fixtures/journal-samples/2026-02-18.md');
    sampleJournal = fs.readFileSync(fixturePath, 'utf-8');
  });

  describe('parseJournalFile', () => {
    it('should parse valid journal with frontmatter and meetings', () => {
      const result = parseJournalFile(sampleJournal);

      expect(result.success).toBe(true);
      expect(result.journal).toBeDefined();
      expect(result.journal?.frontmatter).toBeDefined();
      expect(result.journal?.frontmatter.date).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(result.journal?.frontmatter.type).toBe('daily-planning');
      expect(result.journal?.meetings.length).toBeGreaterThan(0);
    });

    it('should fail on missing required frontmatter fields', () => {
      const invalidJournal = `---
date: 2026-02-18
---
# Some content`;

      const result = parseJournalFile(invalidJournal);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required frontmatter');
    });

    it('should fail on corrupted YAML', () => {
      const corruptedJournal = `---
date: 2026-02-18
day: Monday
  bad: indentation
---
# Content`;

      const result = parseJournalFile(corruptedJournal);

      expect(result.success).toBe(false);
    });
  });

  describe('extractEventId', () => {
    it('should extract EventId in markdown link format', () => {
      const body = '**EventId:** [eventId](AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg)';
      const eventId = extractEventId(body);

      expect(eventId).toBe('AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg');
    });

    it('should extract EventId in plain format', () => {
      const body = '**EventId:** AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg';
      const eventId = extractEventId(body);

      expect(eventId).toBe('AAMkADA0ZWY5ODYyLWZjNjMtNDQ2Mi04ZWVkLWIyMGY1Mjc2YTdjNg');
    });

    it('should return null if EventId not found', () => {
      const body = '**Location:** Virtual Meeting';
      const eventId = extractEventId(body);

      expect(eventId).toBeNull();
    });
  });

  describe('extractMeetings', () => {
    it('should extract meetings with various attendee formats', () => {
      const meetings = extractMeetings(sampleJournal);

      expect(meetings.length).toBeGreaterThan(0);

      // Check if any meeting has attendees
      const meetingWithAttendees = meetings.find((m) => m.attendees);
      expect(meetingWithAttendees).toBeDefined();
    });

    it('should handle meetings with wiki-style links', () => {
      const journalWithWikiLinks = `
### 10:00-11:00 - Team Meeting

**Attendees:** [[people/colleagues/Alice]], [[people/colleagues/Bob]]
**Location:** Virtual
**Related:** [[tasks/project-alpha]]
**EventId:** [eventId](TEST123)

**Prep Notes:**
- Review docs

**Meeting Notes:**
- Discussed timeline

---
`;

      const meetings = extractMeetings(journalWithWikiLinks);

      expect(meetings.length).toBe(1);
      expect(meetings[0]?.attendees).toContain('[[people/colleagues/Alice]]');
      expect(meetings[0]?.related).toContain('[[tasks/project-alpha]]');
    });

    it('should handle meetings with truncated attendee lists', () => {
      const journalWithTruncated = `
### 14:00-15:00 - All Hands

**Attendees:** Alice, Bob, Carol, _(and 20 more...)_
**EventId:** [eventId](TEST456)

**Prep Notes:**

**Meeting Notes:**

---
`;

      const meetings = extractMeetings(journalWithTruncated);

      expect(meetings.length).toBe(1);
      expect(meetings[0]?.attendees).toContain('_(and 20 more...)_');
    });
  });

  describe('extractSection', () => {
    it('should extract prep notes section', () => {
      const body = `
**Prep Notes:**
- Review agenda
- Prepare questions

**Meeting Notes:**
- Discussed items
`;

      const prepNotes = extractSection(body, 'Prep Notes');

      expect(prepNotes).toContain('Review agenda');
      expect(prepNotes).toContain('Prepare questions');
      expect(prepNotes).not.toContain('Discussed items'); // Should not include meeting notes
    });

    it('should extract meeting notes section', () => {
      const body = `
**Prep Notes:**
- Something

**Meeting Notes:**
- Noted action items
- Timeline updated
`;

      const meetingNotes = extractSection(body, 'Meeting Notes');

      expect(meetingNotes).toContain('Noted action items');
      expect(meetingNotes).toContain('Timeline updated');
      expect(meetingNotes).not.toContain('Something'); // Should not include prep notes
    });

    it('should return undefined for empty section', () => {
      const body = `
**Prep Notes:**

**Meeting Notes:**
`;

      const prepNotes = extractSection(body, 'Prep Notes');

      expect(prepNotes).toBeUndefined();
    });
  });
});
