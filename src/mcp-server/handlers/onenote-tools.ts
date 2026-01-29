/**
 * OneNote MCP Tool Handlers
 *
 * MCP tool implementations for OneNote meeting notes management
 */

import { logger } from '../../common';
import { OneNoteClient } from '../../services/microsoft/onenote-client';
import { markdownToOneNoteHtml, validateMarkdown } from '../../services/microsoft/markdown-converter';
import type {
  SectionInput,
  SectionCreationResult,
  PageCreationResult,
  PageUpdateInput,
  PageUpdateResult,
} from '../../types/onenote';
import type { InkToTextInput, InkToTextResult } from '../../types/inkml';

/**
 * Create or reuse a OneNote section and populate with meeting pages
 *
 * Tool: microsoft.onenote-create-section
 */
export async function createSectionWithPages(
  client: OneNoteClient,
  input: SectionInput
): Promise<SectionCreationResult> {
  const { name: sectionName, meetings } = input;

  logger.info({
    operation: 'onenote_create_section',
    sectionName,
    meetingCount: meetings.length,
  }, 'Starting section creation workflow');

  try {
    // Validate inputs
    if (!sectionName || sectionName.trim().length === 0) {
      throw new Error('Section name is required');
    }

    if (!meetings || meetings.length === 0) {
      throw new Error('At least one meeting is required');
    }

    // Validate each meeting
    for (const meeting of meetings) {
      if (!meeting.title || meeting.title.trim().length === 0) {
        throw new Error(`Meeting title is required for all meetings`);
      }

      if (!meeting.date) {
        throw new Error(`Meeting date is required for meeting: ${meeting.title}`);
      }

      // Validate markdown if provided
      if (meeting.preBriefNotes) {
        const validation = validateMarkdown(meeting.preBriefNotes);
        if (!validation.valid) {
          throw new Error(`Invalid markdown for meeting "${meeting.title}": ${validation.errors.join(', ')}`);
        }
      }
    }

    // Get default notebook
    const notebook = await client.getDefaultNotebook();

    // Ensure section exists (find or create)
    const section = await client.ensureSectionExists(notebook.id, sectionName);

    // Sort meetings by time
    const sortedMeetings = client.sortPagesByTime(meetings);

    // Create pages for each meeting
    const createdPages: PageCreationResult[] = [];
    const skippedPages: Array<{ title: string; reason: string }> = [];

    for (const meeting of sortedMeetings) {
      try {
        // Check for duplicates
        const isDuplicate = await client.isDuplicatePage(section.id, meeting.title);

        if (isDuplicate) {
          logger.info({
            sectionId: section.id,
            meetingTitle: meeting.title,
          }, 'Skipping duplicate page');

          skippedPages.push({
            title: meeting.title,
            reason: 'Page already exists',
          });
          continue;
        }

        // Convert markdown to HTML
        const htmlContent = markdownToOneNoteHtml(
          meeting.title,
          meeting.preBriefNotes || '# Meeting Notes\n\n*No pre-brief notes provided*'
        );

        // Create page
        const page = await client.createPage(section.id, meeting.title, htmlContent);

        createdPages.push({
          pageId: page.id,
          title: page.title,
          webUrl: page.links?.oneNoteWebUrl?.href,
          createdDateTime: page.createdDateTime,
        });

        logger.info({
          pageId: page.id,
          title: page.title,
        }, 'Created meeting page');
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
          meetingTitle: meeting.title,
        }, 'Failed to create page for meeting');

        skippedPages.push({
          title: meeting.title,
          reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const result: SectionCreationResult = {
      sectionId: section.id,
      sectionName: section.displayName,
      createdPages,
      skippedPages,
      totalMeetings: meetings.length,
      totalCreated: createdPages.length,
      totalSkipped: skippedPages.length,
    };

    logger.info({
      operation: 'onenote_create_section',
      sectionId: section.id,
      totalCreated: createdPages.length,
      totalSkipped: skippedPages.length,
    }, 'Section creation workflow complete');

    return result;
  } catch (error) {
    logger.error({
      operation: 'onenote_create_section',
      error: error instanceof Error ? error.message : String(error),
      sectionName,
    }, 'Section creation workflow failed');
    throw error;
  }
}

/**
 * Update pre-brief notes on an existing OneNote page
 *
 * Tool: microsoft.onenote-update-page
 */
export async function updatePage(
  client: OneNoteClient,
  input: PageUpdateInput
): Promise<PageUpdateResult> {
  const { sectionName, meetingTitle, content } = input;

  logger.info({
    operation: 'onenote_update_page',
    sectionName,
    meetingTitle,
  }, 'Starting page update workflow');

  try {
    // Validate inputs
    if (!sectionName || sectionName.trim().length === 0) {
      throw new Error('Section name is required');
    }

    if (!meetingTitle || meetingTitle.trim().length === 0) {
      throw new Error('Meeting title is required');
    }

    if (!content || content.trim().length === 0) {
      throw new Error('Content is required');
    }

    // Validate markdown
    const validation = validateMarkdown(content);
    if (!validation.valid) {
      throw new Error(`Invalid markdown: ${validation.errors.join(', ')}`);
    }

    // Get default notebook
    const notebook = await client.getDefaultNotebook();

    // Find section by name
    const section = await client.findSectionByName(notebook.id, sectionName);
    if (!section) {
      throw new Error(`Section not found: ${sectionName}`);
    }

    // Find page by title
    const page = await client.findPageByTitle(section.id, meetingTitle);
    if (!page) {
      throw new Error(`Page not found: ${meetingTitle} in section ${sectionName}`);
    }

    // Convert markdown to HTML
    const htmlContent = markdownToOneNoteHtml(meetingTitle, content);

    // Update page content
    const updatedPage = await client.updatePageContent(page.id, meetingTitle, htmlContent);

    const result: PageUpdateResult = {
      pageId: updatedPage.id,
      title: updatedPage.title,
      updated: true,
      lastModifiedDateTime: updatedPage.lastModifiedDateTime,
      webUrl: updatedPage.links?.oneNoteWebUrl?.href,
    };

    logger.info({
      operation: 'onenote_update_page',
      pageId: updatedPage.id,
      lastModifiedDateTime: updatedPage.lastModifiedDateTime,
    }, 'Page update workflow complete');

    return result;
  } catch (error) {
    logger.error({
      operation: 'onenote_update_page',
      error: error instanceof Error ? error.message : String(error),
      sectionName,
      meetingTitle,
    }, 'Page update workflow failed');
    throw error;
  }
}

/**
 * Convert handwritten ink strokes to text using OCR
 *
 * Tool: microsoft.onenote-get-ink-text
 */
export async function getInkText(
  client: OneNoteClient,
  input: InkToTextInput
): Promise<InkToTextResult> {
  const { sectionName, meetingTitle, language = 'eng', dpi = 96, useLocalFoundry = false, savePng = false } = input;
  const startTime = Date.now();

  logger.info({
    operation: 'onenote_get_ink_text',
    sectionName,
    meetingTitle,
    language,
    dpi,
    useLocalFoundry,
  }, 'Starting ink-to-text conversion');

  try {
    // Validate inputs
    if (!sectionName || sectionName.trim().length === 0) {
      throw new Error('Section name is required');
    }

    if (!meetingTitle || meetingTitle.trim().length === 0) {
      throw new Error('Meeting title is required');
    }

    // Get default notebook
    const notebook = await client.getDefaultNotebook();

    // Find section by name
    const section = await client.findSectionByName(notebook.id, sectionName);
    if (!section) {
      throw new Error(`Section not found: ${sectionName}`);
    }

    // Find page by title
    const page = await client.findPageByTitle(section.id, meetingTitle);
    if (!page) {
      throw new Error(`Page not found: ${meetingTitle} in section ${sectionName}`);
    }

    // Fetch page content with InkML
    const { inkmlXml } = await client.getPageContentWithInk(page.id);

    if (!inkmlXml) {
      logger.info({ pageId: page.id }, 'No ink data found on page');
      return {
        pageId: page.id,
        title: page.title,
        hasInk: false,
        recognizedText: '',
        ocrMethod: 'none',
        processingTime: Date.now() - startTime,
        strokeCount: 0,
      };
    }

    // Import parsers and renderers
    const { parseInkML } = await import('../../services/microsoft/inkml-parser');
    const { renderStrokesToPNG, savePngForDebug } = await import('../../services/microsoft/ink-renderer');

    // Parse InkML to extract strokes
    const inkData = parseInkML(inkmlXml);

    if (inkData.strokes.length === 0) {
      logger.info({ pageId: page.id }, 'No strokes found in InkML data');
      return {
        pageId: page.id,
        title: page.title,
        hasInk: false,
        recognizedText: '',
        ocrMethod: 'none',
        processingTime: Date.now() - startTime,
        strokeCount: 0,
      };
    }

    // Render strokes to PNG
    const { buffer, width, height } = await renderStrokesToPNG(inkData, dpi);

    // Save PNG for debugging if requested
    let debugPngPath: string | undefined;
    if (savePng) {
      debugPngPath = await savePngForDebug(buffer, page.id);
    }

    // Perform OCR
    let recognizedText = '';
    let confidence = 0;
    let ocrMethod: 'tesseract' | 'localfoundry' | 'none' = 'none';

    if (useLocalFoundry) {
      // Use LocalFoundry directly
      const { recognizeWithVision } = await import('../../ocr/localfoundry-recognizer');
      const localFoundryEndpoint = process.env['LOCALFOUNDRY_ENDPOINT'] || 'http://localhost:8080/v1/chat/completions';
      const localFoundryModel = process.env['LOCALFOUNDRY_MODEL'] || 'phi-4';

      try {
        const result = await recognizeWithVision(buffer, localFoundryEndpoint, localFoundryModel);
        recognizedText = result.text;
        confidence = result.confidence;
        ocrMethod = 'localfoundry';
      } catch (error) {
        logger.warn({
          error: error instanceof Error ? error.message : String(error),
        }, 'LocalFoundry recognition failed');
        throw error;
      }
    } else {
      // Try Tesseract first
      const { recognizeHandwriting } = await import('../../ocr/tesseract-recognizer');

      try {
        const result = await recognizeHandwriting(buffer, language);
        recognizedText = result.text;
        confidence = result.confidence;
        ocrMethod = 'tesseract';

        // If Tesseract confidence is too low, try LocalFoundry fallback
        if (confidence < 0.6) {
          logger.info({ confidence }, 'Tesseract confidence low, trying LocalFoundry fallback');

          const { recognizeWithVision } = await import('../../ocr/localfoundry-recognizer');
          const localFoundryEndpoint = process.env['LOCALFOUNDRY_ENDPOINT'] || 'http://localhost:8080/v1/chat/completions';
          const localFoundryModel = process.env['LOCALFOUNDRY_MODEL'] || 'phi-4';

          try {
            const fallbackResult = await recognizeWithVision(buffer, localFoundryEndpoint, localFoundryModel);
            recognizedText = fallbackResult.text;
            confidence = fallbackResult.confidence;
            ocrMethod = 'localfoundry';

            logger.info('LocalFoundry fallback succeeded');
          } catch (fallbackError) {
            logger.warn({
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            }, 'LocalFoundry fallback failed, using Tesseract result');
            // Keep Tesseract result
          }
        }
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
        }, 'Tesseract recognition failed');
        throw error;
      }
    }

    const processingTime = Date.now() - startTime;

    const result: InkToTextResult = {
      pageId: page.id,
      title: page.title,
      hasInk: true,
      recognizedText,
      ocrMethod,
      confidence,
      processingTime,
      strokeCount: inkData.strokes.length,
      imageDimensions: { width, height },
      debugPngPath,
    };

    logger.info({
      operation: 'onenote_get_ink_text',
      pageId: page.id,
      ocrMethod,
      confidence,
      textLength: recognizedText.length,
      processingTime,
    }, 'Ink-to-text conversion complete');

    return result;
  } catch (error) {
    logger.error({
      operation: 'onenote_get_ink_text',
      error: error instanceof Error ? error.message : String(error),
      sectionName,
      meetingTitle,
      processingTime: Date.now() - startTime,
    }, 'Ink-to-text conversion failed');
    throw error;
  }
}
