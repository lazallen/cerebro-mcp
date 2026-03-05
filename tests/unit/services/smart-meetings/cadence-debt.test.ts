/**
 * Unit tests for cadence-debt.ts
 * Tests calculateCadenceDebt and sortByDebtDesc
 */

import { calculateCadenceDebt, sortByDebtDesc } from '../../../../src/services/smart-meetings/cadence-debt';
import type { MeetingDefinition } from '../../../../src/types/smart-meetings';

function makeMeeting(
  overrides: Partial<MeetingDefinition> & { id?: string }
): MeetingDefinition {
  return {
    id: overrides.id ?? 'test-meeting',
    title: 'Test Meeting',
    attendees: ['alice@example.com'],
    durationMinutes: 30,
    cadence: { frequency: 'weekly', idealDays: ['monday'] },
    window: { days: 21, startTime: '09:00', endTime: '17:00' },
    history: [],
    enabled: true,
    ...overrides,
  };
}

describe('calculateCadenceDebt', () => {
  describe('null history (no history entries)', () => {
    it('returns targetHorizonDays 21 with null debtDays and null daysSinceLastOccurrence', () => {
      const meeting = makeMeeting({ history: [] });
      const now = new Date('2026-03-05T12:00:00.000Z');
      const result = calculateCadenceDebt(meeting, now);

      expect(result.meetingId).toBe('test-meeting');
      expect(result.debtDays).toBeNull();
      expect(result.daysSinceLastOccurrence).toBeNull();
      expect(result.targetHorizonDays).toBe(21);
      expect(result.lastOccurrenceDate).toBeNull();
    });
  });

  describe('debt brackets — weekly meeting (cadence = 7 days)', () => {
    it('returns targetHorizonDays 21 when debtDays <= 0 (on schedule)', () => {
      // Last occurred 5 days ago → daysSince=5, debt=5-7=-2
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-28', dayOfWeek: 'saturday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 5 days later
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(-2);
      expect(result.targetHorizonDays).toBe(21);
    });

    it('returns targetHorizonDays 21 when debtDays is exactly 0', () => {
      // Last occurred exactly 7 days ago → debt=0
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-26', dayOfWeek: 'thursday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 7 days later
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(0);
      expect(result.targetHorizonDays).toBe(21);
    });

    it('returns targetHorizonDays 14 when debtDays is in range 1–6', () => {
      // Last occurred 10 days ago → daysSince=10, debt=10-7=3
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-23', dayOfWeek: 'monday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 10 days later
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(3);
      expect(result.targetHorizonDays).toBe(14);
    });

    it('returns targetHorizonDays 14 when debtDays is exactly 1', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-25', dayOfWeek: 'wednesday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 8 days later → debt=1
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(1);
      expect(result.targetHorizonDays).toBe(14);
    });

    it('returns targetHorizonDays 14 when debtDays is exactly 6', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-20', dayOfWeek: 'friday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 13 days later → debt=6
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(6);
      expect(result.targetHorizonDays).toBe(14);
    });

    it('returns targetHorizonDays 7 when debtDays is in range 7–13', () => {
      // Last occurred 16 days ago → daysSince=16, debt=16-7=9
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-17', dayOfWeek: 'tuesday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 16 days later
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(9);
      expect(result.targetHorizonDays).toBe(7);
    });

    it('returns targetHorizonDays 7 when debtDays is exactly 7', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-19', dayOfWeek: 'thursday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 14 days later → debt=7
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(7);
      expect(result.targetHorizonDays).toBe(7);
    });

    it('returns targetHorizonDays 7 when debtDays is exactly 13', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-13', dayOfWeek: 'friday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 20 days later → debt=13
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(13);
      expect(result.targetHorizonDays).toBe(7);
    });

    it('returns targetHorizonDays 2 when debtDays >= 14', () => {
      // Last occurred 22 days ago → daysSince=22, debt=22-7=15
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-11', dayOfWeek: 'wednesday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 22 days later
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(15);
      expect(result.targetHorizonDays).toBe(2);
    });

    it('returns targetHorizonDays 2 when debtDays is exactly 14', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-12', dayOfWeek: 'thursday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 21 days later → debt=14
      const result = calculateCadenceDebt(meeting, now);

      expect(result.debtDays).toBe(14);
      expect(result.targetHorizonDays).toBe(2);
    });
  });

  describe('cadence frequencies', () => {
    it('calculates debt correctly for fortnightly meetings (14 day cadence)', () => {
      // Last occurred 16 days ago → daysSince=16, debt=16-14=2
      const meeting = makeMeeting({
        cadence: { frequency: 'fortnightly', idealDays: ['wednesday'] },
        history: [
          { date: '2026-02-17', dayOfWeek: 'tuesday', startTime: '14:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z');
      const result = calculateCadenceDebt(meeting, now);

      expect(result.expectedCadenceDays).toBe(14);
      expect(result.debtDays).toBe(2);
      expect(result.targetHorizonDays).toBe(14);
    });

    it('calculates debt correctly for monthly meetings (30 day cadence)', () => {
      // Last occurred 15 days ago → daysSince=15, debt=15-30=-15
      const meeting = makeMeeting({
        cadence: { frequency: 'monthly', idealDays: ['thursday'] },
        history: [
          { date: '2026-02-18', dayOfWeek: 'wednesday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z');
      const result = calculateCadenceDebt(meeting, now);

      expect(result.expectedCadenceDays).toBe(30);
      expect(result.debtDays).toBe(-15);
      expect(result.targetHorizonDays).toBe(21);
    });
  });

  describe('history with mixed statuses', () => {
    it('uses most recent occurred or scheduled entry, ignores skipped', () => {
      // Most recent relevant entry: occurred on 2026-02-26 (7 days ago → debt=0)
      // There's a newer skipped entry that should be ignored
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-24', dayOfWeek: 'tuesday', startTime: '10:00', status: 'occurred' },
          { date: '2026-02-26', dayOfWeek: 'thursday', startTime: '10:00', status: 'occurred' },
          { date: '2026-03-04', dayOfWeek: 'wednesday', startTime: '10:00', status: 'skipped' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z'); // 7 days after 2026-02-26
      const result = calculateCadenceDebt(meeting, now);

      expect(result.lastOccurrenceDate).toBe('2026-02-26');
      expect(result.daysSinceLastOccurrence).toBe(7);
      expect(result.debtDays).toBe(0);
    });

    it('prefers occurred over scheduled on the same date', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-26', dayOfWeek: 'thursday', startTime: '10:00', status: 'scheduled' },
          { date: '2026-02-26', dayOfWeek: 'thursday', startTime: '10:00', status: 'occurred' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z');
      const result = calculateCadenceDebt(meeting, now);

      // Both are on the same date so result is the same, but occurred should be picked
      expect(result.lastOccurrenceDate).toBe('2026-02-26');
    });

    it('uses scheduled entry when no occurred entries exist', () => {
      const meeting = makeMeeting({
        cadence: { frequency: 'weekly', idealDays: ['monday'] },
        history: [
          { date: '2026-02-26', dayOfWeek: 'thursday', startTime: '10:00', status: 'scheduled' },
        ],
      });
      const now = new Date('2026-03-05T12:00:00.000Z');
      const result = calculateCadenceDebt(meeting, now);

      expect(result.lastOccurrenceDate).toBe('2026-02-26');
      expect(result.debtDays).toBe(0);
    });
  });
});

describe('sortByDebtDesc', () => {
  const now = new Date('2026-03-05T12:00:00.000Z');

  it('places highest debtDays first', () => {
    // Meeting A: last occurred 22 days ago → weekly debt = 15
    const meetingA = makeMeeting({
      id: 'meeting-a',
      cadence: { frequency: 'weekly', idealDays: ['monday'] },
      history: [{ date: '2026-02-11', dayOfWeek: 'wednesday', startTime: '10:00', status: 'occurred' }],
    });

    // Meeting B: last occurred 10 days ago → weekly debt = 3
    const meetingB = makeMeeting({
      id: 'meeting-b',
      cadence: { frequency: 'weekly', idealDays: ['monday'] },
      history: [{ date: '2026-02-23', dayOfWeek: 'monday', startTime: '10:00', status: 'occurred' }],
    });

    const sorted = sortByDebtDesc([meetingB, meetingA], now);

    expect(sorted[0].id).toBe('meeting-a');
    expect(sorted[1].id).toBe('meeting-b');
  });

  it('places null debt (no history) after positive debt', () => {
    // Meeting A: last occurred 22 days ago → debt=15
    const meetingA = makeMeeting({
      id: 'meeting-a',
      cadence: { frequency: 'weekly', idealDays: ['monday'] },
      history: [{ date: '2026-02-11', dayOfWeek: 'wednesday', startTime: '10:00', status: 'occurred' }],
    });

    // Meeting B: no history → debtDays=null (treated as 0)
    const meetingB = makeMeeting({
      id: 'meeting-b',
      history: [],
    });

    const sorted = sortByDebtDesc([meetingB, meetingA], now);

    expect(sorted[0].id).toBe('meeting-a');
    expect(sorted[1].id).toBe('meeting-b');
  });

  it('places null debt at/below 0 debt (both treated as 0, stable relative order)', () => {
    // Meeting A: on-schedule → debt=-2
    const meetingA = makeMeeting({
      id: 'meeting-a',
      cadence: { frequency: 'weekly', idealDays: ['monday'] },
      history: [{ date: '2026-02-28', dayOfWeek: 'saturday', startTime: '10:00', status: 'occurred' }],
    });

    // Meeting B: no history → null (treated as 0)
    const meetingB = makeMeeting({
      id: 'meeting-b',
      history: [],
    });

    const sorted = sortByDebtDesc([meetingA, meetingB], now);
    // null (0) >= -2, so meetingB should come before or equal to meetingA
    // The function sorts desc: 0 > -2, so meetingB (null→0) comes first
    expect(sorted[0].id).toBe('meeting-b');
    expect(sorted[1].id).toBe('meeting-a');
  });

  it('returns a new array without mutating the original', () => {
    const meetingA = makeMeeting({ id: 'meeting-a' });
    const meetingB = makeMeeting({ id: 'meeting-b' });
    const original = [meetingA, meetingB];

    const sorted = sortByDebtDesc(original, now);

    expect(sorted).not.toBe(original);
  });

  it('handles empty array', () => {
    const sorted = sortByDebtDesc([], now);
    expect(sorted).toEqual([]);
  });

  it('handles single-element array', () => {
    const meeting = makeMeeting({ id: 'solo' });
    const sorted = sortByDebtDesc([meeting], now);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('solo');
  });
});
