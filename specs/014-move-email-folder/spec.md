# Feature Specification: Move Email to Folder

**Feature Branch**: `014-move-email-folder`
**Created**: 2026-01-30
**Status**: Draft
**Input**: User description: "I would like to add functionality to move e-mails within outlook to different directories. Have an optional flag for marking the email as read - with the default being true."

## Clarifications

### Session 2026-01-30

- Q: When moving multiple emails in a batch, how should the system handle partial failures? → A: Atomic - All emails move successfully or none move (transaction-style, revert on any failure)
- Q: When a user attempts to move an email that is already in the target folder, what should happen? → A: Treat as success - Operation succeeds silently (idempotent behavior, no actual move needed)
- Q: When a user attempts to move an email to a folder path deeper than 5 levels, what should happen? → A: Rely on Microsoft Graph API limits - No artificial depth restriction, let Microsoft Graph API handle any platform limits
- Q: How much detail should error messages include when operations fail? → A: Balanced - Include IDs plus human-readable context like email subject and folder path for easier debugging
- Q: When should the email be marked as read during the move operation? → A: After successful move

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move Single Email to Target Folder (Priority: P1)

A user wants to organize their inbox by moving an email to a specific folder (e.g., from "Inbox" to "Projects/Q1-Planning") to keep their mailbox organized.

**Why this priority**: Core functionality that delivers immediate value - moving emails is the primary feature requested and the most common use case for email organization.

**Independent Test**: Can be fully tested by providing an email ID and target folder name, then verifying the email appears in the destination folder and is marked as read by default.

**Acceptance Scenarios**:

1. **Given** an email exists in the "Inbox" folder, **When** user moves the email to "Projects" folder, **Then** the email appears in "Projects" folder and is marked as read
2. **Given** an email exists in "Inbox" folder, **When** user moves the email to "Archive" folder with markAsRead=false, **Then** the email appears in "Archive" folder and retains its original read/unread status
3. **Given** an email exists in "Sent" folder, **When** user moves the email to "Important" folder, **Then** the email is moved from "Sent" to "Important" and marked as read
4. **Given** an email already exists in "Projects" folder, **When** user attempts to move the same email to "Projects" folder again, **Then** the operation succeeds with confirmation and the email remains in "Projects" folder

---

### User Story 2 - Move Email to Nested Folder Path (Priority: P2)

A user wants to move an email to a nested folder structure (e.g., "Projects/2026/Q1/Planning") to maintain hierarchical organization.

**Why this priority**: Important for users with complex folder structures, but basic single-level folder moves are more common and can work independently.

**Independent Test**: Can be tested by specifying a nested folder path and verifying the email is moved to the correct nested location.

**Acceptance Scenarios**:

1. **Given** an email exists in "Inbox", **When** user moves the email to "Projects/2026/Q1", **Then** the email appears in the nested folder "Projects/2026/Q1" and is marked as read
2. **Given** a nested folder path "Work/Clients/ClientA" exists, **When** user moves an email to "Work/Clients/ClientA", **Then** the email is moved to the correct nested location

---

### User Story 3 - Move Multiple Emails in Batch (Priority: P3)

A user wants to move multiple selected emails to the same destination folder at once to save time when organizing multiple related messages.

**Why this priority**: Nice-to-have optimization for power users, but single email moves provide the core value.

**Independent Test**: Can be tested by providing multiple email IDs and a target folder, then verifying all emails are moved correctly.

**Acceptance Scenarios**:

1. **Given** three emails exist in "Inbox", **When** user moves all three to "Archive" folder, **Then** all three emails appear in "Archive" and are marked as read
2. **Given** five emails exist across different folders, **When** user moves all five to "Projects" folder with markAsRead=false, **Then** all emails appear in "Projects" and retain their original read status
3. **Given** three emails exist in "Inbox" but one has an invalid ID, **When** user attempts to move all three to "Archive" folder, **Then** none of the emails are moved and an error message identifies the invalid email ID

---

### Edge Cases

