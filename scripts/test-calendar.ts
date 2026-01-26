#!/usr/bin/env ts-node
/**
 * Manual test script for Microsoft Calendar list-events endpoint
 *
 * Usage: npx ts-node scripts/test-calendar.ts
 */

import { MicrosoftService } from '../src/services/microsoft/microsoft-service';
import { ServiceConfig } from '../src/types/service';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testCalendar() {
  console.log('='.repeat(80));
  console.log('Microsoft Calendar Test - Today\'s Events');
  console.log('='.repeat(80));
  console.log();

  // Create service configuration
  const config: ServiceConfig = {
    name: 'microsoft',
    displayName: 'Microsoft 365',
    apiEndpoint: 'https://graph.microsoft.com/v1.0',
    oauth: {
      clientId: process.env['MICROSOFT_CLIENT_ID'] || '',
      clientSecret: process.env['MICROSOFT_CLIENT_SECRET'] || '',
      tenantId: process.env['MICROSOFT_TENANT_ID'] || 'common',
      redirectUri: process.env['OAUTH_REDIRECT_URI'] || 'https://localhost:3333/auth/microsoft/callback',
      scopes: [
        'offline_access',
        'User.Read',
        'Mail.Read',
        'Mail.Send',
        'Calendars.ReadWrite',
      ],
      authEndpoint: `https://login.microsoftonline.com/${process.env['MICROSOFT_TENANT_ID'] || 'common'}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${process.env['MICROSOFT_TENANT_ID'] || 'common'}/oauth2/v2.0/token`,
    },
    tokenStorePath: './.tokens/microsoft-tokens.json',
  };

  // Initialize service
  console.log('Initializing Microsoft service...');
  const service = new MicrosoftService(config);
  await service.initialize();

  // Check authentication
  const isAuth = await service.isAuthenticated();
  console.log(`Authentication status: ${isAuth ? '✓ Authenticated' : '✗ Not authenticated'}`);
  console.log();

  if (!isAuth) {
    console.error('ERROR: Not authenticated. Please authenticate first using the authenticate tool.');
    process.exit(1);
  }

  // Get today's events only
  console.log('Fetching calendar events for TODAY only...');
  console.log();

  const tools = service.getTools();
  const listEventsTool = tools.find((t) => t.name === 'list-events');

  if (!listEventsTool) {
    console.error('ERROR: list-events tool not found');
    process.exit(1);
  }

  try {
    // Get today's date range (start of day to end of day)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Call the list-events handler
    const result = await listEventsTool.handler({
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
      count: 100, // Get up to 100 events
    });

    const data = result as {
      events: Array<{
        subject: string;
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
        location?: { displayName?: string };
        organizer?: { emailAddress?: { name?: string; address?: string } };
        attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>;
        isAllDay?: boolean;
        onlineMeeting?: { joinUrl?: string };
      }>;
      count: number;
      totalRetrieved: number;
      hasMore: boolean;
      startDate: string;
      endDate: string;
    };

    console.log(`Query Range: ${data.startDate} to ${data.endDate}`);
    console.log(`Events Found: ${data.count} (Total Retrieved: ${data.totalRetrieved})`);
    console.log(`Has More Pages: ${data.hasMore ? 'Yes' : 'No'}`);
    console.log();
    console.log('='.repeat(80));
    console.log();

    if (data.events.length === 0) {
      console.log('No events found in the specified date range.');
    } else {
      // Display each event
      data.events.forEach((event, index) => {
        console.log(`Event ${index + 1}:`);
        console.log(`  Subject: ${event.subject}`);

        // Format date/time
        const startDate = new Date(event.start.dateTime);
        const endDate = new Date(event.end.dateTime);

        if (event.isAllDay) {
          console.log(`  When: All day - ${startDate.toLocaleDateString()}`);
        } else {
          console.log(`  Start: ${startDate.toLocaleString()} (${event.start.timeZone})`);
          console.log(`  End: ${endDate.toLocaleString()} (${event.end.timeZone})`);
        }

        if (event.location?.displayName) {
          console.log(`  Location: ${event.location.displayName}`);
        }

        if (event.organizer?.emailAddress) {
          console.log(`  Organizer: ${event.organizer.emailAddress.name || event.organizer.emailAddress.address}`);
        }

        if (event.attendees && event.attendees.length > 0) {
          console.log(`  Attendees: ${event.attendees.length} people`);
          // Show first 3 attendees
          const displayAttendees = event.attendees.slice(0, 3);
          displayAttendees.forEach((attendee) => {
            const name = attendee.emailAddress?.name || attendee.emailAddress?.address || 'Unknown';
            console.log(`    - ${name}`);
          });
          if (event.attendees.length > 3) {
            console.log(`    ... and ${event.attendees.length - 3} more`);
          }
        }

        if (event.onlineMeeting?.joinUrl) {
          console.log(`  Online Meeting: ${event.onlineMeeting.joinUrl}`);
        }

        console.log();
      });
    }

    console.log('='.repeat(80));
    console.log('Test completed successfully!');

  } catch (error) {
    console.error('ERROR: Failed to fetch calendar events');
    console.error(error);
    process.exit(1);
  }

  await service.shutdown();
}

// Run the test
testCalendar().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
