/**
 * Unit tests for SmartMeetingsService
 * Tests smart_meetings_status tool execution
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SmartMeetingsService } from '../../../../src/services/smart-meetings/smart-meetings-service';
import { createPortfolioRef } from '../../../../src/services/smart-meetings/portfolio-ref';
import type { SmartMeetingsConfig } from '../../../../src/types/smart-meetings';

const MOCK_MICROSOFT_SERVICE = {};

function makeMinimalConfig(overrides: Partial<SmartMeetingsConfig> = {}): SmartMeetingsConfig {
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
        id: 'alice-laz-121',
        title: 'Alice 1-2-1',
        attendees: ['alice@example.com'],
        durationMinutes: 30,
        cadence: { frequency: 'fortnightly', idealDays: ['tuesday'] },
        window: { days: 21, startTime: '09:00', endTime: '17:00' },
        history: [
          {
            date: '2026-02-20',
            dayOfWeek: 'friday',
            startTime: '10:00',
            status: 'occurred',
          },
        ],
        enabled: true,
      },
      {
        id: 'bob-laz-121',
        title: 'Bob 1-2-1',
        attendees: ['bob@example.com'],
        durationMinutes: 30,
        cadence: { frequency: 'weekly', idealDays: ['thursday'] },
        window: { days: 14, startTime: '10:00', endTime: '16:00' },
        history: [],
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('SmartMeetingsService', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `sm-test-${Date.now()}`);
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

  describe('smart_meetings_status — basic response shape', () => {
    it('returns isError: false with correct response shape when config exists', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      expect(tool).toBeDefined();

      const result = await tool!.handler({}) as any;

      expect(result.error).toBeUndefined();
      expect(result.generatedAt).toBeDefined();
      expect(result.meetings).toBeDefined();
      expect(Array.isArray(result.meetings)).toBe(true);
      expect(result.meetings).toHaveLength(2);
    });

    it('includes meetingId, title, enabled, cadence, cadenceDebt fields per meeting', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({}) as any;

      const firstMeeting = result.meetings[0];
      expect(firstMeeting.meetingId).toBeDefined();
      expect(firstMeeting.title).toBeDefined();
      expect(typeof firstMeeting.enabled).toBe('boolean');
      expect(firstMeeting.cadence).toBeDefined();
      expect(firstMeeting.cadenceDebt).toBeDefined();
      expect(firstMeeting.attendees).toBeDefined();
    });
  });

  describe('smart_meetings_status — meetingId filter', () => {
    it('returns only the matching meeting when meetingId is passed', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({ meetingId: 'alice-laz-121' }) as any;

      expect(result.meetings).toHaveLength(1);
      expect(result.meetings[0].meetingId).toBe('alice-laz-121');
    });

    it('returns an error when meetingId does not match any meeting', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({ meetingId: 'nonexistent-id' }) as any;

      expect(result.error).toBe(true);
      expect(result.message).toContain('nonexistent-id');
    });
  });

  describe('smart_meetings_status — missing config file', () => {
    it('returns isError: true when config file does not exist', async () => {
      const nonExistentPath = path.join(testDir, 'does-not-exist.json');
      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, nonExistentPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({}) as any;

      expect(result.error).toBe(true);
      expect(result.message).toBeDefined();
    });
  });

  describe('smart_meetings_status — portfolio unavailable', () => {
    it('includes _meta.portfolioUnavailable: true and stale warning when portfolioRef.current is null', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef(); // current is null by default
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({}) as any;

      expect(result.timePortfolio).toBeNull();
      expect(result._meta).toBeDefined();
      expect(result._meta.portfolioUnavailable).toBe(true);
      expect(result._meta.reason).toBeDefined();
      expect(typeof result._meta.reason).toBe('string');
    });

    it('includes timePortfolio data when portfolioRef.current is populated', async () => {
      const config = makeMinimalConfig();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const portfolioRef = createPortfolioRef();
      // Populate with a minimal portfolio summary
      portfolioRef.current = {
        thisWeek: {
          weekStart: '2026-03-02',
          focusPct: 80,
          recurringPct: 10,
          adHocPct: 10,
          focusMins: 1920,
          recurringMins: 240,
          adHocMins: 240,
          workingMins: 2400,
        },
        lastWeek: {
          weekStart: '2026-02-23',
          focusPct: 70,
          recurringPct: 15,
          adHocPct: 15,
          focusMins: 1680,
          recurringMins: 360,
          adHocMins: 360,
          workingMins: 2400,
        },
        trend: { focus: 'improving', recurring: 'stable', adHoc: 'stable' },
        warnings: [],
      };
      portfolioRef.lastUpdated = new Date();

      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);

      const tool = service.getTools().find(t => t.name === 'smart_meetings_status');
      const result = await tool!.handler({}) as any;

      expect(result.timePortfolio).not.toBeNull();
      expect(result.timePortfolio.thisWeek).toBeDefined();
      expect(result._meta).toBeUndefined();
    });
  });

  describe('SmartMeetingsService — service interface', () => {
    it('exposes the smart_meetings_status tool', () => {
      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);
      const tools = service.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('smart_meetings_status');
    });

    it('initializes without throwing', async () => {
      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('isAuthenticated returns true', async () => {
      const portfolioRef = createPortfolioRef();
      const service = new SmartMeetingsService(MOCK_MICROSOFT_SERVICE, configPath, portfolioRef);
      const result = await service.isAuthenticated();
      expect(result).toBe(true);
    });
  });
});
