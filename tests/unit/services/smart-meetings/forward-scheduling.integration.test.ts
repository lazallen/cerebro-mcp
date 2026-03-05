/**
 * Integration smoke test for forward-scheduling phase (T023)
 * Uses a mock MicrosoftService with an empty calendar.
 * Verifies that createEvent is called exactly once and that
 * the scheduled date is approximately 21 days out from now.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SmartMeetingSchedulerTask } from '../../../../src/services/heartbeat/tasks/smart-meeting-scheduler-task';
import { createPortfolioRef } from '../../../../src/services/smart-meetings/portfolio-ref';
import type { SmartMeetingsConfig } from '../../../../src/types/smart-meetings';
import type { TaskConfig } from '../../../../src/types/heartbeat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaskConfig(configPath: string): TaskConfig {
  return {
    id: 'smart-meeting-forward',
    name: 'Smart Meeting Scheduler (forward-scheduling)',
    type: 'smart-meeting-scheduler',
    schedule: '0 8 * * *',
    enabled: true,
    config: {
      phase: 'forward-scheduling',
      configPath,
    },
  };
}

function makeSmartMeetingsConfig(): SmartMeetingsConfig {
  return {
    version: 1,
    settings: {
      lookAheadDays: 21,
      minNoticePeriodHours: 48,
      timezone: 'Europe/London',
      historyRetentionCount: 10,
      rebalanceCadence: '0 8 * * 1',
      timePortfolio: {
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        imbalanceThresholdPct: 50,
        imbalanceWindowWeeks: 2,
        focusKeywords: ['focus'],
      },
    },
    meetings: [
      {
        id: 'carol-121',
        title: 'Carol 1-2-1',
        attendees: ['carol@example.com'],
        durationMinutes: 30,
        cadence: { frequency: 'weekly', idealDays: ['wednesday'] },
        window: { days: 21, startTime: '09:00', endTime: '17:00' },
        // No history — brand new meeting (null debt → targetHorizonDays=21)
        history: [],
        enabled: true,
      },
    ],
  };
}

// ─── Integration smoke test ───────────────────────────────────────────────────

describe('Forward-scheduling integration smoke test (T023)', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sm-integration-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    configPath = path.join(testDir, 'smart-meetings-config.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('calls createEvent exactly once when calendar is empty', async () => {
    const config = makeSmartMeetingsConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Target date: approximately 21 days out (no debt → targetHorizonDays=21)
    const approxTarget = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const slotStart = approxTarget.toISOString();
    const slotEnd = new Date(approxTarget.getTime() + 30 * 60 * 1000).toISOString();

    const mockMs = {
      // Empty calendar — no existing events
      listEvents: jest.fn().mockResolvedValue({ events: [] }),
      findMeetingTimes: jest.fn().mockResolvedValue({
        suggestions: [
          {
            timeSlot: {
              start: slotStart,
              end: slotEnd,
            },
          },
        ],
      }),
      createEvent: jest.fn().mockResolvedValue({ id: 'created-event-id' }),
      deleteEvent: jest.fn().mockResolvedValue({}),
    };

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig(configPath));

    // createEvent must be called exactly once
    expect(mockMs.createEvent).toHaveBeenCalledTimes(1);

    const callArgs = mockMs.createEvent.mock.calls[0][0] as {
      subject: string;
      startDateTime: string;
      endDateTime: string;
      attendees: string[];
    };

    expect(callArgs.subject).toBe('Carol 1-2-1');
    expect(callArgs.attendees).toEqual(['carol@example.com']);

    // The scheduled date should be approximately 21 days out (±3 days)
    const scheduledDate = new Date(callArgs.startDateTime);
    const now = new Date();
    const daysOut = (scheduledDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

    expect(daysOut).toBeGreaterThanOrEqual(18);
    expect(daysOut).toBeLessThanOrEqual(24);
  });

  it('findMeetingTimes is called with the correct time constraint window', async () => {
    const config = makeSmartMeetingsConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const slotStart = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const slotEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();

    const mockMs = {
      listEvents: jest.fn().mockResolvedValue({ events: [] }),
      findMeetingTimes: jest.fn().mockResolvedValue({
        suggestions: [{ timeSlot: { start: slotStart, end: slotEnd } }],
      }),
      createEvent: jest.fn().mockResolvedValue({ id: 'new-event' }),
      deleteEvent: jest.fn().mockResolvedValue({}),
    };

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig(configPath));

    expect(mockMs.findMeetingTimes).toHaveBeenCalledTimes(1);

    const ftArgs = mockMs.findMeetingTimes.mock.calls[0][0] as {
      attendees: string[];
      meetingDuration: number;
      timeConstraintStart: string;
      timeConstraintEnd: string;
      maxCandidates: number;
    };

    expect(ftArgs.attendees).toEqual(['carol@example.com']);
    expect(ftArgs.meetingDuration).toBe(30);

    // timeConstraintStart should be ~48h from now (minNoticePeriodHours)
    const constraintStart = new Date(ftArgs.timeConstraintStart);
    const hoursUntilStart = (constraintStart.getTime() - Date.now()) / (60 * 60 * 1000);
    expect(hoursUntilStart).toBeGreaterThanOrEqual(47);
    expect(hoursUntilStart).toBeLessThanOrEqual(49);

    // timeConstraintEnd should be ~21 days from now (targetHorizonDays for null debt)
    const constraintEnd = new Date(ftArgs.timeConstraintEnd);
    const daysUntilEnd = (constraintEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilEnd).toBeGreaterThanOrEqual(20);
    expect(daysUntilEnd).toBeLessThanOrEqual(22);
  });
});
