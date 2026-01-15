/**
 * Service Registration Helpers
 *
 * Conditional service registration based on environment variables.
 * Services are only registered if their required credentials are present.
 */

import { ServiceRegistry } from '../common/service-registry';
import { logger } from '../common';

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
// eslint-disable-next-line @typescript-eslint/require-await
export async function registerServices(registry: ServiceRegistry): Promise<void> {
  logger.info({
    operation: 'service_registration_start',
    msg: 'Starting service registration',
  });

  let registeredCount = 0;

  // Microsoft 365
  if (hasMicrosoftCredentials()) {
    // TODO: Implement in Feature 004
    logger.info({
      service: 'microsoft',
      msg: 'Microsoft 365 credentials found (service implementation pending Feature 004)',
    });
  } else {
    logger.info({
      service: 'microsoft',
      msg: 'Microsoft 365 service not registered - missing credentials',
      requiredVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'],
    });
  }

  // Slack
  if (hasSlackCredentials()) {
    // TODO: Implement in Feature 005
    logger.info({
      service: 'slack',
      msg: 'Slack credentials found (service implementation pending Feature 005)',
    });
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
