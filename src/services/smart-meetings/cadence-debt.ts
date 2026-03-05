/**
 * Cadence debt calculation for managed meetings.
 *
 * debtDays = daysSinceLastOccurrence - expectedCadenceDays
 * Positive debt means the meeting is overdue.
 */

import type { MeetingDefinition, CadenceDebt } from '../../types/smart-meetings';
import { CADENCE_DAYS } from '../../types/smart-meetings';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Derive the target scheduling horizon in days from the debt level.
 *
 *   null debt (no history)  → 21
 *   debtDays ≤ 0            → 21
 *   debtDays 1–6            → 14
 *   debtDays 7–13           → 7
 *   debtDays ≥ 14           → 2
 */
function targetHorizonFromDebt(debtDays: number | null): number {
  if (debtDays === null || debtDays <= 0) return 21;
  if (debtDays <= 6) return 14;
  if (debtDays <= 13) return 7;
  return 2;
}

/**
 * Calculate cadence debt for a single meeting definition.
 *
 * Finds the most recent history entry with status 'occurred' or 'scheduled'.
 * If both share the same date, 'occurred' is preferred.
 */
export function calculateCadenceDebt(
  meeting: MeetingDefinition,
  now: Date = new Date()
): CadenceDebt {
  const expectedCadenceDays = CADENCE_DAYS[meeting.cadence.frequency];

  // Find most recent relevant history entry.
  // 'occurred' is preferred over 'scheduled' on the same date.
  const relevant = meeting.history
    .filter(h => h.status === 'occurred' || h.status === 'scheduled')
    .sort((a, b) => {
      if (a.date !== b.date) {
        // Most recent date first
        return b.date.localeCompare(a.date);
      }
      // Same date: prefer 'occurred' (sort it first)
      if (a.status === 'occurred' && b.status !== 'occurred') return -1;
      if (b.status === 'occurred' && a.status !== 'occurred') return 1;
      return 0;
    });

  const latest = relevant[0] ?? null;

  let daysSinceLastOccurrence: number | null = null;
  let lastOccurrenceDate: string | null = null;

  if (latest !== null) {
    lastOccurrenceDate = latest.date;
    const lastDate = new Date(latest.date);
    daysSinceLastOccurrence = Math.floor(
      (now.getTime() - lastDate.getTime()) / MS_PER_DAY
    );
  }

  const debtDays =
    daysSinceLastOccurrence === null
      ? null
      : daysSinceLastOccurrence - expectedCadenceDays;

  const targetHorizonDays = targetHorizonFromDebt(debtDays);

  return {
    meetingId: meeting.id,
    daysSinceLastOccurrence,
    expectedCadenceDays,
    debtDays,
    targetHorizonDays,
    lastOccurrenceDate,
  };
}

/**
 * Sort a list of meeting definitions by cadence debt descending (most overdue first).
 * Meetings with null debt are treated as 0 for sorting purposes (nulls last).
 * Returns a new array; the input is not mutated.
 */
export function sortByDebtDesc(
  meetings: MeetingDefinition[],
  now: Date = new Date()
): MeetingDefinition[] {
  return [...meetings].sort((a, b) => {
    const debtA = calculateCadenceDebt(a, now).debtDays ?? 0;
    const debtB = calculateCadenceDebt(b, now).debtDays ?? 0;
    return debtB - debtA;
  });
}
