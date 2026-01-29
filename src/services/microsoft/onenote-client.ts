/**
 * OneNote Client
 *
 * Client for interacting with Microsoft OneNote via Graph API
 */

import { logger } from '../../common';
import type {
  OneNoteNotebook,
  OneNoteSection,
  OneNotePage,
  OneNoteListResponse,
  MeetingInput,
} from '../../types/onenote';

export class OneNoteClient {
  private baseUrl = 'https://graph.microsoft.com/v1.0';
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Get the default OneNote notebook
   */
  async getDefaultNotebook(): Promise<OneNoteNotebook> {
    try {
      logger.debug('Fetching default notebook');

      const response = await fetch(`${this.baseUrl}/me/onenote/notebooks?$top=1&$orderby=lastModifiedDateTime desc`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch notebooks: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as OneNoteListResponse<OneNoteNotebook>;

      if (data.value.length === 0) {
        throw new Error('No OneNote notebooks found');
      }

      const notebook = data.value[0];
      if (!notebook) {
        throw new Error('No OneNote notebook found in response');
      }

      logger.info({
        notebookId: notebook.id,
        displayName: notebook.displayName,
      }, 'Retrieved default notebook');

      return notebook;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to get default notebook');
      throw error;
    }
  }

  /**
   * List all sections in a notebook
   */
  async listSections(notebookId: string): Promise<OneNoteSection[]> {
    try {
      logger.debug({ notebookId }, 'Listing sections');

      const response = await fetch(`${this.baseUrl}/me/onenote/notebooks/${notebookId}/sections`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list sections: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as OneNoteListResponse<OneNoteSection>;

      logger.info({
        notebookId,
        sectionCount: data.value.length,
      }, 'Listed sections');

      return data.value;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        notebookId,
      }, 'Failed to list sections');
      throw error;
    }
  }

