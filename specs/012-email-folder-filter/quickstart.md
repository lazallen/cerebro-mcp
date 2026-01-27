# Quickstart: Email Folder Filtering

**Feature**: Email Folder Filtering for List-Emails
**Date**: 2026-01-27
**Audience**: Users of the Cerebro MCP server

## Overview

The `list-emails` tool now supports filtering emails by folder, allowing you to retrieve emails from specific folders like inbox, spam, sent, or drafts. By default, only inbox emails are returned, eliminating spam from your email triage workflow.

## Basic Usage

### List Inbox Emails (Default)

Retrieve the most recent inbox emails without spam or junk:

```typescript
// No folder parameter needed - defaults to inbox
{
  "count": 10
}
```

**Response**:
```json
{
  "emails": [
    {
      "id": "AAMkAG...",
      "subject": "Project Update",
      "from": { "emailAddress": { "name": "John Doe", "address": "john@example.com" } },
      "receivedDateTime": "2026-01-27T10:30:00Z",
      "bodyPreview": "Here's the latest update...",
      "isRead": false
    }
  ],
  "count": 10
}
```

### List Spam Emails

Review spam emails that were automatically filtered:

```typescript
{
  "count": 20,
  "folder": "spam"
}
```

### List Sent Emails

Check emails you've sent:

```typescript
{
  "count": 15,
  "folder": "sent"
}
```

### List All Emails (Cross-Folder Search)

Retrieve emails from all folders (original behavior):

```typescript
{
  "count": 50,
  "folder": "all"
}
```

## Supported Folders

| Folder Name | Description | Microsoft Graph Folder |
|-------------|-------------|------------------------|
| `inbox` | Primary inbox (default) | inbox |
| `spam` | Spam/junk email folder | junkemail |
| `junk` | Alias for spam folder | junkemail |
| `sent` | Sent items | sentitems |
| `drafts` | Draft messages | drafts |
| `trash` | Deleted items | deleteditems |
| `deleted` | Alias for trash | deleteditems |
| `all` | All folders (cross-folder search) | (all folders) |

**Note**: Folder names are **case-insensitive**. "Inbox", "INBOX", and "inbox" all work identically.

## Common Use Cases

### Email Triage (Default Behavior)

Retrieve inbox emails for daily triage without spam contamination:

```typescript
// Simple inbox retrieval
{ "count": 20 }
```

**Before this feature**: Would include spam emails mixed with inbox emails
**After this feature**: Only inbox emails, no spam

### Spam Review

Periodically check spam folder for false positives:

```typescript
{ "count": 25, "folder": "spam" }
```

### Sent Email Search

Find recently sent emails:

```typescript
{ "count": 30, "folder": "sent" }
```

### Draft Recovery

Retrieve draft emails you've been working on:

```typescript
{ "count": 10, "folder": "drafts" }
```

### Cross-Folder Search

Search across all folders when needed:

```typescript
{
  "count": 50,
  "folder": "all"
}
```

## Migration from Old Behavior

### Old Behavior (Before Feature)

```typescript
// Retrieved emails from ALL folders (inbox + spam + junk + sent + drafts)
{ "count": 10 }
```

### New Behavior (After Feature)

```typescript
// Default: Retrieves only inbox emails
{ "count": 10 }

// To get old behavior: Explicitly request all folders
{ "count": 10, "folder": "all" }
```

**Impact**: Spam emails no longer appear in default results. This is an **improvement** for most users, as it solves the core problem of spam contaminating email triage.

## Error Handling

### Invalid Folder

```typescript
// Request
{ "count": 10, "folder": "archive" }

// Error Response
{
  "error": {
    "message": "Invalid folder: archive. Supported folders: inbox, spam, junk, sent, drafts, trash, deleted, all"
  }
}
```

### Empty Folder

```typescript
// Request (spam folder has no emails)
{ "count": 10, "folder": "spam" }

// Response (not an error, valid empty result)
{
  "emails": [],
  "count": 0
}
```

### Not Authenticated

```typescript
// Request without authentication
{ "count": 10, "folder": "inbox" }

// Error Response
{
  "error": {
    "message": "Not authenticated. Please run authenticate tool."
  }
}
```

**Solution**: Run the `authenticate` tool first to complete OAuth authentication.

## Integration Examples

### Claude Desktop

```json
{
  "mcpServers": {
    "cerebro": {
      "command": "node",
      "args": ["/path/to/cerebro-mcp/dist/index.js"],
      "env": {
        "MICROSOFT_CLIENT_ID": "your-client-id",
        "MICROSOFT_CLIENT_SECRET": "your-client-secret",
        "MICROSOFT_TENANT_ID": "your-tenant-id"
      }
    }
  }
}
```

**Usage in Claude**:
```
User: "List my inbox emails"
Claude: [Calls list-emails with default folder=inbox]

User: "Check my spam folder"
Claude: [Calls list-emails with folder=spam]

User: "Show me sent emails"
Claude: [Calls list-emails with folder=sent]
```

### Programmatic Usage (TypeScript)

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'email-client',
  version: '1.0.0',
});

