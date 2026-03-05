/**
 * Time portfolio calculation from pre-fetched calendar events.
 * Read-only — no Graph calls here; events are supplied by the caller.
 */

import { logger } from '../../common/logger';
import type {
  TimePortfolioSummary,
  TimePortfolioSettings,
  WeeklyPortfolioSlice,
  PortfolioImbalanceWarning,
  MeetingDefinition,
} from '../../types/smart-meetings';

export interface CalendarEvent {
  subject: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: Array<{ emailAddress?: { address?: string } }>;
  recurrence?: unknown;
}

/**
 * Return the Monday (00:00 local) of the week containing `date`.
 * Uses simple arithmetic rather than a library to keep dependencies minimal.
 */
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  // getDay(): 0=Sun, 1=Mon, … 6=Sat
  const dayOfWeek = d.getDay();
  // Days since Monday (treating Sunday as 6)
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Format a Date as YYYY-MM-DD using local time components.
 */
function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse "HH:MM" → total minutes from midnight.
 */
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Count the number of working days in the Mon–Sun week starting at `monday`
 * that appear in `workingDays`.
 */
/**
 * All seven day names in Mon–Sun order. Saturday and sunday are never in
 * DayOfWeek but we need them for index-based day-of-week arithmetic.
 * We use `string` here to avoid a type mismatch when indexing DAY_NAMES
 * against the DayOfWeek union (which only covers Mon–Fri).
 */
const DAY_NAMES: string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

function countWorkingDaysInWeek(
  workingDays: TimePortfolioSettings['workingDays']
): number {
  const workingSet = new Set<string>(workingDays);
  let count = 0;
  for (const name of DAY_NAMES) {
    if (workingSet.has(name)) {
      count++;
    }
  }
  return count;
}

/**
 * Classify a single calendar event into one of: recurring, focus, adHoc.
 * Returns the event duration in minutes (clamped to working hours), plus
 * the classification.
 */
function classifyEvent(
  event: CalendarEvent,
  meetingTitles: string[],
  focusKeywords: string[],
  workingStartMins: number,
  workingEndMins: number,
  workingDaysSet: Set<string>
): { category: 'recurring' | 'focus' | 'adHoc'; durationMins: number } | null {
  const startDt = new Date(event.start.dateTime);
  const endDt = new Date(event.end.dateTime);

  if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
    return null;
  }

  // Determine which working day this falls on
  const dayIndex = (startDt.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const dayName = DAY_NAMES[dayIndex];
  if (!workingDaysSet.has(dayName)) {
    return null;
  }

  // Clamp event to the working hours window
  const eventStartMins = startDt.getHours() * 60 + startDt.getMinutes();
  const eventEndMins = endDt.getHours() * 60 + endDt.getMinutes();

  const clampedStart = Math.max(eventStartMins, workingStartMins);
  const clampedEnd = Math.min(eventEndMins, workingEndMins);
  const durationMins = Math.max(0, clampedEnd - clampedStart);

  if (durationMins === 0) {
    return null;
  }

  const subjectLower = event.subject.toLowerCase();

  // Recurring: event has a recurrence property, OR its title matches a managed meeting
  const isRecurring =
    event.recurrence !== undefined ||
    meetingTitles.some(title => subjectLower.includes(title.toLowerCase()));

  // Focus: no attendees, OR subject contains a focus keyword
  const hasAttendees =
    event.attendees !== undefined && event.attendees.length > 0;
  const hasFocusKeyword = focusKeywords.some(kw =>
    subjectLower.includes(kw.toLowerCase())
  );
  const isFocus = !hasAttendees || hasFocusKeyword;

  // Category precedence: recurring > focus > adHoc
  let category: 'recurring' | 'focus' | 'adHoc';
  if (isRecurring) {
    category = 'recurring';
  } else if (isFocus) {
    category = 'focus';
  } else {
    category = 'adHoc';
  }

  return { category, durationMins };
}

/**
 * Build a WeeklyPortfolioSlice for the Mon–Sun week starting at `monday`.
 */
