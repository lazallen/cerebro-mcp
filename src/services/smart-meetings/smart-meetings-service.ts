/**
 * Smart Meetings MCP Service (Feature 023)
 *
 * Exposes the smart_meetings_status tool, which returns the current scheduling
 * state of all configured smart meetings, including cadence debt per meeting
 * and a time portfolio summary.
 */

import { BaseService, ServiceConfig } from '../../types/service';
import { Tool } from '../../types/tool';
import { logger } from '../../common/logger';
import { loadSmartMeetingsConfig } from './config-io';
import { calculateCadenceDebt } from './cadence-debt';
import type { PortfolioRef } from './portfolio-ref';
import type {
  MeetingDefinition,
  MeetingStatus,
  SmartMeetingsStatusResponse,
} from '../../types/smart-meetings';

export class SmartMeetingsService implements BaseService {
  public readonly config: ServiceConfig;
  public readonly name: string;
  private readonly configPath: string;
  private readonly portfolioRef: PortfolioRef;

  constructor(
    // microsoftService reserved for future use (e.g. nextScheduled lookup via Graph API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _microsoftService: any,
    configPath: string,
    portfolioRef: PortfolioRef
  ) {
    this.configPath = configPath;
    this.portfolioRef = portfolioRef;
    this.config = {
      name: 'smart-meetings',
      displayName: 'Smart Meetings',
      apiEndpoint: '',
      oauth: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        scopes: [],
        authEndpoint: '',
        tokenEndpoint: '',
      },
      tokenStorePath: '',
    };
    this.name = this.config.name;
  }

  async initialize(): Promise<void> {
    logger.info({
      operation: 'smart_meetings_service_init',
      configPath: this.configPath,
      msg: 'SmartMeetingsService initialized',
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return true; // File-based; no auth required
  }

  async shutdown(): Promise<void> {}

  getTools(): Tool[] {
    return [
      {
        name: 'smart_meetings_status',
        description:
          'Returns the current scheduling state of all configured smart meetings, ' +
          'including cadence debt per meeting and a time portfolio summary.',
        inputSchema: {
          type: 'object',
          properties: {
            meetingId: {
              type: 'string',
              description:
                'Optional. If provided, returns status for only the specified meeting.',
            },
          },
          required: [],
        },
        handler: this.getStatus.bind(this),
      },
    ];
  }

  private async getStatus(input: Record<string, unknown>): Promise<unknown> {
    // Load config
    let config;
    try {
      config = await loadSmartMeetingsConfig(this.configPath);
    } catch (err) {
      const isNotFound =
        err instanceof Error && err.message.includes('not found');
      if (isNotFound) {
        const msg =
          `Error: smart-meetings-config.json not found at ${this.configPath}. ` +
          `Create the config file to use smart meeting scheduling.`;
        logger.warn({
          operation: 'smart_meetings_status_config_missing',
          configPath: this.configPath,
          msg,
        });
        return { error: true, message: msg };
      }
      throw err;
    }

    // Optional single-meeting filter
    const meetingId = input['meetingId'] as string | undefined;

    let meetings: MeetingDefinition[];
    if (meetingId !== undefined) {
      const found = config.meetings.find((m) => m.id === meetingId);
      if (!found) {
        const msg = `Error: No meeting with id '${meetingId}' found in smart-meetings-config.json.`;
        logger.warn({
          operation: 'smart_meetings_status_meeting_not_found',
          meetingId,
          msg,
        });
        return { error: true, message: msg };
      }
      meetings = [found];
    } else {
      meetings = config.meetings;
    }

    // Build MeetingStatus for each meeting
    const now = new Date();

    const buildStatus = (meeting: MeetingDefinition): MeetingStatus => {
      const cadenceDebt = calculateCadenceDebt(meeting, now);

      // Derive lastOccurrence from most recent history entry (occurred or scheduled)
      const relevant = meeting.history
        .filter((h) => h.status === 'occurred' || h.status === 'scheduled')
        .sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          if (a.status === 'occurred' && b.status !== 'occurred') return -1;
          if (b.status === 'occurred' && a.status !== 'occurred') return 1;
          return 0;
        });

      const latestHistory = relevant[0] ?? null;
      const lastOccurrence = latestHistory
        ? `${latestHistory.date}T${latestHistory.startTime}:00.000Z`
        : null;

      return {
        meetingId: meeting.id,
        title: meeting.title,
        enabled: meeting.enabled,
        cadence: meeting.cadence,
        lastOccurrence,
        nextScheduled: null,
        cadenceDebt,
        attendees: meeting.attendees,
        pendingReschedule: meeting.pendingReschedule,
      };
    };

    // Separate enabled from disabled, sort enabled by debtDays DESC (nulls last)
    const enabledMeetings = meetings.filter((m) => m.enabled);
    const disabledMeetings = meetings.filter((m) => !m.enabled);

    const sortedEnabled = enabledMeetings
      .map((m) => buildStatus(m))
      .sort((a, b) => {
        const debtA = a.cadenceDebt.debtDays;
        const debtB = b.cadenceDebt.debtDays;
        // nulls last
        if (debtA === null && debtB === null) return 0;
        if (debtA === null) return 1;
        if (debtB === null) return -1;
        return debtB - debtA;
      });

    const sortedDisabled = disabledMeetings.map((m) => buildStatus(m));

    const meetingStatuses: MeetingStatus[] = [...sortedEnabled, ...sortedDisabled];

    // Build response
    const response: SmartMeetingsStatusResponse = {
      generatedAt: now.toISOString(),
      meetings: meetingStatuses,
      timePortfolio: this.portfolioRef.current,
      ...(this.portfolioRef.current === null
        ? {
            _meta: {
              portfolioUnavailable: true,
              reason:
                'Rebalance pass has not yet run. Portfolio data will be available after the first Monday 08:00 rebalance.',
            },
          }
        : {}),
    };

    logger.info({
      operation: 'smart_meetings_status_success',
      meetingCount: meetingStatuses.length,
      hasPortfolio: this.portfolioRef.current !== null,
      msg: 'smart_meetings_status returned successfully',
    });

    return response;
  }
}
