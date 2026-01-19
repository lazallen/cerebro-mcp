# Feature 007: Slack OAuth Fixes & OAuth Server Enhancements

**Status**: Implemented
**Priority**: P0 (Critical - Bug Fix)
**Estimated Effort**: Small
**Target Release**: v0.3.1

---

## Overview

Fixes critical OAuth authentication issues with Slack integration and enhances the unified OAuth server to support diverse OAuth provider patterns. Addresses bugs where Slack OAuth v2 was using incorrect parameters and response parsing, and extends the OAuth server architecture to handle both bot and user-level scopes with configurable delimiters.

---

## Business Context

### Problem Statement

After implementing Feature 006 (Slack Integration), the OAuth authentication flow failed with two critical issues:

1. **Authorization URL Issue**: The OAuth URL was using `scope` instead of `user_scope` and space-separated scopes instead of comma-separated scopes
   - Generated URL: `...&scope=channels%3Aread%20channels%3Ahistory...` (wrong)
   - Expected URL: `...&user_scope=channels%3Aread%2Cchannels%3Ahistory...` (correct)

2. **Token Exchange Issue**: After user authorization, token exchange failed with "No access token in response"
   - Code was looking for `access_token` at top level
   - Actual location: `authed_user.access_token` for user tokens

### Root Cause

Slack OAuth v2 distinguishes between:
- **Bot scopes** (`scope` parameter): For bot-level permissions, token at top level
- **User scopes** (`user_scope` parameter): For user-level permissions, token in `authed_user.access_token`

Since Feature 006 requests user-level permissions (channels, messages, reminders), it must use `user_scope` with comma-separated values, and parse tokens from the `authed_user` object.

### Impact

Without these fixes:
- Slack authentication completely non-functional
- Users cannot authorize the application
- All Slack tools are inaccessible
- Feature 006 is effectively broken

### Success Criteria

1. ✅ Slack OAuth authorization URL uses `user_scope` parameter
2. ✅ Scopes are comma-separated in authorization URL
3. ✅ Token exchange correctly parses `authed_user.access_token`
4. ✅ OAuth server supports both scope types (bot and user)
5. ✅ OAuth server supports configurable scope delimiters
6. ✅ Solution is extensible for future OAuth providers
7. ✅ Microsoft 365 authentication continues to work (no regression)
8. ✅ Type safety maintained with optional `scopes` field

---

## Technical Design

### Architecture Changes

#### Before (Broken)
```typescript
interface OAuthConfig {
  scopes: string[];  // Required, no distinction between bot/user scopes
  // No delimiter configuration
}

// OAuth URL generation
authParams['scope'] = oauth.scopes.join(' ');  // Always space-separated

// Token parsing
access_token = parsed.access_token;  // Only checks top level
```

#### After (Fixed)
```typescript
interface OAuthConfig {
  scopes?: string[];           // Optional, for bot/app-level scopes
  userScopes?: string[];       // Optional, for user-level scopes
  scopeDelimiter?: string;     // Configurable delimiter
}

// OAuth URL generation
if (oauth.userScopes) {
  const delimiter = oauth.scopeDelimiter ?? ',';
  authParams['user_scope'] = oauth.userScopes.join(delimiter);
}
if (oauth.scopes) {
  const delimiter = oauth.scopeDelimiter ?? ' ';
  authParams['scope'] = oauth.scopes.join(delimiter);
}

// Token parsing (Slack-specific)
const accessToken = parsed.authed_user?.access_token ?? parsed.access_token;
```

### Files Modified

#### Core Type Definitions
- **src/types/service.ts**
  - Made `scopes` optional (was required)
  - Added `userScopes?: string[]` for user-level scopes
  - Added `scopeDelimiter?: string` for configurable delimiters
  - Updated documentation comments

#### OAuth Server
- **src/auth-server/oauth-server.ts**
  - Refactored `buildAuthUrl()` to handle both scope types
  - Added support for `user_scope` parameter
  - Implemented configurable delimiter logic
  - Maintains backward compatibility with space-delimited scopes

#### Slack Service
- **src/services/slack/slack-service.ts**
  - Updated `getAuthorizationUrl()` to use `userScopes`
  - Changed from `scope` to `user_scope` parameter
  - Maintained comma-separated format