- What happens when the target folder does not exist? System returns an error message identifying the missing folder.
- What happens when the email ID is invalid or the email has been deleted? System returns an error message indicating the email was not found.
- What happens when trying to move an email that's already in the target folder? Operation succeeds silently (idempotent behavior) with success confirmation.
- How does the system handle moving emails from special folders (Drafts, Sent Items, Deleted Items)? Treated the same as moving from any other folder (no special restrictions).
- What happens when the user lacks permissions to move emails to the target folder? System returns an error message indicating insufficient permissions.
- What happens when moving an email that has already been moved or is part of a conversation thread? Each email is treated independently; conversation relationships are preserved but not validated.
- How does the system handle folder names with special characters or very long paths? Folder names are handled as provided by Microsoft Graph API, including special characters; path length limits follow Microsoft Graph API constraints.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to move an email from its current folder to a specified target folder by email ID
- **FR-002**: System MUST support moving emails to folders specified by name (e.g., "Archive", "Projects")
- **FR-003**: System MUST support moving emails to nested folder paths using forward slash notation (e.g., "Projects/2026/Q1")
- **FR-004**: System MUST mark moved emails as read by default after the move operation completes successfully
- **FR-005**: System MUST accept an optional markAsRead parameter (boolean) that allows users to preserve the original read/unread status
- **FR-006**: System MUST validate that the target folder exists before attempting to move the email
- **FR-007**: System MUST validate that the email ID is valid and the email exists before attempting to move
- **FR-008**: System MUST return clear error messages when the target folder does not exist, including the folder path that was not found
- **FR-009**: System MUST return clear error messages when the email ID is invalid or email not found, including the email ID and subject (if available) for context
- **FR-010**: System MUST return success confirmation including the email ID and destination folder path
- **FR-011**: System MUST support moving emails from any user-accessible folder (inbox, sent, drafts, custom folders)
- **FR-012**: System MUST handle folder names case-sensitively as per Microsoft Graph API behavior
- **FR-013**: System MUST process batch email moves atomically - either all emails in the batch move successfully or none move (transaction-style behavior)
- **FR-014**: System MUST validate all email IDs and the target folder before attempting any moves in a batch operation
- **FR-015**: System MUST return a clear error message identifying which validation failed when a batch operation cannot proceed, including relevant IDs and human-readable context (email subjects, folder paths)
- **FR-016**: System MUST treat attempts to move an email to its current folder as a successful operation (idempotent behavior)
- **FR-017**: System MUST return a success confirmation even when an email is already in the target folder
- **FR-018**: Error messages MUST include both technical identifiers (email IDs, folder IDs) and human-readable context (email subjects, folder paths) to facilitate debugging without exposing sensitive email content
- **FR-019**: System MUST only update the read status of an email after the move operation has completed successfully to maintain data consistency
- **FR-020**: System MUST NOT mark an email as read if the move operation fails or is rolled back

### Key Entities *(include if feature involves data)*

- **Email Message**: Represents an email in the user's mailbox with attributes including message ID, subject, sender, current folder location, and read/unread status
- **Mail Folder**: Represents a folder in the user's mailbox hierarchy with attributes including folder ID, display name, parent folder reference, and path in folder hierarchy

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully move an email to any accessible folder in under 3 seconds
- **SC-002**: 100% of valid move operations result in the email appearing in the correct destination folder
- **SC-003**: 100% of moved emails are marked as read by default unless explicitly specified otherwise
- **SC-004**: System handles invalid email IDs and non-existent folders with clear error messages without system failures
- **SC-005**: Users can successfully move emails to nested folder structures at least 5 levels deep (no artificial depth limits imposed beyond Microsoft Graph API platform constraints)
- **SC-006**: System provides confirmation feedback within 2 seconds of initiating the move operation

## Assumptions

- Users have necessary permissions to move emails within their own mailbox
- The Microsoft Graph API mail.readwrite permission is already available (existing Microsoft email functionality in cerebro-mcp)
- Folder paths use forward slash (/) as the delimiter for nested folders, consistent with existing email folder filtering feature (012-email-folder-filter)
- Default behavior marks emails as read to match common email client behavior (Outlook automatically marks moved emails as read in most scenarios)
- The system will use existing Microsoft Graph authentication and token management
- Moving an email does not modify any other email properties (attachments, metadata, timestamps) except for the read status when specified
- Read status updates occur after successful move completion to maintain consistency and prevent marking emails as read if the move fails
- No artificial folder depth limits are imposed; system relies on Microsoft Graph API platform constraints for folder hierarchy depth and path length validation

## Dependencies

- Existing Microsoft Graph API integration for email operations
- Existing OAuth authentication flow for Microsoft services
- Feature 012-email-folder-filter provides folder path handling patterns that can be referenced

## Out of Scope

- Creating new folders as part of the move operation (user must specify existing folders)
- Moving emails based on search criteria or filters (only explicit email ID moves)
- Undoing or reverting email moves
- Moving emails between different user accounts or mailboxes
- Archiving or deleting emails (this feature only moves them)
- Rules or automation for moving emails based on conditions
- Conversation thread handling (each email is moved independently)
