# Quickstart: Meeting Response Functionality

**Feature**: 015-meeting-response
**Date**: 2026-02-02
**Audience**: Developers integrating meeting response capabilities

## Overview

This guide provides step-by-step instructions for integrating the meeting response functionality into calendar management workflows, specifically the calendar triage command.

---

## Prerequisites

1. **Authentication**: Microsoft OAuth configured and authenticated
2. **Permissions**: `Calendars.ReadWrite` permission granted
3. **MCP Server**: Running on `localhost:3334`
4. **Existing Tools**: Access to `microsoft.list-events`, `microsoft.get-event`

---

## Basic Usage

### 1. Authenticate with Microsoft

```typescript
// Initiate OAuth flow
const authResult = await mcpClient.callTool('microsoft.authenticate');
console.log('Open this URL:', authResult.authUrl);

// Check authentication status
const status = await mcpClient.callTool('microsoft.check-auth-status');
console.log('Authenticated:', status.authenticated);
```

### 2. List Meeting Invitations

```typescript
// Get events for a specific date range
const events = await mcpClient.callTool('microsoft.list-events', {
  startDate: '2026-02-09T00:00:00Z',
  endDate: '2026-02-09T23:59:59Z',
  count: 50
});

console.log(`Found ${events.value.length} events`);
```

### 3. Respond to a Meeting

```typescript
// Decline a meeting with a message
const result = await mcpClient.callTool('microsoft.respond-to-event', {
  eventId: events.value[0].id,
  response: 'declined',
  comment: 'I\'m out of office on this date',
  sendResponse: true
});

if (result.success) {
  console.log('Meeting declined successfully');
} else {
  console.error('Failed to decline:', result.message);
}
```

---

## Calendar Triage Integration

### Automated Holiday Conflict Resolution

**Use Case**: Bulk decline meetings during holidays/time off

**Before (Manual)**:
```markdown
1. Run calendar triage to detect conflicts
2. Review list of conflicting meetings
3. Open Outlook
4. Manually decline each meeting
5. Type custom message for each
```

**After (Automated)**:
```markdown
1. Run calendar triage to detect conflicts
2. Review list of conflicting meetings
3. Confirm bulk decline action
4. System automatically declines all meetings with message
```

### Implementation Steps

#### Step 1: Detect Conflicts

```typescript
// In calendar-triage command
async function detectHolidayConflicts(date: string) {
  const events = await mcpClient.callTool('microsoft.list-events', {
    startDate: `${date}T00:00:00Z`,
    endDate: `${date}T23:59:59Z`
  });

  // Filter to meeting invitations (where user is attendee, not organizer)
  const invitations = events.value.filter(event =>
    event.isOrganizer === false &&
    event.responseStatus?.response !== 'declined'
  );

  return invitations;
}

const conflicts = await detectHolidayConflicts('2026-02-09');
console.log(`Found ${conflicts.length} meetings during holiday`);
```

#### Step 2: Present Conflicts to User

```typescript
// Display conflicts with details
console.log('\nMeetings found during your time off:');
conflicts.forEach((event, index) => {
  console.log(`\n${index + 1}. ${event.subject}`);
  console.log(`   Time: ${event.start.dateTime} - ${event.end.dateTime}`);
  console.log(`   Organizer: ${event.organizer.emailAddress.name}`);
  console.log(`   Attendees: ${event.attendees?.length || 0} people`);
});
```

#### Step 3: Confirm Bulk Action

```typescript
// Ask user for confirmation
const confirmMessage = `\nDecline all ${conflicts.length} meetings with message?\n` +
  `Message: "I'm out of office on this date"\n\n` +
  `Type 'yes' to confirm or 'no' to cancel: `;

const userResponse = await promptUser(confirmMessage);

if (userResponse.toLowerCase() !== 'yes') {
  console.log('Cancelled. No meetings were declined.');
  return;
}
```

#### Step 4: Bulk Decline with Progress

```typescript
// Decline each meeting with progress tracking
console.log('\nDeclining meetings...');

const results = [];
for (let i = 0; i < conflicts.length; i++) {
  const event = conflicts[i];
  const progress = `[${i + 1}/${conflicts.length}]`;

  console.log(`${progress} Declining "${event.subject}"...`);

  try {
    const result = await mcpClient.callTool('microsoft.respond-to-event', {
      eventId: event.id,
      response: 'declined',
      comment: 'I\'m out of office on this date',
      sendResponse: true
    });

    if (result.success) {
      console.log(`${progress} ✓ Declined successfully`);
      results.push({ event: event.subject, status: 'success' });
    } else {
      console.log(`${progress} ✗ Failed: ${result.message}`);
      results.push({ event: event.subject, status: 'failed', error: result.message });
    }

    // Small delay to avoid rate limiting
    await delay(500);

  } catch (error) {
    console.log(`${progress} ✗ Error: ${error.message}`);
    results.push({ event: event.subject, status: 'error', error: error.message });
  }
}
```

#### Step 5: Summary Report