// List inbox emails
const inboxResult = await client.callTool({
  name: 'list-emails',
  arguments: {
    count: 20,
    folder: 'inbox', // Can omit this - inbox is default
  },
});

// List spam emails
const spamResult = await client.callTool({
  name: 'list-emails',
  arguments: {
    count: 15,
    folder: 'spam',
  },
});

// List all emails
const allResult = await client.callTool({
  name: 'list-emails',
  arguments: {
    count: 50,
    folder: 'all',
  },
});
```

## Best Practices

### 1. Use Default Inbox for Daily Triage

For most email triage scenarios, use the default behavior (inbox only):

```typescript
✅ Good: { "count": 20 }  // Clear intent, inbox default
❌ Avoid: { "count": 20, "folder": "inbox" }  // Redundant, inbox is default
```

### 2. Explicitly Request Other Folders

When checking spam or other folders, be explicit:

```typescript
✅ Good: { "count": 25, "folder": "spam" }  // Clear intent
✅ Good: { "count": 30, "folder": "sent" }  // Explicit folder
```

### 3. Use "all" Sparingly

Only use `folder="all"` when you genuinely need cross-folder search:

```typescript
✅ Good: { "count": 50, "folder": "all" }  // Searching across all folders
❌ Avoid: Using "all" by default (defeats spam filtering purpose)
```

### 4. Handle Empty Folders Gracefully

Empty folders return `count: 0`, not an error. Check the count before processing:

```typescript
const result = await client.callTool({
  name: 'list-emails',
  arguments: { count: 10, folder: 'spam' },
});

if (result.count === 0) {
  console.log('No spam emails found');
} else {
  // Process emails
}
```

### 5. Case-Insensitive Folder Names

Folder names are normalized to lowercase. Use any casing you prefer:

```typescript
✅ All valid:
  { "folder": "inbox" }
  { "folder": "Inbox" }
  { "folder": "INBOX" }
```

## Troubleshooting

### Problem: Getting Empty Results

**Symptom**: `{ "emails": [], "count": 0 }`

**Possible Causes**:
1. The folder genuinely has no emails (not an error)
2. You're checking the wrong folder (e.g., expecting inbox but folder="sent")
3. OAuth scope missing (should include `Mail.Read`)

**Solution**:
```typescript
// Try different folders
{ "count": 10, "folder": "inbox" }
{ "count": 10, "folder": "spam" }
{ "count": 10, "folder": "all" }  // Check if emails exist in any folder
```

### Problem: "Invalid folder" Error

**Symptom**: `Invalid folder: Archive. Supported folders: inbox, spam...`

**Cause**: Requesting an unsupported folder name

**Solution**: Use only supported folders (inbox, spam, junk, sent, drafts, trash, deleted, all)

**Note**: Custom folders are not supported in this version

### Problem: "Not authenticated" Error

**Symptom**: `Not authenticated. Please run authenticate tool.`

**Cause**: OAuth tokens not present or expired

**Solution**:
```typescript
// 1. Run authenticate tool
await client.callTool({ name: 'authenticate', arguments: {} });

// 2. Complete OAuth flow in browser

// 3. Retry list-emails
await client.callTool({
  name: 'list-emails',
  arguments: { count: 10 },
});
```

## Performance Considerations

- **Inbox filtering**: ~Same performance as before (single API call)
- **Folder-specific requests**: ~Same performance (single API call to different endpoint)
- **Cross-folder search**: Same performance as old default behavior

**No additional latency** introduced by folder filtering (no extra API calls for folder resolution).

## FAQ

### Q: Why did the default behavior change?

**A**: The old default returned emails from all folders, mixing spam with legitimate inbox emails. This made email triage difficult. The new default (inbox only) solves the spam contamination problem that prompted this feature request.

### Q: How do I get the old behavior back?

**A**: Set `folder="all"` to retrieve emails from all folders:
```typescript
{ "count": 10, "folder": "all" }
```

### Q: Can I filter by custom folders?

**A**: Not in this version. Custom folder support may be added in a future enhancement if there's user demand. Currently, only standard folders are supported.

### Q: Are subfolders supported?

**A**: No. Only top-level folders (inbox, spam, sent, etc.) are supported. Subfolder support may be added in a future enhancement.

### Q: Is this a breaking change?

**A**: Technically yes (changes default behavior), but it's designed as a **non-breaking improvement**:
- Old behavior available via `folder="all"`
- New default solves the spam problem (user value)
- No API contract changes (adds optional parameter)

## Next Steps

- **Try it out**: Start with default inbox filtering: `{ "count": 20 }`
- **Check spam**: Periodically review spam: `{ "count": 25, "folder": "spam" }`
- **Explore folders**: Try different folders to see what works best for your workflow
- **Provide feedback**: Report any issues or enhancement requests

## Related Tools

- `read-email`: Read full email content by ID (works with emails from any folder)
- `send-email`: Send emails (placed in sent folder automatically)
- `authenticate`: Complete OAuth authentication for Microsoft 365
- `check-auth-status`: Verify authentication status

## Support

For issues, questions, or feature requests:
1. Check the [README](../../../README.md) for general documentation
2. Review this quickstart for folder filtering specifics
3. Open a GitHub issue for bugs or enhancement requests
