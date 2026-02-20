/**
 * Tests for journal writer
 */

import {
  createDailyJournal,
  formatMeetingEntry,
  appendHeartbeatSummary,
  writeJournalFile,
} from '../journal-writer';
import { parseJournalFile } from '../journal-parser';
import type { JournalFrontmatter, MeetingEntry, HeartbeatSummary, DailyJournal } from '../types';

describe('journal-writer', () => {
  describe('createDailyJournal', () => {
    it('should create daily journal with valid frontmatter', () => {
      const date = new Date('2026-02-18');
      const frontmatter: JournalFrontmatter = {
        date: '2026-02-18',
        day: 'Tuesday',
        type: 'daily-planning',
        'energy-level': 7,
        'energy-description': 'Feeling productive',
      };

      const journal = createDailyJournal(date, frontmatter);

      expect(journal).toContain('---');
      expect(journal).toContain('date: 2026-02-18');
      expect(journal).toContain('Tuesday, February 18');
      expect(journal).toContain('## Morning Check-In');
      expect(journal).toContain('## Today\'s Schedule');
    });

    it('should create journal that can be re-parsed with gray-matter', () => {
      const date = new Date('2026-02-18');
      const frontmatter: JournalFrontmatter = {
        date: '2026-02-18',
        day: 'Tuesday',
        type: 'daily-planning',
        'energy-level': 8,
        'energy-description': 'Ready to work',
      };

      const journal = createDailyJournal(date, frontmatter);
      const parseResult = parseJournalFile(journal);

      expect(parseResult.success).toBe(true);
      expect(parseResult.journal?.frontmatter['energy-level']).toBe(8);
      expect(parseResult.journal?.frontmatter['energy-description']).toBe('Ready to work');
    });
  });

  describe('formatMeetingEntry', () => {
    it('should format meeting entry with all fields', () => {
      const meeting: MeetingEntry = {
        time: '10:00-11:00',
        title: 'Team Standup',
        attendees: 'Alice, Bob, Carol',
        location: 'https://zoom.us/j/123',
        eventId: 'TEST123',
        related: '[[tasks/sprint-planning]]',
        prepNotes: '- Review agenda\n- Prepare updates',
        meetingNotes: '- Discussed blockers',
      };

      const formatted = formatMeetingEntry(meeting);

      expect(formatted).toContain('### 10:00-11:00 - Team Standup');
      expect(formatted).toContain('**Attendees:** Alice, Bob, Carol');
      expect(formatted).toContain('**Location:** https://zoom.us/j/123');
      expect(formatted).toContain('**Related:** [[tasks/sprint-planning]]');
      expect(formatted).toContain('**EventId:** [eventId](TEST123)');
      expect(formatted).toContain('**Prep Notes:**');
      expect(formatted).toContain('- Review agenda');
      expect(formatted).toContain('**Meeting Notes:**');
      expect(formatted).toContain('- Discussed blockers');
      expect(formatted).toContain('---');
    });

    it('should format meeting entry with optional fields missing', () => {
      const meeting: MeetingEntry = {
        time: 'All Day',
        title: 'Conference',
        eventId: 'TEST456',
      };

      const formatted = formatMeetingEntry(meeting);

      expect(formatted).toContain('### All Day - Conference');
      expect(formatted).toContain('**Attendees:**');
      expect(formatted).toContain('**Location:**');
      expect(formatted).toContain('**Related:**');
      expect(formatted).toContain('**EventId:** [eventId](TEST456)');
    });

    it('should mark cancelled meetings in title', () => {
      const meeting: MeetingEntry = {
        time: '14:00-15:00',
        title: 'Planning Session',
        eventId: 'TEST789',
        isCancelled: true,
        prepNotes: '- Had prepared notes',
      };

      const formatted = formatMeetingEntry(meeting);

      expect(formatted).toContain('(CANCELLED)');
      expect(formatted).toContain('- Had prepared notes'); // Preserves notes
    });
  });

  describe('appendHeartbeatSummary', () => {
    it('should append summary to journal without existing summary', () => {
      const journal = `---
date: 2026-02-18
day: Tuesday
type: daily-planning
energy-level: 7
energy-description: "Good"
---

# Tuesday, February 18, 2026

## Today's Schedule

---
`;

      const summary: HeartbeatSummary = {
        timestamp: '2026-02-18T10:00:00Z',
        taskName: 'journal-triage',
        entriesCreated: 3,
        entriesUpdated: 2,
        onenotePagesSynced: 5,
      };

      const updated = appendHeartbeatSummary(journal, summary);

      expect(updated).toContain('## Heartbeat Summary');
      expect(updated).toContain('**Last Run**: 2026-02-18T10:00:00Z');
      expect(updated).toContain('Created 3 new journal entries');
      expect(updated).toContain('Updated 2 existing entries');
      expect(updated).toContain('Synced 5 OneNote pages');
      expect(updated).toContain('Errors: None');
    });

    it('should update existing heartbeat summary', () => {
      const journal = `---
date: 2026-02-18
---

# Tuesday

## Heartbeat Summary

**Last Run**: 2026-02-18T09:00:00Z
**Task**: journal-triage

- Created 1 new journal entry

---
`;

      const summary: HeartbeatSummary = {
        timestamp: '2026-02-18T10:00:00Z',
        taskName: 'journal-triage',
        entriesCreated: 2,
        entriesUpdated: 1,
        onenotePagesSynced: 3,
      };

      const updated = appendHeartbeatSummary(journal, summary);

      expect(updated).toContain('2026-02-18T10:00:00Z');
      expect(updated).toContain('Created 2 new journal entries');
      expect(updated).not.toContain('2026-02-18T09:00:00Z'); // Old timestamp replaced
    });

    it('should include errors in summary if present', () => {
      const journal = '# Test';
      const summary: HeartbeatSummary = {
        timestamp: '2026-02-18T10:00:00Z',
        taskName: 'journal-triage',
        entriesCreated: 0,
        entriesUpdated: 0,
        onenotePagesSynced: 0,
        errors: ['OneNote API timeout', 'Calendar fetch failed'],
      };

      const updated = appendHeartbeatSummary(journal, summary);

      expect(updated).toContain('Errors: OneNote API timeout, Calendar fetch failed');
    });
  });

  describe('writeJournalFile', () => {
    it('should reconstruct valid markdown that can be re-parsed', () => {
      const journal: DailyJournal = {
        frontmatter: {
          date: '2026-02-18',
          day: 'Tuesday',
          type: 'daily-planning',
          'energy-level': 7,
          'energy-description': 'Feeling great',
        },
        meetings: [
          {
            time: '10:00-11:00',
            title: 'Standup',
            eventId: 'TEST123',
            prepNotes: '- Review items',
          },
        ],
        rawContent: `
## Morning Check-In

**Energy Level:** 7/10

## Today's Schedule
`.trim(),
      };

      const written = writeJournalFile(journal);
      const reparsed = parseJournalFile(written);

      expect(reparsed.success).toBe(true);
      expect(reparsed.journal?.frontmatter.date).toBe('2026-02-18');
      expect(reparsed.journal?.meetings.length).toBe(1);
      expect(reparsed.journal?.meetings[0]?.eventId).toBe('TEST123');
    });
  });
});
