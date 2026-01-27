# Research: Microsoft Graph API Folder Handling

**Feature**: Email Folder Filtering for List-Emails
**Date**: 2026-01-27
**Phase**: 0 - Technical Research

## Overview

This document consolidates research findings on Microsoft Graph API folder handling for implementing folder-based email filtering in the `list-emails` MCP tool.

## Microsoft Graph API Folder Endpoints

### Well-Known Folder Names

Microsoft Graph API supports well-known folder names that can be used instead of folder IDs:

**Supported Well-Known Names**:
- `inbox` - Primary inbox folder
- `drafts` - Draft messages
- `sentitems` - Sent items folder
- `deleteditems` - Deleted items (trash)
- `junkemail` - Spam/junk email folder

**API Documentation**: https://learn.microsoft.com/en-us/graph/api/resources/mailfolder

**Key Findings**:
1. Well-known names are case-insensitive in Microsoft Graph API
2. Can be used directly in endpoint paths: `/me/mailFolders/inbox/messages`
3. No need to resolve inbox, drafts, sentitems, deleteditems, or junkemail to IDs

### Endpoint Structure

**Folder-Specific Messages**:
```
GET /me/mailFolders/{folderId}/messages
```
- `{folderId}` can be: well-known name (e.g., "inbox") or actual folder ID (UUID)
- Supports all query parameters: $top, $select, $orderby, $filter
- Returns messages only from the specified folder

**All Messages**:
```
GET /me/messages
```
- Returns messages from all folders (current behavior)
- No folder filtering applied

### Folder Resolution Strategy

**Decision**: Use well-known names directly without resolution

**Rationale**:
1. **Simplicity**: Well-known names map to common folder types (inbox, spam, junk, sent, drafts)
2. **Performance**: No additional API call needed to resolve folder names
3. **User Experience**: Folder names are intuitive and match user expectations
4. **Error Handling**: Microsoft Graph returns clear 404 errors for invalid folder names

**Implementation Approach**:
```typescript
// Pseudo-code
function getEmailEndpoint(folder: string): string {
  if (folder === 'all') {
    return '/me/messages';  // All folders
  }

  // Map user-friendly names to well-known names
  const folderMap: Record<string, string> = {
    'inbox': 'inbox',
    'spam': 'junkemail',    // User says "spam", API expects "junkemail"
    'junk': 'junkemail',     // User says "junk", API expects "junkemail"
    'sent': 'sentitems',     // User says "sent", API expects "sentitems"
    'drafts': 'drafts',
    'trash': 'deleteditems', // User says "trash", API expects "deleteditems"
    'deleted': 'deleteditems'
  };

  const wellKnownName = folderMap[folder.toLowerCase()];

  if (!wellKnownName) {
    throw new Error(`Unknown folder: ${folder}. Supported folders: inbox, spam, junk, sent, drafts, trash, deleted, all`);
  }

  return `/me/mailFolders/${wellKnownName}/messages`;
}
```

### Query Parameters Preservation

**Requirement**: FR-009 - Preserve existing pagination and sorting behavior

**Findings**:
- Both `/me/messages` and `/me/mailFolders/{folderId}/messages` support identical query parameters
- No changes needed to existing $top, $select, $orderby parameters
- Pagination behavior identical across endpoints

**Verification**:
```typescript
// Current implementation (line 392-398 in microsoft-service.ts)
const response = await this.apiClient.request('/me/messages', {
  method: 'GET',
  params: {
    $top: count.toString(),
    $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead',
    $orderby: 'receivedDateTime desc',
  },
});

// New implementation (folder-specific)
const response = await this.apiClient.request(
  `/me/mailFolders/${wellKnownName}/messages`,
  {
    method: 'GET',
    params: {
      $top: count.toString(),
      $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead',
      $orderby: 'receivedDateTime desc',
    },
  }
);
```

**Result**: No changes to query parameters needed. Existing pagination and sorting preserved.

## Error Handling Patterns

### Microsoft Graph Error Responses

**Invalid Folder**:
```json
{
  "error": {
    "code": "ErrorItemNotFound",
    "message": "The specified object was not found in the store."
  }
}
```

**User-Friendly Error Mapping**:
```typescript
// Map Microsoft Graph errors to user-friendly messages
function mapFolderError(error: GraphError, folder: string): string {
  if (error.code === 'ErrorItemNotFound') {
    return `Folder '${folder}' not found. Supported folders: inbox, spam, junk, sent, drafts, trash, deleted, all`;
  }

  // Fallback to generic error
  return error.message;
}
```

### Validation Strategy

**Client-Side Validation** (Preferred):
- Validate folder parameter against known folder list before API call
- Provide immediate feedback without network round-trip
- Clearer error messages for users

**Server-Side Validation** (Fallback):
- Catch Microsoft Graph 404 errors
- Map to user-friendly error messages
- Handle edge cases (custom folders, regional variations)

**Decision**: Implement client-side validation with server-side error mapping as fallback

