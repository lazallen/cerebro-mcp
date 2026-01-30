# Quickstart: Move Email to Folder

**Date**: 2026-01-30
**Feature**: 014-move-email-folder

## Overview

This guide shows how to use the new `move-email` and `move-emails-batch` MCP tools to organize Outlook emails by moving them between folders.

## Prerequisites

1. **Authentication**: Complete Microsoft OAuth authentication first:
   ```javascript
   await mcpClient.callTool('microsoft.authenticate');
   // Complete authentication in browser
   ```

2. **Required Scope**: `Mail.ReadWrite` (automatically requested during authentication)

3. **List Existing Emails**: Get email IDs to move:
   ```javascript
   const emails = await mcpClient.callTool('microsoft.list-emails', {
     folder: 'inbox',
     count: 10
   });
   // emails.emails[0].id = 'AAMkAGI2T...'
   ```

4. **Check Available Folders**: See what folders exist:
   ```javascript
   const folders = await mcpClient.callTool('microsoft.list-mail-folders');
   // folders.folders = [{ id: '...', displayName: 'Archive' }, ...]
   ```

---

## Common Use Cases

### 1. Archive Old Emails

Move a single email from Inbox to Archive folder:

```javascript
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
});

console.log(result);
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Old Newsletter - January 2025',
//   fromFolder: 'Inbox',
//   toFolder: 'Archive',
//   markedAsRead: true,
//   wasIdempotent: false
// }
```

**What happens**:
- Email moves from Inbox to Archive
- Email is automatically marked as read (default behavior)
- Returns confirmation with email subject for verification

---

### 2. Move to Project Folder (Keep Unread)

Move an important email to a project folder while preserving its unread status:

```javascript
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Projects/2026/Q1',
  markAsRead: false
});

console.log(result);
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Action Required: Q1 Planning',
//   fromFolder: 'Inbox',
//   toFolder: 'Projects/2026/Q1',
//   markedAsRead: false,  // Preserved unread status
//   wasIdempotent: false
// }
```

**What happens**:
- Email moves to nested folder `Projects/2026/Q1`
- Email remains unread (attention still needed)
- Folder path uses `/` delimiter for nested folders

---

### 3. Organize Multiple Related Emails

Move several project-related emails to a project folder at once:

```javascript
// Get emails about "Q1 Planning"
const emails = await mcpClient.callTool('microsoft.list-emails', {
  folder: 'inbox',
  count: 50
});

// Filter emails with "Q1 Planning" in subject
const q1Emails = emails.emails
  .filter(e => e.subject.includes('Q1 Planning'))
  .map(e => e.id);

// Move all at once (atomic operation)
const result = await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: q1Emails,
  folderPath: 'Projects/2026/Q1'
});

console.log(result);
// {
//   success: true,
//   count: 5,
//   results: [
//     { success: true, emailId: '...', subject: '...', ... },
//     { success: true, emailId: '...', subject: '...', ... },
//     // ... 3 more
//   ],
//   toFolder: 'Projects/2026/Q1',
//   hadIdempotentMoves: false
// }
```

**What happens**:
- All 5 emails move together (atomic: all succeed or all fail)
- If one email ID is invalid, **no emails are moved**
- All emails are marked as read
- Returns individual results for each email

---

### 4. Clean Up Spam/Junk

Move multiple spam emails to trash:

```javascript
// List spam emails
const spamEmails = await mcpClient.callTool('microsoft.list-emails', {
  folder: 'junk',
  count: 20
});

// Move all to trash
const result = await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: spamEmails.emails.map(e => e.id),
  folderPath: 'trash'
});

console.log(`Moved ${result.count} spam emails to trash`);
```

**What happens**:
- All junk emails move to trash folder
- Well-known folder names work: `junk`, `trash`, `spam`, `deleted`
- Atomic operation ensures consistency

---

### 5. Organize Client Emails

Move client emails to dedicated client folders:

```javascript
// Move email to nested client folder
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Work/Clients/Acme Corp'
});

// Result shows full path
console.log(`Moved to: ${result.toFolder}`);
// "Moved to: Work/Clients/Acme Corp"
```

**What happens**:
- Supports deeply nested folder structures (5+ levels)
- No artificial depth limits (relies on Microsoft Graph API limits)
- Case-sensitive folder names for custom folders

---

### 6. Idempotent Moves (Safe Retry)

Try moving an email that's already in the target folder:

```javascript
// First move
await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
});

// Accidental retry (same email, same folder)
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
});

console.log(result);
// {
//   success: true,
//   emailId: 'AAMkAGI2T...',
//   subject: 'Already Archived',
//   fromFolder: 'Archive',
//   toFolder: 'Archive',
//   markedAsRead: true,
//   wasIdempotent: true  // Indicates no actual move was needed
// }
```

**What happens**:
- Operation succeeds (no error)
- `wasIdempotent: true` indicates email was already in place
- Safe to retry moves without worrying about errors

---

## Error Handling

### Email Not Found