```typescript
// Generate summary
const successCount = results.filter(r => r.status === 'success').length;
const failureCount = results.length - successCount;

console.log('\n--- Summary ---');
console.log(`Total meetings: ${results.length}`);
console.log(`Successfully declined: ${successCount}`);
console.log(`Failed: ${failureCount}`);

if (failureCount > 0) {
  console.log('\nFailed meetings:');
  results
    .filter(r => r.status !== 'success')
    .forEach(r => {
      console.log(`  - ${r.event}: ${r.error}`);
    });
}
```

---

## Advanced Scenarios

### Scenario 1: Accept Meetings from Specific People

```typescript
async function autoAcceptFromVIPs(vipEmails: string[]) {
  const events = await mcpClient.callTool('microsoft.list-events', {
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    count: 50
  });

  for (const event of events.value) {
    const organizerEmail = event.organizer?.emailAddress?.address?.toLowerCase();

    if (vipEmails.includes(organizerEmail)) {
      await mcpClient.callTool('microsoft.respond-to-event', {
        eventId: event.id,
        response: 'accepted',
        sendResponse: true
      });
      console.log(`Auto-accepted meeting from VIP: ${event.subject}`);
    }
  }
}

await autoAcceptFromVIPs(['boss@company.com', 'ceo@company.com']);
```

### Scenario 2: Tentative Response to Potential Conflicts

```typescript
async function tentativeForConflicts() {
  const events = await mcpClient.callTool('microsoft.list-events', {
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  });

  // Group events by time slot
  const timeSlots = new Map();
  events.value.forEach(event => {
    const key = `${event.start.dateTime}-${event.end.dateTime}`;
    if (!timeSlots.has(key)) {
      timeSlots.set(key, []);
    }
    timeSlots.get(key).push(event);
  });

  // Find conflicts (>1 event in same time slot)
  for (const [timeSlot, eventsInSlot] of timeSlots.entries()) {
    if (eventsInSlot.length > 1) {
      console.log(`\nConflict detected: ${eventsInSlot.length} meetings at ${timeSlot}`);

      // Tentatively accept all except first (keep first accepted)
      for (let i = 1; i < eventsInSlot.length; i++) {
        const event = eventsInSlot[i];
        await mcpClient.callTool('microsoft.respond-to-event', {
          eventId: event.id,
          response: 'tentativelyAccepted',
          comment: 'I have a potential conflict at this time',
          sendResponse: true
        });
        console.log(`  Tentatively accepted: ${event.subject}`);
      }
    }
  }
}
```

### Scenario 3: Silent Decline for Spam/Unwanted Meetings

```typescript
async function silentDeclineSpam(spamKeywords: string[]) {
  const events = await mcpClient.callTool('microsoft.list-events', {
    count: 100
  });

  for (const event of events.value) {
    const subject = event.subject?.toLowerCase() || '';

    const isSpam = spamKeywords.some(keyword =>
      subject.includes(keyword.toLowerCase())
    );

    if (isSpam) {
      // Decline without notification to avoid engaging
      await mcpClient.callTool('microsoft.respond-to-event', {
        eventId: event.id,
        response: 'declined',
        sendResponse: false // Silent decline
      });
      console.log(`Silently declined spam: ${event.subject}`);
    }
  }
}

await silentDeclineSpam(['lottery', 'viagra', 'prince']);
```

---

## Error Handling

### Handling Rate Limiting

The system automatically handles rate limiting with exponential backoff:

```typescript
async function bulkRespondWithRateLimit(eventIds: string[], response: string) {
  const results = [];

  for (const eventId of eventIds) {
    try {
      const result = await mcpClient.callTool('microsoft.respond-to-event', {
        eventId,
        response,
        sendResponse: true
      });

      results.push(result);

      // If rate limited, the tool automatically waits and retries
      // You don't need to handle this manually

    } catch (error) {
      if (error.code === 'TooManyRequests') {
        // This should not happen as it's handled internally
        // But log for debugging
        console.error('Rate limit not handled internally:', error);
      }
      results.push({ success: false, eventId, error: error.message });
    }
  }

  return results;
}
```

### Handling Authentication Errors

```typescript
async function respondWithAuthRetry(eventId: string, response: string) {
  try {
    return await mcpClient.callTool('microsoft.respond-to-event', {
      eventId,
      response,
      sendResponse: true
    });
  } catch (error) {
    if (error.code === 'InvalidAuthenticationToken') {
      console.log('Token expired. Re-authenticating...');

      // Re-authenticate
      const authResult = await mcpClient.callTool('microsoft.authenticate');
      console.log('Please complete authentication:', authResult.authUrl);

      // Wait for user to complete auth
      await waitForAuthentication();

      // Retry the operation
      return await mcpClient.callTool('microsoft.respond-to-event', {
        eventId,
        response,
        sendResponse: true
      });
    }

    throw error;
  }
}
```

### Handling Invalid Event IDs

```typescript
async function safeRespond(eventId: string, response: string) {
  const result = await mcpClient.callTool('microsoft.respond-to-event', {
    eventId,
    response,
    sendResponse: true
  });

  if (!result.success) {
    if (result.error?.code === 'ResourceNotFound') {
      console.log(`Event ${eventId} no longer exists. It may have been cancelled.`);
      // Handle gracefully - don't treat as critical error
      return { success: true, skipped: true };
    }

    // Other errors - propagate
    throw new Error(result.message);
  }

  return result;
}
```