- **src/services/slack/token-storage.ts**
  - Fixed token extraction to check `authed_user.access_token` first
  - Falls back to top-level `access_token` for flexibility
  - Extracts user ID and scope from correct location
  - Added TypeScript interface for `authed_user` object

#### Service Registration
- **src/mcp-server/service-registration.ts**
  - Changed Slack config from `scopes` to `userScopes`
  - Added `scopeDelimiter: ','` configuration
  - Scopes remain unchanged, just moved to correct field

#### Microsoft Service (Type Safety)
- **src/services/microsoft/token-storage.ts**
  - Added null safety: `oauth.scopes?.join(' ') ?? ''`
  - Handles optional scopes gracefully

- **src/services/microsoft/microsoft-service.ts**
  - Added null safety: `oauth.scopes?.join(' ') ?? ''`
  - Handles optional scopes gracefully

#### Configuration Cleanup
- **.env.example**
  - Removed unused `MICROSOFT_REDIRECT_URI` variable
  - Removed unused `MICROSOFT_SCOPES` variable
  - Removed unused `MICROSOFT_TOKEN_PATH` variable
  - Removed unused `SLACK_REDIRECT_URI` variable
  - Removed unused `SLACK_TOKEN_PATH` variable
  - Added documentation comments showing hardcoded values

### Implementation Details

#### Slack OAuth v2 Response Structure

**When using `user_scope`**:
```json
{
  "ok": true,
  "access_token": "xoxb-...",  // Bot token (if bot scopes also requested)
  "token_type": "bot",
  "scope": "chat:write",
  "team": {
    "id": "T123456",
    "name": "Workspace Name"
  },
  "authed_user": {
    "id": "U123456",
    "access_token": "xoxp-...",  // USER TOKEN HERE ✅
    "token_type": "user",
    "scope": "channels:read,channels:history,..."  // Comma-separated
  }
}
```

**Key takeaways**:
1. User tokens are in `authed_user.access_token`
2. User scopes are comma-separated in `authed_user.scope`
3. Top-level `access_token` is for bot (if bot scopes requested)

#### OAuth Server Extensibility

The enhanced OAuth server now supports:

| Provider | Scope Type | Parameter | Delimiter |
|----------|-----------|-----------|-----------|
| Microsoft | App-level | `scope` | Space ` ` |
| Slack (bot) | Bot-level | `scope` | Comma `,` |
| Slack (user) | User-level | `user_scope` | Comma `,` |
| Future providers | Either/both | Configurable | Configurable |

**Configuration examples**:

```typescript
// Microsoft (space-separated app scopes)
{
  scopes: ['Mail.Read', 'Calendars.ReadWrite'],
  scopeDelimiter: ' '  // Optional, defaults to ' '
}

// Slack (comma-separated user scopes)
{
  userScopes: ['channels:read', 'channels:history'],
  scopeDelimiter: ','
}

// Hypothetical service with both
{
  scopes: ['bot:read', 'bot:write'],           // Bot scopes
  userScopes: ['user:read', 'user:profile'],   // User scopes
  scopeDelimiter: ','
}
```

---

## Testing Strategy

### Manual Testing Performed
1. ✅ Slack OAuth authorization URL generation
2. ✅ Slack OAuth callback and token exchange
3. ✅ Slack user token storage and retrieval
4. ✅ Slack API calls with user token
5. ✅ Microsoft OAuth still works (no regression)
6. ✅ TypeScript compilation succeeds
7. ✅ Build succeeds without errors

### Automated Testing
- **Existing tests**: OAuth server unit tests continue to pass
- **Note**: Some tests fail due to HTTPS/HTTP mismatch (separate issue, not related to this fix)

### Future Test Improvements
- Add unit tests for `userScopes` configuration
- Add integration tests for Slack user token flow
- Mock Slack OAuth responses in tests
- Add tests for mixed bot/user scope scenarios

---

## Deployment

### Migration Path
No migration required. Changes are:
- **Backward compatible**: Microsoft continues to use `scopes` field
- **Additive**: New `userScopes` and `scopeDelimiter` fields are optional
- **Type-safe**: TypeScript enforces correct usage

### Rollout Plan
1. Deploy changes
2. Existing Microsoft users: No action required
3. New Slack users: Authentication now works correctly
4. Existing Slack users (if any): Need to re-authenticate

### Rollback Plan
If issues arise:
1. Revert to commit `9c59dce` (before these changes)
2. Slack OAuth will be broken again
3. Microsoft OAuth will continue working

