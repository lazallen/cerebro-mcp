/**
 * Smart Meeting Scheduler Task (Feature 023)
 *
 * Implements the forward-scheduling and rebalance phases for managed meetings.
 * Registered as 'smart-meeting-scheduler' in the task registry.
 */

import type { TaskConfig } from '../../../types/heartbeat';
import type { TaskHandler } from '../types';
import { logger } from '../../../common/logger';
import { loadSmartMeetingsConfig, saveSmartMeetingsConfig } from '../../smart-meetings/config-io';
import { calculateCadenceDebt, sortByDebtDesc } from '../../smart-meetings/cadence-debt';
import { calcTimePortfolio } from '../../smart-meetings/portfolio-calculator';
import type { PortfolioRef } from '../../smart-meetings/portfolio-ref';
import type {
  SmartMeetingTaskConfig,
  MeetingDefinition,
  MeetingHistory,
  DayOfWeek,
  PendingReschedule,
} from '../../../types/smart-meetings';

const DAY_NAMES_SHORT: string[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHHMM(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export class SmartMeetingSchedulerTask implements TaskHandler {
  constructor(
    private readonly microsoftService: any,
    private readonly portfolioRef: PortfolioRef
  ) {}

  async execute(taskConfig: TaskConfig): Promise<void> {
    const cfg = taskConfig.config as unknown as SmartMeetingTaskConfig;

    logger.info({
      operation: 'smart_meeting_scheduler_execute',
      taskId: taskConfig.id,
      phase: cfg.phase,
      configPath: cfg.configPath,
      message: `SmartMeetingSchedulerTask starting phase: ${cfg.phase}`,
    });

    try {
      if (cfg.phase === 'forward-scheduling') {
        await this.runForwardScheduling(cfg);
      } else if (cfg.phase === 'rebalance') {
        await this.runRebalance(cfg);
      } else {
        logger.warn({
          operation: 'smart_meeting_scheduler_unknown_phase',
          phase: (cfg as any).phase,
          message: `Unknown phase: ${(cfg as any).phase}`,
        });
      }
    } catch (err) {
      logger.error({
        operation: 'smart_meeting_scheduler_error',
        phase: cfg.phase,
        error: (err as Error).message,
        stack: (err as Error).stack,
        message: `SmartMeetingSchedulerTask failed for phase ${cfg.phase}`,
      });
      throw err;
    }
  }

  private async runForwardScheduling(cfg: SmartMeetingTaskConfig): Promise<void> {
    const config = await loadSmartMeetingsConfig(cfg.configPath);
    const { settings } = config;
    const { lookAheadDays, minNoticePeriodHours, historyRetentionCount } = settings;

    const now = new Date();

    // Update history statuses for past scheduled entries
    config.meetings = await this.updateHistoryStatuses(config.meetings, this.microsoftService);

    // Check for declined meetings: delete immediately, set pendingReschedule, or action overdue reschedules
    await this.checkDeclinedMeetings(config.meetings, cfg.configPath, now);
    // Reload config after potential mutations from checkDeclinedMeetings
    const refreshedConfig = await loadSmartMeetingsConfig(cfg.configPath);
    config.meetings = refreshedConfig.meetings;

    // Get enabled meetings sorted by cadence debt descending (most overdue first)
    const enabledMeetings = sortByDebtDesc(
      config.meetings.filter(m => m.enabled),
      now
    );

    logger.info({
      operation: 'smart_meeting_forward_scheduling_start',
      enabledCount: enabledMeetings.length,
      message: `Forward scheduling ${enabledMeetings.length} enabled meetings`,
    });

    // Look-ahead window for duplicate detection
    const lookAheadStart = now;
    const lookAheadEnd = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

    // Fetch calendar for duplicate detection (FR-003)
    let calendarEvents: any[] = [];
    try {
      const calResponse = await this.microsoftService.listEvents({
        startDate: lookAheadStart.toISOString(),
        endDate: lookAheadEnd.toISOString(),
        count: 200,
      });
      calendarEvents = (calResponse as any).events ?? [];
    } catch (err) {
      logger.warn({
        operation: 'smart_meeting_calendar_fetch_warn',
        error: (err as Error).message,
        message: 'Could not fetch calendar for duplicate detection; proceeding without check',
      });
    }

    for (const meeting of enabledMeetings) {
      try {
        const debt = calculateCadenceDebt(meeting, now);
        const targetHorizonDays = debt.targetHorizonDays;

        // Build search window: now + minNoticePeriod → now + targetHorizonDays
        const windowStart = new Date(now.getTime() + minNoticePeriodHours * 60 * 60 * 1000);
        const windowEnd = new Date(now.getTime() + targetHorizonDays * 24 * 60 * 60 * 1000);

        // FR-003: Check if a matching event already exists in the look-ahead window
        const alreadyScheduled = this.findMatchingEvent(calendarEvents, meeting);
        if (alreadyScheduled) {
          logger.info({
            operation: 'smart_meeting_skip_already_scheduled',
            meetingId: meeting.id,
            existingEventSubject: alreadyScheduled.subject,
            message: `[${meeting.id}] Already scheduled — skipping`,
          });
          continue;
        }

        logger.info({
          operation: 'smart_meeting_find_slot',
          meetingId: meeting.id,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          durationMinutes: meeting.durationMinutes,
          message: `[${meeting.id}] Finding meeting slot`,
        });

        // Call findMeetingTimes
        let suggestions: any[] = [];
        try {
          const result = await this.microsoftService.findMeetingTimes({
            attendees: meeting.attendees,
            meetingDuration: meeting.durationMinutes,
            timeConstraintStart: windowStart.toISOString(),
            timeConstraintEnd: windowEnd.toISOString(),
            maxCandidates: 5,
          });
          suggestions = (result as any).suggestions ?? [];
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_find_times_error',
            meetingId: meeting.id,
            error: (err as Error).message,
            message: `[${meeting.id}] findMeetingTimes failed — skipping`,
          });
          continue;
        }

        if (suggestions.length === 0) {
          logger.warn({
            operation: 'smart_meeting_no_slot_found',
            meetingId: meeting.id,
            message: `[${meeting.id}] No available slot found in window — skipping`,
          });
          continue;
        }

        // Pick first suggestion
        const slot = suggestions[0];
        const slotStart = slot.timeSlot?.start;
        const slotEnd = slot.timeSlot?.end;

        if (!slotStart || !slotEnd) {
          logger.warn({
            operation: 'smart_meeting_invalid_slot',
            meetingId: meeting.id,
            slot,
            message: `[${meeting.id}] Suggestion has no valid timeSlot — skipping`,
          });
          continue;
        }

        // Create the calendar event
        try {
          await this.microsoftService.createEvent({
            subject: meeting.title,
            startDateTime: slotStart,
            endDateTime: slotEnd,
            attendees: meeting.attendees,
          });
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_create_event_error',
            meetingId: meeting.id,
            error: (err as Error).message,
            message: `[${meeting.id}] createEvent failed — skipping`,
          });
          continue;
        }

        // Append history entry
        const slotDate = new Date(slotStart);
        const historyEntry: MeetingHistory = {
          date: toISODate(slotDate),
          dayOfWeek: DAY_NAMES_SHORT[slotDate.getDay()] as DayOfWeek,
          startTime: toHHMM(slotDate),
          status: 'scheduled',
        };

        // Find the meeting in config.meetings (update the reference, not a copy)
        const meetingInConfig = config.meetings.find(m => m.id === meeting.id);
        if (meetingInConfig) {
          meetingInConfig.history.push(historyEntry);
        }

        logger.info({
          operation: 'smart_meeting_scheduled',
          meetingId: meeting.id,
          slotStart,
          slotEnd,
          message: `[${meeting.id}] Scheduled at ${slotStart}`,
        });
      } catch (err) {
        logger.error({
          operation: 'smart_meeting_forward_scheduling_meeting_error',
          meetingId: meeting.id,
          error: (err as Error).message,
          message: `[${meeting.id}] Unexpected error during forward scheduling — continuing`,
        });
      }
    }

    // Prune history arrays to historyRetentionCount
    for (const meeting of config.meetings) {
      if (meeting.history.length > historyRetentionCount) {
        meeting.history = meeting.history.slice(
          meeting.history.length - historyRetentionCount
        );
      }
    }

    await saveSmartMeetingsConfig(cfg.configPath, config);

    logger.info({
      operation: 'smart_meeting_forward_scheduling_done',
      message: 'Forward scheduling pass complete',
    });
  }

  private async runRebalance(cfg: SmartMeetingTaskConfig): Promise<void> {
    const config = await loadSmartMeetingsConfig(cfg.configPath);
    const { settings } = config;
    const { lookAheadDays, minNoticePeriodHours } = settings;

    const now = new Date();

    // Update history statuses for past scheduled entries
    config.meetings = await this.updateHistoryStatuses(config.meetings, this.microsoftService);

    // Fetch calendar for look-ahead window
    const lookAheadStart = now;
    const lookAheadEnd = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

    let calendarEvents: any[] = [];
    try {
      const calResponse = await this.microsoftService.listEvents({
        startDate: lookAheadStart.toISOString(),
        endDate: lookAheadEnd.toISOString(),
        count: 200,
      });
      calendarEvents = (calResponse as any).events ?? [];
    } catch (err) {
      logger.error({
        operation: 'smart_meeting_rebalance_calendar_error',
        error: (err as Error).message,
        message: 'Failed to fetch calendar for rebalance — aborting',
      });
      return;
    }

    const enabledMeetings = config.meetings.filter(m => m.enabled);
    const rescheduledMeetingIds = new Set<string>();

    for (const meeting of enabledMeetings) {
      try {
        // Find scheduled event in calendar
        const scheduledEvent = this.findMatchingEvent(calendarEvents, meeting);
        if (!scheduledEvent) {
          continue;
        }

        const eventStartIso = scheduledEvent.start?.dateTime ?? scheduledEvent.startDateTime;
        if (!eventStartIso) {
          continue;
        }

        const eventStart = new Date(eventStartIso);
        const hoursUntilEvent = (eventStart.getTime() - now.getTime()) / (60 * 60 * 1000);

        // FR-006: Skip if event is within minNoticePeriodHours
        if (hoursUntilEvent < minNoticePeriodHours) {
          logger.debug({
            operation: 'smart_meeting_rebalance_skip_notice',
            meetingId: meeting.id,
            hoursUntilEvent,
            minNoticePeriodHours,
            message: `[${meeting.id}] Within notice period — skipping rebalance`,
          });
          continue;
        }

        // FR-015: Max 1 reschedule per meeting per run
        if (rescheduledMeetingIds.has(meeting.id)) {
          continue;
        }

        // Check for conflicts: another event overlapping this slot for any attendee
        const eventEndIso = scheduledEvent.end?.dateTime ?? scheduledEvent.endDateTime;
        if (!eventEndIso) {
          continue;
        }

        const hasConflict = this.hasConflict(calendarEvents, scheduledEvent, eventStartIso, eventEndIso);

        if (!hasConflict) {
          continue;
        }

        logger.info({
          operation: 'smart_meeting_rebalance_conflict_detected',
          meetingId: meeting.id,
          eventStart: eventStartIso,
          message: `[${meeting.id}] Conflict detected — attempting to reschedule`,
        });

        const eventId = scheduledEvent.id;
        if (!eventId) {
          logger.warn({
            operation: 'smart_meeting_rebalance_no_event_id',
            meetingId: meeting.id,
            message: `[${meeting.id}] No eventId on conflicting smart-meeting event — skipping`,
          });
          continue;
        }

        // Find an alternative slot
        const windowStart = new Date(now.getTime() + minNoticePeriodHours * 60 * 60 * 1000);
        const windowEnd = lookAheadEnd;

        let newSuggestions: any[] = [];
        try {
          const result = await this.microsoftService.findMeetingTimes({
            attendees: meeting.attendees,
            meetingDuration: meeting.durationMinutes,
            timeConstraintStart: windowStart.toISOString(),
            timeConstraintEnd: windowEnd.toISOString(),
            maxCandidates: 5,
          });
          newSuggestions = (result as any).suggestions ?? [];
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_rebalance_find_times_error',
            meetingId: meeting.id,
            error: (err as Error).message,
            message: `[${meeting.id}] findMeetingTimes failed during rebalance — skipping`,
          });
          continue;
        }

        if (newSuggestions.length === 0) {
          logger.warn({
            operation: 'smart_meeting_rebalance_no_alt_slot',
            meetingId: meeting.id,
            message: `[${meeting.id}] No alternative slot found — leaving in place`,
          });
          continue;
        }

        const newSlot = newSuggestions[0];
        const newStart = newSlot.timeSlot?.start;
        const newEnd = newSlot.timeSlot?.end;

        if (!newStart || !newEnd) {
          logger.warn({
            operation: 'smart_meeting_rebalance_invalid_alt_slot',
            meetingId: meeting.id,
            message: `[${meeting.id}] Alternative suggestion has no valid timeSlot — skipping`,
          });
          continue;
        }

        // Delete old event and create new one
        try {
          await this.microsoftService.deleteEvent({ eventId });
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_rebalance_delete_error',
            meetingId: meeting.id,
            eventId,
            error: (err as Error).message,
            message: `[${meeting.id}] deleteEvent failed — skipping`,
          });
          continue;
        }

        try {
          await this.microsoftService.createEvent({
            subject: meeting.title,
            startDateTime: newStart,
            endDateTime: newEnd,
            attendees: meeting.attendees,
          });
        } catch (err) {
          logger.error({
            operation: 'smart_meeting_rebalance_create_error',
            meetingId: meeting.id,
            error: (err as Error).message,
            message: `[${meeting.id}] createEvent failed after deletion — history not updated`,
          });
          continue;
        }

        // Update history: replace last 'scheduled' entry with new slot
        const meetingInConfig = config.meetings.find(m => m.id === meeting.id);
        if (meetingInConfig) {
          const lastScheduledIdx = meetingInConfig.history.map(h => h.status).lastIndexOf('scheduled');
          const newSlotDate = new Date(newStart);
          const newHistoryEntry: MeetingHistory = {
            date: toISODate(newSlotDate),
            dayOfWeek: DAY_NAMES_SHORT[newSlotDate.getDay()] as DayOfWeek,
            startTime: toHHMM(newSlotDate),
            status: 'scheduled',
          };
          if (lastScheduledIdx >= 0) {
            meetingInConfig.history[lastScheduledIdx] = newHistoryEntry;
          } else {
            meetingInConfig.history.push(newHistoryEntry);
          }
        }

        rescheduledMeetingIds.add(meeting.id);

        logger.info({
          operation: 'smart_meeting_rebalance_rescheduled',
          meetingId: meeting.id,
          oldStart: eventStartIso,
          newStart,
          message: `[${meeting.id}] Rescheduled from ${eventStartIso} to ${newStart}`,
        });
      } catch (err) {
        logger.error({
          operation: 'smart_meeting_rebalance_meeting_error',
          meetingId: meeting.id,
          error: (err as Error).message,
          message: `[${meeting.id}] Unexpected error during rebalance — continuing`,
        });
      }
    }

    // Calculate time portfolio: past 4 weeks + current lookAheadDays window
    try {
      const portfolioStart = new Date(now.getTime() - 4 * 7 * 24 * 60 * 60 * 1000);
      const portfolioEnd = lookAheadEnd;

      let portfolioEvents: any[] = [];
      try {
        const portfolioResponse = await this.microsoftService.listEvents({
          startDate: portfolioStart.toISOString(),
          endDate: portfolioEnd.toISOString(),
          count: 200,
        });
        portfolioEvents = (portfolioResponse as any).events ?? [];
      } catch (err) {
        logger.warn({
          operation: 'smart_meeting_rebalance_portfolio_fetch_warn',
          error: (err as Error).message,
          message: 'Could not fetch events for portfolio calculation',
        });
      }

      // Convert raw calendar events to CalendarEvent shape expected by calcTimePortfolio
      const mappedEvents = portfolioEvents.map((e: any) => ({
        subject: e.subject ?? '(No title)',
        start: { dateTime: e.start?.dateTime ?? e.startDateTime ?? '' },
        end: { dateTime: e.end?.dateTime ?? e.endDateTime ?? '' },
        attendees: e.attendees,
        recurrence: e.recurrence,
      }));

      const portfolio = calcTimePortfolio(
        mappedEvents,
        config.meetings,
        config.settings.timePortfolio,
        now
      );

      this.portfolioRef.current = portfolio;
      this.portfolioRef.lastUpdated = new Date();

      logger.info({
        operation: 'smart_meeting_portfolio_updated',
        thisWeekFocusPct: portfolio.thisWeek.focusPct,
        thisWeekRecurringPct: portfolio.thisWeek.recurringPct,
        thisWeekAdHocPct: portfolio.thisWeek.adHocPct,
        message: 'Portfolio ref updated',
      });
    } catch (err) {
      logger.error({
        operation: 'smart_meeting_portfolio_error',
        error: (err as Error).message,
        message: 'Failed to calculate time portfolio — portfolioRef not updated',
      });
    }

    await saveSmartMeetingsConfig(cfg.configPath, config);

    logger.info({
      operation: 'smart_meeting_rebalance_done',
      rescheduledCount: rescheduledMeetingIds.size,
      message: `Rebalance pass complete — ${rescheduledMeetingIds.size} meeting(s) rescheduled`,
    });
  }

  /**
   * Check for declined meetings:
   *   Phase A — if pendingReschedule has been set for >24h, create a replacement event.
   *   Phase B — if no pendingReschedule, find the matching event and check if ALL
   *             attendees have declined; if so, delete immediately and record the state.
   */
  private async checkDeclinedMeetings(
    meetings: MeetingDefinition[],
    configPath: string,
    now: Date
  ): Promise<void> {
    const enabledMeetings = meetings.filter(m => m.enabled);

    for (const meeting of enabledMeetings) {
      try {
        // ── Phase A: Overdue pending reschedule ────────────────────────────────
        if (meeting.pendingReschedule) {
          const detectedAt = new Date(meeting.pendingReschedule.detectedAt);
          const ageHours = (now.getTime() - detectedAt.getTime()) / (60 * 60 * 1000);

          if (ageHours < 24) {
            continue; // Still within cooling-off period
          }

          logger.info({
            operation: 'smart_meeting_reschedule_overdue',
            meetingId: meeting.id,
            ageHours: Math.round(ageHours),
            message: `[${meeting.id}] Pending reschedule is ${Math.round(ageHours)}h old — scheduling replacement`,
          });

          let newStart: string | undefined;
          let newEnd: string | undefined;

          // Use proposed time if within meeting window
          const proposed = meeting.pendingReschedule.proposedTime;
          if (proposed) {
            const proposedStart = new Date(proposed.start);
            const windowEnd = new Date(now.getTime() + meeting.window.days * 24 * 60 * 60 * 1000);
            if (proposedStart > now && proposedStart < windowEnd) {
              newStart = proposed.start;
              newEnd = proposed.end;
              logger.info({
                operation: 'smart_meeting_using_proposed_time',
                meetingId: meeting.id,
                proposedStart: newStart,
                message: `[${meeting.id}] Using attendee-proposed time: ${newStart}`,
              });
            }
          }

          // Fall back to findMeetingTimes
          if (!newStart) {
            const windowStart = now;
            const windowEnd = new Date(now.getTime() + meeting.window.days * 24 * 60 * 60 * 1000);
            try {
              const result = await this.microsoftService.findMeetingTimes({
                attendees: meeting.attendees,
                meetingDuration: meeting.durationMinutes,
                timeConstraintStart: windowStart.toISOString(),
                timeConstraintEnd: windowEnd.toISOString(),
                maxCandidates: 5,
              });
              const suggestions = (result as any).suggestions ?? [];
              if (suggestions.length > 0) {
                newStart = suggestions[0].timeSlot?.start;
                newEnd = suggestions[0].timeSlot?.end;
              }
            } catch (err) {
              logger.warn({
                operation: 'smart_meeting_reschedule_find_times_error',
                meetingId: meeting.id,
                error: (err as Error).message,
                message: `[${meeting.id}] findMeetingTimes failed during reschedule — will retry tomorrow`,
              });
              continue;
            }
          }

          if (!newStart || !newEnd) {
            logger.warn({
              operation: 'smart_meeting_reschedule_no_slot',
              meetingId: meeting.id,
              message: `[${meeting.id}] No slot found for reschedule — will retry tomorrow`,
            });
            continue;
          }

          try {
            await this.microsoftService.createEvent({
              subject: meeting.title,
              startDateTime: newStart,
              endDateTime: newEnd,
              attendees: meeting.attendees,
            });
          } catch (err) {
            logger.warn({
              operation: 'smart_meeting_reschedule_create_error',
              meetingId: meeting.id,
              error: (err as Error).message,
              message: `[${meeting.id}] createEvent failed during reschedule — will retry tomorrow`,
            });
            continue;
          }

          const slotDate = new Date(newStart);
          const historyEntry: MeetingHistory = {
            date: toISODate(slotDate),
            dayOfWeek: DAY_NAMES_SHORT[slotDate.getDay()] as DayOfWeek,
            startTime: toHHMM(slotDate),
            status: 'scheduled',
          };
          meeting.history.push(historyEntry);
          delete meeting.pendingReschedule;

          // Persist immediately so other phases see the updated state
          const cfg = await loadSmartMeetingsConfig(configPath);
          const meetingInConfig = cfg.meetings.find(m => m.id === meeting.id);
          if (meetingInConfig) {
            meetingInConfig.history = meeting.history;
            delete meetingInConfig.pendingReschedule;
          }
          await saveSmartMeetingsConfig(configPath, cfg);

          logger.info({
            operation: 'smart_meeting_rescheduled_after_decline',
            meetingId: meeting.id,
            newStart,
            message: `[${meeting.id}] Rescheduled at ${newStart} after all-declined detection`,
          });
          continue;
        }

        // ── Phase B: Detect newly declined ────────────────────────────────────
        // Get calendar window (look-ahead) — use the meeting's own window setting
        const lookAheadEnd = new Date(now.getTime() + meeting.window.days * 24 * 60 * 60 * 1000);
        let calendarEvents: any[] = [];
        try {
          const calResponse = await this.microsoftService.listEvents({
            startDate: now.toISOString(),
            endDate: lookAheadEnd.toISOString(),
            count: 200,
          });
          calendarEvents = (calResponse as any).events ?? [];
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_decline_check_calendar_error',
            meetingId: meeting.id,
            error: (err as Error).message,
            message: `[${meeting.id}] Could not fetch calendar for decline check — skipping`,
          });
          continue;
        }

        const matchingEvent = this.findMatchingEvent(calendarEvents, meeting);
        if (!matchingEvent) {
          continue;
        }

        const eventId = matchingEvent.id;
        if (!eventId) {
          continue;
        }

        // Fetch full event details to get attendee status
        let eventDetails: any;
        try {
          eventDetails = await this.microsoftService.fetchEventDetails(eventId);
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_decline_fetch_event_error',
            meetingId: meeting.id,
            eventId,
            error: (err as Error).message,
            message: `[${meeting.id}] Could not fetch event details for decline check — skipping`,
          });
          continue;
        }

        const attendees: any[] = (eventDetails as any)?.attendees ?? [];
        const organizerEmail = (eventDetails as any)?.organizer?.emailAddress?.address?.toLowerCase();

        // Filter to non-organiser attendees matching our managed attendee list
        const managedAttendeeStatuses = attendees.filter((a: any) => {
          const email = (a.emailAddress?.address ?? '').toLowerCase();
          return (
            email !== organizerEmail &&
            meeting.attendees.some(ma => ma.toLowerCase() === email)
          );
        });

        if (managedAttendeeStatuses.length === 0) {
          continue;
        }

        const allDeclined = managedAttendeeStatuses.every(
          (a: any) => a.status?.response === 'declined'
        );

        if (!allDeclined) {
          continue;
        }

        logger.info({
          operation: 'smart_meeting_all_declined_detected',
          meetingId: meeting.id,
          eventId,
          attendeeCount: managedAttendeeStatuses.length,
          message: `[${meeting.id}] All attendees declined — deleting event and setting pendingReschedule`,
        });

        // Delete the event (no cancellation — they already declined)
        try {
          await this.microsoftService.deleteEvent({ eventId, sendCancellation: false });
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_decline_delete_error',
            meetingId: meeting.id,
            eventId,
            error: (err as Error).message,
            message: `[${meeting.id}] deleteEvent failed after all-declined detection — skipping`,
          });
          continue;
        }

        // Extract proposedNewTime from first declining attendee if present
        const decliningAttendee = managedAttendeeStatuses[0];
        const proposedNewTime = decliningAttendee?.proposedNewTime;
        let proposedTime: PendingReschedule['proposedTime'] | undefined;
        if (proposedNewTime?.start?.dateTime && proposedNewTime?.end?.dateTime) {
          proposedTime = {
            start: proposedNewTime.start.dateTime,
            end: proposedNewTime.end.dateTime,
          };
        }

        // Parse original event time
        const eventStartIso: string = matchingEvent.start?.dateTime ?? matchingEvent.startDateTime ?? '';
        const eventStartDate = eventStartIso ? new Date(eventStartIso) : new Date();

        const pendingReschedule: PendingReschedule = {
          eventId,
          detectedAt: now.toISOString(),
          attendeeEmail: decliningAttendee?.emailAddress?.address ?? meeting.attendees[0] ?? '',
          originalDate: toISODate(eventStartDate),
          originalTime: toHHMM(eventStartDate),
          ...(proposedTime ? { proposedTime } : {}),
        };

        // Persist to config
        const cfg = await loadSmartMeetingsConfig(configPath);
        const meetingInConfig = cfg.meetings.find(m => m.id === meeting.id);
        if (meetingInConfig) {
          meetingInConfig.pendingReschedule = pendingReschedule;
        }
        await saveSmartMeetingsConfig(configPath, cfg);

        // Also update in-memory so forward scheduling skips this meeting
        meeting.pendingReschedule = pendingReschedule;

        logger.info({
          operation: 'smart_meeting_pending_reschedule_set',
          meetingId: meeting.id,
          originalDate: pendingReschedule.originalDate,
          originalTime: pendingReschedule.originalTime,
          hasProposedTime: !!proposedTime,
          message: `[${meeting.id}] pendingReschedule set — will reschedule in 24h`,
        });
      } catch (err) {
        logger.error({
          operation: 'smart_meeting_decline_check_error',
          meetingId: meeting.id,
          error: (err as Error).message,
          message: `[${meeting.id}] Unexpected error in checkDeclinedMeetings — continuing`,
        });
      }
    }
  }

  /**
   * For each meeting with a 'scheduled' history entry in the past, check
   * whether the event actually occurred (by querying a ±4h window).
   * Flips status to 'occurred' or 'skipped' accordingly.
   * Does NOT save config — caller is responsible.
   */
  private async updateHistoryStatuses(
    meetings: MeetingDefinition[],
    microsoftService: any
  ): Promise<MeetingDefinition[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const meeting of meetings) {
      for (const entry of meeting.history) {
        if (entry.status !== 'scheduled') {
          continue;
        }

        const entryDate = new Date(entry.date);
        if (entryDate >= today) {
          // Still in the future or today — leave as 'scheduled'
          continue;
        }

        // Build a ±4h window around the scheduled time
        const [hh, mm] = entry.startTime.split(':').map(Number);
        const scheduledDateTime = new Date(entry.date);
        scheduledDateTime.setHours(hh ?? 0, mm ?? 0, 0, 0);

        const windowStart = new Date(scheduledDateTime.getTime() - 4 * 60 * 60 * 1000);
        const windowEnd = new Date(scheduledDateTime.getTime() + 4 * 60 * 60 * 1000);

        try {
          const response = await microsoftService.listEvents({
            startDate: windowStart.toISOString(),
            endDate: windowEnd.toISOString(),
            count: 50,
          });
          const events: any[] = (response as any).events ?? [];

          const matchingEvent = events.find((e: any) => {
            const subject: string = e.subject ?? '';
            const titleMatch = subject.toLowerCase().includes(meeting.title.toLowerCase());

            const attendeeList: any[] = e.attendees ?? [];
            const attendeeEmails = attendeeList
              .map((a: any) => (a.emailAddress?.address ?? '').toLowerCase())
              .filter(Boolean);

            const attendeeMatch = meeting.attendees.some(addr =>
              attendeeEmails.includes(addr.toLowerCase())
            );

            return titleMatch && attendeeMatch;
          });

          if (matchingEvent) {
            entry.status = 'occurred';
            logger.debug({
              operation: 'smart_meeting_history_status_occurred',
              meetingId: meeting.id,
              date: entry.date,
              message: `[${meeting.id}] History entry ${entry.date} marked as occurred`,
            });
          } else {
            entry.status = 'skipped';
            logger.debug({
              operation: 'smart_meeting_history_status_skipped',
              meetingId: meeting.id,
              date: entry.date,
              message: `[${meeting.id}] History entry ${entry.date} marked as skipped (no matching event found)`,
            });
          }
        } catch (err) {
          logger.warn({
            operation: 'smart_meeting_history_status_error',
            meetingId: meeting.id,
            date: entry.date,
            error: (err as Error).message,
            message: `[${meeting.id}] Could not verify history entry for ${entry.date} — leaving as scheduled`,
          });
        }
      }
    }

    return meetings;
  }

  /**
   * Find a calendar event matching a meeting definition by title substring
   * AND attendee presence.
   */
  private findMatchingEvent(
    events: any[],
    meeting: MeetingDefinition
  ): any | undefined {
    return events.find((e: any) => {
      const subject: string = e.subject ?? '';
      const titleMatch = subject.toLowerCase().includes(meeting.title.toLowerCase());

      const attendeeList: any[] = e.attendees ?? [];
      const attendeeEmails = attendeeList
        .map((a: any) => (a.emailAddress?.address ?? '').toLowerCase())
        .filter(Boolean);

      const attendeeMatch = meeting.attendees.some(addr =>
        attendeeEmails.includes(addr.toLowerCase())
      );

      return titleMatch && attendeeMatch;
    });
  }

  /**
   * Determine if a given event has a scheduling conflict with another event
   * in the calendar array (overlap, not free/all-day).
   */
  private hasConflict(
    events: any[],
    targetEvent: any,
    startIso: string,
    endIso: string
  ): boolean {
    const targetId = targetEvent.id;

    return events.some((e: any) => {
      if (e.id === targetId) return false;

      const eStart: string = e.start?.dateTime ?? e.startDateTime ?? '';
      const eEnd: string = e.end?.dateTime ?? e.endDateTime ?? '';

      if (!eStart || !eEnd) return false;
      if (e.isAllDay) return false;
      if (e.showAs === 'free') return false;

      // Overlap check: startIso < eEnd AND eStart < endIso
      return startIso < eEnd && eStart < endIso;
    });
  }
}