---

## Best Practices

### 1. Always Confirm Bulk Operations

```typescript
// ✓ GOOD: Confirm before bulk decline
console.log('About to decline 10 meetings. Continue? (y/n)');
const confirm = await getUserInput();
if (confirm === 'y') {
  await bulkDecline(eventIds);
}

// ✗ BAD: No confirmation
await bulkDecline(eventIds); // User has no chance to cancel
```

### 2. Provide Progress Feedback

```typescript
// ✓ GOOD: Show progress for long operations
for (let i = 0; i < eventIds.length; i++) {
  console.log(`Processing ${i + 1}/${eventIds.length}...`);
  await respond(eventIds[i]);
}

// ✗ BAD: No feedback during long operation
for (const eventId of eventIds) {
  await respond(eventId); // User doesn't know if it's working
}
```

### 3. Handle Partial Failures Gracefully

```typescript
// ✓ GOOD: Track successes and failures separately
const results = { success: [], failed: [] };
for (const eventId of eventIds) {
  const result = await respond(eventId);
  if (result.success) {
    results.success.push(eventId);
  } else {
    results.failed.push({ eventId, error: result.message });
  }
}
console.log(`Success: ${results.success.length}, Failed: ${results.failed.length}`);

// ✗ BAD: Stop on first failure
for (const eventId of eventIds) {
  await respond(eventId); // Throws on first error, rest never processed
}
```

### 4. Respect Rate Limits

```typescript
// ✓ GOOD: Add small delays between requests
for (const eventId of eventIds) {
  await respond(eventId);
  await delay(500); // 500ms between requests
}

// ✗ BAD: Fire all requests simultaneously
await Promise.all(eventIds.map(id => respond(id))); // Will trigger rate limiting
```

### 5. Log Important Actions

```typescript
// ✓ GOOD: Log all meeting responses for audit trail
logger.info({
  operation: 'bulk_decline',
  count: eventIds.length,
  date: '2026-02-09',
  reason: 'holiday',
  msg: 'Bulk declined meetings for holiday'
});

// ✗ BAD: No audit trail
// (silently decline meetings with no record)
```

---

## Testing

### Unit Test Example

```typescript
describe('Calendar Triage Integration', () => {
  it('should decline multiple meetings with progress tracking', async () => {
    const mockEvents = [
      { id: '1', subject: 'Meeting 1' },
      { id: '2', subject: 'Meeting 2' },
      { id: '3', subject: 'Meeting 3' }
    ];

    const results = [];
    for (const event of mockEvents) {
      const result = await respondToEvent(event.id, 'declined');
      results.push(result);
    }

    expect(results.every(r => r.success)).toBe(true);
    expect(results.length).toBe(3);
  });
});
```

### Integration Test Example

```typescript
describe('Meeting Response End-to-End', () => {
  it('should handle holiday conflict workflow', async () => {
    // 1. List events
    const events = await mcpClient.callTool('microsoft.list-events', {
      startDate: '2026-02-09T00:00:00Z',
      endDate: '2026-02-09T23:59:59Z'
    });

    expect(events.value.length).toBeGreaterThan(0);

    // 2. Decline first event
    const result = await mcpClient.callTool('microsoft.respond-to-event', {
      eventId: events.value[0].id,
      response: 'declined',
      comment: 'Out of office',
      sendResponse: true
    });

    expect(result.success).toBe(true);

    // 3. Verify status changed
    const updated = await mcpClient.callTool('microsoft.get-event', {
      eventId: events.value[0].id
    });

    expect(updated.responseStatus.response).toBe('declined');
  });
});
```

---

## Troubleshooting

### Problem: "Event not found" errors

**Cause**: Event was cancelled or deleted between listing and responding

**Solution**: Check event exists before responding
```typescript
const event = await mcpClient.callTool('microsoft.get-event', { eventId });
if (!event) {
  console.log('Event no longer exists, skipping');
  continue;
}
await respond(eventId);
```

### Problem: Rate limiting during bulk operations

**Cause**: Too many requests in short time

**Solution**: Add delays between requests
```typescript
for (const eventId of eventIds) {
  await respond(eventId);
  await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
}
```

### Problem: Authentication expires during bulk operation

**Cause**: Token expires mid-operation

**Solution**: Refresh token before bulk operation
```typescript
await mcpClient.callTool('microsoft.check-auth-status'); // Refreshes if needed
await bulkDecline(eventIds);
```

---

## Summary

This quickstart guide covers:
- ✅ Basic meeting response operations
- ✅ Calendar triage integration with bulk decline
- ✅ Advanced scenarios (VIP auto-accept, conflict detection, spam filtering)
- ✅ Error handling (rate limiting, auth, invalid IDs)
- ✅ Best practices (confirmation, progress, partial failures, logging)
- ✅ Testing examples (unit and integration)
- ✅ Troubleshooting common issues

For complete API reference, see [contracts/event-response-api.md](contracts/event-response-api.md).
