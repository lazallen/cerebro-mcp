/**
 * Journal file writer for creating and formatting journal markdown
 *
 * Strategy: Surgical AST updates.
 * When updating an existing journal, we NEVER rebuild the Today's Schedule
 * section from scratch. Instead we parse the file into an AST and update
 * only the calendar metadata fields (heading, attendees, location) in place,
 * leaving all user-written content (Notes, Prep Notes, Meeting Notes) untouched.
 * New meetings are appended; cancelled meetings have their heading updated.
 */

import matter from 'gray-matter';
import type { JournalFrontmatter, MeetingEntry, DailyJournal, HeartbeatSummary } from './types';

/**
 * Create a new daily journal with frontmatter
 */
export function createDailyJournal(date: Date, frontmatter: JournalFrontmatter): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[date.getDay()];

  const content = matter.stringify(
    `
# ${dayName}, ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })}

## Morning Check-In

**Energy Level:** ${frontmatter['energy-level']}/10 - ${frontmatter['energy-description']}

## Top 3 Priorities

1.
2.
3.

## Today's Schedule

`.trim(),
    frontmatter
  );

  return content;
}

/**
 * Format a new meeting entry as markdown (used only for brand-new meetings)
 */
export function formatMeetingEntry(meeting: MeetingEntry): string {
  const parts: string[] = [];

  const titleWithCancelled = meeting.isCancelled && !meeting.title.includes('(CANCELLED)')
    ? `${meeting.title} (CANCELLED)`
    : meeting.title;
  parts.push(`### ${meeting.time} - ${titleWithCancelled}`);
  parts.push('');

  const hasOtherAttendees = meeting.attendees && meeting.attendees.trim().length > 0 &&
                             meeting.attendees.split(',').length > 1;

  if (hasOtherAttendees) {
    parts.push(`**Attendees:** ${meeting.attendees}`);
    if (meeting.location && meeting.location.trim().length > 0) {
      parts.push(`**Location:** ${meeting.location}`);
    }
  }

  if (meeting.related && meeting.related.trim().length > 0) {
    parts.push(`**Related:** ${meeting.related}`);
  }

  parts.push(`**EventId:** [eventId](${meeting.eventId})`);
  parts.push('');

  if (hasOtherAttendees) {
    parts.push('#### Prep Notes');
    parts.push('');
    parts.push('#### Meeting Notes');
    parts.push('');
  } else {
    parts.push('#### Notes');
    parts.push('');
  }

  parts.push('---');

  return parts.join('\n');
}

/**
 * Append or update heartbeat summary section
 */
export function appendHeartbeatSummary(journal: string, summary: HeartbeatSummary): string {
  const summaryRegex = /## Heartbeat Summary[\s\S]*?(?=\n##\s|$)/;
  const existingSummary = journal.match(summaryRegex);

  const summaryMarkdown = `
## Heartbeat Summary

**Last Run**: ${summary.timestamp}
**Task**: ${summary.taskName}

- Created ${summary.entriesCreated} new journal entries
- Updated ${summary.entriesUpdated} existing entries
- Synced ${summary.onenotePagesSynced} OneNote pages
- Errors: ${summary.errors && summary.errors.length > 0 ? summary.errors.join(', ') : 'None'}

---
`.trim();

  if (existingSummary) {
    return journal.replace(summaryRegex, summaryMarkdown);
  } else {
    const shutdownRegex = /\n## Shutdown Review/;
    if (shutdownRegex.test(journal)) {
      return journal.replace(shutdownRegex, `\n\n${summaryMarkdown}\n\n## Shutdown Review`);
    } else {
      return `${journal}\n\n${summaryMarkdown}`;
    }
  }
}

/**
 * Write a journal file.
 *
 * For new journals (empty rawContent): creates the full structure.
 * For existing journals: surgically updates calendar metadata only,
 * preserving all user-written content in place.
 */
export function writeJournalFile(journal: DailyJournal): string {
  if (!journal.rawContent || journal.rawContent.trim().length === 0) {
    return createNewJournal(journal);
  }

  return updateExistingJournal(journal);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createNewJournal(journal: DailyJournal): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(journal.frontmatter.date);
  const dayName = dayNames[date.getDay()];

  const meetingsMarkdown = journal.meetings.length > 0
    ? journal.meetings.map(m => formatMeetingEntry(m)).join('\n')
    : '';

  const content = `# ${dayName}, ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })}

## Morning Check-In

**Energy Level:** ${journal.frontmatter['energy-level'] || 7}/10 - ${journal.frontmatter['energy-description'] || 'Ready to start the day'}

## Top 3 Priorities

1.
2.
3.

## Today's Schedule

${meetingsMarkdown}`;

  return matter.stringify(content, journal.frontmatter);
}

/**
 * Surgically update an existing journal.
 *
 * For each meeting in journal.meetings:
 *   - If it already exists in the file (matched by EventId): update only the
 *     heading (time/title) and the Attendees/Location metadata lines. Never
 *     touch Notes, Prep Notes, or Meeting Notes.
 *   - If it is new: append it into the Today's Schedule section.
 *
 * The file is manipulated as plain text lines so we never risk an AST
 * serialiser changing whitespace or formatting in sections we don't own.
 */
