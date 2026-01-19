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
import { ServiceConfig } from '../types/service';

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
 * Register all available services based on environment configuration
 * @param registry Service registry to register services with
 */
export async function registerServices(registry: ServiceRegistry): Promise<void> {
  logger.info({
    operation: 'service_registration_start',
    msg: 'Starting service registration',
  });

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
}
