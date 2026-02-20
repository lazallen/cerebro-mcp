/**
 * Signal computation extension points for non-email sources.
 * These stubs return default signals; replace with real implementations
 * when the corresponding ingestion task is built.
 */

import type { EventSignals } from '../policy/types';

/**
 * Compute signals for a calendar event.
 * @param sourceData Raw calendar event data (e.g., from Microsoft Graph)
 */
export function computeCalendarSignals(sourceData: Record<string, unknown>): Partial<EventSignals> {
  return {
    isAutomated: false,
    isBulk: false,
    hasUnsubscribe: false,
    hasAttachments: false,
    mentionsMeeting: true, // Calendar events always relate to meetings
    mentionsMoney: false,
    asksForAction: false,
    prioritySender: false,
    // calendar-specific extensions
    'calendar.isOrganiser': sourceData['isOrganiser'] === true,
    'calendar.isCancelled': sourceData['isCancelled'] === true,
    'calendar.isOnlineMeeting': sourceData['isOnlineMeeting'] === true,
  };
}

/**
 * Compute signals for a Slack message.
 * @param sourceData Raw Slack message data
 */
export function computeSlackSignals(sourceData: Record<string, unknown>): Partial<EventSignals> {
  const text = String(sourceData['text'] ?? '');
  return {
    isAutomated: sourceData['isBot'] === true,
    isBulk: sourceData['isChannelMessage'] === true && sourceData['isDirectMessage'] !== true,
    hasUnsubscribe: false,
    hasAttachments:
      Array.isArray(sourceData['files']) && (sourceData['files'] as unknown[]).length > 0,
    mentionsMeeting: /meet|call|zoom|teams|standup|stand-up/.test(text.toLowerCase()),
    mentionsMoney: /£|\$|€|budget|cost|invoice|payment/.test(text.toLowerCase()),
    asksForAction: /please|could you|can you|action|follow.?up/.test(text.toLowerCase()),
    prioritySender: false,
    // slack-specific extensions
    'slack.isDirectMessage': sourceData['isDirectMessage'] === true,
    'slack.hasMention': sourceData['hasMention'] === true,
    'slack.channel': String(sourceData['channel'] ?? ''),
  };
}

/**
 * Compute signals for a journal entry.
 * @param sourceData Journal entry metadata
 */
export function computeJournalSignals(sourceData: Record<string, unknown>): Partial<EventSignals> {
  const text = String(sourceData['content'] ?? '');
  return {
    isAutomated: false,
    isBulk: false,
    hasUnsubscribe: false,
    hasAttachments: false,
    mentionsMeeting: /meeting|call|standup|1:1|one.on.one/.test(text.toLowerCase()),
    mentionsMoney: /budget|cost|invoice|expense/.test(text.toLowerCase()),
    asksForAction: /todo|action|follow.?up|task|deadline/.test(text.toLowerCase()),
    prioritySender: false,
  };
}