function updateExistingJournal(journal: DailyJournal): string {
  // gray-matter strips the frontmatter; we work on the body only.
  const parsed = matter(journal.rawContent);
  let body = parsed.content;

  // Build a map of eventId → MeetingEntry for quick lookup
  const meetingsByEventId = new Map<string, MeetingEntry>();
  for (const m of journal.meetings) {
    meetingsByEventId.set(m.eventId, m);
  }

  // Track which event IDs we've already seen in the file
  const eventIdsInFile = new Set<string>();

  // Split into lines for surgical editing
  const lines = body.split('\n');
  const result: string[] = [];

  let i = 0;
  let inScheduleSection = false;
  let scheduleEndIndex: number | null = null; // index in `result` where new meetings go

  while (i < lines.length) {
    const line = lines[i];

    // Detect section boundaries
    if (line.startsWith('## ')) {
      if (line.trim() === "## Today's Schedule") {
        inScheduleSection = true;
        result.push(line);
        i++;
        continue;
      } else if (inScheduleSection) {
        // Leaving Today's Schedule – record where new meetings should be inserted
        scheduleEndIndex = result.length;
        inScheduleSection = false;
      }
    }

    if (inScheduleSection && line.startsWith('### ')) {
      // Parse the meeting heading: ### TIME - TITLE
      const headingMatch = line.match(/^### (.+?)\s*-\s*(.+)$/);
      if (headingMatch) {
        // Look ahead to find the EventId for this meeting block
        const blockLines: string[] = [line];
        let j = i + 1;
        let eventId: string | null = null;

        while (j < lines.length && !lines[j].startsWith('### ') && !lines[j].startsWith('## ')) {
          blockLines.push(lines[j]);
          // Extract eventId from **EventId:** [eventId](URL)
          const eventIdMatch = lines[j].match(/\*\*EventId:\*\*\s*\[eventId\]\((.+?)\)/);
          if (eventIdMatch) {
            eventId = eventIdMatch[1];
          }
          if (lines[j] === '---') {
            j++;
            break;
          }
          j++;
        }

        if (eventId && meetingsByEventId.has(eventId)) {
          // We have an update for this meeting — patch metadata lines only
          const updated = meetingsByEventId.get(eventId)!;
          eventIdsInFile.add(eventId);
          result.push(...patchMeetingBlock(blockLines, updated));
        } else {
          // No matching meeting in calendar (e.g. EventId not in lookahead) — keep as-is
          if (eventId) eventIdsInFile.add(eventId);
          result.push(...blockLines);
        }

        i = j;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  // If we never left Today's Schedule (it's the last section), record end now
  if (inScheduleSection) {
    scheduleEndIndex = result.length;
  }

  // Append any brand-new meetings (not already in the file) into Today's Schedule
  const newMeetings = journal.meetings.filter(m => !eventIdsInFile.has(m.eventId));
  if (newMeetings.length > 0 && scheduleEndIndex !== null) {
    const newMeetingLines = newMeetings.map(m => formatMeetingEntry(m)).join('\n').split('\n');
    result.splice(scheduleEndIndex, 0, '', ...newMeetingLines);
  }

  const newBody = result.join('\n');
  return matter.stringify(newBody, journal.frontmatter);
}

/**
 * Patch the calendar-owned metadata lines within a meeting block.
 * Lines that contain user content (Notes, Prep Notes, Meeting Notes and
 * their subsequent content) are returned verbatim.
 */
function patchMeetingBlock(blockLines: string[], meeting: MeetingEntry): string[] {
  const hasOtherAttendees = meeting.attendees && meeting.attendees.trim().length > 0 &&
                             meeting.attendees.split(',').length > 1;

  const titleWithCancelled = meeting.isCancelled && !meeting.title.includes('(CANCELLED)')
    ? `${meeting.title} (CANCELLED)`
    : meeting.title;

  const result: string[] = [];

  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];

    // Update heading
    if (line.startsWith('### ')) {
      result.push(`### ${meeting.time} - ${titleWithCancelled}`);
      continue;
    }

    // Update or remove Attendees line
    if (line.startsWith('**Attendees:**')) {
      if (hasOtherAttendees) {
        result.push(`**Attendees:** ${meeting.attendees}`);
      }
      // If no longer has other attendees, drop the line
      continue;
    }

    // Update or remove Location line
    if (line.startsWith('**Location:**')) {
      if (hasOtherAttendees && meeting.location && meeting.location.trim().length > 0) {
        result.push(`**Location:** ${meeting.location}`);
      }
      // Drop if no location or no longer has other attendees
      continue;
    }

    // Update EventId line
    if (line.startsWith('**EventId:**')) {
      result.push(`**EventId:** [eventId](${meeting.eventId})`);
      continue;
    }

    // Everything else (Notes, Prep Notes, Meeting Notes, Related, user content,
    // blank lines, separators) is kept exactly as written.
    result.push(line);
  }

  return result;
}
