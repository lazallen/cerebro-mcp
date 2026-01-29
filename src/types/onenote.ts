/**
 * OneNote Type Definitions
 *
 * Type definitions for Microsoft OneNote entities via Graph API
 */

// Input types (user-facing)
export interface MeetingInput {
  title: string;
  date: string;              // ISO 8601 date (YYYY-MM-DD)
  time?: string;             // ISO 8601 datetime (optional)
  preBriefNotes?: string;    // Markdown format
}

export interface SectionInput {
  name: string;              // "YYYY-MM-DD [descriptor]"
  meetings: MeetingInput[];
}

export interface PageUpdateInput {
  sectionName: string;
  meetingTitle: string;
  content: string;           // Markdown format
}

// Internal types (OneNote Graph API)
export interface OneNoteSection {
  id: string;
  displayName: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  pagesUrl: string;
  parentNotebook?: {
    id: string;
    displayName: string;
  };
}

export interface OneNotePage {
  id: string;
  title: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  contentUrl: string;
  links?: {
    oneNoteClientUrl?: { href: string };
    oneNoteWebUrl?: { href: string };
  };
  parentSection?: {
    id: string;
    displayName: string;
  };
}

export interface OneNotePageContent {
  id: string;
  title: string;
  htmlContent: string;
}

export interface OneNoteNotebook {
  id: string;
  displayName: string;
  isDefault?: boolean;
  createdDateTime: string;
  lastModifiedDateTime: string;
}

// Response types
export interface SectionCreationResult {
  sectionId: string;
  sectionName: string;
  createdPages: PageCreationResult[];
  skippedPages: {
    title: string;
    reason: string;
  }[];
  totalMeetings: number;
  totalCreated: number;
  totalSkipped: number;
}

export interface PageCreationResult {
  pageId: string;
  title: string;
  webUrl?: string;
  createdDateTime: string;
}

export interface PageUpdateResult {
  pageId: string;
  title: string;
  updated: boolean;
  lastModifiedDateTime: string;
  webUrl?: string;
}

export interface SectionDeletionResult {
  sectionId: string;
  sectionName: string;
  deleted: boolean;
  pageCount?: number;
}

// Graph API List Response
export interface OneNoteListResponse<T> {
  '@odata.context': string;
  '@odata.nextLink'?: string;
  value: T[];
}
