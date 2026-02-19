/**
 * Tests for journal-merger.ts
 * Validates merge logic for calendar-to-journal updates
 */

import {
  mergeCalendarToJournal,
  buildEventIdIndex,
  markMeetingCancelled,
} from '../journal-merger';
import type { MeetingEntry, CalendarEvent, DailyJournal } from '../types';

describe('journal-merger', () => {
  describe('mergeCalendarToJournal', () => {
    const sampleCalendarEvent: CalendarEvent = {
      id: 'event-123',
      subject: 'Team Standup',
      start: {
        dateTime: '2026-02-18T09:00:00Z',
        timeZone: 'UTC',
      },
      end: {
        dateTime: '2026-02-18T09:30:00Z',
        timeZone: 'UTC',
      },
      location: {
        displayName: 'Conference Room A',
        locationUri: undefined,
      },
      attendees: [
        { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
        { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
      ],
      isAllDay: false,
      isCancelled: false,
    };

    test('creates new entry when no existing entry', () => {
      const result = mergeCalendarToJournal(null, sampleCalendarEvent);

      expect(result).toEqual({
        time: '09:00-09:30',
        title: 'Team Standup',
        attendees: 'Alice, Bob',
        location: 'Conference Room A',
        eventId: 'event-123',
        prepNotes: undefined,
        meetingNotes: undefined,
        related: undefined,
        isCancelled: false,
      });
    });

    test('preserves user notes when merging with existing entry', () => {
      const existingEntry: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Old Title',
        attendees: 'Old Attendee',
        location: 'Old Location',
        eventId: 'event-123',
        prepNotes: 'My prep notes',
        meetingNotes: 'My meeting notes',
        related: '[[project/foo]]',
        isCancelled: false,
      };

      const result = mergeCalendarToJournal(existingEntry, sampleCalendarEvent);

      expect(result).toEqual({
        time: '09:00-09:30', // Updated from calendar
        title: 'Team Standup', // Updated from calendar
        attendees: 'Alice, Bob', // Updated from calendar
        location: 'Conference Room A', // Updated from calendar
        eventId: 'event-123',
        prepNotes: 'My prep notes', // PRESERVED
        meetingNotes: 'My meeting notes', // PRESERVED
        related: '[[project/foo]]', // PRESERVED
        isCancelled: false,
      });
    });

    test('handles all-day events', () => {
      const allDayEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        isAllDay: true,
      };

      const result = mergeCalendarToJournal(null, allDayEvent);

      expect(result.time).toBe('All Day');
    });

    test('handles cancelled events for new entry', () => {
      const cancelledEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        isCancelled: true,
      };

      const result = mergeCalendarToJournal(null, cancelledEvent);

      expect(result.isCancelled).toBe(true);
    });

    test('preserves cancelled status from existing entry', () => {
      const existingEntry: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup (CANCELLED)',
        eventId: 'event-123',
        isCancelled: true,
      };

      const result = mergeCalendarToJournal(existingEntry, sampleCalendarEvent);

      expect(result.isCancelled).toBe(true);
    });

    test('handles event with no location', () => {
      const noLocationEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        location: undefined,
      };

      const result = mergeCalendarToJournal(null, noLocationEvent);

      expect(result.location).toBeUndefined();
    });

    test('handles event with no attendees', () => {
      const noAttendeesEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        attendees: [],
      };

      const result = mergeCalendarToJournal(null, noAttendeesEvent);

      expect(result.attendees).toBeUndefined();
    });

    test('prefers locationUri over displayName for virtual meetings', () => {
      const virtualMeetingEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        location: {
          displayName: 'Teams Meeting',
          locationUri: 'https://teams.microsoft.com/l/meetup/...',
        },
      };

      const result = mergeCalendarToJournal(null, virtualMeetingEvent);

      expect(result.location).toBe('https://teams.microsoft.com/l/meetup/...');
    });

    test('truncates attendees list when more than 10', () => {
      const manyAttendees = Array.from({ length: 15 }, (_, i) => ({
        emailAddress: { name: `Person ${i + 1}`, address: `person${i + 1}@example.com` },
      }));

      const eventWithManyAttendees: CalendarEvent = {
        ...sampleCalendarEvent,
        attendees: manyAttendees,
      };

      const result = mergeCalendarToJournal(null, eventWithManyAttendees);

      expect(result.attendees).toContain('Person 1, Person 2');
      expect(result.attendees).toContain('_(and 5 more...)_');
      expect(result.attendees).not.toContain('Person 11');
    });

    test('formats time with correct padding for single-digit hours', () => {
      const earlyMorningEvent: CalendarEvent = {
        ...sampleCalendarEvent,
        start: {
          dateTime: '2026-02-18T08:05:00Z',
          timeZone: 'UTC',
        },
        end: {
          dateTime: '2026-02-18T09:30:00Z',
          timeZone: 'UTC',
        },
      };

      const result = mergeCalendarToJournal(null, earlyMorningEvent);

      expect(result.time).toBe('08:05-09:30');
    });
  });

  describe('buildEventIdIndex', () => {
    test('creates empty index for journal with no meetings', () => {
      const journal: DailyJournal = {
        frontmatter: {
          date: '2026-02-18',
          day: 'Tuesday',
          type: 'daily-planning',
          'energy-level': 7,
          'energy-description': 'Good',
        },
        meetings: [],
        rawContent: '',
      };

      const index = buildEventIdIndex(journal);

      expect(index.size).toBe(0);
    });

    test('builds index with single meeting', () => {
      const meeting: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup',
        eventId: 'event-123',
      };

      const journal: DailyJournal = {
        frontmatter: {
          date: '2026-02-18',
          day: 'Tuesday',
          type: 'daily-planning',
          'energy-level': 7,
          'energy-description': 'Good',
        },
        meetings: [meeting],
        rawContent: '',
      };

      const index = buildEventIdIndex(journal);

      expect(index.size).toBe(1);
      expect(index.get('event-123')).toEqual(meeting);
    });

    test('builds index with multiple meetings', () => {
      const meeting1: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup',
        eventId: 'event-123',
      };

      const meeting2: MeetingEntry = {
        time: '14:00-15:00',
        title: 'Design Review',
        eventId: 'event-456',
      };

      const journal: DailyJournal = {
        frontmatter: {
          date: '2026-02-18',
          day: 'Tuesday',
          type: 'daily-planning',
          'energy-level': 7,
          'energy-description': 'Good',
        },
        meetings: [meeting1, meeting2],
        rawContent: '',
      };

      const index = buildEventIdIndex(journal);

      expect(index.size).toBe(2);
      expect(index.get('event-123')).toEqual(meeting1);
      expect(index.get('event-456')).toEqual(meeting2);
    });

    test('provides O(1) lookup performance', () => {
      const meetings: MeetingEntry[] = Array.from({ length: 100 }, (_, i) => ({
        time: `${String(9 + Math.floor(i / 4)).padStart(2, '0')}:00-${String(10 + Math.floor(i / 4)).padStart(2, '0')}:00`,
        title: `Meeting ${i}`,
        eventId: `event-${i}`,
      }));

      const journal: DailyJournal = {
        frontmatter: {
          date: '2026-02-18',
          day: 'Tuesday',
          type: 'daily-planning',
          'energy-level': 7,
          'energy-description': 'Good',
        },
        meetings,
        rawContent: '',
      };

      const index = buildEventIdIndex(journal);

      // All lookups should be instant
      expect(index.get('event-0')).toBeDefined();
      expect(index.get('event-50')).toBeDefined();
      expect(index.get('event-99')).toBeDefined();
      expect(index.get('nonexistent')).toBeUndefined();
    });
  });

  describe('markMeetingCancelled', () => {
    test('marks meeting as cancelled and adds CANCELLED tag to title', () => {
      const meeting: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup',
        eventId: 'event-123',
        isCancelled: false,
      };

      const result = markMeetingCancelled(meeting);

      expect(result.isCancelled).toBe(true);
      expect(result.title).toBe('Team Standup (CANCELLED)');
    });

    test('does not duplicate CANCELLED tag if already present', () => {
      const meeting: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup (CANCELLED)',
        eventId: 'event-123',
        isCancelled: true,
      };

      const result = markMeetingCancelled(meeting);

      expect(result.title).toBe('Team Standup (CANCELLED)');
      expect(result.title).not.toContain('(CANCELLED) (CANCELLED)');
    });

    test('preserves all other meeting properties', () => {
      const meeting: MeetingEntry = {
        time: '09:00-09:30',
        title: 'Team Standup',
        attendees: 'Alice, Bob',
        location: 'Room A',
        eventId: 'event-123',
        prepNotes: 'My prep notes',
        meetingNotes: 'My meeting notes',
        related: '[[project/foo]]',
        isCancelled: false,
      };

      const result = markMeetingCancelled(meeting);

      expect(result.time).toBe(meeting.time);
      expect(result.attendees).toBe(meeting.attendees);
      expect(result.location).toBe(meeting.location);
      expect(result.eventId).toBe(meeting.eventId);
      expect(result.prepNotes).toBe(meeting.prepNotes);
      expect(result.meetingNotes).toBe(meeting.meetingNotes);
      expect(result.related).toBe(meeting.related);
    });
  });
});
