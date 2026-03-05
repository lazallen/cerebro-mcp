/**
 * Service Registration Helpers
 *
 * Conditional service registration based on environment variables.
 * Services are only registered if their required credentials are present.
 */

import { ServiceRegistry } from '../common/service-registry';
import { logger } from '../common';
import { MicrosoftService } from '../services/microsoft';
import { SlackService } from '../services/slack';
import { LocalFoundryService } from '../services/localfoundry';
import { TriageService } from '../services/triage';
import { SlackSavedItemsService } from '../services/slack-saved-items/slack-saved-items-service';
import { SessionCredentialStorage } from '../services/slack-saved-items/session-credential-storage';
import { WebclientApiClient } from '../services/slack-saved-items/webclient-api-client';
import { ServiceConfig } from '../types/service';
import { loadLocalFoundryConfig } from '../common/config';
import { ConfigLoader } from '../services/heartbeat/config-loader';
import { SmartMeetingsService, createPortfolioRef, PortfolioRef } from '../services/smart-meetings';

/**
 * Check if Microsoft 365 credentials are configured
 */
export function hasMicrosoftCredentials(): boolean {
  return !!(
    process.env['MICROSOFT_CLIENT_ID'] &&
    process.env['MICROSOFT_CLIENT_SECRET'] &&
    process.env['MICROSOFT_TENANT_ID']
  );
}

/**
 * Check if Slack credentials are configured
 */
export function hasSlackCredentials(): boolean {
  return !!(process.env['SLACK_CLIENT_ID'] && process.env['SLACK_CLIENT_SECRET']);
}

/**
 * Result of registering all services, including shared refs needed by other subsystems.
 */
export interface RegisterServicesResult {
  portfolioRef: PortfolioRef;
}

/**
 * Register all available services based on environment configuration
 * @param registry Service registry to register services with
 * @returns Shared refs produced during registration (e.g. portfolioRef for HeartbeatService)
 */