  /**
   * Create a new section in a notebook
   */
  async createSection(notebookId: string, sectionName: string): Promise<OneNoteSection> {
    try {
      logger.debug({ notebookId, sectionName }, 'Creating section');

      const response = await fetch(`${this.baseUrl}/me/onenote/notebooks/${notebookId}/sections`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: sectionName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create section: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const section = await response.json() as OneNoteSection;

      logger.info({
        sectionId: section.id,
        displayName: section.displayName,
      }, 'Created section');

      return section;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        notebookId,
        sectionName,
      }, 'Failed to create section');
      throw error;
    }
  }

  /**
   * Find a section by name
   */
  async findSectionByName(notebookId: string, sectionName: string): Promise<OneNoteSection | null> {
    try {
      const sections = await this.listSections(notebookId);
      const section = sections.find(s => s.displayName === sectionName);

      if (section) {
        logger.debug({
          sectionId: section.id,
          sectionName,
        }, 'Found section by name');
      } else {
        logger.debug({ sectionName }, 'Section not found');
      }

      return section || null;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        notebookId,
        sectionName,
      }, 'Failed to find section by name');
      throw error;
    }
  }

  /**
   * Ensure a section exists (find or create)
   */
  async ensureSectionExists(notebookId: string, sectionName: string): Promise<OneNoteSection> {
    try {
      // Try to find existing section first
      const existingSection = await this.findSectionByName(notebookId, sectionName);

      if (existingSection) {
        logger.info({
          sectionId: existingSection.id,
          sectionName,
        }, 'Reusing existing section');
        return existingSection;
      }

      // Create new section if not found
      return await this.createSection(notebookId, sectionName);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        notebookId,
        sectionName,
      }, 'Failed to ensure section exists');
      throw error;
    }
  }

  /**
   * List pages in a section
   */
  async listPagesInSection(sectionId: string): Promise<OneNotePage[]> {
    try {
      logger.debug({ sectionId }, 'Listing pages in section');

      const response = await fetch(`${this.baseUrl}/me/onenote/sections/${sectionId}/pages?$select=id,title,createdDateTime,lastModifiedDateTime`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list pages: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as OneNoteListResponse<OneNotePage>;

      logger.info({
        sectionId,
        pageCount: data.value.length,
      }, 'Listed pages in section');

      return data.value;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        sectionId,
      }, 'Failed to list pages in section');
      throw error;
    }
  }

  /**
   * Create a page in a section
   */
  async createPage(sectionId: string, title: string, htmlContent: string): Promise<OneNotePage> {
    try {
      logger.debug({ sectionId, title }, 'Creating page');

      const response = await fetch(`${this.baseUrl}/me/onenote/sections/${sectionId}/pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/xhtml+xml',
        },
        body: htmlContent,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create page: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const page = await response.json() as OneNotePage;

      logger.info({
        pageId: page.id,
        title: page.title,
      }, 'Created page');

      return page;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        sectionId,
        title,
      }, 'Failed to create page');
      throw error;
    }
  }

  /**
   * Check if a page with the given title already exists in the section
   */
  async isDuplicatePage(sectionId: string, meetingTitle: string): Promise<boolean> {
    try {
      const pages = await this.listPagesInSection(sectionId);
      const duplicate = pages.some(page => page.title === meetingTitle);

      if (duplicate) {
        logger.debug({
          sectionId,
          meetingTitle,
        }, 'Duplicate page found');
      }

      return duplicate;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        sectionId,
        meetingTitle,
      }, 'Failed to check for duplicate page');
      throw error;
    }
  }

  /**
   * Find a page by title within a section
   */
  async findPageByTitle(sectionId: string, pageTitle: string): Promise<OneNotePage | null> {
    try {
      const pages = await this.listPagesInSection(sectionId);
      const page = pages.find(p => p.title === pageTitle);

      if (page) {
        logger.debug({
          sectionId,
          pageId: page.id,
          pageTitle,
        }, 'Found page by title');
      } else {
        logger.debug({ sectionId, pageTitle }, 'Page not found');
      }

      return page || null;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        sectionId,
        pageTitle,
      }, 'Failed to find page by title');
      throw error;
    }
  }

  /**
   * Update page content (replaces entire page content)
   */
  async updatePageContent(pageId: string, title: string, htmlContent: string): Promise<OneNotePage> {
    try {
      logger.debug({ pageId, title }, 'Updating page content');

      const response = await fetch(`${this.baseUrl}/me/onenote/pages/${pageId}/content`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            target: 'body',
            action: 'replace',
            content: htmlContent,
          },
        ]),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update page: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // After successful update, fetch the updated page metadata
      const pageResponse = await fetch(`${this.baseUrl}/me/onenote/pages/${pageId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!pageResponse.ok) {
        throw new Error(`Failed to fetch updated page: ${pageResponse.status} ${pageResponse.statusText}`);
      }

      const updatedPage = await pageResponse.json() as OneNotePage;

      logger.info({
        pageId: updatedPage.id,
        title: updatedPage.title,
        lastModifiedDateTime: updatedPage.lastModifiedDateTime,
      }, 'Updated page content');

      return updatedPage;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        pageId,
        title,
      }, 'Failed to update page content');
      throw error;
    }
  }

  /**
   * Get page content with InkML data (multipart MIME response)
   */
  async getPageContentWithInk(pageId: string): Promise<{ htmlContent: string; inkmlXml: string | null }> {
    try {
      logger.debug({ pageId }, 'Fetching page content with InkML');

      const response = await fetch(
        `${this.baseUrl}/me/onenote/pages/${pageId}/content?includeInkML=true`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Accept': 'multipart/form-data',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch page content: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();

      // Import MIME parser (avoid circular dependency)
      const { extractHtml, extractInkML } = await import('../../common/mime-parser');

      // Parse multipart response
      const htmlContent = extractHtml(responseText, contentType) || '';
      const inkmlXml = extractInkML(responseText, contentType);

      logger.info({
        pageId,
        hasHtml: !!htmlContent,
        hasInk: !!inkmlXml,
        inkmlLength: inkmlXml?.length || 0,
      }, 'Fetched page content with InkML');

      return { htmlContent, inkmlXml };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        pageId,
      }, 'Failed to fetch page content with InkML');
      throw error;
    }
  }

  /**
   * Sort pages by time (helper function)
   */
  sortPagesByTime(meetings: MeetingInput[]): MeetingInput[] {
    return [...meetings].sort((a, b) => {
      // If both have time, sort by time
      if (a.time && b.time) {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
      }
      // If only one has time, prioritize it
      if (a.time) return -1;
      if (b.time) return 1;
      // If neither has time, maintain original order
      return 0;
    });
  }
}
