/**
 * Unit tests for SmartMeetingSchedulerTask (Feature 023)
 * Covers forward-scheduling (T021) and rebalance (T022) phases
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SmartMeetingSchedulerTask } from '../../../../../src/services/heartbeat/tasks/smart-meeting-scheduler-task';
import { createPortfolioRef } from '../../../../../src/services/smart-meetings/portfolio-ref';
import type { SmartMeetingsConfig } from '../../../../../src/types/smart-meetings';
import type { TaskConfig } from '../../../../../src/types/heartbeat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(
  meetings: SmartMeetingsConfig['meetings'] = []
): SmartMeetingsConfig {
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
    meetings,
  };
}

function makeTaskConfig(
  phase: 'forward-scheduling' | 'rebalance',
  configPath: string
): TaskConfig {
  return {
    id: `smart-meeting-${phase}`,
    name: `Smart Meeting Scheduler (${phase})`,
    type: 'smart-meeting-scheduler',
    schedule: '0 8 * * *',
    enabled: true,
    config: {
      phase,
      configPath,
    },
  };
}

/** ISO string for N days from now */
function isoInDays(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

/** ISO string for N hours from now */
function isoInHours(n: number): string {
  return new Date(Date.now() + n * 60 * 60 * 1000).toISOString();
}

// ─── Shared meeting definitions ────────────────────────────────────────────────

function makeOnScheduleMeeting(): SmartMeetingsConfig['meetings'][0] {
  const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  const dateStr = recentDate.toISOString().slice(0, 10);
  return {
    id: 'alice-121',
    title: 'Alice 1-2-1',
    attendees: ['alice@example.com'],
    durationMinutes: 30,
    cadence: { frequency: 'weekly', idealDays: ['tuesday'] },
    window: { days: 21, startTime: '09:00', endTime: '17:00' },
    history: [
      {
        date: dateStr,
        dayOfWeek: 'wednesday',
        startTime: '10:00',
        status: 'occurred',
      },
    ],
    enabled: true,
  };
}

function makeOverdueMeeting(): SmartMeetingsConfig['meetings'][0] {
  // 25 days ago → weekly debt = 18 (very overdue)
  const overdueDate = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const dateStr = overdueDate.toISOString().slice(0, 10);
  return {
    id: 'bob-121',
    title: 'Bob 1-2-1',
    attendees: ['bob@example.com'],
    durationMinutes: 30,
    cadence: { frequency: 'weekly', idealDays: ['thursday'] },
    window: { days: 14, startTime: '10:00', endTime: '16:00' },
    history: [
      {
        date: dateStr,
        dayOfWeek: 'thursday',
        startTime: '14:00',
        status: 'occurred',
      },
    ],
    enabled: true,
  };
}

// ─── Mock Microsoft Service factory ───────────────────────────────────────────

function makeMockMicrosoftService(overrides: Record<string, jest.Mock> = {}) {
  const slotStart = isoInDays(14);
  const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

  return {
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
    createEvent: jest.fn().mockResolvedValue({ id: 'new-event-id' }),
    deleteEvent: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

// ─── T021: Forward-scheduling phase ──────────────────────────────────────────

describe('SmartMeetingSchedulerTask — forward-scheduling phase (T021)', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sm-fwd-test-${Date.now()}`);
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

  it('creates an event when no matching event exists in the look-ahead window', async () => {
    const config = makeConfig([makeOnScheduleMeeting()]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const mockMs = makeMockMicrosoftService();
    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    expect(mockMs.createEvent).toHaveBeenCalledTimes(1);
    expect(mockMs.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Alice 1-2-1',
        attendees: ['alice@example.com'],
      })
    );
  });

  it('does NOT call createEvent when a matching event already exists (idempotency)', async () => {
    const meeting = makeOnScheduleMeeting();
    const config = makeConfig([meeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Simulate a pre-existing matching event in the calendar
    const existingEvent = {
      id: 'existing-event-id',
      subject: 'Alice 1-2-1',
      start: { dateTime: isoInDays(10) },
      end: { dateTime: isoInDays(10) },
      attendees: [{ emailAddress: { address: 'alice@example.com' } }],
    };

    const mockMs = makeMockMicrosoftService({
      listEvents: jest.fn().mockResolvedValue({ events: [existingEvent] }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    expect(mockMs.createEvent).not.toHaveBeenCalled();
  });

  it('processes meetings with higher debt before on-schedule meetings', async () => {
    const config = makeConfig([makeOnScheduleMeeting(), makeOverdueMeeting()]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const createOrder: string[] = [];
    const mockMs = makeMockMicrosoftService({
      createEvent: jest.fn().mockImplementation(async (args: any) => {
        createOrder.push(args.subject);
        return { id: `event-${args.subject}` };
      }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    // Bob (overdue, 18 days debt) should be scheduled before Alice (3 days debt, on schedule)
    expect(createOrder[0]).toBe('Bob 1-2-1');
    expect(createOrder[1]).toBe('Alice 1-2-1');
  });

  it('saves updated config after scheduling', async () => {
    const config = makeConfig([makeOnScheduleMeeting()]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const mockMs = makeMockMicrosoftService();
    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    // Read back saved config and verify history was updated
    const savedRaw = await fs.readFile(configPath, 'utf-8');
    const saved = JSON.parse(savedRaw) as SmartMeetingsConfig;
    const aliceMeeting = saved.meetings.find(m => m.id === 'alice-121');

    expect(aliceMeeting).toBeDefined();
    // Should have original history entry + new 'scheduled' entry
    const scheduledEntries = aliceMeeting!.history.filter(h => h.status === 'scheduled');
    expect(scheduledEntries).toHaveLength(1);
  });

  it('skips a meeting when findMeetingTimes returns no suggestions', async () => {
    const config = makeConfig([makeOnScheduleMeeting()]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const mockMs = makeMockMicrosoftService({
      findMeetingTimes: jest.fn().mockResolvedValue({ suggestions: [] }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    expect(mockMs.createEvent).not.toHaveBeenCalled();
  });

  it('does not schedule disabled meetings', async () => {
    const disabledMeeting = { ...makeOnScheduleMeeting(), enabled: false };
    const config = makeConfig([disabledMeeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const mockMs = makeMockMicrosoftService();
    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('forward-scheduling', configPath));

    expect(mockMs.createEvent).not.toHaveBeenCalled();
  });
});

// ─── T022: Rebalance phase ────────────────────────────────────────────────────

describe('SmartMeetingSchedulerTask — rebalance phase (T022)', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sm-rebal-test-${Date.now()}`);
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

  it('moves a conflicting meeting when it is >48h away', async () => {
    const meeting = makeOnScheduleMeeting();
    const config = makeConfig([meeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // The managed meeting is in 72h — well outside the 48h protection window
    const managedEventStart = isoInHours(72);
    const managedEventEnd = new Date(new Date(managedEventStart).getTime() + 30 * 60 * 1000).toISOString();

    // A conflicting event at the same time
    const conflictEventStart = managedEventStart;
    const conflictEventEnd = managedEventEnd;

    const managedEvent = {
      id: 'managed-event-id',
      subject: 'Alice 1-2-1',
      start: { dateTime: managedEventStart },
      end: { dateTime: managedEventEnd },
      attendees: [{ emailAddress: { address: 'alice@example.com' } }],
    };

    const conflictEvent = {
      id: 'conflict-event-id',
      subject: 'Another Meeting',
      start: { dateTime: conflictEventStart },
      end: { dateTime: conflictEventEnd },
      attendees: [],
    };

    const newSlotStart = isoInDays(10);
    const newSlotEnd = new Date(new Date(newSlotStart).getTime() + 30 * 60 * 1000).toISOString();

    const mockMs = makeMockMicrosoftService({
      listEvents: jest.fn().mockResolvedValue({ events: [managedEvent, conflictEvent] }),
      findMeetingTimes: jest.fn().mockResolvedValue({
        suggestions: [{ timeSlot: { start: newSlotStart, end: newSlotEnd } }],
      }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('rebalance', configPath));

    expect(mockMs.deleteEvent).toHaveBeenCalledWith({ eventId: 'managed-event-id' });
    expect(mockMs.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Alice 1-2-1',
        startDateTime: newSlotStart,
      })
    );
  });

  it('does NOT move a meeting that is within 48h (48h protection)', async () => {
    const meeting = makeOnScheduleMeeting();
    const config = makeConfig([meeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // The managed meeting is only 24h away — inside the 48h protection window
    const managedEventStart = isoInHours(24);
    const managedEventEnd = new Date(new Date(managedEventStart).getTime() + 30 * 60 * 1000).toISOString();

    const conflictEventStart = managedEventStart;
    const conflictEventEnd = managedEventEnd;

    const managedEvent = {
      id: 'managed-event-id',
      subject: 'Alice 1-2-1',
      start: { dateTime: managedEventStart },
      end: { dateTime: managedEventEnd },
      attendees: [{ emailAddress: { address: 'alice@example.com' } }],
    };

    const conflictEvent = {
      id: 'conflict-event-id',
      subject: 'Last Minute Call',
      start: { dateTime: conflictEventStart },
      end: { dateTime: conflictEventEnd },
      attendees: [],
    };

    const mockMs = makeMockMicrosoftService({
      listEvents: jest.fn().mockResolvedValue({ events: [managedEvent, conflictEvent] }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('rebalance', configPath));

    // Should NOT have tried to move the meeting
    expect(mockMs.deleteEvent).not.toHaveBeenCalled();
    expect(mockMs.createEvent).not.toHaveBeenCalled();
  });

  it('does not produce cascading reschedules (max 1 reschedule per meeting per run)', async () => {
    const meeting = makeOnScheduleMeeting();
    const config = makeConfig([meeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const managedEventStart = isoInHours(72);
    const managedEventEnd = new Date(new Date(managedEventStart).getTime() + 30 * 60 * 1000).toISOString();
    const conflictEventStart = managedEventStart;
    const conflictEventEnd = managedEventEnd;

    const managedEvent = {
      id: 'managed-event-id',
      subject: 'Alice 1-2-1',
      start: { dateTime: managedEventStart },
      end: { dateTime: managedEventEnd },
      attendees: [{ emailAddress: { address: 'alice@example.com' } }],
    };

    const conflictEvent = {
      id: 'conflict-event-id',
      subject: 'Blocker',
      start: { dateTime: conflictEventStart },
      end: { dateTime: conflictEventEnd },
      attendees: [],
    };

    const newSlotStart = isoInDays(10);
    const newSlotEnd = new Date(new Date(newSlotStart).getTime() + 30 * 60 * 1000).toISOString();

    const mockMs = makeMockMicrosoftService({
      listEvents: jest.fn().mockResolvedValue({ events: [managedEvent, conflictEvent] }),
      findMeetingTimes: jest.fn().mockResolvedValue({
        suggestions: [{ timeSlot: { start: newSlotStart, end: newSlotEnd } }],
      }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('rebalance', configPath));

    // Should only call deleteEvent and createEvent once per meeting
    expect(mockMs.deleteEvent).toHaveBeenCalledTimes(1);
    expect(mockMs.createEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves a meeting in place when no alternative slot is found', async () => {
    const meeting = makeOnScheduleMeeting();
    const config = makeConfig([meeting]);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const managedEventStart = isoInHours(72);
    const managedEventEnd = new Date(new Date(managedEventStart).getTime() + 30 * 60 * 1000).toISOString();
    const conflictEventStart = managedEventStart;
    const conflictEventEnd = managedEventEnd;

    const managedEvent = {
      id: 'managed-event-id',
      subject: 'Alice 1-2-1',
      start: { dateTime: managedEventStart },
      end: { dateTime: managedEventEnd },
      attendees: [{ emailAddress: { address: 'alice@example.com' } }],
    };

    const conflictEvent = {
      id: 'conflict-event-id',
      subject: 'Blocker',
      start: { dateTime: conflictEventStart },
      end: { dateTime: conflictEventEnd },
      attendees: [],
    };

    const mockMs = makeMockMicrosoftService({
      listEvents: jest.fn().mockResolvedValue({ events: [managedEvent, conflictEvent] }),
      findMeetingTimes: jest.fn().mockResolvedValue({ suggestions: [] }),
    });

    const portfolioRef = createPortfolioRef();
    const task = new SmartMeetingSchedulerTask(mockMs, portfolioRef);

    await task.execute(makeTaskConfig('rebalance', configPath));

    // Should not delete or recreate
    expect(mockMs.deleteEvent).not.toHaveBeenCalled();
    expect(mockMs.createEvent).not.toHaveBeenCalled();
  });
});