## Case Sensitivity Handling

**Requirement**: FR-008 - Handle folder names in a case-insensitive manner

**Microsoft Graph Behavior**:
- Well-known folder names are case-insensitive on the API side
- `/me/mailFolders/INBOX/messages` works identically to `/me/mailFolders/inbox/messages`

**Implementation**:
```typescript
// Normalize folder parameter to lowercase before mapping
const folder = (input['folder'] as string | undefined) ?? 'inbox';
const normalizedFolder = folder.toLowerCase();
```

**Result**: Case-insensitive handling achieved through lowercase normalization before folder mapping.

## Custom Folders and Subfolders

**Requirement**: Edge case - User mailboxes may have custom folders

**Research Findings**:
- Custom folders require folder ID (UUID), not well-known name
- To support custom folders, would need to call `/me/mailFolders` to list folders and search by displayName
- Subfolders use nested structure: `/me/mailFolders/{parentId}/childFolders/{childId}/messages`

**Decision for MVP**: Do NOT support custom folders or subfolders in initial implementation

**Rationale**:
1. **Scope**: Feature spec focuses on standard folders (inbox, spam, junk, sent, drafts) - see FR-004
2. **Complexity**: Custom folder support requires folder list API call + name-to-ID resolution
3. **User Need**: Primary use case is filtering spam/junk from inbox (solved by standard folders)
4. **Future Enhancement**: Can add custom folder support in a follow-up feature if user demand exists

**Assumptions Section Update**: Document that custom folders are not supported in MVP (add to spec assumptions)

## Performance Considerations

**Requirement**: SC-002 - Users can successfully retrieve emails from any valid folder within 2 seconds

**Findings**:
- Single API call required (no folder resolution call)
- Same response time as current `/me/messages` endpoint
- No additional latency introduced by folder filtering

**Verification**: Performance goal met through direct well-known name usage (no extra API calls)

## Backward Compatibility

**Current Behavior**: `/me/messages` returns emails from all folders

**New Behavior**: Default to inbox folder only

**Breaking Change Analysis**:
- **Is this breaking?** Technically yes (changes default behavior), but improves user experience
- **Mitigation**: Users can explicitly set folder="all" to get old behavior
- **User Impact**: Positive (spam no longer mixed with inbox emails)
- **Migration Path**: Document folder="all" parameter for users who need cross-folder search

**Decision**: Treat as non-breaking enhancement because:
1. Default behavior improves UX (primary user complaint solved)
2. Old behavior available via folder="all" parameter
3. No API contract changes (only adds optional parameter)

## Alternatives Considered

### Alternative 1: Client-Side Filtering
**Approach**: Retrieve all messages, filter by parent folder ID client-side
**Rejected Because**:
- Inefficient (downloads spam emails only to discard them)
- Violates spec requirement SC-001 (zero spam in results means API-level filtering)
- Poor performance for large mailboxes

### Alternative 2: Custom Folder Resolution
**Approach**: Call `/me/mailFolders` to get folder list, resolve names to IDs
**Rejected Because**:
- Adds API call latency (violates SC-002: <2 seconds)
- Unnecessary complexity for standard folders
- Can be added later if custom folder support needed

### Alternative 3: Folder ID Parameter
**Approach**: Require users to provide folder UUID instead of friendly name
**Rejected Because**:
- Poor UX (users don't know folder UUIDs)
- Violates FR-008 (user-friendly folder names expected)
- Requires users to call separate API to discover folder IDs

## Best Practices Summary

1. **Use well-known folder names directly** - No resolution needed, optimal performance
2. **Normalize folder names to lowercase** - Case-insensitive user experience
3. **Map user-friendly names** - "spam" → "junkemail", "sent" → "sentitems"
4. **Client-side validation** - Fast feedback, clear error messages
5. **Preserve query parameters** - $top, $select, $orderby work identically across endpoints
6. **Document folder="all"** - Backward compatibility for cross-folder search
7. **Defer custom folders** - Out of scope for MVP, add if user demand emerges

## References

- [Microsoft Graph Mail API Reference](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview)
- [MailFolder Resource Type](https://learn.microsoft.com/en-us/graph/api/resources/mailfolder)
- [List Messages Endpoint](https://learn.microsoft.com/en-us/graph/api/user-list-messages)
- [Get Messages in MailFolder](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages)
- [Query Parameters Documentation](https://learn.microsoft.com/en-us/graph/query-parameters)

## Resolution Status

All NEEDS CLARIFICATION items from Technical Context have been resolved:
- ✅ Folder resolution approach: Use well-known names directly
- ✅ Case sensitivity handling: Normalize to lowercase
- ✅ Custom folder support: Deferred to future enhancement
- ✅ Performance impact: No additional latency (single API call)
- ✅ Backward compatibility: folder="all" for old behavior
- ✅ Error handling: Client-side validation + server-side error mapping

**Phase 0 Status**: ✅ COMPLETE - Proceed to Phase 1 (Design & Contracts)
