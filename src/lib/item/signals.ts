/**
 * Signal computation helpers for non-email sources.
 * Moved from src/lib/triage/signal-definitions.ts and updated to use the
 * unified Signals interface.
 */

import type { Signals } from './types';

/**
 * Compute signals for a calendar event.
 */
export function computeCalendarSignals(sourceData: Record<string, unknown>): Partial<Signals> {
  return {
    isAutomated: false,
    isBulk: false,
    hasUnsubscribe: false,
    hasAttachments: false,
    mentionsMeeting: true,
    mentionsMoney: false,
    isActionRequest: false,
    isPrioritySender: false,
    'calendar.isOrganiser': sourceData['isOrganiser'] === true,
    'calendar.isCancelled': sourceData['isCancelled'] === true,
    'calendar.isOnlineMeeting': sourceData['isOnlineMeeting'] === true,
  };
}

/**
 * Compute signals for a Slack message.
 */
export function computeSlackSignals(sourceData: Record<string, unknown>): Partial<Signals> {
  const text = String(sourceData['text'] ?? '');
  return {
    isAutomated: sourceData['isBot'] === true,
    isBulk: sourceData['isChannelMessage'] === true && sourceData['isDirectMessage'] !== true,
    hasUnsubscribe: false,
    hasAttachments:
      Array.isArray(sourceData['files']) && (sourceData['files'] as unknown[]).length > 0,
    mentionsMeeting: /meet|call|zoom|teams|standup|stand-up/.test(text.toLowerCase()),
    mentionsMoney: /£|\$|€|budget|cost|invoice|payment/.test(text.toLowerCase()),
    isActionRequest: /please|could you|can you|action|follow.?up/.test(text.toLowerCase()),
    isPrioritySender: false,
    'slack.isDirectMessage': sourceData['isDirectMessage'] === true,
    'slack.hasMention': sourceData['hasMention'] === true,
    'slack.channel': String(sourceData['channel'] ?? ''),
  };
}