function buildWeekSlice(
  monday: Date,
  events: CalendarEvent[],
  meetings: MeetingDefinition[],
  settings: TimePortfolioSettings
): WeeklyPortfolioSlice {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const workingStartMins = parseHHMM(settings.workingHoursStart);
  const workingEndMins = parseHHMM(settings.workingHoursEnd);
  const workingDayMins = Math.max(0, workingEndMins - workingStartMins);

  const workingDayCount = countWorkingDaysInWeek(settings.workingDays);
  const workingMins = workingDayMins * workingDayCount;

  const meetingTitles = meetings.map(m => m.title);
  const workingDaysSet = new Set<string>(settings.workingDays);

  let recurringMins = 0;
  let adHocMins = 0;
  let bookedFocusMins = 0;

  for (const event of events) {
    const startDt = new Date(event.start.dateTime);
    if (isNaN(startDt.getTime())) continue;
    // Only events within this week
    if (startDt < monday || startDt > sunday) continue;

    const result = classifyEvent(
      event,
      meetingTitles,
      settings.focusKeywords,
      workingStartMins,
      workingEndMins,
      workingDaysSet
    );
    if (result === null) continue;

    switch (result.category) {
      case 'recurring':
        recurringMins += result.durationMins;
        break;
      case 'focus':
        bookedFocusMins += result.durationMins;
        break;
      case 'adHoc':
        adHocMins += result.durationMins;
        break;
    }
  }

  // Unbooked time counts as focus
  const unbookedMins = Math.max(
    0,
    workingMins - recurringMins - adHocMins - bookedFocusMins
  );
  const focusMins = bookedFocusMins + unbookedMins;

  // Calculate percentages
  const recurringPct =
    workingMins > 0 ? Math.round((recurringMins / workingMins) * 100) : 0;
  const adHocPct =
    workingMins > 0 ? Math.round((adHocMins / workingMins) * 100) : 0;
  const focusPct =
    workingMins > 0 ? Math.round((focusMins / workingMins) * 100) : 0;

  return {
    weekStart: toISODate(monday),
    focusPct,
    recurringPct,
    adHocPct,
    focusMins,
    recurringMins,
    adHocMins,
    workingMins,
  };
}

type TrendDirection = 'improving' | 'stable' | 'worsening';

/**
 * Derive trend direction for a single category.
 * For focus: higher % is better (increasing = improving).
 * For recurring/adHoc: lower % is better (decreasing = improving).
 */
function calcTrend(
  category: 'focus' | 'recurring' | 'adHoc',
  lastWeekPct: number,
  thisWeekPct: number
): TrendDirection {
  const diff = thisWeekPct - lastWeekPct;
  if (Math.abs(diff) <= 3) return 'stable';

  // For focus: more is better → increasing diff is improving
  // For recurring/adHoc: less is better → decreasing diff is improving
  const higherIsBetter = category === 'focus';
  if (higherIsBetter) {
    return diff > 3 ? 'improving' : 'worsening';
  } else {
    return diff > 3 ? 'worsening' : 'improving';
  }
}

/**
 * Build imbalance warnings for the current week.
 * A warning is raised for each category whose thisWeek percentage exceeds
 * settings.imbalanceThresholdPct.
 */
function buildWarnings(
  thisWeek: WeeklyPortfolioSlice,
  settings: TimePortfolioSettings
): PortfolioImbalanceWarning[] {
  const warnings: PortfolioImbalanceWarning[] = [];
  const threshold = settings.imbalanceThresholdPct;

  const categories: Array<{
    key: 'focus' | 'recurring' | 'adHoc';
    pct: number;
    label: string;
  }> = [
    { key: 'focus', pct: thisWeek.focusPct, label: 'Focus' },
    { key: 'recurring', pct: thisWeek.recurringPct, label: 'Recurring meetings' },
    { key: 'adHoc', pct: thisWeek.adHocPct, label: 'Ad-hoc meetings' },
  ];

  for (const { key, pct, label } of categories) {
    if (pct > threshold) {
      warnings.push({
        warningType: 'imbalance',
        category: key,
        consecutiveWeeks: 1,
        thresholdPct: threshold,
        message: `${label} time (${pct}%) exceeds the ${threshold}% imbalance threshold this week.`,
      });
    }
  }

  return warnings;
}

/**
 * Calculate a TimePortfolioSummary from pre-fetched calendar events.
 *
 * @param events  Calendar events (covering at least the past two weeks)
 * @param meetings Managed meeting definitions (used for title matching)
 * @param settings Time portfolio settings from SmartMeetingsConfig
 * @param now     Reference point for "current week" (defaults to new Date())
 */
export function calcTimePortfolio(
  events: CalendarEvent[],
  meetings: MeetingDefinition[],
  settings: TimePortfolioSettings,
  now: Date = new Date()
): TimePortfolioSummary {
  const thisMonday = getMondayOf(now);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  logger.debug({
    operation: 'calc_time_portfolio',
    thisWeekStart: toISODate(thisMonday),
    lastWeekStart: toISODate(lastMonday),
    eventCount: events.length,
    message: 'Calculating time portfolio',
  });

  const thisWeek = buildWeekSlice(thisMonday, events, meetings, settings);
  const lastWeek = buildWeekSlice(lastMonday, events, meetings, settings);

  const trend = {
    focus: calcTrend('focus', lastWeek.focusPct, thisWeek.focusPct),
    recurring: calcTrend('recurring', lastWeek.recurringPct, thisWeek.recurringPct),
    adHoc: calcTrend('adHoc', lastWeek.adHocPct, thisWeek.adHocPct),
  };

  const warnings = buildWarnings(thisWeek, settings);

  logger.debug({
    operation: 'calc_time_portfolio_done',
    thisWeekFocusPct: thisWeek.focusPct,
    thisWeekRecurringPct: thisWeek.recurringPct,
    thisWeekAdHocPct: thisWeek.adHocPct,
    warningCount: warnings.length,
    message: 'Time portfolio calculated',
  });

  return { thisWeek, lastWeek, trend, warnings };
}
