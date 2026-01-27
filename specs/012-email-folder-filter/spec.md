# Feature Specification: Email Folder Filtering for List-Emails

**Feature Branch**: `012-email-folder-filter`
**Created**: 2026-01-27
**Status**: Draft
**Input**: User description: "The cerebro MCP server's list-emails function currently returns emails from all folders (inbox, spam, junk, etc.) because it likely calls the Microsoft Graph API endpoint /me/messages. This makes email triage difficult as spam emails get mixed in with legitimate inbox emails. During email triage on 2026-01-26, we discovered that emails like PAT testing spam were being returned alongside work emails, even though they weren't visible in the inbox (likely filtered to spam folder automatically). I would like to add an optional folder parameter to the list-emails function, with the default value being the inbox."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default Inbox-Only Email Listing (Priority: P1)

As a user performing email triage, I want the list-emails function to return only inbox emails by default, so that spam and junk emails don't clutter my email list and I can focus on legitimate messages.

**Why this priority**: This is the core problem being solved. Users currently see spam mixed with legitimate emails, making triage ineffective. This single change delivers immediate value by filtering out unwanted emails automatically.

**Independent Test**: Can be fully tested by calling list-emails without any folder parameter and verifying only inbox emails are returned (no spam, junk, or other folder emails appear in results).

**Acceptance Scenarios**:

1. **Given** user has emails in inbox and spam folders, **When** user calls list-emails without specifying a folder parameter, **Then** only inbox emails are returned
2. **Given** user has spam emails that were automatically filtered, **When** user calls list-emails without parameters, **Then** spam emails (like PAT testing spam) do not appear in results
3. **Given** user has emails in multiple folders (inbox, sent, drafts, spam), **When** user calls list-emails without parameters, **Then** results contain only inbox emails, excluding all other folders

---

### User Story 2 - Explicit Folder Selection (Priority: P2)

As a user, I want to optionally specify which email folder to retrieve emails from, so that I can review emails in specific folders (spam, junk, sent, drafts) when needed.

**Why this priority**: While most users need inbox-only by default, there are legitimate scenarios where users need to check spam or other folders. This adds flexibility without complicating the default use case.

**Independent Test**: Can be tested independently by calling list-emails with specific folder parameters (spam, junk, sent, drafts) and verifying only emails from the requested folder are returned.

**Acceptance Scenarios**:

1. **Given** user wants to review spam emails, **When** user calls list-emails with folder parameter set to "spam", **Then** only spam folder emails are returned
2. **Given** user wants to check sent emails, **When** user calls list-emails with folder parameter set to "sent", **Then** only sent folder emails are returned
3. **Given** user wants to review junk emails, **When** user calls list-emails with folder parameter set to "junk", **Then** only junk folder emails are returned

---

### User Story 3 - All Folders Email Listing (Priority: P3)

As a user, I want to optionally retrieve emails from all folders when needed, so that I can perform comprehensive email searches across my entire mailbox.

**Why this priority**: This maintains backward compatibility with the current behavior for users who may need cross-folder email searches. It's the lowest priority because it represents the problematic behavior users are trying to avoid by default.

**Independent Test**: Can be tested by calling list-emails with a special "all" or equivalent folder parameter and verifying emails from all folders (inbox, spam, junk, sent, drafts) are returned.

**Acceptance Scenarios**:

1. **Given** user needs to search across all folders, **When** user calls list-emails with folder parameter set to "all" or equivalent, **Then** emails from all folders are returned
2. **Given** user has emails in inbox, spam, and junk folders, **When** user calls list-emails with "all" parameter, **Then** results include emails from inbox, spam, junk, and all other folders

---

### Edge Cases

- What happens when user specifies a folder that doesn't exist in their mailbox?
- What happens when user specifies a folder name that exists but is empty (contains no emails)?
- How does the system handle folder names with special characters or case sensitivity (e.g., "Inbox" vs "inbox")?
- What happens when a user's mailbox has custom folder names created by the user?
- How does the system handle subfolders or nested folder structures?
- What happens when the user doesn't have permission to access a specific folder?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept an optional folder parameter in the list-emails function
- **FR-002**: System MUST default to the inbox folder when no folder parameter is provided
- **FR-003**: System MUST return only emails from the specified folder when a folder parameter is provided
- **FR-004**: System MUST support standard email folder names including inbox, spam, junk, sent, and drafts
- **FR-005**: System MUST handle invalid or non-existent folder names with clear error messages
- **FR-006**: System MUST allow users to retrieve emails from all folders when explicitly requested
- **FR-007**: System MUST maintain existing email response format and structure (only filtering behavior changes)
- **FR-008**: System MUST handle folder names in a case-insensitive manner
- **FR-009**: System MUST preserve existing pagination and sorting behavior when filtering by folder

### Key Entities

- **Email Folder**: Represents a mailbox folder (inbox, spam, junk, sent, drafts, or custom folders). Contains a folder name/identifier and may contain zero or more emails.
- **Email Message**: Represents an individual email that belongs to exactly one folder at a time. Contains standard email attributes (subject, sender, recipients, body, date, etc.).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users performing email triage see zero spam or junk emails in default list-emails results (100% inbox-only filtering)
- **SC-002**: Users can successfully retrieve emails from any valid folder within 2 seconds
- **SC-003**: Email triage task completion time reduces by at least 30% by eliminating need to manually filter out spam emails
- **SC-004**: Zero regression in existing list-emails functionality (all current valid use cases continue to work)
- **SC-005**: 95% of users successfully use default inbox filtering without needing to specify folder parameter
- **SC-006**: Invalid folder requests return clear error messages within 1 second, with 100% accuracy

## Assumptions

- Users primarily want to triage inbox emails, not spam or junk emails
- The email system uses standard folder naming conventions (inbox, spam, junk, sent, drafts)
- Folder structure is flat or the system can handle hierarchical folders transparently
- Users have appropriate permissions to access the folders they request
- Existing email sorting and pagination mechanisms work independently of folder filtering
- The default "inbox" folder exists in all user mailboxes (standard for email systems)

## Dependencies

- Email service provider must support folder-based email retrieval
- Email service provider must expose folder identifiers or names that can be used for filtering
- Existing authentication and authorization mechanisms must support folder-level access

## Out of Scope

- Creating, renaming, or deleting email folders
- Moving emails between folders
- Modifying folder permissions or access control
- Folder management UI or visualization
- Email search functionality (beyond folder-based filtering)
- Email sorting or advanced filtering rules (beyond folder selection)
- Multi-folder selection (retrieving emails from multiple specific folders simultaneously)
