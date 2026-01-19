# Feature 008: Authentication Dashboard & Home Page

**Status**: Draft
**Priority**: P2 (High)
**Estimated Effort**: Small
**Target Release**: v0.4.0

---

## Overview

Create an index/home webpage for the OAuth server that provides a centralized authentication dashboard. The page displays the authentication status of all configured services (Microsoft and Slack), shows whether they are connected or require authentication, and provides buttons to navigate to the correct OAuth login URLs for each service.

---

## Business Context

### Problem Statement

Currently, users must:
- Manually construct OAuth URLs or use CLI tools to authenticate
- Have no visibility into which services are authenticated or not
- Cannot easily determine if tokens are valid or expired
- Need to remember service-specific authentication endpoints

The OAuth server's current home page ([oauth-server.ts:559](src/auth-server/oauth-server.ts#L559)) only shows a basic service list with no actionable buttons or authentication status.

### User Value

With an authentication dashboard, users can:
- See at-a-glance which services are authenticated
- Quickly authenticate or re-authenticate services via one-click buttons
- Understand token status (valid, expired, missing)
- Access a central management interface for all OAuth services
- Have a better onboarding experience when setting up the application

### Impact

**Without this feature:**
- Poor user experience for authentication management
- No visibility into authentication state
- Difficult to troubleshoot authentication issues
- Manual URL construction required

**With this feature:**
- Intuitive visual dashboard for authentication status
- One-click authentication for all services
- Clear indicators for expired or missing tokens
- Better troubleshooting with status details
- Professional landing page for the OAuth server

---

## Technical Design

### Architecture Changes

#### Enhanced Home Page Route