---

## Documentation Updates

### Updated Files
- ✅ `.env.example` - Removed unused variables, added comments
- ✅ `README.md` - Updated with HTTPS setup instructions (separate update)
- ⚠️ `specs/006-slack-integration/spec.md` - Should be updated (see below)
- ⚠️ `specs/002-oauth-authentication/spec.md` - Should be updated (see below)

### Recommended Spec Updates

#### specs/006-slack-integration/spec.md
Add section under "OAuth Configuration":
```markdown
### OAuth Scope Type

Slack OAuth v2 distinguishes between bot and user tokens:
- **Bot scopes** (`scope` parameter): For bot-level permissions
- **User scopes** (`user_scope` parameter): For user-level permissions

This integration uses **user scopes** because all requested permissions are user-level:
- channels:read, channels:history - User's channel access
- groups:read, groups:history - User's private group access
- canvases:read, canvases:write - User's canvas access
- identify - User's identity information
- reminders:read, reminders:write - User's reminders

Configuration:
- Scopes are comma-separated (`,`)
- Authorization uses `user_scope` parameter
- Token is received in `authed_user.access_token` field
```

#### specs/002-oauth-authentication/spec.md
Add section under "Service Configuration":
```markdown
### Multi-Pattern OAuth Support

The OAuth server supports diverse OAuth provider patterns:

**Scope Types**:
- `scopes`: Bot/app-level permissions (e.g., Microsoft Graph API)
- `userScopes`: User-level permissions (e.g., Slack user tokens)
- Both can be used simultaneously for services requiring both

**Scope Delimiters**:
- `scopeDelimiter`: Configurable delimiter for joining scopes
- Defaults: Space (` `) for `scopes`, Comma (`,`) for `userScopes`
- Provider-specific: Microsoft uses space, Slack uses comma

**Authorization URL Generation**:
- Generates `scope` parameter if `scopes` defined
- Generates `user_scope` parameter if `userScopes` defined
- Applies appropriate delimiter based on configuration
```

---

## Lessons Learned

### What Went Well
1. ✅ Problem identified quickly through OAuth URL inspection
2. ✅ Root cause analysis revealed Slack's dual-token model
3. ✅ Extensible solution benefits future OAuth integrations
4. ✅ TypeScript type system caught potential null reference issues
5. ✅ Configuration cleanup improved code maintainability

### What Could Be Improved
1. ⚠️ Initial Slack implementation didn't research OAuth v2 nuances
2. ⚠️ Should have tested OAuth flow end-to-end before committing
3. ⚠️ Could have consulted Slack OAuth v2 documentation more thoroughly
4. ⚠️ Unit tests don't cover user_scope scenarios yet

### Future Considerations
1. When adding new OAuth providers:
   - Research scope parameter names carefully
   - Check delimiter requirements
   - Review token response structure
   - Test authorization and token exchange flows

2. Documentation improvements:
   - Add OAuth provider comparison table
   - Document common OAuth patterns
   - Include troubleshooting guide for OAuth issues

3. Testing improvements:
   - Add OAuth flow integration tests
   - Mock various OAuth provider responses
   - Test mixed scope scenarios (bot + user)

---

## References

- [Slack OAuth v2 Documentation](https://docs.slack.dev/authentication/installing-with-oauth)
- [Slack oauth.v2.access Method](https://docs.slack.dev/reference/methods/oauth.v2.access)
- Git commit: `9c59dce` - Implement Feature 006: Slack Integration (broken)
- Git commit: (this commit) - Fix Slack OAuth and enhance OAuth server

---

## Acceptance Criteria

- [x] Slack OAuth authorization URL uses `user_scope` parameter
- [x] Scopes are comma-separated in authorization URL
- [x] Token exchange successfully extracts `authed_user.access_token`
- [x] Slack authentication flow completes successfully
- [x] All Slack tools are accessible after authentication
- [x] Microsoft 365 authentication continues to work (no regression)
- [x] OAuth server supports both bot and user scope types
- [x] Scope delimiter is configurable per service
- [x] TypeScript compilation succeeds
- [x] Build succeeds without errors
- [x] Code follows project standards and conventions
- [x] Unused environment variables removed from .env.example
- [ ] Unit tests added for userScopes configuration (future)
- [ ] Integration tests added for Slack user token flow (future)