```javascript
try {
  const result = await mcpClient.callTool('microsoft.move-email', {
    emailId: 'INVALID_ID',
    folderPath: 'Archive'
  });
} catch (error) {
  console.error(error);
  // {
  //   success: false,
  //   errorType: 'EMAIL_NOT_FOUND',
  //   message: 'Failed to move email [INVALID_ID]: Email not found or has been deleted.',
  //   emailId: 'INVALID_ID',
  //   folderPath: 'Archive'
  // }
}
```

**Cause**: Email ID doesn't exist or email was deleted
**Solution**: Verify email ID from `list-emails` tool

---

### Folder Not Found

```javascript
try {
  const result = await mcpClient.callTool('microsoft.move-email', {
    emailId: 'AAMkAGI2T...',
    folderPath: 'NonExistentFolder'
  });
} catch (error) {
  console.error(error);
  // {
  //   success: false,
  //   errorType: 'FOLDER_NOT_FOUND',
  //   message: 'Failed to move email [AAMkAGI2T...] "Subject" to folder "NonExistentFolder". Reason: Folder does not exist.',
  //   emailId: 'AAMkAGI2T...',
  //   subject: 'Subject',
  //   folderPath: 'NonExistentFolder'
  // }
}
```

**Cause**: Target folder doesn't exist
**Solution**: Check folder names with `list-mail-folders` tool or create folder manually in Outlook

---

### Nested Folder Path Error

```javascript
try {
  const result = await mcpClient.callTool('microsoft.move-email', {
    emailId: 'AAMkAGI2T...',
    folderPath: 'Work/Clients/NonExistentClient'
  });
} catch (error) {
  console.error(error);
  // {
  //   success: false,
  //   errorType: 'FOLDER_NOT_FOUND',
  //   message: 'Failed to move email [AAMkAGI2T...] "Email" to folder "Work/Clients/NonExistentClient". Reason: Folder path \'NonExistentClient\' not found under \'Work/Clients\'.',
  //   emailId: 'AAMkAGI2T...',
  //   subject: 'Email',
  //   folderPath: 'Work/Clients/NonExistentClient'
  // }
}
```

**Cause**: Part of the nested folder path doesn't exist
**Solution**: Verify each level of the folder hierarchy exists

---

### Batch Operation Failure

```javascript
try {
  const result = await mcpClient.callTool('microsoft.move-emails-batch', {
    emailIds: ['AAMkAGI2T001...', 'INVALID_ID', 'AAMkAGI2T003...'],
    folderPath: 'Archive'
  });
} catch (error) {
  console.error(error);
  // {
  //   success: false,
  //   errorType: 'EMAIL_NOT_FOUND',
  //   message: 'Batch move failed validation:\n- Email [INVALID_ID]: not found',
  //   validationErrors: [
  //     {
  //       emailId: 'INVALID_ID',
  //       reason: 'Email not found or has been deleted'
  //     }
  //   ],
  //   folderPath: 'Archive',
  //   attemptedCount: 3
  // }
}
```

**Cause**: One or more emails in batch are invalid
**Solution**: Validate all email IDs before batch operation
**Note**: **No emails were moved** (atomic behavior)

---

## Best Practices

### 1. Validate Before Batch Operations

Check that all emails exist before attempting a batch move:

```javascript
// Get emails to move
const emailIds = ['id1', 'id2', 'id3'];

// Validate each email exists (parallel requests)
const validations = await Promise.all(
  emailIds.map(id =>
    mcpClient.callTool('microsoft.read-email', { emailId: id })
      .then(() => true)
      .catch(() => false)
  )
);

const validEmails = emailIds.filter((_, i) => validations[i]);

// Move only valid emails
if (validEmails.length > 0) {
  await mcpClient.callTool('microsoft.move-emails-batch', {
    emailIds: validEmails,
    folderPath: 'Archive'
  });
}
```

---

### 2. Use Batch for Multiple Related Emails

**DO**: Use batch move for emails that should move together:
```javascript
await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: [/* 10 related emails */],
  folderPath: 'Projects/Q1'
});
```

**DON'T**: Use individual moves in a loop:
```javascript
// ❌ Slower and not atomic
for (const emailId of emailIds) {
  await mcpClient.callTool('microsoft.move-email', {
    emailId,
    folderPath: 'Projects/Q1'
  });
}
```

**Why**: Batch operations are atomic and faster (validation done once)

---

### 3. Preserve Read Status for Important Emails

Keep important emails unread after moving:

```javascript
await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Important/Action Required',
  markAsRead: false  // Keep unread for visibility
});
```

Use default (mark as read) for archival/cleanup:

```javascript
await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
  // markAsRead defaults to true
});
```

---

### 4. Handle Idempotent Moves Gracefully

Check `wasIdempotent` to distinguish actual moves from no-ops:

```javascript
const result = await mcpClient.callTool('microsoft.move-email', {
  emailId: 'AAMkAGI2T...',
  folderPath: 'Archive'
});

if (result.wasIdempotent) {
  console.log('Email was already in the target folder');
} else {
  console.log('Email moved successfully');
}
```