The existing home page handler in [oauth-server.ts:559](src/auth-server/oauth-server.ts#L559) will be enhanced to:

1. **Query authentication status** for all registered services
2. **Display service cards** with status badges and login buttons
3. **Show detailed status information** (token expiry, scopes, etc.)
4. **Provide error information** if credentials are misconfigured

#### Authentication Status Check

For each registered service:
- Check if token storage file exists
- Load token data using `BaseTokenStorage.loadTokens()`
- Determine status:
  - **Connected**: Valid token exists and is not expired
  - **Expired**: Token exists but is expired (or expiring within 5 minutes)
  - **Requires Authentication**: No token file exists
  - **Error**: Configuration issue (missing credentials, invalid token file)

#### UI Components

**Status Badge Colors:**
- **Green**: Connected (valid token)
- **Yellow**: Expired token (needs re-authentication)
- **Gray**: Requires authentication (never authenticated)
- **Red**: Error state (configuration issue)

**Service Card Layout:**
```
┌─────────────────────────────────────┐
│ Microsoft 365              [Status] │
│                                     │
│ Status: Connected                   │
│ Token Expires: 2026-01-20 14:30    │
│ Scopes: Mail.Read, Calendars.Read  │
│                                     │
│ [Authenticate] [View Details]      │
└─────────────────────────────────────┘
```

### Implementation Details

#### Modified File: `src/auth-server/oauth-server.ts`

**Enhanced `renderHomePage()` method:**

```typescript
private async renderHomePage(res: http.ServerResponse): Promise<void> {
  const serviceStatuses = await this.getServiceStatuses();

  const serviceCards = serviceStatuses
    .map(status => this.renderServiceCard(status))
    .join('\n');

  const html = this.renderHtml(
    'Cerebro MCP - Authentication Dashboard',
    'Authentication Dashboard',
    `
      <div class="dashboard-intro">
        <p>Manage OAuth authentication for all configured services.</p>
        <p><strong>Server:</strong> <code>${this.protocol}://localhost:${this.port}</code></p>
      </div>
      <div class="service-grid">
        ${serviceCards}
      </div>
    `,
    'info'
  );

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}
```

**New helper method - `getServiceStatuses()`:**

```typescript
private async getServiceStatuses(): Promise<ServiceStatus[]> {
  const statuses: ServiceStatus[] = [];

  for (const [serviceName, registration] of this.services.entries()) {
    const status = await this.checkServiceAuthStatus(serviceName, registration);
    statuses.push(status);
  }

  return statuses;
}
```

**New helper method - `checkServiceAuthStatus()`:**

```typescript
private async checkServiceAuthStatus(
  serviceName: string,
  registration: AuthServiceRegistration
): Promise<ServiceStatus> {
  const status: ServiceStatus = {
    serviceName,
    displayName: registration.name,
    loginUrl: `${this.protocol}://localhost:${this.port}/auth/${serviceName}/login`,
    state: 'requires_auth',
    message: 'Not authenticated',
  };

  try {
    // Check if token file exists
    const hasTokens = await registration.tokenStorage.hasTokens();

    if (!hasTokens) {
      return status;
    }

    // Load token data
    const tokenData = registration.tokenStorage.getCurrentTokenData();

    if (!tokenData) {
      return status;
    }

    // Check if token is expired
    if (isTokenExpired(tokenData, 5 * 60 * 1000)) {
      status.state = 'expired';
      status.message = 'Token expired - re-authentication required';
      status.expiresAt = tokenData.expiresAt;
    } else {
      status.state = 'connected';
      status.message = 'Connected';
      status.expiresAt = tokenData.expiresAt;
      status.scopes = tokenData.scope?.split(' ');
    }

    return status;
  } catch (error) {
    status.state = 'error';
    status.message = error instanceof Error ? error.message : 'Unknown error';
    return status;
  }
}
```

**New helper method - `renderServiceCard()`:**

```typescript
private renderServiceCard(status: ServiceStatus): string {
  const statusConfig = {
    connected: {
      badge: '✓ Connected',
      color: '#5cb85c',
      bgColor: '#d4edda'
    },
    expired: {
      badge: '⚠ Expired',
      color: '#f0ad4e',
      bgColor: '#fff3cd'
    },
    requires_auth: {
      badge: '○ Not Authenticated',
      color: '#6c757d',
      bgColor: '#e9ecef'
    },
    error: {
      badge: '✗ Error',
      color: '#d9534f',
      bgColor: '#f8d7da'
    },
  };

  const config = statusConfig[status.state];

  let details = `<p><strong>Status:</strong> ${status.message}</p>`;

  if (status.expiresAt) {
    const expiryDate = new Date(status.expiresAt);
    details += `<p><strong>Expires:</strong> ${expiryDate.toLocaleString()}</p>`;
  }

  if (status.scopes && status.scopes.length > 0) {
    details += `<p><strong>Scopes:</strong> ${status.scopes.join(', ')}</p>`;
  }

  return `
    <div class="service-card" style="border-color: ${config.color};">
      <div class="service-header">
        <h2>${status.displayName}</h2>
        <span class="status-badge" style="background-color: ${config.bgColor}; color: ${config.color};">
          ${config.badge}
        </span>
      </div>
      <div class="service-details">
        ${details}
      </div>
      <div class="service-actions">
        <a href="${status.loginUrl}" class="btn btn-primary">
          ${status.state === 'connected' ? 'Re-authenticate' : 'Authenticate'}
        </a>
      </div>
    </div>
  `;
}
```

**New TypeScript Interface:**

```typescript
interface ServiceStatus {
  serviceName: string;
  displayName: string;
  loginUrl: string;
  state: 'connected' | 'expired' | 'requires_auth' | 'error';
  message: string;
  expiresAt?: number;
  scopes?: string[];
}
```

**Enhanced CSS in `renderHtml()`:**

Add to the `<style>` section:

```css
.dashboard-intro {
  margin-bottom: 30px;
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.service-card {
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.service-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.service-header h2 {
  margin: 0;
  font-size: 1.4em;
  color: #333;
}

.status-badge {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: bold;
}

.service-details {
  margin: 15px 0;
  color: #666;
}

.service-details p {
  margin: 8px 0;
}

.service-actions {
  margin-top: 15px;
  display: flex;
  gap: 10px;
}

.btn {
  display: inline-block;
  padding: 10px 20px;
  text-decoration: none;
  border-radius: 4px;
  font-weight: bold;
  transition: all 0.2s;
}

.btn-primary {
  background-color: #0078d4;
  color: white;
}

.btn-primary:hover {
  background-color: #005a9e;
}
```

---

## User Stories

### User Story 1: View Authentication Dashboard (P1)

**As a** user
**I want to** view a dashboard showing all configured services and their authentication status
**So that** I can quickly understand which services need authentication

**Acceptance Criteria**:
1. Dashboard displays all registered services (Microsoft, Slack)
2. Each service shows a clear status indicator (connected/expired/requires auth/error)
3. Status updates reflect current token state
4. Dashboard is accessible at the root URL (`/`)
5. Visual design is clean and professional

**Independent Test**: Navigate to `https://localhost:3333/` and verify all services are displayed with accurate status badges.

---

### User Story 2: One-Click Authentication (P1)

**As a** user
**I want to** click a button to initiate OAuth authentication for any service
**So that** I can easily authenticate without manually constructing URLs

**Acceptance Criteria**:
1. Each service card has an "Authenticate" or "Re-authenticate" button
2. Button links to the correct OAuth login URL for that service
3. Clicking the button initiates the OAuth flow
4. After successful authentication, dashboard shows "Connected" status
5. Button text changes based on current authentication state

**Independent Test**: Click "Authenticate" button for a non-authenticated service, complete OAuth flow, and verify dashboard updates to show "Connected".

---

### User Story 3: View Authentication Details (P2)

**As a** user
**I want to** see detailed information about my authentication status
**So that** I can understand token expiry times and granted permissions

**Acceptance Criteria**:
1. Connected services show token expiration date/time
2. Connected services display granted OAuth scopes
3. Expired services show clear "Expired" status
4. Error states display helpful error messages
5. All timestamps use user's local timezone

**Independent Test**: Authenticate a service and verify the dashboard displays expiration time and scopes accurately.

---

### User Story 4: Responsive Error Handling (P2)

**As a** user
**I want to** see clear error messages when services are misconfigured
**So that** I can troubleshoot authentication issues quickly

**Acceptance Criteria**:
1. Services with missing credentials show error state
2. Error messages are descriptive and actionable
3. Configuration issues highlighted in the dashboard
4. Invalid token files handled gracefully
5. Errors don't crash the server

**Independent Test**: Remove credentials for a service, reload dashboard, and verify error state is displayed with helpful message.

---

### User Story 5: Mobile-Friendly Layout (P3)

**As a** user
**I want to** access the dashboard from any device
**So that** I can manage authentication on mobile or tablet

**Acceptance Criteria**:
1. Dashboard is responsive and adapts to screen size
2. Service cards stack vertically on small screens
3. Buttons and text are readable on mobile devices
4. Touch targets are appropriately sized
5. Grid layout adjusts based on viewport width

**Independent Test**: Access dashboard from mobile device or resize browser window to verify responsive layout.

---

## Functional Requirements

### FR-039: Dashboard Home Page
- **Priority**: P1
- **Description**: Serve an enhanced home page at `/` with authentication dashboard
- **Input**: HTTP GET request to `/`
- **Output**: HTML page with service status cards
- **Acceptance**:
  - Home page displays at root URL
  - All registered services shown
  - Real-time status information displayed
  - Professional visual design applied

### FR-040: Authentication Status Check
- **Priority**: P1
- **Description**: Check and display authentication status for each service
- **Input**: Service registration and token storage
- **Output**: Status object with state, message, expiry, scopes
- **Acceptance**:
  - Reads token files from disk
  - Determines if tokens are valid, expired, or missing
  - Handles errors gracefully
  - Returns structured status data

### FR-041: Service Status Badges
- **Priority**: P1
- **Description**: Display visual status indicators for each service
- **Input**: Service status data
- **Output**: Color-coded status badge
- **Acceptance**:
  - Green badge for connected services
  - Yellow badge for expired tokens
  - Gray badge for unauthenticated services
  - Red badge for error states
  - Clear text labels on badges

### FR-042: Authentication Buttons
- **Priority**: P1
- **Description**: Provide clickable buttons to initiate OAuth flows
- **Input**: Service name and current status
- **Output**: Hyperlink button to login URL
- **Acceptance**:
  - Button links to correct `/auth/:service/login` URL
  - Button text adapts to status (Authenticate vs Re-authenticate)
  - Button styled as primary call-to-action
  - Hover states for better UX

### FR-043: Token Expiry Display
- **Priority**: P2
- **Description**: Show when authentication tokens will expire
- **Input**: Token expiration timestamp
- **Output**: Formatted date/time string
- **Acceptance**:
  - Displays human-readable expiration date
  - Uses local timezone for display
  - Only shown for connected services
  - Format: "YYYY-MM-DD HH:MM"

### FR-044: Scope Display
- **Priority**: P2
- **Description**: List OAuth scopes granted for each service
- **Input**: Token scope string
- **Output**: Comma-separated scope list
- **Acceptance**:
  - Parses scope string into individual permissions
  - Displays all granted scopes
  - Only shown for connected services
  - Clear formatting and readability

### FR-045: Responsive Grid Layout
- **Priority**: P3
- **Description**: Display service cards in responsive grid
- **Input**: Number of services
- **Output**: CSS grid with appropriate columns
- **Acceptance**:
  - Uses CSS Grid for layout
  - Minimum card width: 400px
  - Auto-fills columns based on viewport width
  - Gap spacing between cards: 20px

### FR-046: Error State Handling
- **Priority**: P2
- **Description**: Handle and display authentication errors
- **Input**: Error from token loading or status check
- **Output**: Error status card with message
- **Acceptance**:
  - Catches exceptions from token loading
  - Displays error message to user
  - Shows red error badge
  - Doesn't crash the server
  - Helpful troubleshooting hints

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can view authentication status for all services in under 2 seconds
- **SC-002**: Dashboard displays accurate token status (valid/expired/missing) with 100% accuracy
- **SC-003**: One-click authentication reduces OAuth setup time by 50%
- **SC-004**: Error states provide actionable troubleshooting information 100% of the time
- **SC-005**: Dashboard is responsive and usable on screens 375px wide and larger
- **SC-006**: Page load time is under 500ms for dashboard rendering

---

## Test Plan

### Unit Tests

**Home Page Rendering**:
- ✓ `renderHomePage()` generates valid HTML
- ✓ Dashboard includes all registered services
- ✓ CSS styles are included in output
- ✓ Service grid is properly structured

**Status Checking**:
- ✓ `checkServiceAuthStatus()` returns correct status for connected service
- ✓ Returns "requires_auth" for service without tokens
- ✓ Returns "expired" for service with expired token
- ✓ Returns "error" when token loading fails
- ✓ Handles missing token files gracefully
- ✓ Extracts expiration time correctly
- ✓ Parses scopes correctly

**Service Card Rendering**:
- ✓ `renderServiceCard()` generates correct HTML structure
- ✓ Status badge uses correct color for each state
- ✓ Login button URL is correct
- ✓ Button text changes based on status
- ✓ Expiry time displayed for connected services
- ✓ Scopes displayed for connected services
- ✓ Error messages displayed for error states

**Status Utilities**:
- ✓ `getServiceStatuses()` returns status for all services
- ✓ Handles empty service list
- ✓ Processes multiple services concurrently
- ✓ Returns statuses in consistent order

### Integration Tests (Manual)

**Dashboard Access**:
- [ ] Navigate to `https://localhost:3333/`
- [ ] Verify dashboard loads successfully
- [ ] All configured services displayed
- [ ] Status badges visible and correct
- [ ] CSS styling applied correctly

**Authentication Flow**:
- [ ] Click "Authenticate" button for Microsoft
- [ ] Complete OAuth flow
- [ ] Verify redirect back to success page
- [ ] Return to dashboard (`/`)
- [ ] Verify Microsoft status shows "Connected"
- [ ] Verify token expiry is displayed
- [ ] Verify scopes are listed

**Expired Token Handling**:
- [ ] Manually expire a token (edit token file)
- [ ] Reload dashboard
- [ ] Verify service shows "Expired" status
- [ ] Click "Re-authenticate" button
- [ ] Complete OAuth flow
- [ ] Verify status returns to "Connected"

**Error States**:
- [ ] Remove credentials for a service (env vars)
- [ ] Restart server
- [ ] Verify dashboard still loads
- [ ] Service shows error state
- [ ] Error message is displayed

**Multiple Services**:
- [ ] Configure both Microsoft and Slack
- [ ] Authenticate both services
- [ ] Verify both show "Connected" status
- [ ] Verify each has correct login URL
- [ ] Verify expiry times are different

**Responsive Design**:
- [ ] Access dashboard on desktop (1920px)
- [ ] Resize window to tablet size (768px)
- [ ] Resize window to mobile size (375px)
- [ ] Verify cards stack appropriately
- [ ] Verify buttons remain usable
- [ ] Verify text remains readable

**No Services Configured**:
- [ ] Remove all service credentials
- [ ] Restart server
- [ ] Access dashboard
- [ ] Verify helpful message is shown
- [ ] Verify no errors occur

---

## Security Considerations

### Data Display

- **Token Security**: Never display actual token values in the dashboard
- **Scope Display**: Only show scope names, not sensitive details
- **Expiry Information**: Safe to display as it's not sensitive
- **Error Messages**: Sanitize error messages to avoid leaking sensitive paths or config

### Access Control

- **Local Only**: Dashboard only accessible on localhost
- **No Remote Access**: Server bound to localhost, not exposed externally
- **File Permissions**: Token files remain secured with 0600 permissions
- **Read-Only**: Dashboard only reads tokens, never modifies them

### Attack Vectors

- **XSS Prevention**: All user-facing text properly escaped in HTML
- **No User Input**: Dashboard doesn't accept user input, only displays data
- **Path Traversal**: Token paths resolved securely via path.join()
- **Error Handling**: Errors caught and sanitized before display

---

## Dependencies

### Internal Dependencies
- Feature 002 (OAuth Server) - **COMPLETED** - Base server infrastructure
- Feature 004 (Microsoft Service) - **COMPLETED** - Microsoft token storage
- Feature 006 (Slack Integration) - **COMPLETED** - Slack token storage
- Feature 007 (Slack OAuth Fixes) - **COMPLETED** - Working Slack authentication

### External Dependencies
- None - uses built-in Node.js modules only

---

## Migration & Deployment

### Backward Compatibility

- **Existing Routes**: All existing routes (`/auth/:service/login`, `/auth/:service/callback`) remain unchanged
- **Legacy Routes**: Legacy routes (`/auth`, `/auth/callback`) continue to work
- **API Stability**: No breaking changes to OAuth flow
- **Token Storage**: No changes to token file format or location

### Deployment Steps

1. Deploy updated `oauth-server.ts` with new methods
2. No database migrations required
3. No environment variable changes needed
4. Restart MCP server to apply changes
5. Verify dashboard accessible at `https://localhost:3333/`

### Rollback Plan

If issues arise:
1. Revert to previous version of `oauth-server.ts`
2. Dashboard will show old simple home page
3. All OAuth flows continue working normally
4. No data loss or token invalidation

---

## Future Enhancements (Out of Scope)

- **Token Refresh Button**: Manual token refresh without re-authentication
- **Token Revocation**: Ability to revoke tokens from dashboard
- **Activity Log**: Show recent authentication attempts and API usage
- **Service Health Indicators**: API availability and rate limit status
- **Multi-User Support**: Dashboard for managing multiple user accounts
- **Scope Management**: Edit requested scopes before authentication
- **Token Export**: Download tokens for backup or transfer
- **Dark Mode**: Theme toggle for dashboard
- **Real-Time Updates**: WebSocket-based live status updates
- **QR Code Login**: Generate QR codes for mobile device authentication
- **Session Management**: View and manage active OAuth sessions
- **Audit Trail**: Complete history of authentication events

---

## Documentation Updates

### Files to Update

- **README.md**: Add section about Authentication Dashboard
- **docs/oauth-setup.md**: Include screenshots of dashboard
- **CHANGELOG.md**: Document new feature in release notes

### New Documentation

Create `docs/authentication-dashboard.md` with:
- Dashboard overview and purpose
- Screenshot of dashboard with status examples
- Explanation of status indicators
- Troubleshooting common issues
- FAQ section

---

## References

- [oauth-server.ts:559](src/auth-server/oauth-server.ts#L559) - Current home page implementation
- [base-token-storage.ts](src/common/base-token-storage.ts) - Token loading and status checking
- [service-registration.ts](src/mcp-server/service-registration.ts) - Service configuration and registration
- Feature 002 - OAuth Authentication Server
- Feature 004 - Microsoft 365 Service
- Feature 006 - Slack Integration
- Feature 007 - Slack OAuth Fixes

---

## Implementation Checklist

### Phase 1: Core Status Checking
- [ ] Add `ServiceStatus` interface to oauth-server.ts
- [ ] Implement `checkServiceAuthStatus()` method
- [ ] Implement `getServiceStatuses()` method
- [ ] Add unit tests for status checking
- [ ] Verify status accuracy for all states

### Phase 2: Card Rendering
- [ ] Implement `renderServiceCard()` method
- [ ] Add status badge configuration
- [ ] Create card HTML structure
- [ ] Add unit tests for card rendering
- [ ] Test with different status states

### Phase 3: Dashboard Layout
- [ ] Enhance `renderHomePage()` to use new methods
- [ ] Add CSS grid layout styles
- [ ] Add service card styles
- [ ] Add responsive design CSS
- [ ] Test layout on different screen sizes

### Phase 4: Visual Polish
- [ ] Add status badge colors and styles
- [ ] Style authentication buttons
- [ ] Add hover states and transitions
- [ ] Ensure accessibility (ARIA labels, contrast)
- [ ] Test visual consistency across browsers

### Phase 5: Testing
- [ ] Write unit tests for all new methods
- [ ] Manual testing of all user stories
- [ ] Test with 0, 1, and 2 services configured
- [ ] Test with various authentication states
- [ ] Test error scenarios

### Phase 6: Documentation
- [ ] Update README.md
- [ ] Create authentication-dashboard.md
- [ ] Add inline code comments
- [ ] Update CHANGELOG.md
- [ ] Take screenshots for documentation

---

## Acceptance Criteria

- [x] Spec document created following established pattern
- [ ] `ServiceStatus` interface defined in oauth-server.ts
- [ ] `checkServiceAuthStatus()` method implemented
- [ ] `getServiceStatuses()` method implemented
- [ ] `renderServiceCard()` method implemented
- [ ] `renderHomePage()` method enhanced with new functionality
- [ ] CSS styles added for dashboard layout
- [ ] Status badges implemented with correct colors
- [ ] Authentication buttons functional and styled
- [ ] Token expiry displayed for connected services
- [ ] OAuth scopes displayed for connected services
- [ ] Responsive grid layout implemented
- [ ] Error states handled gracefully
- [ ] Unit tests written for all new methods
- [ ] Unit test coverage ≥ 80% for new code
- [ ] Manual testing completed for all user stories
- [ ] Dashboard accessible at root URL (`/`)
- [ ] All existing OAuth flows continue working
- [ ] TypeScript compilation succeeds
- [ ] ESLint passes with no errors
- [ ] Documentation updated (README, new docs)
- [ ] CHANGELOG updated with new feature
- [ ] Code follows project conventions and style
