/**
 * Journal merger for intelligent calendar-to-journal updates
 * Preserves user content while updating calendar metadata
 */

import type { MeetingEntry, CalendarEvent, DailyJournal } from './types';

/**
 * Merge calendar event into journal entry
 * Preserves user content (prepNotes, meetingNotes, related)
 * Updates calendar metadata (time, title, location, attendees, eventId)
 */
export function mergeCalendarToJournal(
  existingEntry: MeetingEntry | null,
  calendarEvent: CalendarEvent
): MeetingEntry {
  // Format calendar event data
  const time = formatEventTime(calendarEvent);
  const title = calendarEvent.subject;
  const attendees = formatAttendees(calendarEvent);
  const location = formatLocation(calendarEvent);
  const eventId = calendarEvent.id;

  // If no existing entry, create new one with empty notes
  if (!existingEntry) {
    return {
      time,
      title,
      attendees,
      location,
      eventId,
      prepNotes: undefined,
      meetingNotes: undefined,
      related: undefined,
      isCancelled: calendarEvent.isCancelled,
    };
  }

  // Merge: update calendar fields, preserve user content
  return {
    time, // Update from calendar
    title, // Update from calendar
    attendees, // Update from calendar
    location, // Update from calendar
    eventId, // Should be same, but update anyway
    prepNotes: existingEntry.prepNotes, // PRESERVE
    meetingNotes: existingEntry.meetingNotes, // PRESERVE
    related: existingEntry.related, // PRESERVE
    isCancelled: calendarEvent.isCancelled || existingEntry.isCancelled,
  };
}

/**
 * Build EventId index for O(1) lookup
 */
export function buildEventIdIndex(journal: DailyJournal): Map<string, MeetingEntry> {
  const index = new Map<string, MeetingEntry>();

  for (const meeting of journal.meetings) {
    index.set(meeting.eventId, meeting);
  }

  return index;
}

/**
 * Mark meeting as cancelled while preserving notes
 */
export function markMeetingCancelled(entry: MeetingEntry): MeetingEntry {
  return {
    ...entry,
    isCancelled: true,
    title: entry.title.includes('(CANCELLED)') ? entry.title : `${entry.title} (CANCELLED)`,
  };
}

/**
 * Format event time from calendar event
 */
function formatEventTime(event: CalendarEvent): string {
  if (event.isAllDay) {
    return 'All Day';
  }

  // Parse ISO 8601 datetime
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);

  const startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

  return `${startTime}-${endTime}`;
}

/**
 * Format attendees from calendar event
 * Returns comma-separated names
 */
function formatAttendees(event: CalendarEvent): string | undefined {
  if (!event.attendees || event.attendees.length === 0) {
    return undefined;
  }

  const names = event.attendees.map((att) => att.emailAddress.name || att.emailAddress.address);

  // Truncate if too many attendees (>10)
  if (names.length > 10) {
    const displayNames = names.slice(0, 10);
    return `${displayNames.join(', ')}, _(and ${names.length - 10} more...)_`;
  }

  return names.join(', ');
}

/**
 * Format location from calendar event
 */
function formatLocation(event: CalendarEvent): string | undefined {
  if (!event.location) {
    return undefined;
  }

  // Prefer locationUri (for virtual meetings) over displayName
  if (event.location.locationUri) {
    return event.location.locationUri;
  }

  return event.location.displayName;
}