export async function registerServices(registry: ServiceRegistry): Promise<RegisterServicesResult> {
  logger.info({
    operation: 'service_registration_start',
    msg: 'Starting service registration',
  });

  const portfolioRef = createPortfolioRef();

  let registeredCount = 0;

  // Microsoft 365
  if (hasMicrosoftCredentials()) {
    try {
      const tenantId = process.env['MICROSOFT_TENANT_ID'] ?? '';
      const microsoftConfig: ServiceConfig = {
        name: 'microsoft',
        displayName: 'Microsoft 365',
        apiEndpoint: 'https://graph.microsoft.com/v1.0',
        oauth: {
          clientId: process.env['MICROSOFT_CLIENT_ID'] ?? '',
          clientSecret: process.env['MICROSOFT_CLIENT_SECRET'] ?? '',
          tenantId,
          redirectUri: 'https://localhost:3333/auth/microsoft/callback',
          scopes: [
            'offline_access',
            'Mail.Read',
            'Mail.Send',
            'User.Read',
            'Calendars.Read',
            'Calendars.ReadWrite',
            'Notes.ReadWrite',
          ],
          authEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
          tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        },
        tokenStorePath: './.tokens/microsoft-tokens.json',
      };

      const microsoftService = new MicrosoftService(microsoftConfig);
      await registry.register(microsoftService);
      registeredCount++;

      logger.info({
        service: 'microsoft',
        msg: 'Microsoft 365 service registered successfully',
      });
    } catch (error) {
      logger.error({
        service: 'microsoft',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to register Microsoft 365 service',
      });
    }
  } else {
    logger.info({
      service: 'microsoft',
      msg: 'Microsoft 365 service not registered - missing credentials',
      requiredVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'],
    });
  }

  // Slack
  if (hasSlackCredentials()) {
    try {
      const slackConfig: ServiceConfig = {
        name: 'slack',
        displayName: 'Slack',
        apiEndpoint: 'https://slack.com/api',
        oauth: {
          clientId: process.env['SLACK_CLIENT_ID'] ?? '',
          clientSecret: process.env['SLACK_CLIENT_SECRET'] ?? '',
          redirectUri: 'https://localhost:3333/auth/slack/callback',
          userScopes: [
            'channels:read',
            'channels:history',
            'groups:read',
            'groups:history',
            'canvases:read',
            'canvases:write',
            'identify',
            'reminders:read',
            'reminders:write',
          ],
          scopeDelimiter: ',', // Slack requires comma-separated scopes
          authEndpoint: 'https://slack.com/oauth/v2/authorize',
          tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
        },
        tokenStorePath: './.tokens/slack-tokens.json',
      };

      const slackService = new SlackService(slackConfig);
      await registry.register(slackService);
      registeredCount++;

      logger.info({
        service: 'slack',
        msg: 'Slack service registered successfully',
      });
    } catch (error) {
      logger.error({
        service: 'slack',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to register Slack service',
      });
    }
  } else {
    logger.info({
      service: 'slack',
      msg: 'Slack service not registered - missing credentials',
      requiredVars: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    });
  }

  // LocalFoundry
  const localFoundryConfig = loadLocalFoundryConfig();
  if (localFoundryConfig) {
    try {
      const serviceConfig: ServiceConfig = {
        name: 'local',
        displayName: 'LocalFoundry',
        apiEndpoint: localFoundryConfig.endpoint,
        oauth: {
          clientId: '', // No OAuth required
          clientSecret: '',
          redirectUri: '',
          scopes: [],
          authEndpoint: '',
          tokenEndpoint: '',
        },
        tokenStorePath: './.tokens/localfoundry-tokens.json', // Dummy path (not used)
      };

      const localFoundryService = new LocalFoundryService(serviceConfig, localFoundryConfig);
      await registry.register(localFoundryService);
      registeredCount++;

      logger.info({
        service: 'localfoundry',
        endpoint: localFoundryConfig.endpoint,
        model: localFoundryConfig.model,
        msg: 'LocalFoundry service registered successfully',
      });
    } catch (error) {
      logger.error({
        service: 'localfoundry',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to register LocalFoundry service',
      });
    }
  }

  // Triage (always registered when heartbeat config is present)
  try {
    const heartbeatConfigPath = process.env['HEARTBEAT_CONFIG_FILE'] ?? './heartbeat-config.json';
    const heartbeatConfig = await new ConfigLoader(heartbeatConfigPath).loadConfig();
    const systemDir = heartbeatConfig.systemDir ?? `${heartbeatConfig.rootDir}/system`;

    const triageConfig: ServiceConfig = {
      name: 'triage',
      displayName: 'Triage',
      apiEndpoint: '',
      oauth: { clientId: '', clientSecret: '', redirectUri: '', scopes: [], authEndpoint: '', tokenEndpoint: '' },
      tokenStorePath: '',
    };

    const triageService = new TriageService(triageConfig, systemDir);
    await registry.register(triageService);

    logger.info({
      service: 'triage',
      systemDir,
      msg: 'Triage service registered successfully',
    });
  } catch (error) {
    logger.warn({
      service: 'triage',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Triage service not registered — heartbeat config missing or invalid',
    });
  }

  // Slack Saved Items (always registered — no env var required; graceful when no credentials)
  try {
    const credentialStorage = new SessionCredentialStorage();
    const apiClient = new WebclientApiClient(credentialStorage);
    const slackSavedItemsService = new SlackSavedItemsService(credentialStorage, apiClient);
    await registry.register(slackSavedItemsService);

    logger.info({
      service: 'slack-saved-items',
      msg: 'Slack Saved Items service registered successfully',
    });
  } catch (error) {
    logger.error({
      service: 'slack-saved-items',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to register Slack Saved Items service',
    });
  }

  // Smart Meetings (always registered — file-based, no credentials required)
  try {
    const smartMeetingsConfigPath =
      process.env['SMART_MEETINGS_CONFIG_FILE'] ?? './smart-meetings-config.json';
    const microsoftService = registry.get('microsoft');
    const smartMeetingsService = new SmartMeetingsService(
      microsoftService,
      smartMeetingsConfigPath,
      portfolioRef
    );
    await registry.register(smartMeetingsService);

    logger.info({
      service: 'smart-meetings',
      configPath: smartMeetingsConfigPath,
      msg: 'Smart Meetings service registered successfully',
    });
  } catch (error) {
    logger.error({
      service: 'smart-meetings',
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to register Smart Meetings service',
    });
  }

  // Log summary
  registeredCount = registry.list().length;
  logger.info({
    operation: 'service_registration_complete',
    registeredServices: registeredCount,
    msg: `Service registration complete: ${registeredCount} service(s) registered`,
  });

  if (registeredCount === 0) {
    logger.warn({
      operation: 'no_services_registered',
      msg: 'No services registered. Set service credentials in environment variables to enable functionality.',
      hint: 'Example: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID for Microsoft 365',
    });
  }

  return { portfolioRef };
}
