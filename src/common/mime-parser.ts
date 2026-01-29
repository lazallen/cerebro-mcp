/**
 * Multipart MIME Parser
 *
 * Utilities for parsing multipart MIME responses from Microsoft Graph API
 */

import { logger } from './index';

/**
 * Extract boundary string from Content-Type header
 */
export function extractBoundary(contentType: string): string | null {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch || !boundaryMatch[1]) {
    return null;
  }

  // Remove quotes if present
  return boundaryMatch[1].replace(/"/g, '');
}

/**
 * Parse multipart MIME response and extract sections by content type
 */
export function parseMultipartResponse(
  responseText: string,
  contentType: string
): Map<string, string> {
  const boundary = extractBoundary(contentType);

  if (!boundary) {
    logger.error({ contentType }, 'Failed to extract boundary from Content-Type header');
    throw new Error('Invalid multipart response: no boundary found');
  }

  // Split by boundary markers
  const parts = responseText.split(`--${boundary}`);

  const parsedParts = new Map<string, string>();

  for (const part of parts) {
    // Skip empty parts and the final closing boundary (ends with --)
    if (!part.trim() || part.trim() === '--') {
      continue;
    }

    // Find the Content-Type header
    const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!contentTypeMatch || !contentTypeMatch[1]) {
      continue;
    }

    const partContentType = contentTypeMatch[1].trim();

    // Extract the main MIME type (before any semicolon/parameters)
    const mimeTypeParts = partContentType.split(';');
    const mimeType = mimeTypeParts[0]?.trim();
    if (!mimeType) {
      continue;
    }

    // Find where content starts (after headers, marked by double newline)
    const contentStart = part.search(/\r?\n\r?\n/);
    if (contentStart === -1) {
      continue;
    }

    // Extract content (skip the double newline)
    const content = part.substring(contentStart).replace(/^\r?\n\r?\n/, '').trim();

    parsedParts.set(mimeType, content);

    logger.info({
      mimeType,
      contentLength: content.length,
    }, 'Parsed MIME part');
  }

  logger.info({
    totalParts: parsedParts.size,
    mimeTypes: Array.from(parsedParts.keys()),
  }, 'Multipart parsing complete');

  return parsedParts;
}

/**
 * Extract InkML XML from multipart response
 */
export function extractInkML(responseText: string, contentType: string): string | null {
  try {
    logger.info({
      responseLength: responseText.length,
      contentType,
    }, 'Starting InkML extraction');

    const parts = parseMultipartResponse(responseText, contentType);

    // Look for InkML content type
    const inkmlContent = parts.get('application/inkml+xml');

    logger.info({
      foundInkML: !!inkmlContent,
      inkmlLength: inkmlContent?.length || 0,
      availableMimeTypes: Array.from(parts.keys()),
    }, 'InkML extraction result');

    if (inkmlContent) {
      // Ensure it starts with XML declaration
      const xmlStart = inkmlContent.indexOf('<?xml');
      if (xmlStart !== -1) {
        return inkmlContent.substring(xmlStart);
      }
      return inkmlContent;
    }

    logger.warn('No InkML content found in multipart response');
    return null;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to extract InkML from multipart response');
    return null;
  }
}

/**
 * Extract HTML content from multipart response
 */
export function extractHtml(responseText: string, contentType: string): string | null {
  try {
    const parts = parseMultipartResponse(responseText, contentType);

    const htmlContent = parts.get('text/html');
    if (htmlContent) {
      return htmlContent;
    }

    logger.warn('No HTML content found in multipart response');
    return null;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to extract HTML from multipart response');
    return null;
  }
}
