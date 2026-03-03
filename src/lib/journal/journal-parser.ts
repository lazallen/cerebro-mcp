/**
 * Journal file parser using gray-matter for frontmatter and remark for markdown AST parsing
 */

import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import type { Root } from 'mdast';
import type { JournalParseResult, DailyJournal, MeetingEntry, JournalFrontmatter } from './types';

/**
 * Parse a journal file from markdown content
 */
export function parseJournalFile(content: string): JournalParseResult {
  try {
    // Parse frontmatter using gray-matter
    const parsed = matter(content);
    const frontmatter = parsed.data as Partial<JournalFrontmatter>;

    // Validate required frontmatter fields
    if (!frontmatter.date || !frontmatter.day || !frontmatter.type) {
      return {
        success: false,
        error: 'Missing required frontmatter fields: date, day, or type',
      };
    }

    // Extract meetings from journal body
    const meetings = extractMeetings(parsed.content);

    const journal: DailyJournal = {
      frontmatter: frontmatter as JournalFrontmatter,
      meetings,
      rawContent: parsed.content,
    };

    return {
      success: true,
      journal,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Extract meeting entries from journal body using proper markdown AST parsing
 * Matches pattern: ### TIME - TITLE followed by meeting details until ---
 */
export function extractMeetings(journalBody: string): MeetingEntry[] {
  const meetings: MeetingEntry[] = [];

  try {
    // Parse markdown into AST
    const tree = unified().use(remarkParse).parse(journalBody) as Root;

    // Find "Today's Schedule" section
    let inScheduleSection = false;
    let currentMeeting: Partial<MeetingEntry> | null = null;
    let currentFieldContent: string[] = [];
    let currentFieldName: string | null = null;

    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];

      // Check if we've entered the "Today's Schedule" section
      if (node.type === 'heading' && node.depth === 2) {
        const headingText = toString(node);
        if (headingText === "Today's Schedule") {
          inScheduleSection = true;
          continue;
        } else if (inScheduleSection) {
          // Reached another ## heading, stop processing
          break;
        }
      }

      if (!inScheduleSection) continue;

      // Meeting heading: ### TIME - TITLE
      if (node.type === 'heading' && node.depth === 3) {
        // Save previous meeting if exists
        if (currentMeeting && currentMeeting.eventId) {
          // Save last field content
          if (currentFieldName && currentFieldContent.length > 0) {
            saveMeetingField(currentMeeting, currentFieldName, currentFieldContent.join('\n').trim());
          }
          meetings.push(currentMeeting as MeetingEntry);
        }

        // Start new meeting
        const headingText = toString(node);
        const headingMatch = headingText.match(/^(.+?)\s*-\s*(.+)$/);
        if (headingMatch) {
          const time = headingMatch[1].trim();
          const title = headingMatch[2].trim();
          currentMeeting = {
            time,
            title,
            isCancelled: title.includes('(CANCELLED)'),
          };
          currentFieldName = null;
          currentFieldContent = [];
        }
        continue;
      }

      // #### Notes / Prep Notes / Meeting Notes headings (new format)
      if (currentMeeting && node.type === 'heading' && node.depth === 4) {
        const headingText = toString(node).trim();
        // Save previous field content
        if (currentFieldName && currentFieldContent.length > 0) {
          saveMeetingField(currentMeeting, currentFieldName, currentFieldContent.join('\n').trim());
        }
        currentFieldName = headingText; // e.g. "Prep Notes", "Meeting Notes", "Notes"
        currentFieldContent = [];
        continue;
      }

      // Process meeting content (paragraphs and thematic breaks)
      if (currentMeeting) {
        if (node.type === 'thematicBreak') {
          // --- separator marks end of meeting
          // Save last field content before saving meeting
          if (currentFieldName && currentFieldContent.length > 0) {
            saveMeetingField(currentMeeting, currentFieldName, currentFieldContent.join('\n').trim());
          }
          // Save the meeting if it has an EventId
          if (currentMeeting.eventId) {
            meetings.push(currentMeeting as MeetingEntry);
          }
          // Reset for next meeting
          currentMeeting = null;
          currentFieldName = null;
          currentFieldContent = [];
          continue;
        }

        if (node.type === 'paragraph') {
          //Check if this paragraph starts with a strong (bold) element followed by a colon
          const children = (node as any).children || [];

          if (children.length > 0 && children[0].type === 'strong') {
            // This might be a field marker like **FieldName:**
            const strongChildren = children[0].children || [];
            if (strongChildren.length > 0 && strongChildren[0].type === 'text') {
              const strongText = strongChildren[0].value;
              // Check if it ends with a colon (field marker pattern)
              if (strongText.endsWith(':')) {
                // Save previous field content
                if (currentFieldName && currentFieldContent.length > 0) {
                  saveMeetingField(currentMeeting, currentFieldName, currentFieldContent.join('\n').trim());
                }

                // Extract field name (remove the colon)
                currentFieldName = strongText.slice(0, -1).trim();
                currentFieldContent = [];

                // Check if there's content after the field marker in the same paragraph
                const restOfParagraph = children.slice(1);
                if (restOfParagraph.length > 0) {
                  // Extract text from remaining nodes
                  const remainingText = restOfParagraph
                    .map((child: any) => {
                      if (child.type === 'text') return child.value.trim();
                      if (child.type === 'link') return toString(child).trim();
                      return toString(child).trim();
                    })
                    .filter((t: string) => t.length > 0)
                    .join(' ');

                  // Handle EventId with link
                  if (currentFieldName === 'EventId' && restOfParagraph.find((c: any) => c.type === 'link')) {
                    const linkNode = restOfParagraph.find((c: any) => c.type === 'link');
                    currentMeeting.eventId = linkNode.url;
                    currentFieldName = null;
                  } else if (remainingText) {
                    // Store content for single-line fields or first line of multi-line
                    if (currentFieldName === 'Attendees' || currentFieldName === 'Location' || currentFieldName === 'Related') {
                      saveMeetingField(currentMeeting, currentFieldName, remainingText);
                      currentFieldName = null;
                    } else {
                      // Multi-line field - save first line
                      currentFieldContent.push(remainingText);
                    }
                  }
                }
                continue;
              }
            }
          }

          // If we're currently collecting content for a field, add this paragraph
          if (currentFieldName) {
            const text = toString(node).trim();
            if (text.length > 0) {
              currentFieldContent.push(text);
            }
          }
        }
      }
    }

    // Save last meeting
    if (currentMeeting && currentMeeting.eventId) {
      if (currentFieldName && currentFieldContent.length > 0) {
        saveMeetingField(currentMeeting, currentFieldName, currentFieldContent.join('\n').trim());
      }
      meetings.push(currentMeeting as MeetingEntry);
    }
  } catch (error) {
    // Log error and return empty array if AST parsing fails
    console.error('Failed to parse markdown with AST:', error);
    return [];
  }

  return meetings;
}

/**
 * Helper to save field content to meeting entry
 */
function saveMeetingField(meeting: Partial<MeetingEntry>, fieldName: string, content: string): void {
  if (!content || content.length === 0) return;

  switch (fieldName) {
    case 'Attendees':
      meeting.attendees = content;
      break;
    case 'Location':
      meeting.location = content;
      break;
    case 'Related':
      meeting.related = content;
      break;
    case 'Prep Notes':
    case 'Notes':
      meeting.prepNotes = content;
      break;
    case 'Meeting Notes':
      meeting.meetingNotes = content;
      break;
  }
}


/**
 * Extract EventId from meeting body
 * Supports both plain format and markdown link format
 */
export function extractEventId(body: string): string | null {
  // Try markdown link format first: [eventId](AAMk...)
  const linkMatch = body.match(/\*\*EventId:\*\*\s*\[eventId\]\(([A-Za-z0-9+/=\-_]+)\)/);
  if (linkMatch) {
    return linkMatch[1];
  }

  // Try plain format: EventId: AAMk...
  const plainMatch = body.match(/\*\*EventId:\*\*\s*([A-Za-z0-9+/=\-_]+)/);
  if (plainMatch) {
    return plainMatch[1];
  }

  return null;
}