---

### 5. Use Descriptive Folder Paths

**GOOD**: Clear, hierarchical folder names:
```
Projects/2026/Q1
Work/Clients/Acme Corp
Personal/Finance/Taxes/2026
```

**AVOID**: Flat, ambiguous folder names:
```
Folder1
Misc
Stuff
```

---

### 6. Batch Size Recommendations

**Small batches (1-10 emails)**: Fast, low risk
```javascript
await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: [/* 5 emails */],
  folderPath: 'Archive'
});
```

**Medium batches (10-25 emails)**: Balanced performance
```javascript
await mcpClient.callTool('microsoft.move-emails-batch', {
  emailIds: [/* 20 emails */],
  folderPath: 'Projects'
});
```

**Large batches (25-50 emails)**: Maximum recommended
```javascript
// Consider splitting into smaller batches if operation times out
const batchSize = 25;
for (let i = 0; i < emailIds.length; i += batchSize) {
  const batch = emailIds.slice(i, i + batchSize);
  await mcpClient.callTool('microsoft.move-emails-batch', {
    emailIds: batch,
    folderPath: 'Archive'
  });
}
```

**Why**: Larger batches take longer and increase compensation time if failures occur

---

## Advanced Patterns

### Pattern 1: Move and Categorize by Sender

```javascript
// Get inbox emails
const emails = await mcpClient.callTool('microsoft.list-emails', {
  folder: 'inbox',
  count: 50
});

// Group by sender domain
const emailsBySender = {};
for (const email of emails.emails) {
  const domain = email.from.emailAddress.address.split('@')[1];
  if (!emailsBySender[domain]) {
    emailsBySender[domain] = [];
  }
  emailsBySender[domain].push(email.id);
}

// Move each group to corresponding folder
for (const [domain, emailIds] of Object.entries(emailsBySender)) {
  await mcpClient.callTool('microsoft.move-emails-batch', {
    emailIds,
    folderPath: `Sorted/${domain}`
  });
}
```

---

### Pattern 2: Archive Old Read Emails

```javascript
// Get old read emails from inbox
const emails = await mcpClient.callTool('microsoft.list-emails', {
  folder: 'inbox',
  count: 50
});

const oldReadEmails = emails.emails
  .filter(e => {
    const emailDate = new Date(e.receivedDateTime);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return e.isRead && emailDate < thirtyDaysAgo;
  })
  .map(e => e.id);

if (oldReadEmails.length > 0) {
  await mcpClient.callTool('microsoft.move-emails-batch', {
    emailIds: oldReadEmails,
    folderPath: 'Archive'
  });
  console.log(`Archived ${oldReadEmails.length} old emails`);
}
```

---

### Pattern 3: Move with Confirmation

```javascript
async function moveEmailWithConfirmation(emailId, folderPath) {
  // Read email details first
  const email = await mcpClient.callTool('microsoft.read-email', { emailId });

  console.log(`Move "${email.subject}" to ${folderPath}? (y/n)`);
  const confirm = await getUserInput();  // Your input method

  if (confirm === 'y') {
    const result = await mcpClient.callTool('microsoft.move-email', {
      emailId,
      folderPath
    });
    console.log(`✓ Moved: ${result.subject}`);
  } else {
    console.log('Skipped');
  }
}
```

---

## Troubleshooting

### Issue: "Folder not found" for nested paths

**Problem**: Moving to `Projects/2026/Q1` fails with folder not found

**Solution**:
1. Check each level exists:
   ```javascript
   const folders = await mcpClient.callTool('microsoft.list-mail-folders');
   // Verify "Projects", "Projects/2026", and "Projects/2026/Q1" all exist
   ```
2. Create missing folders manually in Outlook
3. Note: Folder names are case-sensitive for custom folders

---

### Issue: Batch move times out

**Problem**: Moving 100 emails at once times out

**Solution**:
1. Reduce batch size to 25-50 emails
2. Split into multiple sequential batches:
   ```javascript
   const batchSize = 25;
   for (let i = 0; i < emailIds.length; i += batchSize) {
     const batch = emailIds.slice(i, i + batchSize);
     await mcpClient.callTool('microsoft.move-emails-batch', {
       emailIds: batch,
       folderPath: 'Archive'
     });
   }
   ```

---

### Issue: Permission denied

**Problem**: Cannot move emails to certain folders

**Solution**:
1. Check folder permissions in Outlook
2. Verify you have write access to target folder
3. Try moving to a different folder to confirm authentication works
4. Re-authenticate if needed: `microsoft.authenticate`

---

## Next Steps

- Explore other Microsoft email tools: `list-emails`, `read-email`, `send-email`
- Check Microsoft calendar tools: `list-events`, `create-event`
- See OneNote integration: `onenote-create-section`, `onenote-update-page`
- Review full MCP tool documentation in README.md

---

**Feature Version**: 014-move-email-folder
**Last Updated**: 2026-01-30
